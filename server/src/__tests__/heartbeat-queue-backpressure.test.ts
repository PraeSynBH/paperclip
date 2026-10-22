// PRA-6499: the queued-run backpressure sweep must actually run, and it must run
// while the agent is saturated (zero free slots). That second property is the whole
// point of the fix: the backlog only exists because the drain paths all return at the
// slot gate, so a sweep placed behind the gate would never fire on the agent that
// needs it.
//
// This suite drives the real service against an embedded Postgres and asserts the
// terminal rows, so it fails if the wiring call site moves behind the gate or the
// module stops being called at all.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  agentRuntimeState,
  agentWakeupRequests,
  companies,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres heartbeat queue backpressure tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const HOUR_MS = 60 * 60 * 1000;

describeEmbeddedPostgres("heartbeat queue backpressure", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-queue-backpressure-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
  }, 60_000);

  afterAll(async () => {
    if (db) {
      await db.delete(heartbeatRunEvents);
      await db.delete(heartbeatRuns);
      await db.delete(agentWakeupRequests);
      await db.delete(agentRuntimeState);
      await db.delete(agents);
      await db.delete(companies);
    }
    await tempDb?.cleanup();
  }, 30_000);

  it("reaps never-started rows past the bound and coalesces per (agent, issue) while the agent is saturated", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const now = Date.now();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `Q${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "SaturatedAgent",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {
        heartbeat: {
          wakeOnDemand: true,
          // intervalSec 0 => reap bound is the 1h floor.
          intervalSec: 0,
          maxConcurrentRuns: 1,
        },
      },
      permissions: {},
    });

    // The occupied slot. `availableSlots` is 0 for the whole test.
    const runningRunId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runningRunId,
      companyId,
      agentId,
      status: "running",
      invocationSource: "automation",
      startedAt: new Date(now - 10_000),
      createdAt: new Date(now - 60_000),
      contextSnapshot: { issueId: randomUUID() },
    });

    const expiredRunId = randomUUID();
    const supersededRunId = randomUUID();
    const keptDuplicateWinnerRunId = randomUUID();
    const freshOtherIssueRunId = randomUUID();
    const sharedIssueId = randomUUID();

    await db.insert(heartbeatRuns).values([
      {
        id: expiredRunId,
        companyId,
        agentId,
        status: "queued",
        invocationSource: "automation",
        createdAt: new Date(now - 3 * HOUR_MS),
        contextSnapshot: { issueId: randomUUID(), wakeReason: "issue_recovery_action_restored" },
      },
      {
        id: supersededRunId,
        companyId,
        agentId,
        status: "queued",
        invocationSource: "automation",
        createdAt: new Date(now - 40_000),
        contextSnapshot: { issueId: sharedIssueId, wakeReason: "issue_commented" },
      },
      {
        id: keptDuplicateWinnerRunId,
        companyId,
        agentId,
        status: "queued",
        invocationSource: "automation",
        createdAt: new Date(now - 20_000),
        contextSnapshot: { issueId: sharedIssueId, wakeReason: "issue_commented" },
      },
      {
        id: freshOtherIssueRunId,
        companyId,
        agentId,
        status: "queued",
        invocationSource: "automation",
        createdAt: new Date(now - 5_000),
        contextSnapshot: { issueId: randomUUID(), wakeReason: "issue_commented" },
      },
    ]);

    await heartbeat.resumeQueuedRuns();

    const rows = await db
      .select({
        id: heartbeatRuns.id,
        status: heartbeatRuns.status,
        errorCode: heartbeatRuns.errorCode,
        resultJson: heartbeatRuns.resultJson,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.agentId, agentId));
    const byId = new Map(rows.map((row) => [row.id, row]));

    // Slot was occupied the whole time, so the reap cannot have come from the drain path.
    expect(byId.get(runningRunId)?.status).toBe("running");

    expect(byId.get(expiredRunId)).toMatchObject({
      status: "cancelled",
      errorCode: "queued_run_expired",
    });
    expect(byId.get(expiredRunId)?.resultJson).toMatchObject({
      stopReason: "queued_run_expired",
      timeoutSource: "queued_run_backpressure",
    });

    expect(byId.get(supersededRunId)).toMatchObject({
      status: "cancelled",
      errorCode: "superseded_by_newer_wake",
    });
    // The newest wake for that issue survives: a duplicate collapse must not drop work.
    expect(byId.get(keptDuplicateWinnerRunId)?.status).toBe("queued");
    // A different issue inside the bound is untouched.
    expect(byId.get(freshOtherIssueRunId)?.status).toBe("queued");

    const lifecycleEvents = await db
      .select({ runId: heartbeatRunEvents.runId, message: heartbeatRunEvents.message })
      .from(heartbeatRunEvents)
      .where(eq(heartbeatRunEvents.runId, expiredRunId));
    expect(lifecycleEvents.length).toBeGreaterThan(0);
    expect(lifecycleEvents.some((event) => /never started/.test(event.message ?? ""))).toBe(true);
  }, 30_000);
});
