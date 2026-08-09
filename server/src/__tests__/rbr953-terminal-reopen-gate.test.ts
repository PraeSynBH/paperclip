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

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

/**
 * RBR-953 (CEO ruling on the RBR-929 AC-3 open question).
 *
 * `assertTransition` gates exactly one from->to edge class: terminal
 * (`done`/`cancelled`) -> non-terminal. There is deliberately no full
 * transition matrix. The hazard is RBR-864: the recovery reconciler reads a
 * non-terminal status snapshot, the run commits `done`, and the reconciler then
 * writes `blocked` from that stale snapshot -- silently reverting a completed
 * issue.
 *
 * Legitimate reopens exist (board reopen, comment-driven wake, watchdog revive,
 * status-card regeneration), so the gate is opt-in: those callers pass
 * `allowTerminalReopen: true`.
 *
 * Assertions are behavioural -- they read `issues.status` back from the row
 * rather than trusting the return value.
 */
describeEmbeddedPostgres("assertTransition terminal->non-terminal gate (RBR-953)", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-terminal-reopen-gate-");
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

  async function seedIssue(status: string) {
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
      title: "Terminal reopen gate",
      status,
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

  // AC1 + AC3 (rejection direction): the RBR-864 incident edge itself.
  it("rejects an ungated `done -> blocked` write and leaves `done` on the row", async () => {
    const { issueId } = await seedIssue("done");

    await expect(svc.update(issueId, { status: "blocked" })).rejects.toMatchObject({
      status: 409,
    });

    expect(await readStatus(issueId)).toBe("done");
  });

  // AC3: the error must name the rejected edge so the next incident is greppable
  // straight out of the logs, rather than saying "invalid transition".
  it("names the rejected edge (`done -> blocked`) in the error", async () => {
    const { issueId } = await seedIssue("done");

    const error = await svc.update(issueId, { status: "blocked" }).then(
      () => null,
      (caught: unknown) => caught as { message?: string; details?: Record<string, unknown> },
    );

    expect(error).not.toBeNull();
    expect(error!.message).toContain("done -> blocked");
    expect(error!.details).toMatchObject({
      code: "issue_terminal_status_regression",
      from: "done",
      to: "blocked",
      transition: "done -> blocked",
    });
  });

  // AC1: `cancelled` is terminal too -- the gate is an edge *class*, not a
  // single hard-coded pair.
  it("rejects an ungated `cancelled -> todo` write", async () => {
    const { issueId } = await seedIssue("cancelled");

    await expect(svc.update(issueId, { status: "todo" })).rejects.toMatchObject({
      status: 409,
    });

    expect(await readStatus(issueId)).toBe("cancelled");
  });

  // AC2 + AC3 (permitted direction): a deliberate reopen must keep working, or
  // the gate has broken the board.
  it("allows an opted-in `done -> todo` reopen", async () => {
    const { issueId } = await seedIssue("done");

    const updated = await svc.update(issueId, { status: "todo", allowTerminalReopen: true });

    expect(updated?.status).toBe("todo");
    expect(await readStatus(issueId)).toBe("todo");
  });

  it("allows an opted-in `cancelled -> todo` un-cancel", async () => {
    const { issueId } = await seedIssue("cancelled");

    await svc.update(issueId, { status: "todo", allowTerminalReopen: true });

    expect(await readStatus(issueId)).toBe("todo");
  });

  // Scope discipline: this is NOT a transition matrix. Every non-terminal edge,
  // including ones a matrix might well have rejected, stays untouched so the
  // ~70 existing callers keep working.
  it("leaves non-terminal transitions ungated (no transition matrix)", async () => {
    for (const [from, to] of [
      ["todo", "in_progress"],
      ["in_progress", "blocked"],
      ["blocked", "in_progress"],
      ["in_review", "todo"],
      ["backlog", "in_review"],
    ] as const) {
      const { issueId } = await seedIssue(from);
      await svc.update(issueId, { status: to });
      expect(await readStatus(issueId)).toBe(to);
      await db.delete(issues).where(eq(issues.id, issueId));
    }
  });

  // Entering a terminal status is always allowed -- the gate is directional.
  it("allows non-terminal -> terminal and terminal -> terminal", async () => {
    const { issueId: a } = await seedIssue("in_progress");
    await svc.update(a, { status: "done" });
    expect(await readStatus(a)).toBe("done");

    const { issueId: b } = await seedIssue("done");
    await svc.update(b, { status: "cancelled" });
    expect(await readStatus(b)).toBe("cancelled");
  });

  /**
   * The interleaving that actually caused RBR-864, and the reason the gate is
   * re-asserted against the row read under `for("update")` inside `runUpdate`
   * rather than only against the snapshot `update` reads before the transaction.
   *
   * The reconciler's own pre-lock view of the issue is `in_progress`, so a check
   * against that snapshot would pass. Only a check against the locked row --
   * where the status is already `done` -- refuses the write.
   */
  it("rejects a stale-snapshot regression even when the pre-lock snapshot was non-terminal", async () => {
    const { issueId } = await seedIssue("in_progress");

    // What the recovery path saw when it decided the run was lost.
    expect(await readStatus(issueId)).toBe("in_progress");

    // The run completes and commits `done` first.
    await svc.update(issueId, { status: "done" });

    // The recovery path now writes `blocked`, reasoning from its stale snapshot
    // and carrying no opt-in. The locked re-assert is what catches this.
    await expect(svc.update(issueId, { status: "blocked" })).rejects.toMatchObject({
      status: 409,
    });

    expect(await readStatus(issueId)).toBe("done");
  });

  // The two RBR-929 defences are independent and compose: the CAS makes a losing
  // write touch zero rows, this gate refuses a write that should never have been
  // attempted. A caller with a correct `expectedStatus` still cannot regress.
  it("still rejects a terminal regression that carries a correct expectedStatus", async () => {
    const { issueId } = await seedIssue("done");

    await expect(
      svc.update(issueId, { status: "blocked", expectedStatus: "done" }),
    ).rejects.toMatchObject({ status: 409 });

    expect(await readStatus(issueId)).toBe("done");
  });

  // A no-op write of the same terminal status is not a regression.
  it("allows an ungated same-status `done -> done` write", async () => {
    const { issueId } = await seedIssue("done");

    await svc.update(issueId, { status: "done" });

    expect(await readStatus(issueId)).toBe("done");
  });
});
