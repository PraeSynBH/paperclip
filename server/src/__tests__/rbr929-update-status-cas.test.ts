import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  executionWorkspaces,
  goals,
  heartbeatRuns,
  instanceSettings,
  issueComments,
  issueInboxArchives,
  issueRelations,
  issues,
  projectWorkspaces,
  projects,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.ts";
import { HttpError } from "../errors.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

/**
 * RBR-950 (RBR-929 STEP 1): `issuesSvc.update` supports an opt-in status
 * compare-and-set enforced in SQL.
 *
 * The bug this exists for is RBR-864: the recovery path reads an issue, decides
 * from that snapshot that the run was lost, and writes `blocked` -- but by the
 * time the write lands the run has already committed `done`. The snapshot-derived
 * write silently reverts a completed issue.
 *
 * The assertions below are behavioural: they read the row back and assert on
 * `issues.status`, not on the shape of the return value.
 */
describeEmbeddedPostgres("issuesSvc.update status compare-and-set (RBR-929 AC1/AC2/AC4)", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issues-status-cas-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(issueRelations);
    await db.delete(issueInboxArchives);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(executionWorkspaces);
    await db.delete(projectWorkspaces);
    await db.delete(projects);
    await db.delete(goals);
    await db.delete(agents);
    await db.delete(instanceSettings);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedInProgressIssue() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Status compare-and-set",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
    });

    return { companyId, agentId, issueId };
  }

  async function readStatus(issueId: string) {
    return await db
      .select({ status: issues.status })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0]?.status ?? null);
  }

  it("a stale-snapshot `blocked` write loses to a committed `done` write -- `done` survives", async () => {
    const { issueId } = await seedInProgressIssue();

    // The recovery path's snapshot: it saw the issue as `in_progress`.
    const snapshot = await readStatus(issueId);
    expect(snapshot).toBe("in_progress");

    // The run completes and commits `done` first.
    await svc.update(issueId, { status: "done" });
    expect(await readStatus(issueId)).toBe("done");

    // The recovery path now writes `blocked`, still reasoning from its stale
    // snapshot. The CAS predicate must make this write affect zero rows.
    await expect(
      svc.update(issueId, { status: "blocked", expectedStatus: snapshot! }),
    ).rejects.toMatchObject({ status: 409 });

    // The behavioural assertion that matters: `done` survived.
    expect(await readStatus(issueId)).toBe("done");
  });

  it("under real concurrency exactly one of two CAS writes lands", async () => {
    const { issueId } = await seedInProgressIssue();

    // Both writers race from the same `in_progress` snapshot. The predicate is
    // evaluated by the same statement that writes, so the second to acquire the
    // row lock sees `in_progress` already gone and matches zero rows.
    const results = await Promise.allSettled([
      svc.update(issueId, { status: "done", expectedStatus: "in_progress" }),
      svc.update(issueId, { status: "blocked", expectedStatus: "in_progress" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ status: 409 });

    // Whichever won, the row is not left in the pre-race status.
    expect(await readStatus(issueId)).not.toBe("in_progress");
  });

  it("distinguishes a losing CAS (throws conflict) from issue-not-found (returns null)", async () => {
    const { issueId } = await seedInProgressIssue();

    // Not found: `null`, no throw. This is the signal `update` already used, so
    // the CAS cannot reuse it (RBR-929 AC2).
    await expect(
      svc.update(randomUUID(), { status: "blocked", expectedStatus: "in_progress" }),
    ).resolves.toBeNull();

    // Losing CAS on a row that definitely exists: a distinct, loud signal.
    const error = await svc
      .update(issueId, { status: "blocked", expectedStatus: "done" })
      .then(() => null)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({
      status: 409,
      details: { issueId, actualStatus: "in_progress" },
    });

    // The losing write did not touch the row.
    expect(await readStatus(issueId)).toBe("in_progress");
  });

  it("a winning CAS applies the write", async () => {
    const { issueId } = await seedInProgressIssue();

    const updated = await svc.update(issueId, { status: "done", expectedStatus: "in_progress" });
    expect(updated?.status).toBe("done");
    expect(await readStatus(issueId)).toBe("done");
  });

  it("accepts the plural form and matches any listed status", async () => {
    const { issueId } = await seedInProgressIssue();

    const updated = await svc.update(issueId, {
      status: "done",
      expectedStatuses: ["todo", "in_progress"],
    });
    expect(updated?.status).toBe("done");
    expect(await readStatus(issueId)).toBe("done");

    // ...and rejects when the actual status is not in the list.
    await expect(
      svc.update(issueId, { status: "blocked", expectedStatuses: ["todo", "in_progress"] }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await readStatus(issueId)).toBe("done");
  });

  it("rejects an empty expectedStatuses instead of silently no-oping every write", async () => {
    const { issueId } = await seedInProgressIssue();

    await expect(
      svc.update(issueId, { status: "done", expectedStatuses: [] }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await readStatus(issueId)).toBe("in_progress");
  });

  it("stays opt-in: a caller that passes neither key is unguarded", async () => {
    const { issueId } = await seedInProgressIssue();

    // No CAS keys -> no status predicate -> the ~100 existing callers keep
    // exactly the behaviour they had, including the ability to overwrite `done`.
    await svc.update(issueId, { status: "done" });
    const updated = await svc.update(issueId, { status: "blocked" });
    expect(updated?.status).toBe("blocked");
    expect(await readStatus(issueId)).toBe("blocked");
  });

  it("never writes the CAS keys as columns", async () => {
    const { issueId } = await seedInProgressIssue();

    // If either key leaked into `issueData` it would reach `patch` and Drizzle
    // would fail on an unknown column, so a clean write is the assertion.
    const updated = await svc.update(issueId, {
      title: "Renamed under CAS",
      expectedStatus: "in_progress",
      expectedStatuses: ["in_progress"],
    });
    expect(updated?.title).toBe("Renamed under CAS");
    expect(await readStatus(issueId)).toBe("in_progress");
  });
});
