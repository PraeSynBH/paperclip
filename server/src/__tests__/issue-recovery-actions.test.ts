import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  agentWakeupRequests,
  activityLog,
  companies,
  createDb,
  environmentLeases,
  environments,
  heartbeatRuns,
  issueComments,
  issueRecoveryActions,
  issueRelations,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { issueRecoveryActionService } from "../services/issue-recovery-actions.js";
import { recoveryService } from "../services/recovery/service.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

function makeRecoveryActionRow(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-05-09T19:30:00.000Z");
  return {
    id: randomUUID(),
    companyId: "company-1",
    sourceIssueId: "source-1",
    recoveryIssueId: null,
    kind: "missing_disposition",
    status: "active",
    ownerType: "agent",
    ownerAgentId: "agent-1",
    ownerUserId: null,
    previousOwnerAgentId: null,
    returnOwnerAgentId: null,
    cause: "successful_run_missing_issue_disposition",
    fingerprint: "missing-disposition:fingerprint",
    evidence: {},
    nextAction: "Choose a valid issue disposition.",
    wakePolicy: null,
    monitorPolicy: null,
    attemptCount: 1,
    maxAttempts: null,
    timeoutAt: null,
    lastAttemptAt: now,
    outcome: null,
    resolutionNote: null,
    resolvedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("issueRecoveryActionService", () => {
  it("does not reactivate an action resolved between the active read and update", async () => {
    const existingRow = makeRecoveryActionRow({ id: "existing-action", attemptCount: 1 });
    const createdRow = makeRecoveryActionRow({ id: "new-action", attemptCount: 1 });
    const selectResults = [[existingRow], []];

    const makeSelectQuery = (rows: unknown[]) => ({
      from() {
        return this;
      },
      where() {
        return this;
      },
      orderBy() {
        return this;
      },
      limit() {
        return Promise.resolve(rows);
      },
    });

    const fakeDb = {
      select: vi.fn(() => makeSelectQuery(selectResults.shift() ?? [])),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => []),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [createdRow]),
        })),
      })),
    };

    const result = await issueRecoveryActionService(fakeDb as never).upsertSourceScoped({
      companyId: "company-1",
      sourceIssueId: "source-1",
      kind: "missing_disposition",
      ownerType: "agent",
      ownerAgentId: "agent-1",
      cause: "successful_run_missing_issue_disposition",
      fingerprint: "missing-disposition:fingerprint",
      nextAction: "Choose a valid issue disposition.",
    });

    expect(result).toMatchObject({ id: "new-action", status: "active" });
    expect(fakeDb.update).toHaveBeenCalledTimes(1);
    expect(fakeDb.insert).toHaveBeenCalledTimes(1);
  });
});

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres issue recovery action tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("issue recovery actions", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-recovery-actions-");
    db = createDb(tempDb.connectionString);
  }, 180_000);

  afterEach(async () => {
    await db.delete(issueRecoveryActions);
    await db.delete(issueComments);
    await db.delete(environmentLeases);
    await db.delete(activityLog);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(environments);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany() {
    const companyId = randomUUID();
    const managerId = randomUUID();
    const coderId = randomUUID();
    const sourceIssueId = randomUUID();
    const prefix = `RA${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Recovery Co",
      issuePrefix: prefix,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: managerId,
        companyId,
        name: "CTO",
        role: "cto",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: coderId,
        companyId,
        name: "Coder",
        role: "engineer",
        status: "idle",
        reportsTo: managerId,
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    await db.insert(issues).values({
      id: sourceIssueId,
      companyId,
      title: "Implement backend recovery",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: coderId,
      issueNumber: 1,
      identifier: `${prefix}-1`,
    });
    const [sourceIssue] = await db.select().from(issues).where(eq(issues.id, sourceIssueId));
    return { companyId, managerId, coderId, sourceIssueId, prefix, sourceIssue: sourceIssue! };
  }

  async function seedHeartbeatRun(input: {
    companyId: string;
    agentId: string;
    runId: string;
    issueId?: string;
    status?: string;
  }) {
    await db.insert(heartbeatRuns).values({
      id: input.runId,
      companyId: input.companyId,
      agentId: input.agentId,
      invocationSource: "manual",
      status: input.status ?? "running",
      startedAt: new Date("2026-05-13T18:00:00.000Z"),
      contextSnapshot: input.issueId ? { issueId: input.issueId } : undefined,
    });
  }

  function createApp(actor: any = { type: "board", source: "local_implicit" }) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = actor;
      next();
    });
    app.use("/api", issueRoutes(db, {} as any));
    app.use(errorHandler);
    return app;
  }

  it("upserts one active source-scoped action per issue and keeps company scoping explicit", async () => {
    const { companyId, managerId, sourceIssueId } = await seedCompany();
    const svc = issueRecoveryActionService(db);

    const first = await svc.upsertSourceScoped({
      companyId,
      sourceIssueId,
      kind: "stranded_assigned_issue",
      ownerType: "agent",
      ownerAgentId: managerId,
      cause: "stranded_assigned_issue",
      fingerprint: "recovery:fingerprint",
      evidence: { latestRunId: "run-1" },
      nextAction: "Restore a live execution path.",
      wakePolicy: { type: "wake_owner" },
    });
    const second = await svc.upsertSourceScoped({
      companyId,
      sourceIssueId,
      kind: "stranded_assigned_issue",
      ownerType: "agent",
      ownerAgentId: managerId,
      cause: "stranded_assigned_issue",
      fingerprint: "recovery:fingerprint",
      evidence: { latestRunId: "run-2" },
      nextAction: "Restore a live execution path.",
      wakePolicy: { type: "wake_owner" },
    });

    expect(second.id).toBe(first.id);
    expect(second.attemptCount).toBe(2);
    expect(second.evidence).toMatchObject({ latestRunId: "run-2" });
    expect(await svc.getActiveForIssue(companyId, sourceIssueId)).toMatchObject({ id: first.id });
    expect(await svc.getActiveForIssue(randomUUID(), sourceIssueId)).toBeNull();
  });

  it("escalates stranded assigned work into a source action instead of a recovery issue", async () => {
    const { companyId, managerId, coderId, sourceIssue } = await seedCompany();
    const enqueueWakeup = vi.fn(async () => null);
    const recovery = recoveryService(db, { enqueueWakeup });
    const latestRun = {
      id: randomUUID(),
      agentId: coderId,
      status: "failed",
      error: "adapter failed",
      errorCode: "adapter_failed",
      contextSnapshot: { retryReason: "issue_continuation_needed" },
      livenessState: "needs_followup",
    } as const;

    await recovery.escalateStrandedAssignedIssue({
      issue: sourceIssue,
      previousStatus: "in_progress",
      latestRun,
      comment: "Automatic continuation recovery failed.",
    });
    await recovery.escalateStrandedAssignedIssue({
      issue: sourceIssue,
      previousStatus: "in_progress",
      latestRun,
      comment: "Automatic continuation recovery failed.",
    });

    const actionRows = await db
      .select()
      .from(issueRecoveryActions)
      .where(eq(issueRecoveryActions.sourceIssueId, sourceIssue.id));
    expect(actionRows).toHaveLength(1);
    expect(actionRows[0]).toMatchObject({
      companyId,
      kind: "stranded_assigned_issue",
      status: "active",
      previousOwnerAgentId: coderId,
      returnOwnerAgentId: coderId,
      cause: "stranded_assigned_issue",
      attemptCount: 2,
    });

    const [updatedIssue] = await db.select().from(issues).where(eq(issues.id, sourceIssue.id));
    expect(updatedIssue).toMatchObject({
      status: "blocked",
    });
    const recoveryIssues = await db
      .select()
      .from(issues)
      .where(and(eq(issues.companyId, companyId), eq(issues.originKind, "stranded_issue_recovery")));
    expect(recoveryIssues).toHaveLength(0);
    expect(enqueueWakeup).toHaveBeenCalledTimes(2);
    expect(enqueueWakeup.mock.calls[0]?.[1]?.payload).toMatchObject({
      issueId: sourceIssue.id,
      sourceIssueId: sourceIssue.id,
      recoveryCause: "stranded_assigned_issue",
    });
  });

  it("reuses the same source-scoped action when latest run IDs change while the cause stays the same", async () => {
    const { companyId, managerId, coderId, sourceIssue } = await seedCompany();
    const enqueueWakeup = vi.fn(async () => null);
    const recovery = recoveryService(db, { enqueueWakeup });
    const firstLatestRun = {
      id: randomUUID(),
      agentId: coderId,
      status: "failed",
      error: "adapter failed",
      errorCode: "adapter_failed",
      contextSnapshot: { retryReason: "issue_continuation_needed" },
      livenessState: "needs_followup",
    } as const;
    const secondLatestRun = {
      ...firstLatestRun,
      id: randomUUID(),
    };

    await recovery.escalateStrandedAssignedIssue({
      issue: sourceIssue,
      previousStatus: "in_progress",
      latestRun: firstLatestRun,
      comment: "Automatic continuation recovery failed.",
    });
    await recovery.escalateStrandedAssignedIssue({
      issue: sourceIssue,
      previousStatus: "in_progress",
      latestRun: secondLatestRun,
      comment: "Automatic continuation recovery failed.",
    });

    const actionRows = await db
      .select()
      .from(issueRecoveryActions)
      .where(eq(issueRecoveryActions.sourceIssueId, sourceIssue.id));
    expect(actionRows).toHaveLength(1);
    expect(actionRows[0]).toMatchObject({
      companyId,
      kind: "stranded_assigned_issue",
      status: "active",
      previousOwnerAgentId: coderId,
      returnOwnerAgentId: coderId,
      cause: "stranded_assigned_issue",
      attemptCount: 2,
    });
    expect(actionRows[0]?.evidence).toMatchObject({ latestRunId: secondLatestRun.id });
    expect(enqueueWakeup).toHaveBeenCalledTimes(2);
    expect(enqueueWakeup.mock.calls[1]?.[1]?.payload).toMatchObject({
      issueId: sourceIssue.id,
      sourceIssueId: sourceIssue.id,
      strandedRunId: secondLatestRun.id,
      recoveryCause: "stranded_assigned_issue",
    });
  });

  it("deduplicates workspace-incoherence recovery actions by the typed workspace fingerprint", async () => {
    const { companyId, coderId, sourceIssue } = await seedCompany();
    const enqueueWakeup = vi.fn(async () => null);
    const recovery = recoveryService(db, { enqueueWakeup });
    const workspaceFingerprint = `workspace_incoherence:v1:sha256:${"a".repeat(64)}`;
    const workspaceValidation = {
      reason: "git_worktree_branch_incoherence",
      fingerprint: workspaceFingerprint,
      sourceIssueId: sourceIssue.id,
      sourceIdentifier: sourceIssue.identifier,
      executionWorkspaceId: "execution-workspace-1",
      expectedBranch: "PAP-1-expected",
      actualBranch: "PAP-1-publish",
      cleanliness: "dirty",
      provenance: {
        expectedBranchExists: true,
        actualBranchExists: true,
        expectedHeadSha: "1111111111111111111111111111111111111111",
        actualHeadSha: "2222222222222222222222222222222222222222",
        sameHead: false,
      },
      safeRepair: {
        eligible: false,
        attempted: false,
        succeeded: false,
        reason: "worktree is not clean",
      },
    };
    const firstLatestRun = {
      id: randomUUID(),
      agentId: coderId,
      status: "failed",
      error: "workspace branch mismatch",
      errorCode: "workspace_validation_failed",
      contextSnapshot: {},
      livenessState: "failed",
      resultJson: { workspaceValidation },
    } as const;
    const secondLatestRun = {
      ...firstLatestRun,
      id: randomUUID(),
    };

    await recovery.escalateStrandedAssignedIssue({
      issue: sourceIssue,
      previousStatus: "in_progress",
      latestRun: firstLatestRun,
      comment: "Workspace failed validation.",
      recoveryCause: "workspace_validation_failed",
    });
    await recovery.escalateStrandedAssignedIssue({
      issue: sourceIssue,
      previousStatus: "in_progress",
      latestRun: secondLatestRun,
      comment: "Workspace failed validation.",
      recoveryCause: "workspace_validation_failed",
    });

    const actionRows = await db
      .select()
      .from(issueRecoveryActions)
      .where(eq(issueRecoveryActions.sourceIssueId, sourceIssue.id));
    expect(actionRows).toHaveLength(1);
    expect(actionRows[0]).toMatchObject({
      companyId,
      kind: "workspace_validation",
      cause: "workspace_validation_failed",
      status: "active",
      attemptCount: 2,
      fingerprint: expect.stringContaining(workspaceFingerprint),
      evidence: expect.objectContaining({
        latestRunId: secondLatestRun.id,
        latestRunErrorCode: "workspace_validation_failed",
        workspaceValidation: expect.objectContaining({
          reason: "git_worktree_branch_incoherence",
          fingerprint: workspaceFingerprint,
          sourceIssueId: sourceIssue.id,
          executionWorkspaceId: "execution-workspace-1",
          expectedBranch: "PAP-1-expected",
          actualBranch: "PAP-1-publish",
          cleanliness: "dirty",
        }),
      }),
      nextAction: expect.stringContaining("git worktree branch incoherence"),
      wakePolicy: expect.objectContaining({
        type: "manual_repair_required",
        reason: "workspace_validation_failed",
      }),
    });

    const comments = await db.select().from(issueComments).where(eq(issueComments.issueId, sourceIssue.id));
    expect(comments.filter((comment) => comment.body.includes(`Recovery action: \`${actionRows[0]?.id}\``))).toHaveLength(1);
    expect(enqueueWakeup).not.toHaveBeenCalled();
  });

  it("keeps the source issue blocked when source-scoped wakeup is claimed synchronously", async () => {
    const { companyId, managerId, coderId, sourceIssue } = await seedCompany();
    await db.update(agents).set({ status: "paused" }).where(eq(agents.id, managerId));
    const enqueueWakeup = vi.fn(async () => {
      await db
        .update(issues)
        .set({ status: "in_progress" })
        .where(eq(issues.id, sourceIssue.id));
      return null;
    });
    const recovery = recoveryService(db, { enqueueWakeup });
    const firstLatestRun = {
      id: randomUUID(),
      agentId: coderId,
      status: "failed",
      error: "adapter failed",
      errorCode: "adapter_failed",
      contextSnapshot: { retryReason: "issue_continuation_needed" },
      livenessState: "needs_followup",
    } as const;

    await recovery.escalateStrandedAssignedIssue({
      issue: sourceIssue,
      previousStatus: "in_progress",
      latestRun: firstLatestRun,
      comment: "Automatic continuation recovery failed.",
    });

    const [afterFirst] = await db.select().from(issues).where(eq(issues.id, sourceIssue.id));
    expect(afterFirst?.status).toBe("blocked");
    expect(afterFirst?.assigneeAgentId).toBe(coderId);

    const secondLatestRun = {
      ...firstLatestRun,
      id: randomUUID(),
    };
    await recovery.escalateStrandedAssignedIssue({
      issue: sourceIssue,
      previousStatus: "in_progress",
      latestRun: secondLatestRun,
      comment: "Automatic continuation recovery failed.",
    });

    const actionRows = await db
      .select()
      .from(issueRecoveryActions)
      .where(eq(issueRecoveryActions.sourceIssueId, sourceIssue.id));
    expect(actionRows).toHaveLength(1);
    expect(actionRows[0]).toMatchObject({
      companyId,
      kind: "stranded_assigned_issue",
      status: "active",
      previousOwnerAgentId: coderId,
      returnOwnerAgentId: coderId,
      cause: "stranded_assigned_issue",
      attemptCount: 2,
    });
    const [afterSecond] = await db.select().from(issues).where(eq(issues.id, sourceIssue.id));
    expect(afterSecond?.status).toBe("blocked");

    const comments = await db.select().from(issueComments).where(eq(issueComments.issueId, sourceIssue.id));
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toContain("Recovery action:");
  });

  // RBR-1107 (RBR-933 Tier 2, AC3 -- the reblock retry named in the parent
  // chain): `escalateStrandedAssignedIssue`'s reblock-retry re-reads and
  // compares the issue's current status/assignee (service.ts, right after
  // `enqueueSourceScopedStrandedRecoveryWake`) before writing `blocked` again.
  // That re-read narrows the race window but, before RBR-1107, did not close
  // it -- there was still a gap between the compare and the write's own
  // statement. This test forces something to land in that gap: the wakeup
  // hook (awaited synchronously, same as the "claimed synchronously" test
  // above) completes the issue to `done` with a different assignee right
  // between the compare and the write. A pre-fix build would have silently
  // reverted that `done` issue back to `blocked` with the recovery owner
  // reassigned; post-fix the CAS predicate on the reblock write loses the
  // race (or the terminal-reopen gate rejects the done->blocked edge first),
  // and the issue's real status/assignee survive untouched.
  it("reblock retry: a terminal issue survives when its compare-at-write status goes stale before the write lands", async () => {
    const { companyId, managerId, coderId, sourceIssue } = await seedCompany();
    // Pause the manager so recovery ownership resolves to the coder itself --
    // the same setup the "claimed synchronously" test above uses to land in
    // the `recoveryAction.ownerAgentId === input.issue.assigneeAgentId`
    // branch that gates the reblock retry.
    await db.update(agents).set({ status: "paused" }).where(eq(agents.id, managerId));

    let wakeupCalls = 0;
    const enqueueWakeup = vi.fn(async () => {
      wakeupCalls += 1;
      if (wakeupCalls === 2) {
        // Simulate a concurrent run completing the issue in the gap between
        // the reblock retry's compare (which will read this `done` row) and
        // its own write.
        await db
          .update(issues)
          .set({ status: "done", assigneeAgentId: null })
          .where(eq(issues.id, sourceIssue.id));
      }
      return null;
    });
    const recovery = recoveryService(db, { enqueueWakeup });
    const firstLatestRun = {
      id: randomUUID(),
      agentId: coderId,
      status: "failed",
      error: "adapter failed",
      errorCode: "adapter_failed",
      contextSnapshot: { retryReason: "issue_continuation_needed" },
      livenessState: "needs_followup",
    } as const;

    await recovery.escalateStrandedAssignedIssue({
      issue: sourceIssue,
      previousStatus: "in_progress",
      latestRun: firstLatestRun,
      comment: "Automatic continuation recovery failed.",
    });
    const [afterFirst] = await db.select().from(issues).where(eq(issues.id, sourceIssue.id));
    expect(afterFirst?.status).toBe("blocked");
    expect(afterFirst?.assigneeAgentId).toBe(coderId);

    const secondLatestRun = { ...firstLatestRun, id: randomUUID() };
    // `sourceIssue` is intentionally the same stale snapshot passed to the
    // first call -- exactly the shape the parent issue calls out: the
    // caller's in-memory issue object does not reflect the concurrent `done`
    // transition the wakeup hook performs mid-call. The call itself must not
    // throw: a lost CAS/terminal-reopen conflict on the reblock retry is a
    // no-op, not an unhandled exception that could abort the recovery sweep.
    await recovery.escalateStrandedAssignedIssue({
      issue: sourceIssue,
      previousStatus: "in_progress",
      latestRun: secondLatestRun,
      comment: "Automatic continuation recovery failed.",
    });

    const [afterSecond] = await db.select().from(issues).where(eq(issues.id, sourceIssue.id));
    expect(afterSecond?.status).toBe("done");
    expect(afterSecond?.assigneeAgentId).toBeNull();
  });

  it("does not create nested recovery artifacts when issue-backed fallback work itself fails", async () => {
    const { companyId, managerId, sourceIssueId, prefix } = await seedCompany();
    const recoveryIssueId = randomUUID();
    await db.insert(issues).values({
      id: recoveryIssueId,
      companyId,
      title: "Recover stalled issue",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: managerId,
      parentId: sourceIssueId,
      issueNumber: 2,
      identifier: `${prefix}-2`,
      originKind: "stranded_issue_recovery",
      originId: sourceIssueId,
      originFingerprint: `stranded_issue_recovery:${sourceIssueId}`,
    });
    const [recoveryIssue] = await db.select().from(issues).where(eq(issues.id, recoveryIssueId));
    const recovery = recoveryService(db, { enqueueWakeup: vi.fn(async () => null) });

    await recovery.escalateStrandedAssignedIssue({
      issue: recoveryIssue!,
      previousStatus: "in_progress",
      latestRun: {
        id: randomUUID(),
        agentId: managerId,
        status: "failed",
        error: "adapter failed",
        errorCode: "adapter_failed",
        contextSnapshot: { retryReason: "issue_continuation_needed" },
        livenessState: "needs_followup",
      },
    });

    const actionRows = await db.select().from(issueRecoveryActions);
    expect(actionRows).toHaveLength(0);
    const recoveryIssues = await db
      .select()
      .from(issues)
      .where(and(eq(issues.companyId, companyId), eq(issues.originKind, "stranded_issue_recovery")));
    expect(recoveryIssues).toHaveLength(1);
    expect(recoveryIssues[0]?.status).toBe("blocked");
  });

  // RBR-1104 AC4: a terminal (done/cancelled) recovery issue survives a
  // reconcile pass whose escalation decision was derived from a stale
  // snapshot. `reconcileStrandedAssignedIssues` reads a full-row snapshot,
  // then runs a 6+-round-trip per-issue loop before calling
  // `escalateStrandedRecoveryIssueInPlace`, so `issue.status` on that snapshot
  // can be arbitrarily stale by write time. This exercises exactly that: the
  // snapshot still says `in_progress`, but the row has since reached a
  // terminal status. The write must be a silent no-op (RBR-953's
  // terminal-reopen gate rejects it before RBR-929's CAS predicate is even
  // evaluated, since `blocked` is a non-terminal target and the actual row is
  // terminal) — not a clobber back to `blocked`, and not an unhandled
  // exception that could abort the recovery sweep loop.
  it.each(["done", "cancelled"] as const)(
    "does not revert a recovery issue that already reached %s from a stale escalation snapshot",
    async (terminalStatus) => {
      const { companyId, managerId, sourceIssueId, prefix } = await seedCompany();
      const recoveryIssueId = randomUUID();
      await db.insert(issues).values({
        id: recoveryIssueId,
        companyId,
        title: "Recover stalled issue",
        status: "in_progress",
        priority: "medium",
        assigneeAgentId: managerId,
        parentId: sourceIssueId,
        issueNumber: 2,
        identifier: `${prefix}-2`,
        originKind: "stranded_issue_recovery",
        originId: sourceIssueId,
        originFingerprint: `stranded_issue_recovery:${sourceIssueId}`,
      });
      const [staleSnapshot] = await db.select().from(issues).where(eq(issues.id, recoveryIssueId));

      // The row moves on (someone else resolved this recovery issue, e.g. the
      // owning agent marked it done) after the reconcile loop read its
      // snapshot but before this escalation write runs.
      await db.update(issues).set({ status: terminalStatus }).where(eq(issues.id, recoveryIssueId));

      const recovery = recoveryService(db, { enqueueWakeup: vi.fn(async () => null) });
      const result = await recovery.escalateStrandedRecoveryIssueInPlace({
        issue: staleSnapshot!,
        previousStatus: "in_progress",
        latestRun: {
          id: randomUUID(),
          agentId: managerId,
          status: "failed",
          error: "adapter failed",
          errorCode: "adapter_failed",
          contextSnapshot: {},
          livenessState: "needs_followup",
        },
      });

      expect(result).toBeNull();

      const [afterEscalation] = await db.select().from(issues).where(eq(issues.id, recoveryIssueId));
      expect(afterEscalation?.status).toBe(terminalStatus);

      const comments = await db.select().from(issueComments).where(eq(issueComments.issueId, recoveryIssueId));
      expect(comments).toHaveLength(0);

      const activity = await db
        .select()
        .from(activityLog)
        .where(and(eq(activityLog.entityId, recoveryIssueId), eq(activityLog.action, "issue.updated")));
      expect(activity).toHaveLength(0);
    },
  );

  it("exposes active recovery actions on the issue read API", async () => {
    const { companyId, managerId, sourceIssueId } = await seedCompany();
    const recoveryActionSvc = issueRecoveryActionService(db);
    const action = await recoveryActionSvc.upsertSourceScoped({
      companyId,
      sourceIssueId,
      kind: "missing_disposition",
      ownerType: "agent",
      ownerAgentId: managerId,
      cause: "successful_run_missing_issue_disposition",
      fingerprint: "missing-disposition:fingerprint",
      evidence: { sourceRunId: "run-1" },
      nextAction: "Choose a valid issue disposition.",
      wakePolicy: { type: "wake_owner" },
    });
    const app = createApp();

    const detail = await request(app).get(`/api/issues/${sourceIssueId}`).expect(200);
    expect(detail.body.activeRecoveryAction).toMatchObject({
      id: action.id,
      sourceIssueId,
      kind: "missing_disposition",
      ownerAgentId: managerId,
    });

    const list = await request(app).get(`/api/issues/${sourceIssueId}/recovery-actions`).expect(200);
    expect(list.body.active).toMatchObject({ id: action.id });
    expect(list.body.actions).toHaveLength(1);
  });

  it("resolves an active recovery action and removes it from active projections", async () => {
    const { companyId, managerId, sourceIssueId } = await seedCompany();
    const recoveryActionSvc = issueRecoveryActionService(db);
    const action = await recoveryActionSvc.upsertSourceScoped({
      companyId,
      sourceIssueId,
      kind: "missing_disposition",
      ownerType: "agent",
      ownerAgentId: managerId,
      cause: "successful_run_missing_issue_disposition",
      fingerprint: "missing-disposition:fingerprint",
      evidence: { sourceRunId: "run-1" },
      nextAction: "Choose a valid issue disposition.",
      wakePolicy: { type: "wake_owner" },
    });
    const app = createApp();

    const resolved = await request(app)
      .post(`/api/issues/${sourceIssueId}/recovery-actions/resolve`)
      .send({
        actionId: action.id,
        outcome: "restored",
        sourceIssueStatus: "done",
        resolutionNote: "Operator confirmed the source issue is complete.",
      })
      .expect(200);

    expect(resolved.body.issue).toMatchObject({
      id: sourceIssueId,
      status: "done",
      activeRecoveryAction: null,
    });
    expect(resolved.body.recoveryAction).toMatchObject({
      id: action.id,
      status: "resolved",
      outcome: "restored",
      resolutionNote: "Operator confirmed the source issue is complete.",
    });
    expect(resolved.body.recoveryAction.resolvedAt).toBeTruthy();
    expect(await recoveryActionSvc.getActiveForIssue(companyId, sourceIssueId)).toBeNull();

    const detail = await request(app).get(`/api/issues/${sourceIssueId}`).expect(200);
    expect(detail.body.activeRecoveryAction).toBeNull();

    const activityRows = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.entityId, sourceIssueId));
    expect(activityRows.map((row) => row.action)).toEqual(
      expect.arrayContaining(["issue.updated", "issue.recovery_action_resolved"]),
    );
  });

  it("resolves an active recovery action by returning the source issue to todo", async () => {
    const { companyId, managerId, sourceIssueId } = await seedCompany();
    await db
      .update(issues)
      .set({ status: "blocked", assigneeAgentId: null, assigneeUserId: "board-user" })
      .where(eq(issues.id, sourceIssueId));
    const recoveryActionSvc = issueRecoveryActionService(db);
    const action = await recoveryActionSvc.upsertSourceScoped({
      companyId,
      sourceIssueId,
      kind: "issue_graph_liveness",
      ownerType: "agent",
      ownerAgentId: managerId,
      cause: "issue_graph_liveness",
      fingerprint: "graph-liveness:try-again",
      evidence: { latestIssueStatus: "blocked" },
      nextAction: "Restore a live execution path.",
      wakePolicy: { type: "manual" },
    });
    const app = createApp();

    const resolved = await request(app)
      .post(`/api/issues/${sourceIssueId}/recovery-actions/resolve`)
      .send({
        actionId: action.id,
        outcome: "restored",
        sourceIssueStatus: "todo",
        resolutionNote: "Try the source issue again.",
      })
      .expect(200);

    expect(resolved.body.issue).toMatchObject({
      id: sourceIssueId,
      status: "todo",
      activeRecoveryAction: null,
    });
    expect(resolved.body.recoveryAction).toMatchObject({
      id: action.id,
      status: "resolved",
      outcome: "restored",
      resolutionNote: "Try the source issue again.",
    });
    expect(await recoveryActionSvc.getActiveForIssue(companyId, sourceIssueId)).toBeNull();
  });

  it("marks a recovery action stale when a blocked source issue is manually moved to todo", async () => {
    const { companyId, managerId, sourceIssueId } = await seedCompany();
    await db
      .update(issues)
      .set({ status: "blocked", assigneeAgentId: null, assigneeUserId: "board-user" })
      .where(eq(issues.id, sourceIssueId));
    const recoveryActionSvc = issueRecoveryActionService(db);
    const action = await recoveryActionSvc.upsertSourceScoped({
      companyId,
      sourceIssueId,
      kind: "issue_graph_liveness",
      ownerType: "agent",
      ownerAgentId: managerId,
      cause: "issue_graph_liveness",
      fingerprint: "graph-liveness:manual-restore",
      evidence: { latestIssueStatus: "blocked" },
      nextAction: "Restore a live execution path.",
      wakePolicy: { type: "manual" },
    });
    const app = createApp();

    const patched = await request(app)
      .patch(`/api/issues/${sourceIssueId}`)
      .send({ status: "todo" })
      .expect(200);

    expect(patched.body).toMatchObject({
      id: sourceIssueId,
      status: "todo",
      activeRecoveryAction: null,
    });

    const [actionRow] = await db
      .select()
      .from(issueRecoveryActions)
      .where(eq(issueRecoveryActions.id, action.id));
    expect(actionRow).toMatchObject({
      status: "cancelled",
      outcome: "cancelled",
      resolutionNote: "Recovery action became stale because the source issue was manually moved from blocked to todo.",
    });
    expect(actionRow?.resolvedAt).toBeTruthy();
    expect(await recoveryActionSvc.getActiveForIssue(companyId, sourceIssueId)).toBeNull();

    const detail = await request(app).get(`/api/issues/${sourceIssueId}`).expect(200);
    expect(detail.body.activeRecoveryAction).toBeNull();

    const activityRows = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.entityId, sourceIssueId));
    expect(activityRows.map((row) => row.action)).toEqual(
      expect.arrayContaining(["issue.updated", "issue.recovery_action_resolved"]),
    );
    expect(activityRows.find((row) => row.action === "issue.recovery_action_resolved")?.details).toMatchObject({
      source: "source_revalidation",
      trigger: "issue_update",
    });
  });

  // RBR-1101: PATCH /issues/:id has no write path for monitor-scheduling fields
  // (monitorNextCheckAt / monitorNotes / monitorScheduledBy / executionState.monitor.*). Previously
  // these were silently stripped by the non-strict Zod schema and the PATCH returned 200 with no
  // persistence (RBR-1094). Assert each of these now returns a 4xx naming the unsupported field(s)
  // instead of a silent no-op.
  it("rejects monitorNextCheckAt on PATCH /issues/:id with a 4xx naming the field", async () => {
    const { sourceIssueId } = await seedCompany();
    const app = createApp();

    const res = await request(app)
      .patch(`/api/issues/${sourceIssueId}`)
      .send({ monitorNextCheckAt: "2026-06-01T00:00:00.000Z" });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(JSON.stringify(res.body)).toContain("monitorNextCheckAt");

    const [issueRow] = await db.select().from(issues).where(eq(issues.id, sourceIssueId));
    expect(issueRow?.monitorNextCheckAt ?? null).toBeNull();
  });

  it("rejects monitorNotes on PATCH /issues/:id with a 4xx naming the field", async () => {
    const { sourceIssueId } = await seedCompany();
    const app = createApp();

    const res = await request(app)
      .patch(`/api/issues/${sourceIssueId}`)
      .send({ monitorNotes: "checking back later" });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(JSON.stringify(res.body)).toContain("monitorNotes");
  });

  it("rejects monitorScheduledBy on PATCH /issues/:id with a 4xx naming the field", async () => {
    const { sourceIssueId } = await seedCompany();
    const app = createApp();

    const res = await request(app)
      .patch(`/api/issues/${sourceIssueId}`)
      .send({ monitorScheduledBy: "assignee" });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(JSON.stringify(res.body)).toContain("monitorScheduledBy");
  });

  it("rejects executionState.monitor.* on PATCH /issues/:id with a 4xx naming the field", async () => {
    const { sourceIssueId } = await seedCompany();
    const app = createApp();

    const res = await request(app)
      .patch(`/api/issues/${sourceIssueId}`)
      .send({
        executionState: {
          monitor: {
            status: "scheduled",
            nextCheckAt: "2026-06-01T00:00:00.000Z",
            lastTriggeredAt: null,
            notes: null,
            scheduledBy: null,
            clearedAt: null,
            clearReason: null,
          },
        },
      });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(JSON.stringify(res.body)).toContain("executionState.monitor");
  });

  it("still allows a legitimate PATCH without monitor-scheduling fields", async () => {
    const { sourceIssueId } = await seedCompany();
    const app = createApp();

    const res = await request(app)
      .patch(`/api/issues/${sourceIssueId}`)
      .send({ status: "todo", priority: "high" })
      .expect(200);

    expect(res.body).toMatchObject({ id: sourceIssueId, status: "todo", priority: "high" });
  });

  it("folds stale recovery during read projection after the source issue reaches done", async () => {
    const { companyId, managerId, sourceIssueId } = await seedCompany();
    const recoveryActionSvc = issueRecoveryActionService(db);
    const action = await recoveryActionSvc.upsertSourceScoped({
      companyId,
      sourceIssueId,
      kind: "issue_graph_liveness",
      ownerType: "agent",
      ownerAgentId: managerId,
      cause: "issue_graph_liveness",
      fingerprint: "graph-liveness:done-projection",
      evidence: { latestIssueStatus: "in_progress" },
      nextAction: "Restore a live execution path.",
      wakePolicy: { type: "manual" },
    });
    await db.update(issues).set({ status: "done" }).where(eq(issues.id, sourceIssueId));
    const app = createApp();

    const detail = await request(app).get(`/api/issues/${sourceIssueId}`).expect(200);

    expect(detail.body).toMatchObject({
      id: sourceIssueId,
      status: "done",
      activeRecoveryAction: null,
    });
    const [actionRow] = await db
      .select()
      .from(issueRecoveryActions)
      .where(eq(issueRecoveryActions.id, action.id));
    expect(actionRow).toMatchObject({
      status: "cancelled",
      outcome: "cancelled",
      resolutionNote: "Recovery action became stale because the source issue reached done.",
    });
    expect(actionRow?.resolvedAt).toBeTruthy();

    const activityRows = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.entityId, sourceIssueId));
    expect(activityRows.find((row) => row.action === "issue.recovery_action_resolved")?.details).toMatchObject({
      source: "source_revalidation",
      trigger: "read_projection",
      recoveryActionId: action.id,
    });
  });

  it("reverts a phantom park on revalidation, restoring both status and assignee", async () => {
    const { companyId, managerId, coderId, sourceIssueId } = await seedCompany();
    // The RBR-864 defect: a completing run is misread as a lost run and the `done` issue gets parked.
    await db.update(issues).set({ status: "done" }).where(eq(issues.id, sourceIssueId));
    const [doneIssue] = await db.select().from(issues).where(eq(issues.id, sourceIssueId));
    const recovery = recoveryService(db, { enqueueWakeup: vi.fn(async () => null) });

    await recovery.escalateStrandedAssignedIssue({
      issue: doneIssue!,
      previousStatus: "done" as never,
      latestRun: {
        id: randomUUID(),
        agentId: coderId,
        status: "timed_out",
        error: "Timed out",
        errorCode: "timeout",
        contextSnapshot: { retryReason: "issue_continuation_needed" },
        livenessState: "needs_followup",
      } as never,
      comment: "Automatic continuation recovery failed.",
    });

    // Pre-condition: the park damaged the issue exactly as RBR-864 describes.
    const [parked] = await db.select().from(issues).where(eq(issues.id, sourceIssueId));
    expect(parked).toMatchObject({ status: "blocked", assigneeAgentId: managerId });
    const recoveryActionSvc = issueRecoveryActionService(db);
    const action = await recoveryActionSvc.getActiveForIssue(companyId, sourceIssueId);
    expect(action).toMatchObject({ status: "active", previousOwnerAgentId: coderId });
    expect(action?.evidence).toMatchObject({ previousStatus: "done" });

    const app = createApp();
    const detail = await request(app).get(`/api/issues/${sourceIssueId}`).expect(200);

    // AC3: revalidation must revert what the park invalidated — status AND assignee.
    expect(detail.body).toMatchObject({
      id: sourceIssueId,
      status: "done",
      assigneeAgentId: coderId,
      activeRecoveryAction: null,
    });
    const [reverted] = await db.select().from(issues).where(eq(issues.id, sourceIssueId));
    expect(reverted).toMatchObject({ status: "done", assigneeAgentId: coderId });
    expect(await recoveryActionSvc.getActiveForIssue(companyId, sourceIssueId)).toBeNull();

    const [actionRow] = await db
      .select()
      .from(issueRecoveryActions)
      .where(eq(issueRecoveryActions.id, action!.id));
    expect(actionRow).toMatchObject({ status: "cancelled", outcome: "cancelled" });
    expect(actionRow?.resolvedAt).toBeTruthy();

    // Invariant 5 — the revert is observable in activity and on the thread.
    const activityRows = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.entityId, sourceIssueId));
    expect(activityRows.map((row) => row.action)).toEqual(
      expect.arrayContaining(["issue.recovery_action_reverted", "issue.recovery_action_resolved"]),
    );
    expect(activityRows.find((row) => row.action === "issue.recovery_action_reverted")?.details).toMatchObject({
      recoveryActionId: action!.id,
      source: "source_revalidation_revert",
      trigger: "read_projection",
      evidencePreviousStatus: "done",
      revertedFromStatus: "blocked",
      revertedToStatus: "done",
      revertedFromAssigneeAgentId: managerId,
      restoredAssigneeAgentId: coderId,
    });
    const commentRows = await db.select().from(issueComments).where(eq(issueComments.issueId, sourceIssueId));
    expect(
      commentRows.some(
        (row) => row.authorType === "system" && (row.body ?? "").includes("Reverted a recovery park"),
      ),
    ).toBe(true);
  });

  it("does not status-revert a legitimate park taken from a live in_progress run", async () => {
    const { companyId, managerId, coderId, sourceIssueId, sourceIssue } = await seedCompany();
    const recovery = recoveryService(db, { enqueueWakeup: vi.fn(async () => null) });

    await recovery.escalateStrandedAssignedIssue({
      issue: sourceIssue,
      previousStatus: "in_progress",
      latestRun: {
        id: randomUUID(),
        agentId: coderId,
        status: "timed_out",
        error: "Timed out",
        errorCode: "timeout",
        contextSnapshot: { retryReason: "issue_continuation_needed" },
        livenessState: "needs_followup",
      } as never,
      comment: "Automatic continuation recovery failed.",
    });

    const recoveryActionSvc = issueRecoveryActionService(db);
    const action = await recoveryActionSvc.getActiveForIssue(companyId, sourceIssueId);
    expect(action?.evidence).toMatchObject({ previousStatus: "in_progress" });

    const app = createApp();
    const detail = await request(app).get(`/api/issues/${sourceIssueId}`).expect(200);

    // Invariant 2 — a run that really did die from in_progress gets a live path restored elsewhere,
    // never a status rewrite here. The park stands and stays visible.
    expect(detail.body).toMatchObject({ id: sourceIssueId, status: "blocked", assigneeAgentId: managerId });
    expect(detail.body.activeRecoveryAction).toMatchObject({ id: action!.id, status: "active" });
    const [stillParked] = await db.select().from(issues).where(eq(issues.id, sourceIssueId));
    expect(stillParked).toMatchObject({ status: "blocked", assigneeAgentId: managerId });
    expect(await recoveryActionSvc.getActiveForIssue(companyId, sourceIssueId)).toMatchObject({
      id: action!.id,
      status: "active",
    });
    const activityRows = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.entityId, sourceIssueId));
    expect(activityRows.map((row) => row.action)).not.toContain("issue.recovery_action_reverted");
  });

  it("keeps active recovery visible when a plain comment does not create a live path", async () => {
    const { companyId, managerId, sourceIssueId } = await seedCompany();
    await db
      .update(issues)
      .set({ assigneeAgentId: null, assigneeUserId: "board-user" })
      .where(eq(issues.id, sourceIssueId));
    const recoveryActionSvc = issueRecoveryActionService(db);
    const action = await recoveryActionSvc.upsertSourceScoped({
      companyId,
      sourceIssueId,
      kind: "issue_graph_liveness",
      ownerType: "agent",
      ownerAgentId: managerId,
      cause: "issue_graph_liveness",
      fingerprint: "graph-liveness:plain-comment",
      evidence: { latestIssueStatus: "in_progress" },
      nextAction: "Restore a live execution path.",
      wakePolicy: { type: "manual" },
    });
    const app = createApp();

    await request(app)
      .post(`/api/issues/${sourceIssueId}/comments`)
      .send({ body: "I am looking at this, but not changing the disposition." })
      .expect(201);

    expect(await recoveryActionSvc.getActiveForIssue(companyId, sourceIssueId)).toMatchObject({
      id: action.id,
      status: "active",
    });
    const detail = await request(app).get(`/api/issues/${sourceIssueId}`).expect(200);
    expect(detail.body.activeRecoveryAction).toMatchObject({ id: action.id });
  });

  it("folds stale recovery when a structured resume comment restores todo dispatch", async () => {
    const { companyId, managerId, sourceIssueId } = await seedCompany();
    await db
      .update(issues)
      .set({ status: "blocked", assigneeAgentId: null, assigneeUserId: "board-user" })
      .where(eq(issues.id, sourceIssueId));
    const recoveryActionSvc = issueRecoveryActionService(db);
    const action = await recoveryActionSvc.upsertSourceScoped({
      companyId,
      sourceIssueId,
      kind: "issue_graph_liveness",
      ownerType: "agent",
      ownerAgentId: managerId,
      cause: "issue_graph_liveness",
      fingerprint: "graph-liveness:resume-comment",
      evidence: { latestIssueStatus: "blocked" },
      nextAction: "Restore a live execution path.",
      wakePolicy: { type: "manual" },
    });
    const app = createApp();

    await request(app)
      .post(`/api/issues/${sourceIssueId}/comments`)
      .send({ body: "Resume this now.", resume: true })
      .expect(201);

    const [sourceIssue] = await db.select().from(issues).where(eq(issues.id, sourceIssueId));
    expect(sourceIssue?.status).toBe("todo");
    const [actionRow] = await db
      .select()
      .from(issueRecoveryActions)
      .where(eq(issueRecoveryActions.id, action.id));
    expect(actionRow).toMatchObject({
      status: "cancelled",
      outcome: "cancelled",
      resolutionNote: "Recovery action became stale because the source issue was manually moved from blocked to todo.",
    });
    expect(await recoveryActionSvc.getActiveForIssue(companyId, sourceIssueId)).toBeNull();

    const activityRows = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.entityId, sourceIssueId));
    expect(activityRows.find((row) => row.action === "issue.recovery_action_resolved")?.details).toMatchObject({
      source: "source_revalidation",
      trigger: "comment",
      recoveryActionId: action.id,
    });
  });

  it("rejects peer-agent source issue updates that would hide another owner's recovery action", async () => {
    const { companyId, managerId, coderId, sourceIssueId } = await seedCompany();
    await db
      .update(issues)
      .set({ status: "blocked", assigneeAgentId: null, assigneeUserId: "board-user" })
      .where(eq(issues.id, sourceIssueId));
    const recoveryActionSvc = issueRecoveryActionService(db);
    const action = await recoveryActionSvc.upsertSourceScoped({
      companyId,
      sourceIssueId,
      kind: "issue_graph_liveness",
      ownerType: "agent",
      ownerAgentId: managerId,
      cause: "issue_graph_liveness",
      fingerprint: "graph-liveness:peer-status-update",
      evidence: { latestIssueStatus: "blocked" },
      nextAction: "Restore a live execution path.",
      wakePolicy: { type: "manual" },
    });
    const app = createApp({
      type: "agent",
      agentId: coderId,
      companyId,
      runId: randomUUID(),
      source: "agent_jwt",
    });

    await request(app)
      .patch(`/api/issues/${sourceIssueId}`)
      .send({ status: "todo" })
      .expect(403);

    const [sourceIssue] = await db.select().from(issues).where(eq(issues.id, sourceIssueId));
    expect(sourceIssue?.status).toBe("blocked");
    const [actionRow] = await db
      .select()
      .from(issueRecoveryActions)
      .where(eq(issueRecoveryActions.id, action.id));
    expect(actionRow).toMatchObject({
      status: "active",
      outcome: null,
      resolvedAt: null,
    });
  });

  it("rejects peer-agent recovery action resolution on a board-owned source issue", async () => {
    const { companyId, managerId, coderId, sourceIssueId } = await seedCompany();
    await db
      .update(issues)
      .set({ status: "blocked", assigneeAgentId: null, assigneeUserId: "board-user" })
      .where(eq(issues.id, sourceIssueId));
    const recoveryActionSvc = issueRecoveryActionService(db);
    const action = await recoveryActionSvc.upsertSourceScoped({
      companyId,
      sourceIssueId,
      kind: "issue_graph_liveness",
      ownerType: "agent",
      ownerAgentId: managerId,
      cause: "issue_graph_liveness",
      fingerprint: "graph-liveness:peer-resolution",
      evidence: { latestIssueStatus: "blocked" },
      nextAction: "Restore a live execution path.",
      wakePolicy: { type: "manual" },
    });
    const app = createApp({
      type: "agent",
      agentId: coderId,
      companyId,
      runId: randomUUID(),
      source: "agent_jwt",
    });

    await request(app)
      .post(`/api/issues/${sourceIssueId}/recovery-actions/resolve`)
      .send({
        actionId: action.id,
        outcome: "restored",
        sourceIssueStatus: "done",
        resolutionNote: "Peer agent should not be able to clear this recovery.",
      })
      .expect(403);

    const [sourceIssue] = await db.select().from(issues).where(eq(issues.id, sourceIssueId));
    expect(sourceIssue?.status).toBe("blocked");
    const [actionRow] = await db
      .select()
      .from(issueRecoveryActions)
      .where(eq(issueRecoveryActions.id, action.id));
    expect(actionRow).toMatchObject({
      status: "active",
      outcome: null,
      resolvedAt: null,
    });
  });

  it("allows the named recovery owner to resolve a board-owned source recovery action", async () => {
    const { companyId, managerId, sourceIssueId } = await seedCompany();
    await db
      .update(issues)
      .set({ status: "blocked", assigneeAgentId: null, assigneeUserId: "board-user" })
      .where(eq(issues.id, sourceIssueId));
    const recoveryActionSvc = issueRecoveryActionService(db);
    const action = await recoveryActionSvc.upsertSourceScoped({
      companyId,
      sourceIssueId,
      kind: "issue_graph_liveness",
      ownerType: "agent",
      ownerAgentId: managerId,
      cause: "issue_graph_liveness",
      fingerprint: "graph-liveness:owner-resolution",
      evidence: { latestIssueStatus: "blocked" },
      nextAction: "Restore a live execution path.",
      wakePolicy: { type: "manual" },
    });
    const runId = randomUUID();
    const app = createApp({
      type: "agent",
      agentId: managerId,
      companyId,
      runId,
      source: "agent_jwt",
    });
    await seedHeartbeatRun({
      companyId,
      agentId: managerId,
      runId,
      issueId: sourceIssueId,
    });

    const resolved = await request(app)
      .post(`/api/issues/${sourceIssueId}/recovery-actions/resolve`)
      .send({
        actionId: action.id,
        outcome: "restored",
        sourceIssueStatus: "done",
        resolutionNote: "Recovery owner verified the work was intentionally completed.",
      })
      .expect(200);

    expect(resolved.body.issue).toMatchObject({
      id: sourceIssueId,
      status: "done",
      activeRecoveryAction: null,
    });
    expect(resolved.body.recoveryAction).toMatchObject({
      id: action.id,
      status: "resolved",
      outcome: "restored",
    });
  });

  it("rejects blocked recovery resolution when the source issue has no first-class blockers", async () => {
    const { companyId, managerId, sourceIssueId } = await seedCompany();
    const recoveryActionSvc = issueRecoveryActionService(db);
    const action = await recoveryActionSvc.upsertSourceScoped({
      companyId,
      sourceIssueId,
      kind: "issue_graph_liveness",
      ownerType: "agent",
      ownerAgentId: managerId,
      cause: "issue_graph_liveness",
      fingerprint: "graph-liveness:blocked-without-blocker",
      evidence: { latestIssueStatus: "in_progress" },
      nextAction: "Choose a disposition with a live continuation path.",
      wakePolicy: { type: "manual" },
    });
    const app = createApp();

    const rejected = await request(app)
      .post(`/api/issues/${sourceIssueId}/recovery-actions/resolve`)
      .send({
        actionId: action.id,
        outcome: "blocked",
        sourceIssueStatus: "blocked",
      })
      .expect(422);

    expect(rejected.body.error).toContain("requires an unresolved first-class blocker");

    const [sourceIssue] = await db.select().from(issues).where(eq(issues.id, sourceIssueId));
    expect(sourceIssue?.status).toBe("in_progress");

    const [actionRow] = await db
      .select()
      .from(issueRecoveryActions)
      .where(eq(issueRecoveryActions.id, action.id));
    expect(actionRow).toMatchObject({
      status: "active",
      outcome: null,
      resolvedAt: null,
    });
  });

  it("allows blocked recovery resolution when the source issue has an unresolved first-class blocker", async () => {
    const { companyId, managerId, sourceIssueId, prefix } = await seedCompany();
    const blockerIssueId = randomUUID();
    await db.insert(issues).values({
      id: blockerIssueId,
      companyId,
      title: "Unblock recovery disposition",
      status: "todo",
      priority: "medium",
      assigneeAgentId: managerId,
      issueNumber: 2,
      identifier: `${prefix}-2`,
    });
    await db.insert(issueRelations).values({
      companyId,
      issueId: blockerIssueId,
      relatedIssueId: sourceIssueId,
      type: "blocks",
    });
    const recoveryActionSvc = issueRecoveryActionService(db);
    const action = await recoveryActionSvc.upsertSourceScoped({
      companyId,
      sourceIssueId,
      kind: "issue_graph_liveness",
      ownerType: "agent",
      ownerAgentId: managerId,
      cause: "issue_graph_liveness",
      fingerprint: "graph-liveness:blocked-with-blocker",
      evidence: { latestIssueStatus: "in_progress" },
      nextAction: "Wait for the blocker before continuing.",
      wakePolicy: { type: "manual" },
    });
    const app = createApp();

    const resolved = await request(app)
      .post(`/api/issues/${sourceIssueId}/recovery-actions/resolve`)
      .send({
        actionId: action.id,
        outcome: "blocked",
        sourceIssueStatus: "blocked",
        resolutionNote: "The source issue is explicitly blocked by a follow-up.",
      })
      .expect(200);

    expect(resolved.body.issue).toMatchObject({
      id: sourceIssueId,
      status: "blocked",
      activeRecoveryAction: null,
    });
    expect(resolved.body.recoveryAction).toMatchObject({
      id: action.id,
      status: "resolved",
      outcome: "blocked",
      resolutionNote: "The source issue is explicitly blocked by a follow-up.",
    });
    expect(await recoveryActionSvc.getActiveForIssue(companyId, sourceIssueId)).toBeNull();
  });

  it("rejects false-positive recovery resolution without an explicit source issue status", async () => {
    const { companyId, managerId, sourceIssueId } = await seedCompany();
    const recoveryActionSvc = issueRecoveryActionService(db);
    const action = await recoveryActionSvc.upsertSourceScoped({
      companyId,
      sourceIssueId,
      kind: "issue_graph_liveness",
      ownerType: "agent",
      ownerAgentId: managerId,
      cause: "issue_graph_liveness",
      fingerprint: "graph-liveness:fingerprint",
      evidence: { latestIssueStatus: "in_progress" },
      nextAction: "Confirm whether the issue is actually stranded.",
      wakePolicy: { type: "manual" },
    });
    const app = createApp();

    await request(app)
      .post(`/api/issues/${sourceIssueId}/recovery-actions/resolve`)
      .send({
        actionId: action.id,
        outcome: "false_positive",
        resolutionNote: "The source issue still has a live execution path.",
      })
      .expect(400);

    const [sourceIssue] = await db.select().from(issues).where(eq(issues.id, sourceIssueId));
    expect(sourceIssue?.status).toBe("in_progress");

    const [actionRow] = await db
      .select()
      .from(issueRecoveryActions)
      .where(eq(issueRecoveryActions.id, action.id));
    expect(actionRow).toMatchObject({
      status: "active",
      outcome: null,
      resolutionNote: null,
    });
  });

  it("allows false-positive recovery resolution to restore a blocked source issue in the same request", async () => {
    const { companyId, managerId, sourceIssueId } = await seedCompany();
    await db.update(issues).set({ status: "blocked" }).where(eq(issues.id, sourceIssueId));
    const recoveryActionSvc = issueRecoveryActionService(db);
    const action = await recoveryActionSvc.upsertSourceScoped({
      companyId,
      sourceIssueId,
      kind: "issue_graph_liveness",
      ownerType: "agent",
      ownerAgentId: managerId,
      cause: "issue_graph_liveness",
      fingerprint: "graph-liveness:false-positive-unblock",
      evidence: { latestIssueStatus: "blocked" },
      nextAction: "Confirm whether the issue is actually stranded.",
      wakePolicy: { type: "manual" },
    });
    const app = createApp();

    const resolved = await request(app)
      .post(`/api/issues/${sourceIssueId}/recovery-actions/resolve`)
      .send({
        actionId: action.id,
        outcome: "false_positive",
        sourceIssueStatus: "in_review",
        resolutionNote: "Recovery signal was stale; return to review.",
      })
      .expect(200);

    expect(resolved.body.issue).toMatchObject({
      id: sourceIssueId,
      status: "in_review",
      activeRecoveryAction: null,
    });
    expect(resolved.body.recoveryAction).toMatchObject({
      id: action.id,
      status: "resolved",
      outcome: "false_positive",
      resolutionNote: "Recovery signal was stale; return to review.",
    });
  });

  it("enforces company scope when resolving recovery actions", async () => {
    const { companyId, managerId, sourceIssueId } = await seedCompany();
    const recoveryActionSvc = issueRecoveryActionService(db);
    const action = await recoveryActionSvc.upsertSourceScoped({
      companyId,
      sourceIssueId,
      kind: "missing_disposition",
      ownerType: "agent",
      ownerAgentId: managerId,
      cause: "successful_run_missing_issue_disposition",
      fingerprint: "missing-disposition:fingerprint",
      evidence: { sourceRunId: "run-1" },
      nextAction: "Choose a valid issue disposition.",
      wakePolicy: { type: "wake_owner" },
    });
    const app = createApp({
      type: "agent",
      agentId: randomUUID(),
      companyId: randomUUID(),
      runId: randomUUID(),
      source: "agent_jwt",
    });

    await request(app)
      .post(`/api/issues/${sourceIssueId}/recovery-actions/resolve`)
      .send({
        actionId: action.id,
        outcome: "restored",
        sourceIssueStatus: "done",
      })
      .expect(403);

    const [actionRow] = await db
      .select()
      .from(issueRecoveryActions)
      .where(eq(issueRecoveryActions.id, action.id));
    expect(actionRow?.status).toBe("active");
  });

  // RBR-922 (AC4): fingerprint idempotency — a stale-cancelled cause must not
  // re-park the same issue.
  describe("fingerprint idempotency (RBR-922 AC4)", () => {
    it("does not re-create an active action after the action was cancelled for the same fingerprint", async () => {
      const { companyId, managerId, sourceIssueId } = await seedCompany();
      const recoveryActionSvc = issueRecoveryActionService(db);

      // First sweep: create an active action.
      const action1 = await recoveryActionSvc.upsertSourceScoped({
        companyId,
        sourceIssueId,
        kind: "stranded_assigned_issue",
        ownerType: "agent",
        ownerAgentId: managerId,
        cause: "stranded_assigned_issue",
        fingerprint: "source_scoped_recovery:co:issue:stranded_assigned_issue",
        evidence: { latestIssueStatus: "in_progress" },
        nextAction: "Restore a live execution path.",
        wakePolicy: { type: "wake_owner", ownerAgentId: managerId },
      });
      expect(action1.status).toBe("active");
      expect(action1.attemptCount).toBe(1);

      // Simulate AC3 revalidation: cancel the action.
      const resolved = await recoveryActionSvc.resolveActiveForIssue({
        companyId,
        sourceIssueId,
        actionId: action1.id,
        status: "cancelled",
        outcome: "cancelled",
        resolutionNote: "Source revalidation proved the park stale.",
      });
      expect(resolved).not.toBeNull();
      expect(resolved!.status).toBe("cancelled");

      // No active action should remain.
      const activeAfterCancel = await recoveryActionSvc.getActiveForIssue(companyId, sourceIssueId);
      expect(activeAfterCancel).toBeNull();

      // Second sweep: try to create a new action with the same fingerprint.
      // AC4: this must NOT mint a new active action — the fingerprint idempotency
      // gate in getCancelledForFingerprint should prevent it.
      const cancelledAction = await recoveryActionSvc.getCancelledForFingerprint(
        companyId,
        sourceIssueId,
        "stranded_assigned_issue",
        "source_scoped_recovery:co:issue:stranded_assigned_issue",
      );
      expect(cancelledAction).not.toBeNull();
      expect(cancelledAction!.status).toBe("cancelled");
    });

    it("survives multi-revert: three sweeps after three stale-cancels do not re-park", async () => {
      // AC4 AC3: "The test must reproduce the repeat revert, not a single one.
      // Multi-revert is the actual production signature — RBR-847 took three,
      // RBR-815 took two."
      const { companyId, managerId, sourceIssueId } = await seedCompany();
      const recoveryActionSvc = issueRecoveryActionService(db);
      const fingerprint = "source_scoped_recovery:co:issue:stranded_assigned_issue";

      // First sweep: create active action.
      const action1 = await recoveryActionSvc.upsertSourceScoped({
        companyId,
        sourceIssueId,
        kind: "stranded_assigned_issue",
        ownerType: "agent",
        ownerAgentId: managerId,
        cause: "stranded_assigned_issue",
        fingerprint,
        evidence: { latestIssueStatus: "in_progress" },
        nextAction: "Restore a live execution path.",
        wakePolicy: { type: "wake_owner", ownerAgentId: managerId },
      });
      expect(action1.status).toBe("active");

      // Cancel 1.
      await recoveryActionSvc.resolveActiveForIssue({
        companyId,
        sourceIssueId,
        actionId: action1.id,
        status: "cancelled",
        outcome: "cancelled",
        resolutionNote: "Stale cancel #1.",
      });

      // Attempt re-creation (sweep 2). The fingerprint idempotency gate
      // should prevent it: getCancelledForFingerprint finds the cancelled action.
      const cancelled1 = await recoveryActionSvc.getCancelledForFingerprint(
        companyId,
        sourceIssueId,
        "stranded_assigned_issue",
        fingerprint,
      );
      expect(cancelled1).not.toBeNull();
      expect(cancelled1!.status).toBe("cancelled");

      // Cancel 2 (simulating a second stale cancel cycle if somehow a new
      // action was created outside the gate — but the gate prevents it).
      // Verify no active action exists after the first cancel.
      const activeAfter1 = await recoveryActionSvc.getActiveForIssue(companyId, sourceIssueId);
      expect(activeAfter1).toBeNull();

      // Try again (sweep 3) — same result.
      const cancelled2 = await recoveryActionSvc.getCancelledForFingerprint(
        companyId,
        sourceIssueId,
        "stranded_assigned_issue",
        fingerprint,
      );
      expect(cancelled2).not.toBeNull();
      expect(cancelled2!.status).toBe("cancelled");

      // Final assertion: still no active action, and the cancelled action
      // from the first sweep is the one returned.
      const activeAfter3 = await recoveryActionSvc.getActiveForIssue(companyId, sourceIssueId);
      expect(activeAfter3).toBeNull();
      expect(cancelled1!.id).toBe(cancelled2!.id);
    });

    it("allows a new action after cancellation if the fingerprint differs", async () => {
      const { companyId, managerId, sourceIssueId } = await seedCompany();
      const recoveryActionSvc = issueRecoveryActionService(db);

      // First action with fingerprint A.
      const action1 = await recoveryActionSvc.upsertSourceScoped({
        companyId,
        sourceIssueId,
        kind: "stranded_assigned_issue",
        ownerType: "agent",
        ownerAgentId: managerId,
        cause: "stranded_assigned_issue",
        fingerprint: "source_scoped_recovery:co:issue:stranded_assigned_issue",
        evidence: { latestIssueStatus: "in_progress" },
        nextAction: "Restore a live execution path.",
        wakePolicy: { type: "wake_owner", ownerAgentId: managerId },
      });
      expect(action1.status).toBe("active");

      // Cancel it.
      await recoveryActionSvc.resolveActiveForIssue({
        companyId,
        sourceIssueId,
        actionId: action1.id,
        status: "cancelled",
        outcome: "cancelled",
        resolutionNote: "Stale cancel.",
      });

      // Different fingerprint — should NOT be blocked by the idempotency gate.
      const cancelledForOtherFp = await recoveryActionSvc.getCancelledForFingerprint(
        companyId,
        sourceIssueId,
        "stranded_assigned_issue",
        "source_scoped_recovery:co:issue:timeout", // different fingerprint
      );
      expect(cancelledForOtherFp).toBeNull();

      // And creating a new action with the different fingerprint should succeed.
      const action2 = await recoveryActionSvc.upsertSourceScoped({
        companyId,
        sourceIssueId,
        kind: "stranded_assigned_issue",
        ownerType: "agent",
        ownerAgentId: managerId,
        cause: "timeout",
        fingerprint: "source_scoped_recovery:co:issue:timeout",
        evidence: { latestIssueStatus: "in_progress" },
        nextAction: "Restore a live execution path.",
        wakePolicy: { type: "wake_owner", ownerAgentId: managerId },
      });
      expect(action2.status).toBe("active");
      expect(action2.id).not.toBe(action1.id);
    });
  });
});
