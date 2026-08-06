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
 * RBR-951 (RBR-929 AC3): the `patch` fields that are derived from the issue's
 * *current* status must be computed from the row read under the write's own row
 * lock, not from the unlocked snapshot `update` takes before it opens the
 * transaction.
 *
 * Both tests below are deterministic, not timing-hopeful. The interleaving is
 * forced by holding a real row lock in a second transaction:
 *
 *   1. T1 opens a transaction and UPDATEs the row, but does not commit. It now
 *      holds the row lock, and its change is invisible to anyone else.
 *   2. `svc.update` starts. Its pre-transaction read is READ COMMITTED, so it
 *      necessarily observes the *old* status -- this is the stale snapshot.
 *   3. `svc.update` reaches `select ... for update` and blocks on T1's lock.
 *   4. T1 commits. The locked read now returns the *new* row.
 *
 * So the two reads are guaranteed to disagree, and the assertions can tell
 * exactly which one the bookkeeping came from.
 */
describeEmbeddedPostgres("issuesSvc.update derives blocked bookkeeping under the row lock (RBR-929 AC3)", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issues-locked-baseline-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
    // No inline hook budget: vitest.config.ts owns hookTimeout (RBR-912/RBR-945).
    // An inline argument silently overrides both the config and --hookTimeout.
  });

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
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Locked baseline for status-derived patch fields",
      status,
      priority: "medium",
    });

    return { companyId, issueId };
  }

  async function readBookkeeping(issueId: string) {
    return await db
      .select({
        status: issues.status,
        blockedTransitionAt: issues.blockedTransitionAt,
        blockedOwnerNotifiedAt: issues.blockedOwnerNotifiedAt,
        unblockDescriptor: issues.unblockDescriptor,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);
  }

  /**
   * Runs `body` while a concurrent transaction holds the row lock, having
   * already applied `concurrentPatch` without committing. The lock is released
   * (and `concurrentPatch` committed) only once `body` is demonstrably waiting
   * on it.
   */
  async function withCommittedRaceWinner(
    issueId: string,
    concurrentPatch: Partial<typeof issues.$inferInsert>,
    body: () => Promise<unknown>,
  ) {
    let releaseLock!: () => void;
    const lockHeld = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let lockAcquired!: () => void;
    const locked = new Promise<void>((resolve) => {
      lockAcquired = resolve;
    });

    const winner = db.transaction(async (tx) => {
      await tx
        .update(issues)
        .set(concurrentPatch)
        .where(eq(issues.id, issueId));
      lockAcquired();
      await lockHeld;
    });

    await locked;

    // Start the write under test. Its pre-transaction read cannot see the
    // uncommitted change, and its `for update` read cannot proceed until the
    // winner commits.
    const underTest = body();
    // Give it time to take the stale snapshot and park on the row lock. This
    // sleep cannot make the test pass spuriously: the lock, not the clock, is
    // what orders the two reads.
    await new Promise((resolve) => setTimeout(resolve, 500));

    releaseLock();
    await winner;
    return await underTest;
  }

  it("does not reset the blocked clock when the locked row is already blocked", async () => {
    // The row is `in_progress`. A concurrent writer blocks it and notifies the
    // owner. Our writer, still holding an `in_progress` snapshot, also asks for
    // `blocked`.
    const { issueId } = await seedIssue("in_progress");
    const alreadyBlockedAt = new Date("2026-01-01T00:00:00.000Z");
    const ownerAlreadyNotifiedAt = new Date("2026-01-01T00:05:00.000Z");

    await withCommittedRaceWinner(
      issueId,
      {
        status: "blocked",
        blockedTransitionAt: alreadyBlockedAt,
        blockedOwnerNotifiedAt: ownerAlreadyNotifiedAt,
      },
      () => svc.update(issueId, { status: "blocked" }),
    );

    const row = await readBookkeeping(issueId);
    expect(row?.status).toBe("blocked");
    // Derived from the unlocked snapshot, `existing.status !== "blocked"` was
    // true, so this write would have stamped a fresh blockedTransitionAt and
    // nulled blockedOwnerNotifiedAt -- re-notifying an owner who was already
    // told, and restarting the blocked-duration clock. Under the row lock the
    // baseline is already `blocked`, so neither branch fires.
    expect(row?.blockedTransitionAt?.getTime()).toBe(alreadyBlockedAt.getTime());
    expect(row?.blockedOwnerNotifiedAt?.getTime()).toBe(ownerAlreadyNotifiedAt.getTime());
  });

  it("clears blocked bookkeeping when the locked row is blocked even though the snapshot was not", async () => {
    // The mirror case. The row is `in_progress`; a concurrent writer moves it to
    // `blocked` with a full unblock descriptor. Our writer, holding the stale
    // `in_progress` snapshot, moves it to `todo`.
    const { issueId } = await seedIssue("in_progress");

    await withCommittedRaceWinner(
      issueId,
      {
        status: "blocked",
        blockedTransitionAt: new Date("2026-01-01T00:00:00.000Z"),
        blockedOwnerNotifiedAt: new Date("2026-01-01T00:05:00.000Z"),
        unblockDescriptor: { owner: "agent", action: "land the migration" },
      },
      () => svc.update(issueId, { status: "todo" }),
    );

    const row = await readBookkeeping(issueId);
    expect(row?.status).toBe("todo");
    // Derived from the unlocked snapshot, neither branch fired: the snapshot
    // said `in_progress`, so the code never learned it was unblocking a
    // `blocked` row. The row would have been left in `todo` while still
    // carrying a live unblock descriptor and a non-null blockedTransitionAt.
    expect(row?.unblockDescriptor).toBeNull();
    expect(row?.blockedTransitionAt).toBeNull();
    expect(row?.blockedOwnerNotifiedAt).toBeNull();
  });
});
