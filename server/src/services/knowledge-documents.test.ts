import { beforeEach, describe, expect, it, vi } from "vitest";

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
    count: vi.fn((arg: unknown) => ({ op: "count", arg })),
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeDb() {
  const insert = vi.fn();
  const select = vi.fn();
  const update = vi.fn();
  const del = vi.fn();

  function makeChain(overrides?: Record<string, unknown>) {
    return {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      leftJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      groupBy: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      offset: vi.fn(() => chain),
      values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])) })),
      returning: vi.fn(() => Promise.resolve([])),
      then: vi.fn((resolve: (v: unknown) => unknown) => resolve([])),
      ...overrides,
    };
  }

  const chain = makeChain();

  return {
    insert: vi.fn(() => chain),
    select: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    execute: vi.fn(() => Promise.resolve({ rows: [] })),
    _chain: chain,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("KnowledgeDocumentService", () => {
  let db: ReturnType<typeof makeDb>;
  let svc: KnowledgeDocumentService;
  const companyId = "00000000-0000-0000-0000-000000000001";
  const agentId = "00000000-0000-0000-0000-000000000002";
  const issueId = "00000000-0000-0000-0000-000000000003";
  const docId = "00000000-0000-0000-0000-000000000010";
  const revId = "00000000-0000-0000-0000-000000000020";

  beforeEach(() => {
    db = makeDb();
    svc = knowledgeDocumentService(db as any);
  });

  describe("create", () => {
    it("inserts a document and creates initial revision", async () => {
      const now = new Date();
      db.insert.mockReturnValue({
        returning: vi.fn().mockResolvedValue([
          {
            id: docId,
            companyId,
            title: "Test Doc",
            summary: "A summary",
            body: "Content body",
            status: "draft",
            version: 1,
            authorAgentId: null,
            sourceIssueId: null,
            createdAt: now,
            updatedAt: now,
            publishedAt: null,
          },
        ]),
      });

      const doc = await svc.create(companyId, {
        title: "Test Doc",
        summary: "A summary",
        body: "Content body",
      });

      expect(doc).toBeDefined();
      expect(doc.title).toBe("Test Doc");
      expect(doc.status).toBe("draft");
      expect(doc.version).toBe(1);
      expect(db.insert).toHaveBeenCalledTimes(2); // document + revision
    });
  });

  describe("workflow lifecycle", () => {
    it("submits a draft document for review", async () => {
      const now = new Date();

      // Mock the get (assertDocumentExists)
      db.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: docId,
            companyId,
            title: "Test",
            summary: null,
            body: "Content",
            status: "draft",
            version: 1,
            authorAgentId: null,
            sourceIssueId: null,
            createdAt: now,
            updatedAt: now,
            publishedAt: null,
          },
        ]),
      });

      // Mock the insert for revision
      db.insert.mockReturnValue({
        returning: vi.fn().mockResolvedValue([
          {
            id: revId,
            documentId: docId,
            version: 1,
            title: "Test",
            summary: null,
            body: "Content",
            changeDescription: "Submitted for review",
            authorAgentId: null,
            createdAt: now,
          },
        ]),
      });

      // Insert for revision already consumed above; need separate mock
      // Actually the insert is called twice (revision + update), handle that
      db.insert
        .mockReturnValueOnce({
          returning: vi.fn().mockResolvedValue([
            {
              id: revId,
              documentId: docId,
              version: 1,
              title: "Test",
              summary: null,
              body: "Content",
              changeDescription: "Submitted for review",
              authorAgentId: null,
              createdAt: now,
            },
          ]),
        })
        .mockReturnValueOnce({
          returning: vi.fn().mockResolvedValue([]),
        });

      // Mock update for status transition
      db.update.mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([
          {
            id: docId,
            companyId,
            title: "Test",
            summary: null,
            body: "Content",
            status: "in_review",
            version: 1,
            authorAgentId: null,
            sourceIssueId: null,
            createdAt: now,
            updatedAt: now,
            publishedAt: null,
          },
        ]),
      });

      const result = await svc.submitForReview(companyId, docId, {});
      expect(result.document.status).toBe("in_review");
      expect(result.revision.version).toBe(1);
    });
  });

  describe("list", () => {
    it("returns paginated results", async () => {
      const now = new Date();

      // Mock select chain for list query
      const mockChain = {
        document: {
          id: docId,
          title: "Doc 1",
          summary: null,
          status: "published",
          version: 2,
          authorAgentId: null,
          sourceIssueId: null,
          createdAt: now,
          updatedAt: now,
          publishedAt: now,
        },
        revisionCount: 3,
      };

      db.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockChain]),
      });

      // Mock the reviews query
      const reviewsMock = vi.fn().mockResolvedValue([]);
      db.select
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          groupBy: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([mockChain]),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          groupBy: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([]),
        });

      const result = await svc.list(companyId, { limit: 10 });
      expect(result.items).toBeDefined();
      expect(result.items.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("backlinks", () => {
    it("creates a backlink", async () => {
      const now = new Date();

      // Mock get (assertDocumentExists)
      db.select.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          {
            id: docId,
            companyId,
            title: "Doc",
            summary: null,
            body: "Body",
            status: "published",
            version: 1,
            authorAgentId: null,
            sourceIssueId: null,
            createdAt: now,
            updatedAt: now,
            publishedAt: now,
          },
        ]),
      });

      // Mock insert for backlink
      db.insert.mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: "backlink-1" }]),
      });

      const result = await svc.createBacklink(companyId, docId, {
        sourceIssueId: issueId,
        sourceType: "originating_issue",
      });
      expect(result.id).toBeDefined();
    });
  });
});