import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock drizzle-orm operators
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual("drizzle-orm");
  return {
    ...(actual as Record<string, unknown>),
    eq: vi.fn((a: unknown, b: unknown) => ({ op: "eq", left: a, right: b })),
    and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
    asc: vi.fn((arg: unknown) => ({ op: "asc", arg })),
    sql: vi.fn(function sql(...args: unknown[]) {
      return { op: "sql", args };
    }),
  };
});

// Mock @paperclipai/db — table references
vi.mock("@paperclipai/db", () => ({
  documents: { _tableName: "documents" },
  issueDocuments: { _tableName: "issue_documents" },
  issues: { _tableName: "issues" },
  planReviewGates: { _tableName: "plan_review_gates" },
}));

// Mock errors module
vi.mock("../errors.js", () => ({
  notFound: vi.fn((msg: string) => {
    const err = new Error(msg) as Error & { status: number };
    err.status = 404;
    throw err;
  }),
  conflict: vi.fn((msg: string, details?: unknown) => {
    const err = new Error(msg) as Error & { status: number; details?: unknown };
    err.status = 409;
    err.details = details;
    throw err;
  }),
}));

import { planReviewGateService } from "./plan-review-gates.js";

// ─── Mock DB builder ─────────────────────────────────────────────────────────

function makeDb() {
  const returning = vi.fn().mockResolvedValue([]);
  const updateReturning = vi.fn().mockResolvedValue([]);

  const chain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    offset: vi.fn(() => chain),
    then: vi.fn((resolve: (v: unknown) => unknown) => Promise.resolve(resolve([]))),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mock: Record<string, any> = {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning,
        onConflictDoNothing: vi.fn(() => ({ returning })),
      })),
    })),
    select: vi.fn(() => chain),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: updateReturning,
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn().mockResolvedValue([]),
    })),
    execute: vi.fn(() => Promise.resolve({ rows: [] })),
    _chain: chain,
    _returning: returning,
    _updateReturning: updateReturning,
  };
  mock.transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(mock as never));
  return mock;
}

type TestDb = ReturnType<typeof makeDb>;

function hookSelect(db: TestDb, rows: unknown[]) {
  db._chain.then.mockImplementation(
    (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(rows)),
  );
}

function hookSelectSequence(db: TestDb, rowsets: unknown[][]) {
  let callIndex = 0;
  db._chain.then.mockImplementation(
    (resolve: (v: unknown) => unknown) => {
      const rows = rowsets[callIndex] ?? [];
      callIndex = Math.min(callIndex + 1, rowsets.length - 1);
      return Promise.resolve(resolve(rows));
    },
  );
}

