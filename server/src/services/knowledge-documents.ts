import { and, asc, count, desc, eq, gt, ilike, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  knowledgeDocuments,
  knowledgeDocumentRevisions,
  knowledgeDocumentReviews,
  knowledgeSourceBacklinks,
  memoryRecords,
} from "@paperclipai/db";
import type {
  KnowledgeDocument,
  KnowledgeDocumentRevision,
  KnowledgeDocumentReview,
  KnowledgeSourceBacklink,
  KnowledgeDocumentCreateRequest,
  KnowledgeDocumentUpdateRequest,
  KnowledgeDocumentPublishRequest,
  KnowledgeDocumentSubmitReviewRequest,
  KnowledgeDocumentReviewDecision,
  KnowledgeDocumentListQuery,
  KnowledgeDocumentListPage,
  KnowledgeDocumentDiff,
  KnowledgeCreateBacklinkRequest,
  KnowledgePromoteFromMemoryRequest,
} from "@paperclipai/shared";
import { notFound } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { KNOWLEDGE_SEARCH_CACHE_TTL_MS } from "../timeout-constants.js";

// ─── Knowledge Search Cache ──────────────────────────────────────────────────

/**
 * Simple in-memory cache for knowledge document search results.
 * Reduces repeated full-text search overhead for common queries.
 */
const knowledgeSearchCache = new Map<string, {
  result: Array<{ id: string; title: string; summary?: string; score: number }>;
  cachedAt: number;
}>();
const KNOWLEDGE_SEARCH_CACHE_MAX = 200;

function buildKnowledgeSearchCacheKey(companyId: string, query: string, limit: number): string {
  return `${companyId}:${query.toLowerCase().trim()}:${limit}`;
}

/**
 * Invalidate the knowledge search cache.
 *
 * Called on any knowledge document mutation (create/update/delete/publish/
 * archive/review/promote) so search results never serve stale rows. Full
 * invalidation is intentionally coarse — the cache is small (200 entries)
 * and knowledge mutations are rare relative to searches, so a blanket clear
 * is cheaper and simpler than per-document tagging.
 */
