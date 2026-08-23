import { and, desc, eq, ilike, inArray, lt, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  knowledgeDocuments,
  knowledgeDocumentRevisions,
  knowledgeDocumentReviews,
  knowledgeSourceBacklinks,
} from "@paperclipai/db";
import { conflict } from "../errors.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type KnowledgeDocumentStatus = "draft" | "in_review" | "published" | "archived";
export type KnowledgeReviewStatus = "pending" | "approved" | "changes_requested";

export interface KnowledgeDocument {
  id: string;
  companyId: string;
  title: string;
  summary: string | null;
  body: string;
  status: KnowledgeDocumentStatus;
  version: number;
  authorAgentId: string | null;
  sourceIssueId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface KnowledgeDocumentListItem {
  id: string;
  title: string;
  summary: string | null;
  status: KnowledgeDocumentStatus;
  version: number;
  authorAgentId: string | null;
  sourceIssueId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  revisionCount: number;
  latestReviewStatus: KnowledgeReviewStatus | null;
}

export interface KnowledgeDocumentListPage {
  items: KnowledgeDocumentListItem[];
  nextCursor: string | undefined;
  total?: number;
}

export interface KnowledgeDocumentRevision {
  id: string;
  documentId: string;
  version: number;
  title: string;
  summary: string | null;
  body: string;
  changeDescription: string | null;
  authorAgentId: string | null;
  createdAt: string;
}

export interface KnowledgeDocumentDiff {
  oldVersion: number;
  newVersion: number;
  titleChanged: boolean;
  oldTitle?: string;
  newTitle: string;
  summaryChanged: boolean;
  oldSummary?: string;
  newSummary?: string;
  bodyDiff: string;
  changeDescription?: string;
}

export interface KnowledgeSourceBacklink {
  id: string;
  documentId: string;
  sourceIssueId: string;
  sourceType: string;
  createdAt: string;
}

export interface SearchPublishedResult {
  id: string;
  title: string;
  summary: string | null;
  score: number;
}

type DocRow = typeof knowledgeDocuments.$inferSelect;
type RevisionRow = typeof knowledgeDocumentRevisions.$inferSelect;
type ReviewRow = typeof knowledgeDocumentReviews.$inferSelect;
type BacklinkRow = typeof knowledgeSourceBacklinks.$inferSelect;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rowToDocument(row: DocRow): KnowledgeDocument {
  return {
    id: row.id,
    companyId: row.companyId,
    title: row.title,
    summary: row.summary ?? null,
    body: row.body,
    status: row.status as KnowledgeDocumentStatus,
    version: row.version,
    authorAgentId: row.authorAgentId ?? null,
    sourceIssueId: row.sourceIssueId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}

function rowToListItem(
  row: DocRow,
  revisionCount: number,
  latestReviewStatus: KnowledgeReviewStatus | null,
): KnowledgeDocumentListItem {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary ?? null,
    status: row.status as KnowledgeDocumentStatus,
    version: row.version,
    authorAgentId: row.authorAgentId ?? null,
    sourceIssueId: row.sourceIssueId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    revisionCount,
    latestReviewStatus,
  };
}

function rowToRevision(row: RevisionRow): KnowledgeDocumentRevision {
  return {
    id: row.id,
    documentId: row.documentId,
    version: row.version,
    title: row.title,
    summary: row.summary ?? null,
    body: row.body,
    changeDescription: row.changeDescription ?? null,
    authorAgentId: row.authorAgentId ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToBacklink(row: BacklinkRow): KnowledgeSourceBacklink {
  return {
    id: row.id,
    documentId: row.documentId,
    sourceIssueId: row.sourceIssueId,
    sourceType: row.sourceType,
    createdAt: row.createdAt.toISOString(),
  };
}

function simpleDiff(oldText: string, newText: string): string {
  if (oldText === newText) return oldText;
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Find common prefix
  let prefixEnd = 0;
  while (
    prefixEnd < oldLines.length &&
    prefixEnd < newLines.length &&
    oldLines[prefixEnd] === newLines[prefixEnd]
  ) {
    prefixEnd++;
  }

  // Find common suffix
  let oldSuffixStart = oldLines.length;
  let newSuffixStart = newLines.length;
  while (
    oldSuffixStart > prefixEnd &&
    newSuffixStart > prefixEnd &&
    oldLines[oldSuffixStart - 1] === newLines[newSuffixStart - 1]
  ) {
    oldSuffixStart--;
    newSuffixStart--;
  }

  const result: string[] = [];

  // Common prefix
  for (let i = 0; i < prefixEnd; i++) {
    result.push(" " + oldLines[i]);
  }

  // Removed lines
  for (let i = prefixEnd; i < oldSuffixStart; i++) {
    result.push("-" + oldLines[i]);
  }

  // Added lines
  for (let i = prefixEnd; i < newSuffixStart; i++) {
    result.push("+" + newLines[i]);
  }

  // Common suffix
  for (let i = oldSuffixStart; i < oldLines.length; i++) {
    result.push(" " + oldLines[i]);
  }

  return result.join("\n");
}

// ─── Cursor pagination ───────────────────────────────────────────────────────

function encodeCursor(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function decodeCursor(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

// ─── Service ─────────────────────────────────────────────────────────────────

export function knowledgeService(db: Db) {
  return {
    // ── List ──────────────────────────────────────────────────────────────

    async list(
      companyId: string,
      params: {
        status?: KnowledgeDocumentStatus;
        cursor?: string;
        limit?: number;
        search?: string;
      } = {},
    ): Promise<KnowledgeDocumentListPage> {
      const limit = Math.min(params.limit ?? 20, 100);
      const conditions: ReturnType<typeof eq>[] = [
        eq(knowledgeDocuments.companyId, companyId),
      ];

      if (params.status) {
        conditions.push(eq(knowledgeDocuments.status, params.status));
      }

      if (params.search) {
        conditions.push(
          or(
            ilike(knowledgeDocuments.title, `%${params.search}%`),
            ilike(knowledgeDocuments.summary ?? "", `%${params.search}%`),
          ),
        );
      }

      let cursorCondition: ReturnType<typeof lt> | undefined;
      if (params.cursor) {
        const cursorDate = decodeCursor(params.cursor);
        cursorCondition = lt(knowledgeDocuments.updatedAt, new Date(cursorDate));
      }

      const allConditions = cursorCondition
        ? and(...conditions, cursorCondition)
        : and(...conditions);

      const rows = await db
        .select()
        .from(knowledgeDocuments)
        .where(allConditions)
        .orderBy(desc(knowledgeDocuments.updatedAt), desc(knowledgeDocuments.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;

      // Fetch revision counts and review status for each document
      const docIds = pageRows.map((r) => r.id);
      const revisionCounts = new Map<string, number>();
      const reviewStatuses = new Map<string, KnowledgeReviewStatus | null>();

      if (docIds.length > 0) {
        // Count revisions per document
        const revisionRows = await db
          .select({
            documentId: knowledgeDocumentRevisions.documentId,
            count: sql<number>`count(*)::int`,
          })
          .from(knowledgeDocumentRevisions)
          .where(inArray(knowledgeDocumentRevisions.documentId, docIds))
          .groupBy(knowledgeDocumentRevisions.documentId);

        for (const row of revisionRows) {
          revisionCounts.set(row.documentId, row.count);
        }

        // Get latest review status per document
        const reviewRows = await db
          .select({
            documentId: knowledgeDocumentReviews.documentId,
            status: knowledgeDocumentReviews.status,
          })
          .from(knowledgeDocumentReviews)
          .where(
            and(
              inArray(knowledgeDocumentReviews.documentId, docIds),
              eq(knowledgeDocumentReviews.status, "approved"),
            ),
          );

        // For documents in_review, find the latest pending review
        const inReviewDocIds = pageRows
          .filter((r) => r.status === "in_review")
          .map((r) => r.id);

        if (inReviewDocIds.length > 0) {
          const pendingReviews = await db
            .select({
              documentId: knowledgeDocumentReviews.documentId,
              status: knowledgeDocumentReviews.status,
            })
            .from(knowledgeDocumentReviews)
            .where(
              and(
                inArray(knowledgeDocumentReviews.documentId, inReviewDocIds),
                eq(knowledgeDocumentReviews.status, "pending"),
              ),
            );

          for (const row of reviewRows) {
            reviewStatuses.set(row.documentId, row.status as KnowledgeReviewStatus);
          }
          for (const row of pendingReviews) {
            reviewStatuses.set(row.documentId, row.status as KnowledgeReviewStatus);
          }
        } else {
          for (const row of reviewRows) {
            reviewStatuses.set(row.documentId, row.status as KnowledgeReviewStatus);
          }
        }
      }

      const items = pageRows.map((row) =>
        rowToListItem(
          row,
          revisionCounts.get(row.id) ?? 0,
          reviewStatuses.get(row.id) ?? null,
        ),
      );

      const nextCursor =
        hasMore && pageRows.length > 0
          ? encodeCursor(pageRows[pageRows.length - 1].updatedAt.toISOString())
          : undefined;

      return { items, nextCursor };
    },

    // ── Get ───────────────────────────────────────────────────────────────

    async get(companyId: string, documentId: string): Promise<KnowledgeDocument | null> {
      const row = await db
        .select()
        .from(knowledgeDocuments)
        .where(
          and(
            eq(knowledgeDocuments.id, documentId),
            eq(knowledgeDocuments.companyId, companyId),
          ),
        )
        .then((rows) => rows[0] ?? null);

      return row ? rowToDocument(row) : null;
    },

    // ── Create ────────────────────────────────────────────────────────────

    async create(
      companyId: string,
      data: { title: string; summary?: string; body?: string; sourceIssueId?: string },
      authorAgentId: string | null,
    ): Promise<KnowledgeDocument> {
      const [row] = await db
        .insert(knowledgeDocuments)
        .values({
          companyId,
          title: data.title,
          summary: data.summary ?? null,
          body: data.body ?? "",
          status: "draft",
          version: 1,
          authorAgentId,
          sourceIssueId: data.sourceIssueId ?? null,
        })
        .returning();

      return rowToDocument(row!);
    },

    // ── Update ────────────────────────────────────────────────────────────

    async update(
      companyId: string,
      documentId: string,
      data: { title?: string; summary?: string; body?: string },
    ): Promise<KnowledgeDocument | null> {
      const [row] = await db
        .update(knowledgeDocuments)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(knowledgeDocuments.id, documentId),
            eq(knowledgeDocuments.companyId, companyId),
            eq(knowledgeDocuments.status, "draft"),
          ),
        )
        .returning();

      return row ? rowToDocument(row) : null;
    },

    // ── Delete ────────────────────────────────────────────────────────────

    async remove(companyId: string, documentId: string): Promise<boolean> {
      const [row] = await db
        .delete(knowledgeDocuments)
        .where(
          and(
            eq(knowledgeDocuments.id, documentId),
            eq(knowledgeDocuments.companyId, companyId),
            or(
              eq(knowledgeDocuments.status, "draft"),
              eq(knowledgeDocuments.status, "archived"),
            ),
          ),
        )
        .returning({ id: knowledgeDocuments.id });

      return row !== undefined;
    },

    // ── Submit for Review ─────────────────────────────────────────────────

    async submitForReview(
      companyId: string,
      documentId: string,
      reviewerAgentId?: string,
    ): Promise<{ document: KnowledgeDocument; revision: KnowledgeDocumentRevision } | null> {
      const doc = await this.get(companyId, documentId);
      if (!doc) return null;
      if (doc.status !== "draft") return null;

      // Create a revision snapshot
      const [revisionRow] = await db
        .insert(knowledgeDocumentRevisions)
        .values({
          documentId,
          version: doc.version + 1,
          title: doc.title,
          summary: doc.summary,
          body: doc.body,
          changeDescription: "Submitted for review",
          authorAgentId: doc.authorAgentId,
        })
        .returning();

      // Update document status and version
      const [updatedDoc] = await db
        .update(knowledgeDocuments)
        .set({
          status: "in_review",
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

      if (!updatedDoc || !revisionRow) return null;

      return {
        document: rowToDocument(updatedDoc),
        revision: rowToRevision(revisionRow),
      };
    },

    // ── Review ────────────────────────────────────────────────────────────

    async review(
      companyId: string,
      documentId: string,
      data: { status: "approved" | "changes_requested"; comment?: string },
      reviewerAgentId: string | null,
    ): Promise<{ document: KnowledgeDocument; review: { id: string; status: string } } | null> {
      const doc = await this.get(companyId, documentId);
      if (!doc) return null;
      if (doc.status !== "in_review") return null;

      // Find the latest revision
      const latestRevision = await db
        .select()
        .from(knowledgeDocumentRevisions)
        .where(eq(knowledgeDocumentRevisions.documentId, documentId))
        .orderBy(desc(knowledgeDocumentRevisions.version))
        .limit(1)
        .then((rows) => rows[0] ?? null);

      if (!latestRevision) return null;

      // Create review record
      const [reviewRow] = await db
        .insert(knowledgeDocumentReviews)
        .values({
          documentId,
          revisionId: latestRevision.id,
          reviewerAgentId,
          status: data.status,
          comment: data.comment ?? null,
          decidedAt: new Date(),
        })
        .returning();

      // If changes requested, move back to draft
      if (data.status === "changes_requested") {
        const [updatedDoc] = await db
          .update(knowledgeDocuments)
          .set({ status: "draft", updatedAt: new Date() })
          .where(
            and(
              eq(knowledgeDocuments.id, documentId),
              eq(knowledgeDocuments.companyId, companyId),
            ),
          )
          .returning();

        return updatedDoc
          ? {
              document: rowToDocument(updatedDoc),
              review: { id: reviewRow!.id, status: reviewRow!.status },
            }
          : null;
      }

      // If approved, stay in_review until published
      return {
        document: doc,
        review: { id: reviewRow!.id, status: reviewRow!.status },
      };
    },

    // ── Publish ───────────────────────────────────────────────────────────

    async publish(
      companyId: string,
      documentId: string,
      changeDescription?: string,
    ): Promise<{ document: KnowledgeDocument; revision: KnowledgeDocumentRevision } | null> {
      const doc = await this.get(companyId, documentId);
      if (!doc) return null;
      if (doc.status !== "in_review" && doc.status !== "draft") return null;

      // Create a revision snapshot
      const [revisionRow] = await db
        .insert(knowledgeDocumentRevisions)
        .values({
          documentId,
          version: doc.version + 1,
          title: doc.title,
          summary: doc.summary,
          body: doc.body,
          changeDescription: changeDescription ?? "Published",
          authorAgentId: doc.authorAgentId,
        })
        .returning();

      // Update document
      const [updatedDoc] = await db
        .update(knowledgeDocuments)
        .set({
          status: "published",
          version: doc.version + 1,
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

      if (!updatedDoc || !revisionRow) return null;

      return {
        document: rowToDocument(updatedDoc),
        revision: rowToRevision(revisionRow),
      };
    },

    // ── Archive ───────────────────────────────────────────────────────────

    async archive(companyId: string, documentId: string): Promise<KnowledgeDocument | null> {
      const [row] = await db
        .update(knowledgeDocuments)
        .set({ status: "archived", updatedAt: new Date() })
        .where(
          and(
            eq(knowledgeDocuments.id, documentId),
            eq(knowledgeDocuments.companyId, companyId),
            eq(knowledgeDocuments.status, "published"),
          ),
        )
        .returning();

      return row ? rowToDocument(row) : null;
    },

    // ── Revisions ─────────────────────────────────────────────────────────

    async listRevisions(
      companyId: string,
      documentId: string,
    ): Promise<KnowledgeDocumentRevision[]> {
      // Verify document exists and belongs to company
      const doc = await this.get(companyId, documentId);
      if (!doc) return [];

      const rows = await db
        .select()
        .from(knowledgeDocumentRevisions)
        .where(eq(knowledgeDocumentRevisions.documentId, documentId))
        .orderBy(desc(knowledgeDocumentRevisions.version));

      return rows.map(rowToRevision);
    },

    async getRevision(
      companyId: string,
      documentId: string,
      revisionId: string,
    ): Promise<KnowledgeDocumentRevision | null> {
      const doc = await this.get(companyId, documentId);
      if (!doc) return null;

      const row = await db
        .select()
        .from(knowledgeDocumentRevisions)
        .where(
          and(
            eq(knowledgeDocumentRevisions.id, revisionId),
            eq(knowledgeDocumentRevisions.documentId, documentId),
          ),
        )
        .then((rows) => rows[0] ?? null);

      return row ? rowToRevision(row) : null;
    },

    // ── Diff ──────────────────────────────────────────────────────────────

    async diff(
      companyId: string,
      documentId: string,
      revAId: string,
      revBId: string,
    ): Promise<KnowledgeDocumentDiff | null> {
      const doc = await this.get(companyId, documentId);
      if (!doc) return null;

      const [revA, revB] = await Promise.all([
        db
          .select()
          .from(knowledgeDocumentRevisions)
          .where(
            and(
              eq(knowledgeDocumentRevisions.id, revAId),
              eq(knowledgeDocumentRevisions.documentId, documentId),
            ),
          )
          .then((rows) => rows[0] ?? null),
        db
          .select()
          .from(knowledgeDocumentRevisions)
          .where(
            and(
              eq(knowledgeDocumentRevisions.id, revBId),
              eq(knowledgeDocumentRevisions.documentId, documentId),
            ),
          )
          .then((rows) => rows[0] ?? null),
      ]);

      if (!revA || !revB) return null;

      const oldRev = revA.version < revB.version ? revA : revB;
      const newRev = revA.version < revB.version ? revB : revA;

      const titleChanged = oldRev.title !== newRev.title;
      const summaryChanged = oldRev.summary !== newRev.summary;
      const bodyDiff = simpleDiff(oldRev.body, newRev.body);

      return {
        oldVersion: oldRev.version,
        newVersion: newRev.version,
        titleChanged,
        oldTitle: titleChanged ? oldRev.title : undefined,
        newTitle: newRev.title,
        summaryChanged,
        oldSummary: summaryChanged ? (oldRev.summary ?? undefined) : undefined,
        newSummary: newRev.summary ?? undefined,
        bodyDiff,
        changeDescription: newRev.changeDescription ?? undefined,
      };
    },

    // ── Backlinks ─────────────────────────────────────────────────────────

    async listBacklinks(
      companyId: string,
      documentId: string,
    ): Promise<KnowledgeSourceBacklink[]> {
      const doc = await this.get(companyId, documentId);
      if (!doc) return [];

      const rows = await db
        .select()
        .from(knowledgeSourceBacklinks)
        .where(eq(knowledgeSourceBacklinks.documentId, documentId))
        .orderBy(desc(knowledgeSourceBacklinks.createdAt));

      return rows.map(rowToBacklink);
    },

    // ── Search Published ──────────────────────────────────────────────────

    async searchPublished(
      companyId: string,
      q: string,
      limit: number = 20,
    ): Promise<SearchPublishedResult[]> {
      const trimmed = q.trim();
      if (!trimmed) return [];

      const rows = await db
        .select()
        .from(knowledgeDocuments)
        .where(
          and(
            eq(knowledgeDocuments.companyId, companyId),
            eq(knowledgeDocuments.status, "published"),
            or(
              ilike(knowledgeDocuments.title, `%${trimmed}%`),
              ilike(knowledgeDocuments.summary ?? "", `%${trimmed}%`),
              ilike(knowledgeDocuments.body, `%${trimmed}%`),
            ),
          ),
        )
        .orderBy(desc(knowledgeDocuments.publishedAt))
        .limit(limit);

      // Simple scoring: title match scores higher than summary, which scores higher than body
      const lowerQ = trimmed.toLowerCase();
      return rows.map((row) => {
        const titleLower = row.title.toLowerCase();
        const summaryLower = (row.summary ?? "").toLowerCase();
        let score = 0;

        if (titleLower === lowerQ) score = 1.0;
        else if (titleLower.startsWith(lowerQ)) score = 0.9;
        else if (titleLower.includes(lowerQ)) score = 0.8;
        else if (summaryLower.includes(lowerQ)) score = 0.6;
        else score = 0.4;

        return {
          id: row.id,
          title: row.title,
          summary: row.summary ?? null,
          score,
        };
      }).sort((a, b) => b.score - a.score);
    },
  };
}
