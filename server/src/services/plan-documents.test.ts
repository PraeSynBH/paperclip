import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock drizzle-orm operators
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual("drizzle-orm");
  return {
    ...(actual as Record<string, unknown>),
    eq: vi.fn((a: unknown, b: unknown) => ({ op: "eq", left: a, right: b })),
    and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
    desc: vi.fn((arg: unknown) => ({ op: "desc", arg })),
    lt: vi.fn((a: unknown, b: unknown) => ({ op: "lt", left: a, right: b })),
  };
});

// Mock @paperclipai/db — the table references
vi.mock("@paperclipai/db", () => ({
  documents: { _tableName: "documents" },
  documentRevisions: { _tableName: "document_revisions" },
  issueDocuments: { _tableName: "issue_documents" },
  issues: { _tableName: "issues" },
}));

// Mock the errors module
vi.mock("../errors.js", () => ({
  notFound: vi.fn((msg: string) => {
    const err = new Error(msg) as Error & { status: number };
    err.status = 404;
    throw err;
  }),
  unprocessable: vi.fn((msg: string, details?: unknown) => {
    const err = new Error(msg) as Error & { status: number; details?: unknown };
    err.status = 422;
    err.details = details;
    throw err;
  }),
}));

// Hoisted handles for the documentService mock
const { mockDocumentService, mockUpsertIssueDocument, mockGetIssueDocumentPayload } = vi.hoisted(() => {
  const upsert = vi.fn();
  const getPayload = vi.fn();
  return {
    mockDocumentService: vi.fn(() => ({
      upsertIssueDocument: upsert,
      getIssueDocumentPayload: getPayload,
    })),
    mockUpsertIssueDocument: upsert,
    mockGetIssueDocumentPayload: getPayload,
  };
});

// Mock the documentService dependency — planDocumentService delegates
// upsert/get to it, so we only need those two methods.
vi.mock("./documents.js", () => ({
  documentService: mockDocumentService,
}));

import { planDocumentService } from "./plan-documents.js";

// ─── Mock DB builder ─────────────────────────────────────────────────────────