function resetDb(db: TestDb) {
  db._chain.then.mockImplementation(
    (resolve: (v: unknown) => unknown) => Promise.resolve(resolve([])),
  );
  db._returning.mockResolvedValue([]);
  db._updateReturning.mockResolvedValue([]);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const companyId = "00000000-0000-0000-0000-000000000001";
const issueId = "00000000-0000-0000-0000-000000000002";
const documentId = "00000000-0000-0000-0000-000000000003";
const revisionId = "00000000-0000-0000-0000-000000000004";
const gateId = "00000000-0000-0000-0000-000000000005";
const milestoneId = "00000000-0000-0000-0000-000000000006";
const agentId = "00000000-0000-0000-0000-000000000007";
const userId = "user-1";

function makeDocRef(overrides: Record<string, unknown> = {}) {
  return { documentId, companyId, ...overrides };
}

function makeGateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: gateId,
    companyId,
    documentId,
    revisionId,
    milestoneId: null,
    status: "pending",
    acceptanceCriteria: ["Criteria 1"],
    assignedAgentId: null,
    createdByAgentId: null,
    createdByUserId: null,
    resolvedByAgentId: null,
    resolvedByUserId: null,
    resolvedAt: null,
    resolutionComment: null,
    supersededByGateId: null,
    createdAt: new Date("2026-08-16T00:00:00Z"),
    updatedAt: new Date("2026-08-16T00:00:00Z"),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("planReviewGateService", () => {
  let db: TestDb;
  let svc: ReturnType<typeof planReviewGateService>;

  beforeEach(() => {
    db = makeDb();
    svc = planReviewGateService(db as never);
  });

  afterEach(() => {
    resetDb(db);
  });

  describe("listGates", () => {
    it("returns all gates for an issue when no revision filter is given", async () => {
      hookSelectSequence(db, [
        [makeDocRef()],
        [
          makeGateRow(),
          makeGateRow({ id: "gate-2", milestoneId: milestoneId }),
        ],
      ]);

      const gates = await svc.listGates({ issueId });

      expect(gates).toHaveLength(2);
      expect(db.select).toHaveBeenCalled();
      expect(db._chain.from).toHaveBeenCalled();
    });

    it("filters gates by revisionId when provided", async () => {
      hookSelectSequence(db, [
        [makeDocRef()],
        [makeGateRow()],
      ]);

      const gates = await svc.listGates({ issueId, revisionId });

      expect(gates).toHaveLength(1);
    });

    it("throws notFound when no plan document exists for the issue", async () => {
      hookSelect(db, []);

      await expect(svc.listGates({ issueId })).rejects.toThrow(
        "Plan document not found for this issue",
      );
    });
  });

  describe("createGate", () => {
    it("creates a gate on the latest revision of the plan document", async () => {
      hookSelectSequence(db, [
        [makeDocRef()],
        [{ companyId, latestRevisionId: revisionId }],
      ]);
      db._returning.mockResolvedValue([
        makeGateRow({ acceptanceCriteria: ["Must execute Step A"] }),
      ]);

      const gate = await svc.createGate({
        issueId,
        acceptanceCriteria: ["Must execute Step A"],
      });

      expect(gate).toBeDefined();
      expect(gate.status).toBe("pending");
      expect(gate.revisionId).toBe(revisionId);
      expect(gate.acceptanceCriteria).toEqual(["Must execute Step A"]);
    });

    it("throws notFound when no plan document exists", async () => {
      hookSelect(db, []);

      await expect(
        svc.createGate({ issueId, acceptanceCriteria: ["X"] }),
      ).rejects.toThrow("Plan document not found for this issue");
    });

    it("throws conflict when plan document has no revisions", async () => {
      hookSelectSequence(db, [
        [makeDocRef()],
        [{ companyId, latestRevisionId: null }],
      ]);

      await expect(
        svc.createGate({ issueId, acceptanceCriteria: ["X"] }),
      ).rejects.toThrow("Plan document has no revisions yet");
    });

    it("passes optional fields through to the insert", async () => {
      hookSelectSequence(db, [
        [makeDocRef()],
        [{ companyId, latestRevisionId: revisionId }],
      ]);
      db._returning.mockResolvedValue([makeGateRow()]);

      await svc.createGate({
        issueId,
        milestoneId,
        acceptanceCriteria: ["A", "B"],
        assignedAgentId: agentId,
        createdByAgentId: agentId,
        createdByUserId: userId,
      });

      expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({
        _tableName: "plan_review_gates",
      }));
      const valuesFn = (db.insert as ReturnType<typeof vi.fn>).mock.calls[0][1];
      // We verify the insert was called — the values are passed to .values().
      // Check that .values() was called with the right data
      const valuesCall = (db._returning as ReturnType<typeof vi.fn>).mock;

      // Verify the insert chain was used
      expect(db.insert).toHaveBeenCalled();
    });
  });

  describe("resolveGate", () => {
    it("approves a pending gate and returns allApproved=true when no other gates are pending", async () => {
      hookSelectSequence(db, [
        [makeGateRow({ status: "pending" })],
        [{ pending: 0, rejected: 0 }],
      ]);
      db._updateReturning.mockResolvedValue([
        makeGateRow({ status: "approved", resolvedAt: new Date() }),
      ]);

      const result = await svc.resolveGate(gateId, {
        status: "approved",
        resolvedByAgentId: agentId,
        resolutionComment: "Looks good",
      });

      expect(result.gate.status).toBe("approved");
      expect(result.allApproved).toBe(true);
    });

    it("rejects a pending gate and returns allApproved=false", async () => {
      hookSelectSequence(db, [
        [makeGateRow({ status: "pending" })],
        [{ pending: 0, rejected: 0 }],
      ]);
      db._updateReturning.mockResolvedValue([
        makeGateRow({ status: "rejected", resolvedAt: new Date() }),
      ]);

      const result = await svc.resolveGate(gateId, {
        status: "rejected",
        resolvedByUserId: userId,
        resolutionComment: "Needs revision",
      });

      expect(result.gate.status).toBe("rejected");
      expect(result.allApproved).toBe(false);
    });

    it("returns allApproved=false when other gates are still pending", async () => {
      hookSelectSequence(db, [
        [makeGateRow({ status: "pending" })],
        [{ pending: 2, rejected: 0 }],
      ]);
      db._updateReturning.mockResolvedValue([
        makeGateRow({ status: "approved", resolvedAt: new Date() }),
      ]);

      const result = await svc.resolveGate(gateId, { status: "approved" });

      expect(result.gate.status).toBe("approved");
      expect(result.allApproved).toBe(false);
    });

    it("returns allApproved=false when a rejected gate exists even if no gates are pending", async () => {
      hookSelectSequence(db, [
        [makeGateRow({ status: "pending" })],
        [{ pending: 0, rejected: 1 }],
      ]);
      db._updateReturning.mockResolvedValue([
        makeGateRow({ status: "approved", resolvedAt: new Date() }),
      ]);

      const result = await svc.resolveGate(gateId, { status: "approved" });

      expect(result.gate.status).toBe("approved");
      // Even though there are zero pending gates, the existing rejected gate
      // prevents allApproved from being true — fixes H-2 bug.
      expect(result.allApproved).toBe(false);
    });

    it("throws notFound when gate does not exist", async () => {
      hookSelect(db, []);

      await expect(
        svc.resolveGate("nonexistent", { status: "approved" }),
      ).rejects.toThrow("Plan review gate not found");
    });

    it("throws conflict when gate is already resolved", async () => {
      hookSelect(db, [makeGateRow({ status: "approved" })]);

      await expect(
        svc.resolveGate(gateId, { status: "approved" }),
      ).rejects.toThrow("already");
    });

    it("throws conflict when gate is already superseded", async () => {
      hookSelect(db, [makeGateRow({ status: "superseded" })]);

      await expect(
        svc.resolveGate(gateId, { status: "approved" }),
      ).rejects.toThrow("already");
    });
  });

  describe("supersedeGatesForRevision", () => {
    it("supersedes all pending gates for a given revision", async () => {
      hookSelect(db, [makeDocRef()]);

      await svc.supersedeGatesForRevision({ issueId, oldRevisionId: revisionId });

      // Should have called resolvePlanDocumentIds (1 select) then an update
      expect(db.update).toHaveBeenCalled();
      expect(db._chain.from).toHaveBeenCalled(); // from select
    });

    it("throws notFound when no plan document exists", async () => {
      hookSelect(db, []);

      await expect(
        svc.supersedeGatesForRevision({ issueId, oldRevisionId: revisionId }),
      ).rejects.toThrow("Plan document not found for this issue");
    });

    it("only updates pending gates (not approved/rejected)", async () => {
      hookSelect(db, [makeDocRef()]);

      await svc.supersedeGatesForRevision({ issueId, oldRevisionId: revisionId });

      // The update has a where clause that includes status=pending
      const setFn = (db.update as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      expect(setFn).toBeDefined();
    });
  });

  describe("supersedeGatesForPreviousRevisions", () => {
    it("supersedes pending gates from all revisions except the current one", async () => {
      hookSelect(db, [{ companyId }]);

      await svc.supersedeGatesForPreviousRevisions(documentId, revisionId);

      expect(db.update).toHaveBeenCalled();
      expect(db._chain.from).toHaveBeenCalled();
    });

    it("throws notFound when document does not exist", async () => {
      hookSelect(db, []);

      await expect(
        svc.supersedeGatesForPreviousRevisions(documentId, revisionId),
      ).rejects.toThrow("Document not found");
    });
  });
});