import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock drizzle-orm operators
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual("drizzle-orm");
  return {
    ...(actual as Record<string, unknown>),
    eq: vi.fn((a: unknown, b: unknown) => ({ op: "eq", left: a, right: b })),
    and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
    or: vi.fn((...args: unknown[]) => ({ op: "or", args })),
    desc: vi.fn((arg: unknown) => ({ op: "desc", arg })),
    asc: vi.fn((arg: unknown) => ({ op: "asc", arg })),
    gt: vi.fn((a: unknown, b: unknown) => ({ op: "gt", left: a, right: b })),
    count: vi.fn((arg: unknown) => ({
      op: "count",
      arg,
      as: vi.fn((alias: string) => ({ op: "countAs", arg, alias })),
    })),
    ilike: vi.fn((a: unknown, b: unknown) => ({ op: "ilike", left: a, right: b })),
    inArray: vi.fn((a: unknown, b: unknown) => ({ op: "inArray", left: a, right: b })),
    sql: vi.fn(function sql(...args: unknown[]) {
      return { op: "sql", args };
    }),
  };
});

// Mock @paperclipai/db — the table references
vi.mock("@paperclipai/db", () => ({
  knowledgeDocuments: { _tableName: "knowledge_documents" },
  knowledgeDocumentRevisions: { _tableName: "knowledge_document_revisions" },
  knowledgeDocumentReviews: { _tableName: "knowledge_document_reviews" },
  knowledgeSourceBacklinks: { _tableName: "knowledge_source_backlinks" },
  memoryRecords: { _tableName: "memory_records" },
}));

// Mock the errors module
vi.mock("../errors.js", () => ({
  notFound: vi.fn((msg: string) => {
    const err = new Error(msg) as Error & { status: number };
    err.status = 404;
    throw err;
  }),
}));

import { knowledgeDocumentService, type KnowledgeDocumentService } from "./knowledge-documents.js";

// ─── Mock DB builder ─────────────────────────────────────────────────────────

function makeDb() {
  // Shared mock handles — tests can reconfigure these
  const returning = vi.fn().mockResolvedValue([]);
  const updateReturning = vi.fn().mockResolvedValue([]);
  const deleteWhere = vi.fn().mockResolvedValue([]);
  const txReturning = vi.fn().mockResolvedValue([]);

  // Select query chain: all methods return the chain itself
  // `then` is what actually resolves the query result
  const chain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    groupBy: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    offset: vi.fn(() => chain),
    then: vi.fn((resolve: (v: unknown) => unknown) => Promise.resolve(resolve([]))),
  };

  // Last transaction handle — exposed so tests can assert on tx insert values
  let lastTx: unknown = undefined;

  return {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning,
        onConflictDoNothing: vi.fn(() => ({
          returning,
        })),
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
      where: deleteWhere,
    })),
    execute: vi.fn(() => Promise.resolve({ rows: [] })),
    // Transaction: passes a tx handle whose insert/select share the same
    // mock handles so tests can configure promoteFromMemory dedup behavior.
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        insert: vi.fn(() => ({
          values: vi.fn(() => ({
            returning: txReturning,
            onConflictDoNothing: vi.fn(() => ({
              returning: txReturning,
            })),
          })),
        })),
        select: vi.fn(() => chain),
      };
      // Expose the tx handle so tests can assert on insert values
      lastTx = tx;
      return cb(tx);
    }),
    // Exposed for test setup
    _chain: chain,
    _returning: returning,
    _updateReturning: updateReturning,
    _deleteWhere: deleteWhere,
    _txReturning: txReturning,
    _lastTx: () => lastTx,
  };
}

type TestDb = ReturnType<typeof makeDb>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDocRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000010",
    companyId: "00000000-0000-0000-0000-000000000001",
    title: "Test Doc",
    summary: null,
    body: "Content body",
    status: "draft",
    version: 1,
    authorAgentId: null,
    sourceIssueId: null,
    memoryRecordId: null,
    createdAt: new Date("2026-08-16T00:00:00Z"),
    updatedAt: new Date("2026-08-16T00:00:00Z"),
    publishedAt: null,
    ...overrides,
  };
}

function makeRevisionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000020",
    documentId: "00000000-0000-0000-0000-000000000010",
    version: 1,
    title: "Test Doc",
    summary: null,
    body: "Content body",
    changeDescription: "Initial version",
    authorAgentId: null,
    createdAt: new Date("2026-08-16T00:00:00Z"),
    ...overrides,
  };
}

function makeReviewRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000030",
    documentId: "00000000-0000-0000-0000-000000000010",
    revisionId: "00000000-0000-0000-0000-000000000020",
    reviewerAgentId: null,
    status: "approved",
    comment: null,
    createdAt: new Date("2026-08-16T00:00:00Z"),
    decidedAt: new Date("2026-08-16T00:00:00Z"),
    ...overrides,
  };
}

function makeMemoryRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000040",
    companyId: "00000000-0000-0000-0000-000000000001",
    recordType: "analysis",
    text: "Memory content",
    summary: "Memory summary",
    sourceIssueId: null,
    ...overrides,
  };
}

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
  db._deleteWhere.mockResolvedValue([]);
  db._txReturning.mockResolvedValue([]);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("KnowledgeDocumentService", () => {
  let db: TestDb;
  let svc: KnowledgeDocumentService;
  const companyId = "00000000-0000-0000-0000-000000000001";
  const agentId = "00000000-0000-0000-0000-000000000002";
  const issueId = "00000000-0000-0000-0000-000000000003";
  const docId = "00000000-0000-0000-0000-000000000010";
  const revId = "00000000-0000-0000-0000-000000000020";

  beforeEach(() => {
    db = makeDb();
    svc = knowledgeDocumentService(db as never);
  });

  afterEach(() => {
    resetDb(db);
  });

  describe("create", () => {
    it("inserts a document without creating an initial revision", async () => {
      const docRow = makeDocRow();
      db._returning.mockResolvedValueOnce([docRow]);

      const doc = await svc.create(companyId, {
        title: "Test Doc",
        summary: "A summary",
        body: "Content body",
      });

      expect(doc).toBeDefined();
      expect(doc.title).toBe("Test Doc");
      expect(doc.status).toBe("draft");
      expect(doc.version).toBe(1);
      // One insert: document only (revision is created on submitForReview)
      expect(db.insert).toHaveBeenCalledTimes(1);
    });

    it("creates auto-backlink when sourceIssueId is provided", async () => {
      const docRow = makeDocRow();
      db._returning.mockResolvedValue([docRow]); // both inserts use this returning

      await svc.create(companyId, {
        title: "Test Doc",
        body: "Content",
        sourceIssueId: issueId,
      });

      // 2 inserts: document + backlink (no initial revision anymore)
      expect(db.insert).toHaveBeenCalledTimes(2);
    });
  });

  describe("get", () => {
    it("returns a document by id", async () => {
      hookSelect(db, [makeDocRow()]);

      const doc = await svc.get(companyId, docId);
      expect(doc.id).toBe(docId);
      expect(doc.title).toBe("Test Doc");
    });

    it("throws notFound when document does not exist", async () => {
      hookSelect(db, []);

      await expect(svc.get(companyId, "nonexistent")).rejects.toThrow(
        "Knowledge document not found",
      );
    });
  });

  describe("update", () => {
    it("updates a draft document", async () => {
      hookSelect(db, [makeDocRow()]);
      db._updateReturning.mockResolvedValue([
        { ...makeDocRow(), title: "Updated Title" },
      ]);

      const doc = await svc.update(companyId, docId, { title: "Updated Title" });
      expect(doc.title).toBe("Updated Title");
    });

    it("rejects update on non-draft document", async () => {
      hookSelect(db, [makeDocRow({ status: "published" })]);

      await expect(
        svc.update(companyId, docId, { title: "Nope" }),
      ).rejects.toThrow("Only draft documents can be updated directly");
    });
  });

  describe("delete", () => {
    it("deletes a draft document", async () => {
      hookSelect(db, [makeDocRow()]);

      await svc.delete(companyId, docId);
      expect(db.delete).toHaveBeenCalled();
    });

    it("rejects delete on non-draft, non-archived document", async () => {
      hookSelect(db, [makeDocRow({ status: "published" })]);

      await expect(svc.delete(companyId, docId)).rejects.toThrow("Cannot delete");
    });
  });

  describe("workflow lifecycle", () => {
    it("submits a draft document for review", async () => {
      hookSelect(db, [makeDocRow()]);
      db._returning.mockResolvedValueOnce([makeRevisionRow()]);
      // review insert: pending review linked to the new revision
      db._returning.mockResolvedValueOnce([
        makeReviewRow({ status: "pending", decidedAt: null }),
      ]);
      db._updateReturning.mockResolvedValueOnce([
        { ...makeDocRow(), status: "in_review" },
      ]);

      const result = await svc.submitForReview(companyId, docId, {});
      expect(result.document.status).toBe("in_review");
      expect(result.revision.version).toBe(1);
    });

    it("rejects submit on non-draft document", async () => {
      hookSelect(db, [makeDocRow({ status: "published" })]);

      await expect(
        svc.submitForReview(companyId, docId, {}),
      ).rejects.toThrow("Cannot submit a document in 'published' status");
    });

    it("approves a document in review", async () => {
      // Three select queries: assertDocumentExists + latest revision + updated doc
      hookSelectSequence(db, [
        [makeDocRow({ status: "in_review" })],
        [makeRevisionRow()],
        [makeDocRow({ status: "in_review" })],
      ]);

      db._returning.mockResolvedValue([makeReviewRow()]);

      const result = await svc.review(companyId, docId, { status: "approved" });
      expect(result.review.status).toBe("approved");
      // Document stays in_review when approved (batched publication)
      expect(result.document.status).toBe("in_review");
    });

    it("requests changes on a document in review", async () => {
      hookSelectSequence(db, [
        [makeDocRow({ status: "in_review" })],
        [makeRevisionRow()],
        // third select: after UPDATE RETURNING, assertDocumentExists
        [makeDocRow({ status: "draft", version: 2 })],
      ]);

      db._returning.mockResolvedValue([
        makeReviewRow({ status: "changes_requested" }),
      ]);
      db._updateReturning.mockResolvedValue([
        { ...makeDocRow({ status: "draft", version: 2 }) },
      ]);

      const result = await svc.review(companyId, docId, {
        status: "changes_requested",
      });
      expect(result.review.status).toBe("changes_requested");
      // Document reverts to draft with bumped version
      expect(result.document.status).toBe("draft");
      expect(result.document.version).toBe(2);
    });

    it("submits for review again after changes_requested without unique key violation", async () => {
      // ── Step 1: First submission ──
      hookSelectSequence(db, [
        [makeDocRow({ status: "draft", version: 1 })],
      ]);
      db._returning
        .mockResolvedValueOnce([makeRevisionRow()])
        .mockResolvedValueOnce([
          makeReviewRow({ status: "pending", decidedAt: null }),
        ]);
      db._updateReturning.mockResolvedValueOnce([
        { ...makeDocRow({ status: "in_review", version: 1 }) },
      ]);

      const submit1 = await svc.submitForReview(companyId, docId, {});
      expect(submit1.document.status).toBe("in_review");
      expect(submit1.revision.version).toBe(1);

      // ── Step 2: Changes requested ──
      // Reset select sequence for review
      resetDb(db);

      hookSelectSequence(db, [
        [makeDocRow({ status: "in_review", version: 1 })],
        [makeRevisionRow()],
        [makeDocRow({ status: "draft", version: 2 })],
      ]);
      db._returning.mockResolvedValue([
        makeReviewRow({ status: "changes_requested" }),
      ]);
      db._updateReturning.mockResolvedValue([
        { ...makeDocRow({ status: "draft", version: 2 }) },
      ]);

      const reviewResult = await svc.review(companyId, docId, {
        status: "changes_requested",
      });
      expect(reviewResult.document.status).toBe("draft");
      expect(reviewResult.document.version).toBe(2);

      // ── Step 3: Re-submit after changes_requested ──
      // Reset select sequence for re-submit
      resetDb(db);

      hookSelectSequence(db, [
        [makeDocRow({ status: "draft", version: 2 })],
      ]);
      db._returning
        .mockResolvedValueOnce([makeRevisionRow({ version: 2 })])
        .mockResolvedValueOnce([
          makeReviewRow({ status: "pending", decidedAt: null }),
        ]);
      db._updateReturning.mockResolvedValueOnce([
        { ...makeDocRow({ status: "in_review", version: 2 }) },
      ]);

      // Re-submit — this should NOT throw a unique key violation
      const submit2 = await svc.submitForReview(companyId, docId, {});
      expect(submit2.document.status).toBe("in_review");
      expect(submit2.revision.version).toBe(2);
    });

    it("publishes an approved document", async () => {
      hookSelectSequence(db, [
        // Select: assertDocumentExists
        [makeDocRow({ status: "in_review", version: 1 })],
        // Select: latest revision lookup
        [makeRevisionRow({ version: 1 })],
        // Select: approved review for latest revision
        [makeReviewRow()],
      ]);

      db._returning.mockResolvedValueOnce([
        makeRevisionRow({ version: 2, changeDescription: "Version 2" }),
      ]);
      db._updateReturning.mockResolvedValueOnce([
        {
          ...makeDocRow({ status: "published", version: 2 }),
          publishedAt: new Date("2026-08-16T00:00:00Z"),
        },
      ]);

      const result = await svc.publish(companyId, docId, {
        changeDescription: "Version 2",
      });
      expect(result.document.status).toBe("published");
      expect(result.document.version).toBe(2);
    });

    it("rejects stale approval from previous review cycle", async () => {
      // Simulate: document was approved in a previous cycle, then changes
      // were requested, author resubmitted (creating a new revision), but
      // the new revision hasn't been approved yet. The old approval (linked
      // to the old revision) must NOT allow publishing.
      hookSelectSequence(db, [
        // Select: assertDocumentExists
        [makeDocRow({ status: "in_review", version: 1 })],
        // Select: latest revision lookup — returns NEW revision (different id)
        [
          makeRevisionRow({
            id: "00000000-0000-0000-0000-000000000021",
            version: 1,
            createdAt: new Date("2026-08-17T00:00:00Z"),
          }),
        ],
        // Select: approved review for latest revision — empty (no approval yet)
        [],
      ]);

      await expect(
        svc.publish(companyId, docId, { changeDescription: "Version 2" }),
      ).rejects.toThrow(
        "Document must be approved before publishing. Submit for review and get approval first.",
      );
    });

    it("archives a published document", async () => {
      hookSelect(db, [makeDocRow({ status: "published" })]);
      db._updateReturning.mockResolvedValue([
        { ...makeDocRow({ status: "archived" }) },
      ]);

      const doc = await svc.archive(companyId, docId);
      expect(doc.status).toBe("archived");
    });
  });

  describe("list", () => {
    it("returns paginated results", async () => {
      const now = new Date("2026-08-16T00:00:00Z");
      const docRow = makeDocRow({ status: "published", updatedAt: now });

      // First select: list query (select with leftJoin)
      hookSelectSequence(db, [
        [{ document: docRow, revisionCount: 3 }],
        // Second select: latest reviews query (empty)
        [],
      ]);

      const result = await svc.list(companyId, { limit: 10 });
      expect(result.items).toBeDefined();
      expect(result.items.length).toBe(1);
      expect(result.items[0].id).toBe(docId);
      expect(result.items[0].revisionCount).toBe(3);
    });

    it("respects status filter", async () => {
      hookSelect(db, [{ document: makeDocRow({ status: "draft" }), revisionCount: 0 }]);

      const result = await svc.list(companyId, { status: "draft" });
      expect(result.items.length).toBe(1);
      expect(result.items[0].status).toBe("draft");
    });

    it("shows latestReviewStatus for pending reviews", async () => {
      const now = new Date("2026-08-16T00:00:00Z");
      const docRow = makeDocRow({ status: "in_review", updatedAt: now });

      hookSelectSequence(db, [
        [{ document: docRow, revisionCount: 1 }],
        [
          {
            documentId: docId,
            status: "pending",
            decidedAt: null,
          },
        ],
      ]);

      const result = await svc.list(companyId, { limit: 10 });
      expect(result.items.length).toBe(1);
      expect(result.items[0].latestReviewStatus).toBe("pending");
    });

    it("shows changes_requested after a decision, overriding the initial pending review", async () => {
      const now = new Date("2026-08-16T00:00:00Z");
      const docRow = makeDocRow({ status: "draft", updatedAt: now });

      hookSelectSequence(db, [
        [{ document: docRow, revisionCount: 1 }],
        [
          // ORDER BY created_at DESC: the decision was made after the pending
          // review was created, so it sorts first.
          {
            documentId: docId,
            status: "changes_requested",
            decidedAt: now,
          },
          {
            documentId: docId,
            status: "pending",
            decidedAt: null,
          },
        ],
      ]);

      const result = await svc.list(companyId, { limit: 10 });
      expect(result.items[0].latestReviewStatus).toBe("changes_requested");
    });

    it("shows pending after resubmit, overriding stale changes_requested from a previous cycle", async () => {
      const now = new Date("2026-08-16T00:00:00Z");
      const docRow = makeDocRow({ status: "in_review", updatedAt: now });

      hookSelectSequence(db, [
        [{ document: docRow, revisionCount: 2 }],
        [
          // ORDER BY created_at DESC: the new pending review (created on
          // resubmit) sorts before the stale changes_requested from the
          // previous review cycle.
          {
            documentId: docId,
            status: "pending",
            decidedAt: null,
          },
          {
            documentId: docId,
            status: "changes_requested",
            decidedAt: new Date("2026-08-15T00:00:00Z"),
          },
        ],
      ]);

      const result = await svc.list(companyId, { limit: 10 });
      expect(result.items[0].latestReviewStatus).toBe("pending");
    });
  });

  describe("revisions", () => {
    it("lists revisions for a document", async () => {
      hookSelectSequence(db, [
        [makeDocRow()],
        [makeRevisionRow()],
      ]);

      const revisions = await svc.listRevisions(companyId, docId);
      expect(revisions.length).toBe(1);
      expect(revisions[0].version).toBe(1);
    });

    it("gets a specific revision", async () => {
      hookSelectSequence(db, [
        [makeDocRow()],
        [makeRevisionRow()],
      ]);

      const revision = await svc.getRevision(companyId, docId, revId);
      expect(revision.id).toBe(revId);
    });
  });

  describe("diff", () => {
    it("computes diff between two revisions", async () => {
      hookSelectSequence(db, [
        [makeDocRow()],
        [makeRevisionRow({ version: 1, body: "Line A\nLine B\nLine C" })],
        [makeRevisionRow({ version: 2, body: "Line A\nLine D\nLine C" })],
      ]);

      const diff = await svc.diff(companyId, docId, revId, revId);
      expect(diff.oldVersion).toBe(1);
      expect(diff.newVersion).toBe(2);
      expect(diff.bodyDiff).toContain("-Line B");
      expect(diff.bodyDiff).toContain("+Line D");
    });
  });

  describe("backlinks", () => {
    it("creates a backlink", async () => {
      hookSelect(db, [makeDocRow({ status: "published" })]);
      db._returning.mockResolvedValue([{ id: "backlink-1" }]);

      const result = await svc.createBacklink(companyId, docId, {
        sourceIssueId: issueId,
        sourceType: "originating_issue",
      });
      expect(result.id).toBe("backlink-1");
    });

    it("lists backlinks for a document", async () => {
      hookSelectSequence(db, [
        [makeDocRow()],
        [
          {
            id: "bl-1",
            documentId: docId,
            sourceIssueId: issueId,
            sourceType: "originating_issue",
            createdAt: new Date("2026-08-16T00:00:00Z"),
          },
        ],
      ]);

      const backlinks = await svc.listBacklinks(companyId, docId);
      expect(backlinks.length).toBe(1);
      expect(backlinks[0].sourceIssueId).toBe(issueId);
    });
  });

  describe("search", () => {
    it("searches published documents", async () => {
      // searchPublished uses select({...}).from(...) which returns a chain
      hookSelect(db, [
        {
          id: docId,
          title: "Test Doc",
          summary: null,
          score: 0.85,
        },
      ]);

      const results = await svc.searchPublished(companyId, "test query");
      expect(results.length).toBe(1);
      expect(results[0].score).toBeGreaterThan(0);
    });
  });

  describe("promoteFromMemory (VOY-1365 P1-3)", () => {
    const memId = "00000000-0000-0000-0000-000000000040";

    it("promotes a memory record into a new draft document", async () => {
      // Memory record select (before transaction)
      hookSelect(db, [makeMemoryRow()]);
      db._txReturning.mockResolvedValueOnce([makeDocRow({ memoryRecordId: memId })]);

      const result = await svc.promoteFromMemory(companyId, {
        memoryRecordId: memId,
      });
      expect(result.status).toBe("draft");
      // Verify the derived title from recordType was passed to the insert
      const tx = db._lastTx() as { insert: ReturnType<typeof vi.fn> };
      expect(tx).toBeDefined();
      const valuesFn = tx.insert.mock.results[0]?.value?.values;
      expect(valuesFn).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Memory: analysis", // derived from recordType "analysis"
          memoryRecordId: memId,
        }),
      );
    });

    it("returns existing document when memory_record_id conflict is detected (dedup)", async () => {
      const existingDocRow = makeDocRow({
        id: "dedup-existing-doc",
        memoryRecordId: memId,
      });
      // Two selects: 1) memory record lookup 2) existing doc lookup inside tx
      hookSelectSequence(db, [
        [makeMemoryRow()],
        [existingDocRow],
      ]);
      // tx.insert().onConflictDoNothing().returning() returns empty (conflict)
      db._txReturning.mockResolvedValueOnce([]);

      const result = await svc.promoteFromMemory(companyId, {
        memoryRecordId: memId,
      });
      expect(result.id).toBe("dedup-existing-doc");
      expect(result.status).toBe("draft");
    });

    it("creates auto-backlink when memory record has sourceIssueId", async () => {
      const memWithIssue = makeMemoryRow({
        sourceIssueId: issueId,
      });
      hookSelect(db, [memWithIssue]);
      const newDoc = makeDocRow({ memoryRecordId: memId, sourceIssueId: issueId });
      db._txReturning.mockResolvedValueOnce([newDoc]);

      const result = await svc.promoteFromMemory(companyId, {
        memoryRecordId: memId,
      });
      expect(result.status).toBe("draft");
      // The tx was used for both the doc insert and the backlink insert
      // (verify promoteFromMemory reaches the backlink path)
      expect(db.transaction).toHaveBeenCalled();
    });

    it("throws notFound when memory record does not exist", async () => {
      hookSelect(db, []); // empty memory record select

      await expect(
        svc.promoteFromMemory(companyId, { memoryRecordId: memId }),
      ).rejects.toThrow("Memory record not found");
    });
  });

  describe("knowledge search cache invalidation (VOY-1365 P1-1)", () => {
    it("serves repeated searches from cache (control — no mutation)", async () => {
      const q = "cache-control-1365";
      hookSelect(db, [{ id: docId, title: "Doc", summary: null, score: 0.9 }]);
      db._returning.mockResolvedValue([makeDocRow()]);

      const r1 = await svc.searchPublished(companyId, q);
      const r2 = await svc.searchPublished(companyId, q);

      expect(r1).toHaveLength(1);
      expect(r2).toHaveLength(1);
      // Second hit should come from cache — only 1 DB query
      expect(db._chain.then).toHaveBeenCalledTimes(1);
    });

    it("invalidates the cache after create commits", async () => {
      const q = "cache-inv-create-1365";
      hookSelect(db, [{ id: docId, title: "Doc", summary: null, score: 0.9 }]);
      db._returning.mockResolvedValue([makeDocRow()]);

      // First search: cold cache → 1 DB query
      await svc.searchPublished(companyId, q);
      // Create: no select chain calls, but invalidates the cache
      await svc.create(companyId, { title: "New", body: "Body" });
      // Second search: cache was cleared → re-query DB
      await svc.searchPublished(companyId, q);

      // 2 DB queries total — the second re-queried because cache was invalidated
      expect(db._chain.then).toHaveBeenCalledTimes(2);
    });

    it("invalidates the cache after update commits", async () => {
      const q = "cache-inv-update-1365";
      hookSelectSequence(db, [
        [{ id: docId, title: "Doc", summary: null, score: 0.9 }], // searchPublished
        [makeDocRow()],  // assertDocumentExists inside update
      ]);
      db._updateReturning.mockResolvedValue([makeDocRow({ title: "Updated" })]);

      await svc.searchPublished(companyId, q);
      await svc.update(companyId, docId, { title: "Updated" });
      await svc.searchPublished(companyId, q);

      // 3 DB queries: search(1) + assertExists(1) + search(1)
      expect(db._chain.then).toHaveBeenCalledTimes(3);
    });
  });
});