function makeDb() {
  const returning = vi.fn().mockResolvedValue([]);
  const updateReturning = vi.fn().mockResolvedValue([]);

  // Select query chain: all methods return the chain itself.
  // `then` is what actually resolves the query result (the chain is thenable,
  // which is also how `return db.select()...` awaited by callers resolves).
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

  return {
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
}

type TestDb = ReturnType<typeof makeDb>;

/** Configure the select chain to resolve with given rows. */
function hookSelect(db: TestDb, rows: unknown[]) {
  db._chain.then.mockImplementation(
    (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(rows)),
  );
}

/** Configure the select chain to resolve with different rows on successive calls. */
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

/** Reset all shared mocks to defaults */
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
const revisionId1 = "00000000-0000-0000-0000-000000000004";
const revisionId2 = "00000000-0000-0000-0000-000000000005";

const VALID_PLAN_METADATA = {
  sections: [],
  milestones: [],
  status: "draft",
  version: 1,
} as const;

function makeIssueRow(overrides: Record<string, unknown> = {}) {
  return { id: issueId, companyId, ...overrides };
}

function makePlanDocRow(overrides: Record<string, unknown> = {}) {
  return {
    id: documentId,
    companyId,
    issueId,
    key: "plan",
    title: "Test Plan",
    format: "markdown",
    body: "Step 1\nStep 2",
    latestRevisionId: revisionId2,
    latestRevisionNumber: 2,
    createdAt: new Date("2026-08-16T00:00:00Z"),
    updatedAt: new Date("2026-08-16T00:00:00Z"),
    ...overrides,
  };
}

function makeRevisionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: revisionId2,
    companyId,
    documentId,
    revisionNumber: 2,
    title: "Test Plan",
    format: "markdown",
    body: "Step 1\nStep 2",
    planMetadata: VALID_PLAN_METADATA,
    changeSummary: "Second version",
    createdByAgentId: null,
    createdByUserId: null,
    createdByRunId: null,
    createdAt: new Date("2026-08-16T00:00:00Z"),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("planDocumentService", () => {
  let db: TestDb;
  let svc: ReturnType<typeof planDocumentService>;

  beforeEach(() => {
    db = makeDb();
    svc = planDocumentService(db as never);
    mockDocumentService.mockClear();
    mockUpsertIssueDocument.mockReset();
    mockGetIssueDocumentPayload.mockReset();
  });

  afterEach(() => {
    resetDb(db);
  });

  describe("upsertPlanDocument", () => {
    it("delegates to upsertIssueDocument with valid planMetadata", async () => {
      const doc = makePlanDocRow();
      mockUpsertIssueDocument.mockResolvedValue({ created: true, document: doc });

      const result = await svc.upsertPlanDocument({
        issueId,
        body: "Step 1\nStep 2",
        title: "Test Plan",
        changeSummary: "Second version",
        baseRevisionId: revisionId1,
        createdByAgentId: "agent-1",
        createdByUserId: "user-1",
        createdByRunId: "run-1",
        planMetadata: { ...VALID_PLAN_METADATA },
      });

      expect(result.created).toBe(true);
      expect(mockUpsertIssueDocument).toHaveBeenCalledWith({
        issueId,
        key: "plan",
        title: "Test Plan",
        format: "markdown",
        body: "Step 1\nStep 2",
        changeSummary: "Second version",
        baseRevisionId: revisionId1,
        createdByAgentId: "agent-1",
        createdByUserId: "user-1",
        createdByRunId: "run-1",
        lockedDocumentStrategy: "conflict",
        planMetadata: { ...VALID_PLAN_METADATA },
      });
    });

    it("passes null planMetadata when omitted", async () => {
      mockUpsertIssueDocument.mockResolvedValue({
        created: true,
        document: makePlanDocRow(),
      });

      await svc.upsertPlanDocument({ issueId, body: "Step 1" });

      expect(mockUpsertIssueDocument).toHaveBeenCalledWith(
        expect.objectContaining({ issueId, key: "plan", planMetadata: null }),
      );
    });

    it("throws unprocessable when planMetadata is invalid", async () => {
      await expect(
        svc.upsertPlanDocument({
          issueId,
          body: "Step 1",
          planMetadata: { status: "bogus-status", version: 1 },
        }),
      ).rejects.toMatchObject({
        status: 422,
        message: "Invalid plan metadata",
      });

      expect(mockUpsertIssueDocument).not.toHaveBeenCalled();
    });

    it("throws unprocessable when planMetadata version is unsupported", async () => {
      await expect(
        svc.upsertPlanDocument({
          issueId,
          body: "Step 1",
          planMetadata: { sections: [], milestones: [], status: "draft", version: 2 },
        }),
      ).rejects.toMatchObject({ status: 422 });
    });
  });

  describe("getPlanDocument", () => {
    it("returns the plan document when it exists", async () => {
      const doc = makePlanDocRow();
      mockGetIssueDocumentPayload.mockResolvedValue({
        planDocument: doc,
        documentSummaries: [],
        legacyPlanDocument: null,
      });

      const result = await svc.getPlanDocument(issueId);

      expect(result).toEqual(doc);
      expect(mockGetIssueDocumentPayload).toHaveBeenCalledWith(
        { id: issueId, description: null },
        { includeSystem: true },
      );
    });

    it("returns null when no plan document exists", async () => {
      mockGetIssueDocumentPayload.mockResolvedValue({
        planDocument: null,
        documentSummaries: [],
        legacyPlanDocument: null,
      });

      const result = await svc.getPlanDocument(issueId);

      expect(result).toBeNull();
    });
  });

  describe("listPlanRevisions", () => {
    it("returns revisions with plan metadata snapshots", async () => {
      hookSelectSequence(db, [
        [makeIssueRow()],
        [
          makeRevisionRow({
            id: revisionId2,
            revisionNumber: 2,
            body: "Step 3\nStep 4",
            planMetadata: { ...VALID_PLAN_METADATA, status: "in_review" },
          }),
          makeRevisionRow({
            id: revisionId1,
            revisionNumber: 1,
            body: "Step 1\nStep 2",
            planMetadata: { ...VALID_PLAN_METADATA },
          }),
        ],
      ]);

      const revisions = await svc.listPlanRevisions(issueId);

      expect(revisions).toHaveLength(2);
      expect(revisions[0].revisionNumber).toBe(2);
      expect(revisions[0].planMetadata).toEqual({
        ...VALID_PLAN_METADATA,
        status: "in_review",
      });
      expect(revisions[1].planMetadata).toEqual(VALID_PLAN_METADATA);
    });

    it("throws notFound when issue does not exist", async () => {
      hookSelect(db, []);

      await expect(svc.listPlanRevisions(issueId)).rejects.toMatchObject({
        status: 404,
        message: "Issue not found",
      });
    });
  });

  describe("computePlanDiff", () => {
    const baseRows = (target: Record<string, unknown>) => [
      [makeIssueRow()],
      [makePlanDocRow()],
      [makeRevisionRow({ ...target })],
    ];

    it("diffs against the previous revision when no againstRevisionId is given", async () => {
      hookSelectSequence(db, [
        ...baseRows({
          id: revisionId2,
          revisionNumber: 2,
          body: "Step 1\nStep 3",
        }),
        [makeRevisionRow({ id: revisionId1, revisionNumber: 1, body: "Step 1\nStep 2" })],
      ]);

      const result = await svc.computePlanDiff(issueId, revisionId2);

      expect(result.revision.id).toBe(revisionId2);
      expect(result.previousRevision).toEqual({
        id: revisionId1,
        revisionNumber: 1,
      });
      const added = result.bodyDiff.filter((l) => l.type === "added").map((l) => l.value);
      const removed = result.bodyDiff.filter((l) => l.type === "removed").map((l) => l.value);
      expect(added).toContain("Step 3");
      expect(removed).toContain("Step 2");
    });

    it("returns null previousRevision and full diff for the first revision", async () => {
      hookSelectSequence(db, [
        ...baseRows({ id: revisionId1, revisionNumber: 1, body: "Step 1\nStep 2" }),
        [], // no previous revision
      ]);

      const result = await svc.computePlanDiff(issueId, revisionId1);

      expect(result.previousRevision).toBeNull();
      // Diff against "" — oldLines = [""], newLines = ["Step 1","Step 2"]
      // LCS produces a leading removed empty line then all added lines
      const types = result.bodyDiff.map((l) => l.type);
      expect(types[0]).toBe("removed");
      expect(types.slice(1).every((t) => t === "added")).toBe(true);
      expect(result.bodyDiff.map((l) => l.value)).toContain("Step 1");
      expect(result.bodyDiff.map((l) => l.value)).toContain("Step 2");
    });

    it("handles exact-match bodies as all unchanged", async () => {
      hookSelectSequence(db, [
        ...baseRows({ id: revisionId2, revisionNumber: 2, body: "Step 1\nStep 2" }),
        [makeRevisionRow({ id: revisionId1, revisionNumber: 1, body: "Step 1\nStep 2" })],
      ]);

      const result = await svc.computePlanDiff(issueId, revisionId2);

      expect(result.bodyDiff.every((l) => l.type === "unchanged")).toBe(true);
      expect(result.bodyDiff.map((l) => l.value)).toEqual(["Step 1", "Step 2"]);
    });

    it("handles a single-line body", async () => {
      hookSelectSequence(db, [
        ...baseRows({ id: revisionId2, revisionNumber: 2, body: "Only line" }),
        [makeRevisionRow({ id: revisionId1, revisionNumber: 1, body: "Old line" })],
      ]);

      const result = await svc.computePlanDiff(issueId, revisionId2);

      const added = result.bodyDiff.filter((l) => l.type === "added").map((l) => l.value);
      const removed = result.bodyDiff.filter((l) => l.type === "removed").map((l) => l.value);
      expect(added).toEqual(["Only line"]);
      expect(removed).toEqual(["Old line"]);
    });

    it("handles empty bodies", async () => {
      hookSelectSequence(db, [
        ...baseRows({ id: revisionId2, revisionNumber: 2, body: "" }),
        [makeRevisionRow({ id: revisionId1, revisionNumber: 1, body: "" })],
      ]);

      const result = await svc.computePlanDiff(issueId, revisionId2);

      // "" vs "" — both split into [""], which LCS treats as one unchanged line
      expect(result.bodyDiff).toEqual([
        { type: "unchanged", value: "", oldLineNumber: 1, newLineNumber: 1 },
      ]);
    });

    it("diffs against a specific revision when againstRevisionId is given", async () => {
      hookSelectSequence(db, [
        ...baseRows({ id: revisionId2, revisionNumber: 2, body: "A\nC" }),
        [makeRevisionRow({ id: revisionId1, revisionNumber: 1, body: "A\nB" })],
      ]);

      const result = await svc.computePlanDiff(issueId, revisionId2, revisionId1);

      expect(result.previousRevision).toEqual({
        id: revisionId1,
        revisionNumber: 1,
      });
      const added = result.bodyDiff.filter((l) => l.type === "added").map((l) => l.value);
      const removed = result.bodyDiff.filter((l) => l.type === "removed").map((l) => l.value);
      expect(added).toContain("C");
      expect(removed).toContain("B");
    });

    it("throws notFound when issue does not exist", async () => {
      hookSelect(db, []);

      await expect(svc.computePlanDiff(issueId, revisionId2)).rejects.toMatchObject({
        status: 404,
        message: "Issue not found",
      });
    });

    it("throws notFound when no plan document exists", async () => {
      hookSelectSequence(db, [
        [makeIssueRow()],
        [], // no plan document
      ]);

      await expect(svc.computePlanDiff(issueId, revisionId2)).rejects.toMatchObject({
        status: 404,
        message: "Plan document not found",
      });
    });

    it("throws notFound when target revision does not exist", async () => {
      hookSelectSequence(db, [
        [makeIssueRow()],
        [makePlanDocRow()],
        [], // no target revision
      ]);

      await expect(svc.computePlanDiff(issueId, revisionId2)).rejects.toMatchObject({
        status: 404,
        message: "Revision not found",
      });
    });

    it("throws notFound when against revision does not exist", async () => {
      hookSelectSequence(db, [
        ...baseRows({ id: revisionId2, revisionNumber: 2, body: "A" }),
        [], // no against revision
      ]);

      await expect(
        svc.computePlanDiff(issueId, revisionId2, revisionId1),
      ).rejects.toMatchObject({
        status: 404,
        message: "Against revision not found",
      });
    });
  });
});