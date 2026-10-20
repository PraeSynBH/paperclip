import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  issueComments,
  issueRecoveryActions,
  issueThreadInteractions,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { recoveryService } from "../services/recovery/service.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres board-owned recovery sweep tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

describeEmbeddedPostgres("recovery sweepBoardOwnedRecoveryActions (PRA-6483)", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-board-recovery-sweep-");
    db = createDb(tempDb.connectionString);
  }, 180_000);

  afterEach(async () => {
    await db.delete(issueThreadInteractions);
    await db.delete(issueComments);
    await db.delete(issueRecoveryActions);
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany() {
    const companyId = randomUUID();
    const returnOwnerId = randomUUID();
    const pausedOwnerId = randomUUID();
    const prefix = `BR${companyId.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
    await db.insert(companies).values({
      id: companyId,
      name: "Board Recovery Co",
      issuePrefix: prefix,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: returnOwnerId,
        companyId,
        name: "Return Owner",
        role: "engineer",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: pausedOwnerId,
        companyId,
        name: "Paused Owner",
        role: "engineer",
        status: "paused",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    return { companyId, returnOwnerId, pausedOwnerId, prefix };
  }

  async function seedIssue(input: {
    companyId: string;
    prefix: string;
    status?: string;
    assigneeAgentId?: string | null;
  }) {
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId: input.companyId,
      title: "Frozen by a board-owned recovery action",
      status: input.status ?? "blocked",
      priority: "high",
      assigneeAgentId: input.assigneeAgentId ?? null,
      issueNumber: 1,
      identifier: `${input.prefix}-1`,
    });
    return issueId;
  }

  async function seedBoardAction(input: {
    companyId: string;
    issueId: string;
    createdAt: Date;
    returnOwnerAgentId?: string | null;
    ownerUserId?: string | null;
    previousStatus?: string | null;
    attemptCount?: number;
  }) {
    const actionId = randomUUID();
    await db.insert(issueRecoveryActions).values({
      id: actionId,
      companyId: input.companyId,
      sourceIssueId: input.issueId,
      kind: "stranded_assigned_issue",
      status: "active",
      ownerType: "board",
      ownerAgentId: null,
      ownerUserId: input.ownerUserId ?? null,
      previousOwnerAgentId: input.returnOwnerAgentId ?? null,
      returnOwnerAgentId: input.returnOwnerAgentId ?? null,
      cause: "stranded_assigned_issue",
      fingerprint: `board-recovery:${actionId}`,
      evidence: input.previousStatus ? { previousStatus: input.previousStatus } : {},
      nextAction: "Restore a live execution path or record an intentional manual resolution.",
      attemptCount: input.attemptCount ?? 1,
      lastAttemptAt: input.createdAt,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
    return actionId;
  }

  async function getAction(actionId: string) {
    return db
      .select()
      .from(issueRecoveryActions)
      .where(eq(issueRecoveryActions.id, actionId))
      .then((rows) => rows[0]!);
  }

  it("returns a board-owned action to a live return owner and wakes it once", async () => {
    const { companyId, returnOwnerId, prefix } = await seedCompany();
    const issueId = await seedIssue({ companyId, prefix, assigneeAgentId: null });
    const actionId = await seedBoardAction({
      companyId,
      issueId,
      returnOwnerAgentId: returnOwnerId,
      createdAt: new Date(Date.now() - 3 * DAY_MS),
    });
    const enqueueWakeup = vi.fn(async () => null);
    const recovery = recoveryService(db, { enqueueWakeup });

    const first = await recovery.sweepBoardOwnedRecoveryActions();

    expect(first.scanned).toBe(1);
    expect(first.returned).toBe(1);
    expect(first.returnedActionIds).toEqual([actionId]);
    const action = await getAction(actionId);
    expect(action.ownerType).toBe("agent");
    expect(action.ownerAgentId).toBe(returnOwnerId);
    expect(action.ownerUserId).toBeNull();
    expect(enqueueWakeup).toHaveBeenCalledTimes(1);
    const [wokenAgentId, wakeOptions] = enqueueWakeup.mock.calls[0] as unknown as [
      string,
      { idempotencyKey?: string; reason?: string },
    ];
    expect(wokenAgentId).toBe(returnOwnerId);
    expect(wakeOptions.reason).toBe("board_recovery_action_returned");
    expect(wakeOptions.idempotencyKey).toBe(`board_recovery_action_returned:${actionId}:1`);

    // Idempotent: the row is no longer board-owned, so a second sweep has nothing
    // to do and must not wake the agent a second time.
    const second = await recovery.sweepBoardOwnedRecoveryActions();
    expect(second.scanned).toBe(0);
    expect(second.returned).toBe(0);
    expect(enqueueWakeup).toHaveBeenCalledTimes(1);
  });

  it("expires an old board-owned action with no return owner and restores the issue", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue({ companyId, prefix, status: "blocked" });
    const actionId = await seedBoardAction({
      companyId,
      issueId,
      createdAt: new Date(Date.now() - 10 * DAY_MS),
      previousStatus: "todo",
    });
    const recovery = recoveryService(db, { enqueueWakeup: vi.fn(async () => null) });

    const result = await recovery.sweepBoardOwnedRecoveryActions();

    expect(result.expired).toBe(1);
    expect(result.expiredActionIds).toEqual([actionId]);
    const action = await getAction(actionId);
    expect(action.status).toBe("resolved");
    expect(action.outcome).toBe("false_positive");
    expect(action.resolvedAt).not.toBeNull();
    expect(action.resolutionNote).toContain("PRA-6483 sweep");
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(issue!.status).toBe("todo");
    const events = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, issueId), eq(activityLog.action, "issue.recovery_action_expired")));
    expect(events).toHaveLength(1);

    // The park is gone; nothing accumulates across sweeps.
    const second = await recovery.sweepBoardOwnedRecoveryActions();
    expect(second.scanned).toBe(0);
  });

  it("never expires or returns a named-human action that has an open board interaction", async () => {
    const { companyId, returnOwnerId, prefix } = await seedCompany();
    const issueId = await seedIssue({ companyId, prefix, status: "blocked" });
    const actionId = await seedBoardAction({
      companyId,
      issueId,
      // Even with a live return owner recorded, an open question to a named
      // human wins: expiring or reassigning under them is the mirror-image bug.
      returnOwnerAgentId: returnOwnerId,
      ownerUserId: "user-123",
      createdAt: new Date(Date.now() - 30 * DAY_MS),
    });
    await db.insert(issueThreadInteractions).values({
      companyId,
      issueId,
      kind: "ask_user_questions",
      status: "pending",
      continuationPolicy: "none",
      idempotencyKey: `human-owner-question:${issueId}`,
      payload: {
        version: 1,
        questions: [
          {
            id: "owner",
            prompt: "Who should resolve this?",
            selectionMode: "single",
            options: [{ id: "keep", label: "Keep parked" }],
          },
        ],
      },
    });
    const enqueueWakeup = vi.fn(async () => null);
    const recovery = recoveryService(db, { enqueueWakeup });

    const result = await recovery.sweepBoardOwnedRecoveryActions();

    expect(result.expired).toBe(0);
    expect(result.returned).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.skippedActionIds).toEqual([actionId]);
    const action = await getAction(actionId);
    expect(action.status).toBe("active");
    expect(action.ownerType).toBe("board");
    expect(action.ownerUserId).toBe("user-123");
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(issue!.status).toBe("blocked");
    expect(enqueueWakeup).not.toHaveBeenCalled();
  });

  it("does not return an action to an agent that cannot write the source issue", async () => {
    const { companyId, returnOwnerId, pausedOwnerId, prefix } = await seedCompany();
    // The card is assigned to a different agent, so the recorded return owner
    // would still be blocked by the mutation gate; returning would re-freeze it.
    const issueId = await seedIssue({ companyId, prefix, assigneeAgentId: pausedOwnerId });
    const actionId = await seedBoardAction({
      companyId,
      issueId,
      returnOwnerAgentId: returnOwnerId,
      createdAt: new Date(Date.now() - 1 * DAY_MS),
    });
    const enqueueWakeup = vi.fn(async () => null);
    const recovery = recoveryService(db, { enqueueWakeup });

    const result = await recovery.sweepBoardOwnedRecoveryActions();

    expect(result.returned).toBe(0);
    expect(result.questionsCreated).toBe(1);
    expect((await getAction(actionId)).ownerType).toBe("board");
    expect(enqueueWakeup).not.toHaveBeenCalled();
  });

  it("records the board question at promotion time, not only on the next sweep", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue({ companyId, prefix, status: "in_progress", assigneeAgentId: null });
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    const recovery = recoveryService(db, { enqueueWakeup: vi.fn(async () => null) });

    await recovery.escalateStrandedAssignedIssue({
      issue: issue!,
      previousStatus: "in_progress",
      latestRun: {
        id: randomUUID(),
        agentId: null,
        status: "failed",
        error: "adapter failed",
        errorCode: "adapter_failed",
        contextSnapshot: { retryReason: "issue_continuation_needed" },
        livenessState: "needs_followup",
      } as never,
      comment: "Automatic continuation recovery failed.",
    });

    const [action] = await db
      .select()
      .from(issueRecoveryActions)
      .where(eq(issueRecoveryActions.sourceIssueId, issueId));
    expect(action).toMatchObject({ ownerType: "board", ownerAgentId: null });
    // The promotion itself now leaves a durable, answerable question behind.
    const interactions = await db
      .select()
      .from(issueThreadInteractions)
      .where(eq(issueThreadInteractions.issueId, issueId));
    expect(interactions).toHaveLength(1);
    expect(interactions[0]!.kind).toBe("ask_user_questions");
    expect(interactions[0]!.status).toBe("pending");
    expect(interactions[0]!.idempotencyKey).toBe(`board_recovery_action:${action!.id}:1`);
  });

  it("records a board question for a fresh ownerless action instead of expiring it", async () => {
    const { companyId, prefix } = await seedCompany();
    const issueId = await seedIssue({ companyId, prefix, status: "blocked" });
    const actionId = await seedBoardAction({
      companyId,
      issueId,
      createdAt: new Date(Date.now() - 1 * DAY_MS),
    });
    const recovery = recoveryService(db, { enqueueWakeup: vi.fn(async () => null) });

    const first = await recovery.sweepBoardOwnedRecoveryActions();

    expect(first.expired).toBe(0);
    expect(first.questionsCreated).toBe(1);
    const interactions = await db
      .select()
      .from(issueThreadInteractions)
      .where(eq(issueThreadInteractions.issueId, issueId));
    expect(interactions).toHaveLength(1);
    expect(interactions[0]!.kind).toBe("ask_user_questions");
    expect(interactions[0]!.status).toBe("pending");
    expect(interactions[0]!.idempotencyKey).toBe(`board_recovery_action:${actionId}:1`);
    expect((await getAction(actionId)).status).toBe("active");

    // A pending interaction is the "someone is being asked" signal, so the next
    // sweep leaves the row alone instead of asking again.
    const second = await recovery.sweepBoardOwnedRecoveryActions();
    expect(second.questionsCreated).toBe(0);
    expect(second.skipped).toBe(1);
    expect(
      await db
        .select()
        .from(issueThreadInteractions)
        .where(eq(issueThreadInteractions.issueId, issueId))
        .then((rows) => rows.length),
    ).toBe(1);
  });
});