function invalidateKnowledgeSearchCache(): void {
  knowledgeSearchCache.clear();
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface KnowledgeDocumentService {
  /** Create a new knowledge document (draft). */
  create(
    companyId: string,
    req: KnowledgeDocumentCreateRequest,
    authorAgentId?: string,
  ): Promise<KnowledgeDocument>;

  /** Get a document by ID. */
  get(companyId: string, documentId: string): Promise<KnowledgeDocument>;

  /** Update a draft document. */
  update(
    companyId: string,
    documentId: string,
    req: KnowledgeDocumentUpdateRequest,
  ): Promise<KnowledgeDocument>;

  /** Delete a draft document. */
  delete(companyId: string, documentId: string): Promise<void>;

  /** List documents with pagination, filtering, and search. */
  list(companyId: string, query: KnowledgeDocumentListQuery): Promise<KnowledgeDocumentListPage>;

  /** Submit a document for review (draft → in_review). Creates a revision snapshot. */
  submitForReview(
    companyId: string,
    documentId: string,
    req: KnowledgeDocumentSubmitReviewRequest,
    authorAgentId?: string,
  ): Promise<{ document: KnowledgeDocument; revision: KnowledgeDocumentRevision }>;

  /** Review a document (approve or request changes). */
  review(
    companyId: string,
    documentId: string,
    decision: KnowledgeDocumentReviewDecision,
    reviewerAgentId?: string,
  ): Promise<{ document: KnowledgeDocument; review: KnowledgeDocumentReview }>;

  /** Publish an approved document (in_review + approved → published). Increments version. */
  publish(
    companyId: string,
    documentId: string,
    req: KnowledgeDocumentPublishRequest,
  ): Promise<{ document: KnowledgeDocument; revision: KnowledgeDocumentRevision }>;

  /** Archive a published document. */
  archive(companyId: string, documentId: string): Promise<KnowledgeDocument>;

  /** List revisions for a document. */
  listRevisions(
    companyId: string,
    documentId: string,
  ): Promise<KnowledgeDocumentRevision[]>;

  /** Get a specific revision. */
  getRevision(
    companyId: string,
    documentId: string,
    revisionId: string,
  ): Promise<KnowledgeDocumentRevision>;

  /** Compute diff between two revisions. */
  diff(
    companyId: string,
    documentId: string,
    revisionIdA: string,
    revisionIdB: string,
  ): Promise<KnowledgeDocumentDiff>;

  /** Create a backlink from a knowledge document to an issue. */
  createBacklink(
    companyId: string,
    documentId: string,
    req: KnowledgeCreateBacklinkRequest,
  ): Promise<{ id: string }>;

  /** Get backlinks for a document. */
  listBacklinks(
    companyId: string,
    documentId: string,
  ): Promise<KnowledgeSourceBacklink[]>;

  /** Search across all published knowledge documents. */
  searchPublished(
    companyId: string,
    query: string,
    limit?: number,
  ): Promise<Array<{ id: string; title: string; summary?: string; score: number }>>;

  /** Promote a memory record to a draft knowledge document. */
  promoteFromMemory(
    companyId: string,
    req: KnowledgePromoteFromMemoryRequest,
    authorAgentId?: string,
  ): Promise<KnowledgeDocument>;
}

// ─── Factory ────────────────────────────────────────────────────────────────

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

export function knowledgeDocumentService(db: Db): KnowledgeDocumentService {
  // ─── Helpers ────────────────────────────────────────────────────────────

  async function assertDocumentExists(
    companyId: string,
    documentId: string,
  ): Promise<typeof knowledgeDocuments.$inferSelect> {
    const rows = await db
      .select()
      .from(knowledgeDocuments)
      .where(
        and(
          eq(knowledgeDocuments.id, documentId),
          eq(knowledgeDocuments.companyId, companyId),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      throw notFound("Knowledge document not found");
    }
    return rows[0];
  }

  function toDocument(
    row: typeof knowledgeDocuments.$inferSelect,
  ): KnowledgeDocument {
    return {
      id: row.id,
      companyId: row.companyId,
      title: row.title,
      summary: row.summary ?? undefined,
      body: row.body,
      status: row.status as KnowledgeDocument["status"],
      version: row.version,
      authorAgentId: row.authorAgentId ?? undefined,
      sourceIssueId: row.sourceIssueId ?? undefined,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      publishedAt: row.publishedAt?.toISOString(),
    };
  }

  function toRevision(
    row: typeof knowledgeDocumentRevisions.$inferSelect,
  ): KnowledgeDocumentRevision {
    return {
      id: row.id,
      documentId: row.documentId,
      version: row.version,
      title: row.title,
      summary: row.summary ?? undefined,
      body: row.body,
      changeDescription: row.changeDescription ?? undefined,
      authorAgentId: row.authorAgentId ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Compute a simple text diff between two bodies. Returns a unified-diff-like
   * string representation using line-level comparison.
   */
  function computeBodyDiff(oldBody: string, newBody: string): string {
    if (oldBody === newBody) return "(no changes)";

    const oldLines = oldBody.split("\n");
    const newLines = newBody.split("\n");

    // Simple LCS-based diff. For production, we'd use a proper diff library.
    const changes: string[] = [];
    let i = 0;
    let j = 0;

    while (i < oldLines.length || j < newLines.length) {
      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        changes.push(` ${oldLines[i]}`);
        i++;
        j++;
      } else if (j < newLines.length && (i >= oldLines.length || newLines[j] !== oldLines[i])) {
        changes.push(`+${newLines[j]}`);
        j++;
      } else if (i < oldLines.length) {
        changes.push(`-${oldLines[i]}`);
        i++;
      }
    }

    if (changes.length <= 1) return "(no changes)";
    return changes.slice(0, 200).join("\n") + (changes.length > 200 ? "\n...(truncated)" : "");
  }

  // ─── Implementation ────────────────────────────────────────────────────

  async function create(
    companyId: string,
    req: KnowledgeDocumentCreateRequest,
    authorAgentId?: string,
  ): Promise<KnowledgeDocument> {
    const rows = await db
      .insert(knowledgeDocuments)
      .values({
        companyId,
        title: req.title,
        summary: req.summary ?? null,
        body: req.body ?? "",
        status: "draft",
        version: 1,
        authorAgentId: authorAgentId ?? null,
        sourceIssueId: req.sourceIssueId ?? null,
      })
      .returning();

    // NOTE: No initial revision is created here — the first revision snapshot
    // is created by submitForReview when the document enters the review
    // lifecycle. Creating one here would cause a duplicate key violation on
    // knowledge_document_revisions_doc_ver_unique_idx when submitForReview
    // later tries to insert version=1.
    // If sourceIssueId is provided, create a backlink automatically
    if (req.sourceIssueId) {
      await db
        .insert(knowledgeSourceBacklinks)
        .values({
          documentId: rows[0].id,
          sourceIssueId: req.sourceIssueId,
          sourceType: "originating_issue",
        })
        .onConflictDoNothing();
    }

    invalidateKnowledgeSearchCache();
    return toDocument(rows[0]);
  }

  async function get(
    companyId: string,
    documentId: string,
  ): Promise<KnowledgeDocument> {
    const doc = await assertDocumentExists(companyId, documentId);
    return toDocument(doc);
  }

  async function update(
    companyId: string,
    documentId: string,
    req: KnowledgeDocumentUpdateRequest,
  ): Promise<KnowledgeDocument> {
    const doc = await assertDocumentExists(companyId, documentId);

    if (doc.status !== "draft") {
      throw new Error("Only draft documents can be updated directly. Create a new revision via review workflow.");
    }

    const updates: Record<string, unknown> = {};
    if (req.title !== undefined) updates.title = req.title;
    if (req.summary !== undefined) updates.summary = req.summary;
    if (req.body !== undefined) updates.body = req.body;

    if (Object.keys(updates).length === 0) {
      return toDocument(doc);
    }

    const rows = await db
      .update(knowledgeDocuments)
      .set({ ...updates, updatedAt: new Date() })
      .where(
        and(
          eq(knowledgeDocuments.id, documentId),
          eq(knowledgeDocuments.companyId, companyId),
        ),
      )
      .returning();

    invalidateKnowledgeSearchCache();
    return toDocument(rows[0]);
  }

  async function deleteDocument(
    companyId: string,
    documentId: string,
  ): Promise<void> {
    const doc = await assertDocumentExists(companyId, documentId);

    if (doc.status !== "draft" && doc.status !== "archived") {
      throw new Error(
        `Cannot delete a document in '${doc.status}' status. Archive it first.`,
      );
    }

    await db
      .delete(knowledgeDocuments)
      .where(
        and(
          eq(knowledgeDocuments.id, documentId),
          eq(knowledgeDocuments.companyId, companyId),
        ),
      );

    invalidateKnowledgeSearchCache();
  }

  async function list(
    companyId: string,
    query: KnowledgeDocumentListQuery,
  ): Promise<KnowledgeDocumentListPage> {
    const limit = Math.min(query.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
    const conditions = [eq(knowledgeDocuments.companyId, companyId)];

    if (query.status) {
      conditions.push(eq(knowledgeDocuments.status, query.status));
    }

    if (query.search) {
      const searchCondition = or(
        ilike(knowledgeDocuments.title, `%${query.search}%`),
        ilike(knowledgeDocuments.summary ?? sql`''`, `%${query.search}%`),
        ilike(knowledgeDocuments.body, `%${query.search}%`),
      );
      if (searchCondition) {
        conditions.push(searchCondition);
      }
    }

    if (query.cursor) {
      // Cursor-based pagination: cursor is the created_at of the last item
      conditions.push(
        gt(knowledgeDocuments.createdAt, new Date(query.cursor)),
      );
    }

    const rows = await db
      .select({
        document: knowledgeDocuments,
        revisionCount: count(knowledgeDocumentRevisions.id).as("revision_count"),
      })
      .from(knowledgeDocuments)
      .leftJoin(
        knowledgeDocumentRevisions,
        eq(knowledgeDocumentRevisions.documentId, knowledgeDocuments.id),
      )
      .where(and(...conditions))
      .groupBy(knowledgeDocuments.id)
      .orderBy(desc(knowledgeDocuments.updatedAt))
      .limit(limit + 1); // Fetch one extra to determine if there's a next page

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);

    // Get latest review status for each document
    const docIds = items.map((r) => r.document.id);
    const latestReviews = docIds.length > 0
      ? await db
          .select({
            documentId: knowledgeDocumentReviews.documentId,
            status: knowledgeDocumentReviews.status,
            decidedAt: knowledgeDocumentReviews.decidedAt,
          })
          .from(knowledgeDocumentReviews)
          .where(
            inArray(knowledgeDocumentReviews.documentId, docIds as [string, ...string[]]),
          )
          .orderBy(desc(knowledgeDocumentReviews.createdAt))
      : [];

    const reviewMap = new Map<string, string>();
    for (const r of latestReviews) {
      if (!reviewMap.has(r.documentId)) {
        reviewMap.set(r.documentId, r.status);
      }
    }

    const nextCursor =
      hasMore && items.length > 0
        ? items[items.length - 1].document.updatedAt.toISOString()
        : undefined;

    return {
      items: items.map((r) => ({
        id: r.document.id,
        title: r.document.title,
        summary: r.document.summary ?? undefined,
        status: r.document.status as KnowledgeDocument["status"],
        version: r.document.version,
        authorAgentId: r.document.authorAgentId ?? undefined,
        sourceIssueId: r.document.sourceIssueId ?? undefined,
        createdAt: r.document.createdAt.toISOString(),
        updatedAt: r.document.updatedAt.toISOString(),
        publishedAt: r.document.publishedAt?.toISOString(),
        revisionCount: Number(r.revisionCount),
        latestReviewStatus: reviewMap.get(r.document.id) as
          | "approved"
          | "pending"
          | "changes_requested"
          | undefined,
      })),
      nextCursor,
    };
  }

  async function submitForReview(
    companyId: string,
    documentId: string,
    req: KnowledgeDocumentSubmitReviewRequest,
    authorAgentId?: string,
  ): Promise<{ document: KnowledgeDocument; revision: KnowledgeDocumentRevision }> {
    const doc = await assertDocumentExists(companyId, documentId);

    if (doc.status !== "draft") {
      throw new Error(
        `Cannot submit a document in '${doc.status}' status. Only drafts can be submitted for review.`,
      );
    }

    // Create a revision snapshot for review
    const revisionRows = await db
      .insert(knowledgeDocumentRevisions)
      .values({
        documentId,
        version: doc.version,
        title: doc.title,
        summary: doc.summary,
        body: doc.body,
        changeDescription: "Submitted for review",
        authorAgentId: authorAgentId ?? null,
      })
      .returning();

    await db
      .insert(knowledgeDocumentReviews)
      .values({
        documentId,
        revisionId: revisionRows[0].id,
        status: "pending",
        reviewerAgentId: null,
        comment: null,
      })
      .returning();

    const docRows = await db
      .update(knowledgeDocuments)
      .set({
        status: "in_review",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(knowledgeDocuments.id, documentId),
          eq(knowledgeDocuments.companyId, companyId),
        ),
      )
      .returning();

    invalidateKnowledgeSearchCache();

    return {
      document: toDocument(docRows[0]),
      revision: toRevision(revisionRows[0]),
    };
  }

  async function review(
    companyId: string,
    documentId: string,
    decision: KnowledgeDocumentReviewDecision,
    reviewerAgentId?: string,
  ): Promise<{ document: KnowledgeDocument; review: KnowledgeDocumentReview }> {
    const doc = await assertDocumentExists(companyId, documentId);

    if (doc.status !== "in_review") {
      throw new Error(
        `Cannot review a document in '${doc.status}' status. Only documents in review can be reviewed.`,
      );
    }

    const revisions = await db
      .select()
      .from(knowledgeDocumentRevisions)
      .where(
        and(
          eq(knowledgeDocumentRevisions.documentId, documentId),
          eq(knowledgeDocumentRevisions.version, doc.version),
        ),
      )
      .orderBy(desc(knowledgeDocumentRevisions.createdAt))
      .limit(1);

    if (revisions.length === 0) {
      throw new Error("No revision found for the current version");
    }

    const reviewRows = await db
      .insert(knowledgeDocumentReviews)
      .values({
        documentId,
        revisionId: revisions[0].id,
        reviewerAgentId: reviewerAgentId ?? null,
        status: decision.status,
        comment: decision.comment ?? null,
        decidedAt: new Date(),
      })
      .returning();

    // If changes requested, revert to draft and bump the version so the
    // next submitForReview inserts a fresh revision (version+1) instead of
    // colliding with the existing revision on
    // knowledge_document_revisions_doc_ver_unique_idx (VOY-1358).
    if (decision.status === "changes_requested") {
      const bumped = await db
        .update(knowledgeDocuments)
        .set({
          status: "draft",
          version: doc.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(knowledgeDocuments.id, documentId),
            eq(knowledgeDocuments.companyId, companyId),
          ),
        )
        .returning();
      // Keep doc in sync for the response below.
      doc.version = bumped[0]?.version ?? doc.version + 1;
    }

    // If approved, document stays in_review until explicitly published
    // (allows batched publication of multiple approved documents)

    const updatedDoc = await assertDocumentExists(companyId, documentId);

    invalidateKnowledgeSearchCache();

    return {
      document: toDocument(updatedDoc),
      review: {
        id: reviewRows[0].id,
        documentId: reviewRows[0].documentId,
        revisionId: reviewRows[0].revisionId,
        reviewerAgentId: reviewRows[0].reviewerAgentId ?? undefined,
        status: reviewRows[0].status as KnowledgeDocumentReview["status"],
        comment: reviewRows[0].comment ?? undefined,
        createdAt: reviewRows[0].createdAt.toISOString(),
        decidedAt: reviewRows[0].decidedAt?.toISOString(),
      },
    };
  }

  async function publish(
    companyId: string,
    documentId: string,
    req: KnowledgeDocumentPublishRequest,
  ): Promise<{ document: KnowledgeDocument; revision: KnowledgeDocumentRevision }> {
    const doc = await assertDocumentExists(companyId, documentId);

    if (doc.status !== "in_review") {
      throw new Error(
        `Cannot publish a document in '${doc.status}' status. Only reviewed documents can be published.`,
      );
    }

    // Find the latest revision for this document (most recent review cycle)
    const revisions = await db
      .select()
      .from(knowledgeDocumentRevisions)
      .where(eq(knowledgeDocumentRevisions.documentId, documentId))
      .orderBy(desc(knowledgeDocumentRevisions.createdAt))
      .limit(1);

    if (revisions.length === 0) {
      throw new Error("No revision found for the document.");
    }

    // Check for an approved review on the latest revision only.
    // This prevents a stale approval from a previous review cycle
    // (before the document was published) from being reused after
    // changes were requested and the document was re-submitted.
    const approvedReviews = await db
      .select()
      .from(knowledgeDocumentReviews)
      .where(
        and(
          eq(knowledgeDocumentReviews.documentId, documentId),
          eq(knowledgeDocumentReviews.revisionId, revisions[0].id),
          eq(knowledgeDocumentReviews.status, "approved"),
        ),
      )
      .limit(1);

    if (approvedReviews.length === 0) {
      throw new Error(
        "Document must be approved before publishing. Submit for review and get approval first.",
      );
    }

    const newVersion = doc.version + 1;

    // Create new revision for the published version
    const revisionRows = await db
      .insert(knowledgeDocumentRevisions)
      .values({
        documentId,
        version: newVersion,
        title: doc.title,
        summary: doc.summary,
        body: doc.body,
        changeDescription: req.changeDescription ?? `Version ${newVersion}`,
        authorAgentId: approvedReviews[0].reviewerAgentId,
      })
      .returning();

    // Update document
    const docRows = await db
      .update(knowledgeDocuments)
      .set({
        status: "published",
        version: newVersion,
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(knowledgeDocuments.id, documentId),
          eq(knowledgeDocuments.companyId, companyId),
        ),
      )
      .returning();

    invalidateKnowledgeSearchCache();

    return {
      document: toDocument(docRows[0]),
      revision: toRevision(revisionRows[0]),
    };
  }

  async function archive(
    companyId: string,
    documentId: string,
  ): Promise<KnowledgeDocument> {
    const doc = await assertDocumentExists(companyId, documentId);

    if (doc.status !== "published") {
      throw new Error(
        `Cannot archive a document in '${doc.status}' status. Only published documents can be archived.`,
      );
    }

    const rows = await db
      .update(knowledgeDocuments)
      .set({
        status: "archived",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(knowledgeDocuments.id, documentId),
          eq(knowledgeDocuments.companyId, companyId),
        ),
      )
      .returning();

    invalidateKnowledgeSearchCache();

    return toDocument(rows[0]);
  }

  async function listRevisions(
    companyId: string,
    documentId: string,
  ): Promise<KnowledgeDocumentRevision[]> {
    await assertDocumentExists(companyId, documentId);

    const rows = await db
      .select()
      .from(knowledgeDocumentRevisions)
      .where(eq(knowledgeDocumentRevisions.documentId, documentId))
      .orderBy(desc(knowledgeDocumentRevisions.version));

    return rows.map(toRevision);
  }

  async function getRevision(
    companyId: string,
    documentId: string,
    revisionId: string,
  ): Promise<KnowledgeDocumentRevision> {
    await assertDocumentExists(companyId, documentId);

    const rows = await db
      .select()
      .from(knowledgeDocumentRevisions)
      .where(
        and(
          eq(knowledgeDocumentRevisions.id, revisionId),
          eq(knowledgeDocumentRevisions.documentId, documentId),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      throw notFound("Revision not found");
    }

    return toRevision(rows[0]);
  }

  async function diff(
    companyId: string,
    documentId: string,
    revisionIdA: string,
    revisionIdB: string,
  ): Promise<KnowledgeDocumentDiff> {
    await assertDocumentExists(companyId, documentId);

    const [revA, revB] = await Promise.all([
      db
        .select()
        .from(knowledgeDocumentRevisions)
        .where(
          and(
            eq(knowledgeDocumentRevisions.id, revisionIdA),
            eq(knowledgeDocumentRevisions.documentId, documentId),
          ),
        )
        .limit(1),
      db
        .select()
        .from(knowledgeDocumentRevisions)
        .where(
          and(
            eq(knowledgeDocumentRevisions.id, revisionIdB),
            eq(knowledgeDocumentRevisions.documentId, documentId),
          ),
        )
        .limit(1),
    ]);

    if (revA.length === 0 || revB.length === 0) {
      throw notFound("One or both revisions not found");
    }

    const older = revA[0].version < revB[0].version ? revA[0] : revB[0];
    const newer = revA[0].version < revB[0].version ? revB[0] : revA[0];

    return {
      oldVersion: older.version,
      newVersion: newer.version,
      titleChanged: older.title !== newer.title,
      oldTitle: older.title !== newer.title ? older.title : undefined,
      newTitle: newer.title,
      summaryChanged: (older.summary ?? "") !== (newer.summary ?? ""),
      oldSummary:
        older.summary !== newer.summary ? (older.summary ?? undefined) : undefined,
      newSummary: newer.summary ?? undefined,
      bodyDiff: computeBodyDiff(older.body, newer.body),
      changeDescription: newer.changeDescription ?? undefined,
    };
  }

  async function createBacklink(
    companyId: string,
    documentId: string,
    req: KnowledgeCreateBacklinkRequest,
  ): Promise<{ id: string }> {
    await assertDocumentExists(companyId, documentId);

    const rows = await db
      .insert(knowledgeSourceBacklinks)
      .values({
        documentId,
        sourceIssueId: req.sourceIssueId,
        sourceType: req.sourceType ?? "referenced_in_body",
      })
      .onConflictDoNothing()
      .returning({ id: knowledgeSourceBacklinks.id });

    return { id: rows[0]?.id ?? "" };
  }

  async function listBacklinks(
    companyId: string,
    documentId: string,
  ): Promise<KnowledgeSourceBacklink[]> {
    await assertDocumentExists(companyId, documentId);

    const rows = await db
      .select()
      .from(knowledgeSourceBacklinks)
      .where(eq(knowledgeSourceBacklinks.documentId, documentId))
      .orderBy(desc(knowledgeSourceBacklinks.createdAt));

    return rows.map((r) => ({
      id: r.id,
      documentId: r.documentId,
      sourceIssueId: r.sourceIssueId,
      sourceType: r.sourceType as KnowledgeSourceBacklink["sourceType"],
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async function searchPublished(
    companyId: string,
    query: string,
    limit?: number,
  ): Promise<Array<{ id: string; title: string; summary?: string; score: number }>> {
    const searchLimit = Math.min(limit ?? 10, 50);

    // Check cache for recent identical queries
    const cacheKey = buildKnowledgeSearchCacheKey(companyId, query ?? "", searchLimit);
    const cached = knowledgeSearchCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < KNOWLEDGE_SEARCH_CACHE_TTL_MS) {
      // True LRU: re-insert to move this entry to the end of the Map's
      // insertion-order iteration, so eviction always targets the
      // least-recently-used entry.
      knowledgeSearchCache.delete(cacheKey);
      knowledgeSearchCache.set(cacheKey, cached);
      return cached.result;
    }

    // Use full-text search on published documents.
    // plainto_tsquery handles natural language input safely — punctuation,
    // operators, and special characters are stripped rather than causing
    // 400 errors as to_tsquery would with malformed lexemes.
    const rows = await db
      .select({
        id: knowledgeDocuments.id,
        title: knowledgeDocuments.title,
        summary: knowledgeDocuments.summary,
        score: sql<number>`ts_rank(
          to_tsvector('english', ${knowledgeDocuments.title} || ' ' || coalesce(${knowledgeDocuments.body}, '')),
          plainto_tsquery('english', ${query})
        ) AS "score"`,
      })
      .from(knowledgeDocuments)
      .where(
        and(
          eq(knowledgeDocuments.companyId, companyId),
          eq(knowledgeDocuments.status, "published"),
          sql`to_tsvector('english', ${knowledgeDocuments.title} || ' ' || coalesce(${knowledgeDocuments.body}, '')) @@ plainto_tsquery('english', ${query})`,
        ),
      )
      .orderBy(sql`score DESC`)
      .limit(searchLimit);

    const result = rows.map((r) => ({
      id: r.id,
      title: r.title,
      summary: r.summary ?? undefined,
      score: r.score ?? 0,
    }));

    // Update cache (with LRU-like eviction)
    if (knowledgeSearchCache.size >= KNOWLEDGE_SEARCH_CACHE_MAX) {
      const firstKey = knowledgeSearchCache.keys().next().value;
      if (firstKey) knowledgeSearchCache.delete(firstKey);
    }
    knowledgeSearchCache.set(cacheKey, { result, cachedAt: Date.now() });

    return result;
  }

  // ─── promoteFromMemory ─────────────────────────────────────────────────────

  /**
   * Promote a memory record into a draft knowledge document.
   *
   * - Looks up the memory record by id within the company.
   * - Defaults title/body/summary from the memory record content.
   * - Creates an originating backlink when the memory record's source
   *   references an issue.
   * - The promoted document enters the normal review lifecycle (draft →
   *   in_review → published), so company knowledge stays curated.
   */
  async function promoteFromMemory(
    companyId: string,
    req: KnowledgePromoteFromMemoryRequest,
    authorAgentId?: string,
  ): Promise<KnowledgeDocument> {
    const memRows = await db
      .select()
      .from(memoryRecords)
      .where(
        and(
          eq(memoryRecords.id, req.memoryRecordId),
          eq(memoryRecords.companyId, companyId),
        ),
      )
      .limit(1);

    if (memRows.length === 0) {
      throw notFound("Memory record not found");
    }
    const mem = memRows[0];

    const title =
      req.title?.trim() ||
      `Memory: ${mem.recordType.replaceAll("_", " ")}`;
    const body = req.body ?? mem.text;
    const summary =
      req.summary !== undefined
        ? req.summary
        : (mem.summary ?? undefined);

    // Use a transaction to prevent orphan documents (C-1) and enforce
    // idempotency via the memory_record_id unique constraint (C-2).
    const rows = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(knowledgeDocuments)
        .values({
          companyId,
          title,
          summary: summary ?? null,
          body,
          status: "draft",
          version: 1,
          authorAgentId: authorAgentId ?? null,
          sourceIssueId: mem.sourceIssueId ?? null,
          memoryRecordId: req.memoryRecordId,
        })
        .onConflictDoNothing()
        .returning();

      // onConflictDoNothing returns empty array when the insert is skipped
      // due to a unique constraint violation on memory_record_id.
      if (inserted.length === 0) {
        // Fetch the existing document promoted from this memory record
        const existing = await tx
          .select()
          .from(knowledgeDocuments)
          .where(
            and(
              eq(knowledgeDocuments.companyId, companyId),
              eq(knowledgeDocuments.memoryRecordId, req.memoryRecordId),
            ),
          )
          .limit(1);
        if (existing.length === 0) {
          throw new Error("Memory record already promoted but document not found");
        }
        return { doc: existing[0], wasInserted: false };
      }

      // NOTE: No initial revision is created here — see create() for rationale.
      // The first review-cycle revision is created by submitForReview.

      // Auto-backlink to the source issue when the memory record has one
      if (mem.sourceIssueId) {
        await tx
          .insert(knowledgeSourceBacklinks)
          .values({
            documentId: inserted[0].id,
            sourceIssueId: mem.sourceIssueId,
            sourceType: "originating_issue",
          })
          .onConflictDoNothing();
      }

      return { doc: inserted[0], wasInserted: true };
    });

    // Invalidate AFTER the transaction commits so a concurrent search cannot
    // repopulate the cache with pre-promotion rows (P1-1).
    invalidateKnowledgeSearchCache();

    return toDocument(rows.doc);
  }

  return {
    create,
    get,
    update,
    delete: deleteDocument,
    list,
    submitForReview,
    review,
    publish,
    archive,
    listRevisions,
    getRevision,
    diff,
    createBacklink,
    listBacklinks,
    searchPublished,
    promoteFromMemory,
  };
}