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
  issueRelations,
  issues,
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
      await db.delete(issueRelations);
      await db.delete(issues);
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

    // PRX-6045: age reap must only apply to work that is still wakeable, so this row
    // points at a real open issue. (A row whose issue is gone is now cancelled as
    // `issue_not_found` by the wakeability sweep before the age bound is read.)
    const openIssueId = randomUUID();
    await db.insert(issues).values({
      id: openIssueId,
      companyId,
      projectId: null,
      identifier: `Q${openIssueId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      title: "Still wakeable work",
      status: "todo",
      assigneeAgentId: agentId,
      createdByAgentId: null,
      createdByUserId: null,
    });

    // PRX-6045: coalesce/age rules are only reachable for issues that still exist,
    // so the duplicate pair and the untouched row point at real open issues. (A row
    // whose issue is gone is cancelled as `issue_not_found` by the wakeability sweep
    // before either rule is consulted.)
    const sharedIssueId = randomUUID();
    const otherIssueId = randomUUID();
    await db.insert(issues).values([
      {
        id: sharedIssueId,
        companyId,
        identifier: `Q${sharedIssueId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        title: "Issue with duplicate wakes",
        status: "todo",
        assigneeAgentId: agentId,
      },
      {
        id: otherIssueId,
        companyId,
        identifier: `Q${otherIssueId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        title: "Other wakeable issue",
        status: "todo",
        assigneeAgentId: agentId,
      },
    ]);

    const expiredRunId = randomUUID();
    const supersededRunId = randomUUID();
    const keptDuplicateWinnerRunId = randomUUID();
    const freshOtherIssueRunId = randomUUID();

    await db.insert(heartbeatRuns).values([
      {
        id: expiredRunId,
        companyId,
        agentId,
        status: "queued",
        invocationSource: "automation",
        createdAt: new Date(now - 3 * HOUR_MS),
        contextSnapshot: { issueId: openIssueId, wakeReason: "issue_recovery_action_restored" },
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
        contextSnapshot: { issueId: otherIssueId, wakeReason: "issue_commented" },
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

  // PRX-6045 AC2: a queued run whose issue can never be woken again is cancelled by
  // reason *while the agent is saturated*, i.e. before the slot gate — not left to
  // age into `queued_run_expired`. The same run through `claimQueuedRun` would need a
  // free slot, which a single-slot agent under backlog never has.
  it("cancels not-wakeable queued runs by reason before the slot gate", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const now = Date.now();
    const issuePrefix = `W${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip wakeability",
      issuePrefix,
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
      runtimeConfig: { heartbeat: { wakeOnDemand: true, intervalSec: 0, maxConcurrentRuns: 1 } },
      permissions: {},
    });

    const makeIssue = async (status: string, title: string) => {
      const id = randomUUID();
      await db.insert(issues).values({
        id,
        companyId,
        identifier: `${issuePrefix}-${title.replace(/\W+/g, "").slice(0, 8).toUpperCase()}`,
        title,
        status,
        assigneeAgentId: agentId,
      });
      return id;
    };

    const blockedIssueId = await makeIssue("blocked", "Parked behind a blocker");
    const blockerIssueId = await makeIssue("todo", "Unresolved blocker");
    const doneIssueId = await makeIssue("done", "Finished work");
    const resolvedIssueId = await makeIssue("blocked", "Blocked but resolved");
    const doneBlockerIssueId = await makeIssue("done", "Resolved blocker");
    // Descriptor-parked: blocked pending a human action. No agent wake can progress it,
    // so its queued run must die with a named code instead of aging out.
    const parkedIssueId = await makeIssue("blocked", "Parked on a human action");
    await db
      .update(issues)
      .set({
        unblockDescriptor: {
          owner: { userId: "user-1" },
          action: "Reissue the SendGrid key in the console",
        } as never,
      })
      .where(eq(issues.id, parkedIssueId));
    await db.insert(issueRelations).values([
      { companyId, issueId: blockerIssueId, relatedIssueId: blockedIssueId, type: "blocks" },
      { companyId, issueId: doneBlockerIssueId, relatedIssueId: resolvedIssueId, type: "blocks" },
    ]);

    // Occupied slot for the whole test.
    await db.insert(heartbeatRuns).values({
      id: randomUUID(),
      companyId,
      agentId,
      status: "running",
      invocationSource: "automation",
      startedAt: new Date(now - 10_000),
      createdAt: new Date(now - 60_000),
      contextSnapshot: { issueId: randomUUID() },
    });

    const blockedRunId = randomUUID();
    const doneRunId = randomUUID();
    const resumeOnClosedRunId = randomUUID();
    const resolvedBlockedRunId = randomUUID();
    const freshWakeableRunId = await makeIssue("in_progress", "Fresh wakeable work");
    const freshWakeableQueuedRunId = randomUUID();
    const parkedRunId = randomUUID();

    await db.insert(heartbeatRuns).values([
      {
        id: blockedRunId,
        companyId,
        agentId,
        status: "queued",
        invocationSource: "automation",
        // Fresh: the age rule cannot be the reason this is cancelled.
        createdAt: new Date(now - 30_000),
        contextSnapshot: { issueId: blockedIssueId, wakeReason: "issue_commented" },
      },
      {
        id: doneRunId,
        companyId,
        agentId,
        status: "queued",
        invocationSource: "automation",
        createdAt: new Date(now - 25_000),
        contextSnapshot: { issueId: doneIssueId, wakeReason: "issue_commented" },
      },
      {
        id: resumeOnClosedRunId,
        companyId,
        agentId,
        status: "queued",
        invocationSource: "automation",
        createdAt: new Date(now - 20_000),
        // An explicit resume of a closed issue is legitimate work and must survive.
        contextSnapshot: { issueId: doneIssueId, resumeIntent: true, wakeReason: "issue_reopened" },
      },
      {
        id: resolvedBlockedRunId,
        companyId,
        agentId,
        status: "queued",
        invocationSource: "automation",
        createdAt: new Date(now - 15_000),
        // Blocked status, but every blocker is done => wakeable again (PRX-6026).
        contextSnapshot: { issueId: resolvedIssueId, wakeReason: "issue_blockers_resolved" },
      },
      {
        id: parkedRunId,
        companyId,
        agentId,
        status: "queued",
        invocationSource: "automation",
        createdAt: new Date(now - 12_000),
        contextSnapshot: { issueId: parkedIssueId, wakeReason: "issue_commented" },
      },
      {
        id: freshWakeableQueuedRunId,
        companyId,
        agentId,
        status: "queued",
        invocationSource: "automation",
        createdAt: new Date(now - 10_000),
        contextSnapshot: { issueId: freshWakeableRunId, wakeReason: "issue_commented" },
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

    expect(byId.get(blockedRunId)).toMatchObject({
      status: "cancelled",
      errorCode: "issue_dependencies_blocked",
    });
    // The blocked-dependency rule reuses the claim-time implementation, so it keeps that
    // implementation's `dependency_gate` marker and message instead of a second vocabulary.
    expect(byId.get(blockedRunId)?.resultJson).toMatchObject({
      stopReason: "issue_dependencies_blocked",
      timeoutSource: "dependency_gate",
    });
    expect(byId.get(doneRunId)).toMatchObject({
      status: "cancelled",
      errorCode: "issue_terminal_status",
    });

    expect(byId.get(parkedRunId)).toMatchObject({
      status: "cancelled",
      errorCode: "issue_parked_on_unblock_action",
    });

    expect(byId.get(resumeOnClosedRunId)?.status).toBe("queued");
    expect(byId.get(resolvedBlockedRunId)?.status).toBe("queued");
    expect(byId.get(freshWakeableQueuedRunId)?.status).toBe("queued");

    const blockedEvent = await db
      .select({ message: heartbeatRunEvents.message })
      .from(heartbeatRunEvents)
      .where(eq(heartbeatRunEvents.runId, blockedRunId));
    expect(blockedEvent.some((event) => /dependencies are still blocked/.test(event.message ?? ""))).toBe(true);
  }, 30_000);

  // PRX-6045 AC1: a second wake for an issue that already has a queued, unclaimed run
  // must not create a second heartbeat_runs row. The run itself has to coalesce (bump
  // the wakeup request) so no user/board comment is dropped by the collapse.
  it("does not enqueue a second run when a wake arrives for an issue that is already queued", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const now = Date.now();
    const issuePrefix = `C${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip coalesce",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CoalescingAgent",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: { heartbeat: { wakeOnDemand: true, intervalSec: 0, maxConcurrentRuns: 1 } },
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      identifier: `${issuePrefix}-1`,
      title: "Scratch issue for the coalesce proof",
      status: "in_progress",
      assigneeAgentId: agentId,
    });
    // Saturated: the first wake can only be queued, never claimed.
    await db.insert(heartbeatRuns).values({
      id: randomUUID(),
      companyId,
      agentId,
      status: "running",
      invocationSource: "automation",
      startedAt: new Date(now - 5_000),
      createdAt: new Date(now - 30_000),
      contextSnapshot: { issueId: randomUUID() },
    });

    const wake = () => heartbeat.wakeup(agentId, {
      source: "automation",
      triggerDetail: "system",
      reason: "issue_assigned",
      contextSnapshot: { issueId, taskId: issueId, responsibleUserId: "responsible-user" },
    });

    const runsBefore = await db
      .select({ id: heartbeatRuns.id })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.agentId, agentId));
    const first = await wake();
    expect(first).not.toBeNull();

    const afterFirst = await db
      .select({ id: heartbeatRuns.id, status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.agentId, agentId));
    expect(afterFirst.length).toBe(runsBefore.length + 1);
    expect(afterFirst.filter((row) => row.status === "queued")).toHaveLength(1);

    const second = await wake();
    const afterSecond = await db
      .select({ id: heartbeatRuns.id, status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.agentId, agentId));

    // AC1: no new heartbeat_runs row for the second wake.
    expect(afterSecond.length).toBe(afterFirst.length);
    expect(second?.id).toBe(first?.id);

    const wakeRequests = await db
      .select({ status: agentWakeupRequests.status })
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.agentId, agentId));
    expect(wakeRequests.filter((row) => row.status === "coalesced").length).toBeGreaterThan(0);
  }, 30_000);
});
