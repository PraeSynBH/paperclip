import { and, desc, eq, lt } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { documentRevisions, documents, issueDocuments, issues } from "@paperclipai/db";
import { planMetadataSchema } from "@paperclipai/shared";
import { notFound, unprocessable, unprocessable as unprocessableEntity } from "../errors.js";
import { documentService } from "./documents.js";

// Maximum total lines for LCS diff to prevent OOM (C-2 guard)
// 10K lines × 10K lines = 100M entries ≈ 800MB at 8 bytes — still too high.
// 2K × 2K = 4M entries ≈ 32MB — acceptable peak.
const MAX_DIFF_LINES = 2_000;

export function planDocumentService(db: Db) {
  const docsSvc = documentService(db);

  return {
    /**
     * Upsert a plan document for an issue, including structured plan metadata.
     * Validates planMetadata against the schema before upserting.
     */
    upsertPlanDocument: async (input: {
      issueId: string;
      title?: string | null;
      body: string;
      changeSummary?: string | null;
      baseRevisionId?: string | null;
      createdByAgentId?: string | null;
      createdByUserId?: string | null;
      createdByRunId?: string | null;
      planMetadata?: Record<string, unknown> | null;
    }) => {
      // Validate planMetadata schema if provided
      if (input.planMetadata) {
        const parsed = planMetadataSchema.safeParse(input.planMetadata);
        if (!parsed.success) {
          throw unprocessable("Invalid plan metadata", parsed.error.issues);
        }
      }

      return docsSvc.upsertIssueDocument({
        issueId: input.issueId,
        key: "plan",
        title: input.title ?? null,
        format: "markdown",
        body: input.body,
        changeSummary: input.changeSummary ?? null,
        baseRevisionId: input.baseRevisionId ?? null,
        createdByAgentId: input.createdByAgentId ?? null,
        createdByUserId: input.createdByUserId ?? null,
        createdByRunId: input.createdByRunId ?? null,
        lockedDocumentStrategy: "conflict",
        planMetadata: input.planMetadata ?? null,
      });
    },

    /**
     * Get the plan document for an issue, including plan metadata.
     */
    getPlanDocument: async (issueId: string) => {
      const payload = await docsSvc.getIssueDocumentPayload(
        { id: issueId, description: null },
        { includeSystem: true },
      );
      return payload.planDocument;
    },

    /**
     * List plan document revisions with plan metadata snapshots.
     * Tenant-safe: filters by issue companyId (C-1 defense-in-depth).
     */
    listPlanRevisions: async (issueId: string) => {
      const issue = await db
        .select({ id: issues.id, companyId: issues.companyId })
        .from(issues)
        .where(eq(issues.id, issueId))
        .then((rows) => rows[0] ?? null);
      if (!issue) throw notFound("Issue not found");

      return db
        .select({
          id: documentRevisions.id,
          companyId: documentRevisions.companyId,
          documentId: documentRevisions.documentId,
          revisionNumber: documentRevisions.revisionNumber,
          title: documentRevisions.title,
          format: documentRevisions.format,
          body: documentRevisions.body,
          planMetadata: documentRevisions.planMetadata,
          changeSummary: documentRevisions.changeSummary,
          createdByAgentId: documentRevisions.createdByAgentId,
          createdByUserId: documentRevisions.createdByUserId,
          createdByRunId: documentRevisions.createdByRunId,
          createdAt: documentRevisions.createdAt,
        })
        .from(issueDocuments)
        .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
        .innerJoin(documentRevisions, eq(documentRevisions.documentId, documents.id))
        .where(and(
          eq(issueDocuments.issueId, issueId),
          eq(issueDocuments.companyId, issue.companyId),
          eq(issueDocuments.key, "plan"),
          eq(documents.companyId, issue.companyId),
        ))
        .orderBy(desc(documentRevisions.revisionNumber));
    },

    /**
     * Compute a line-level diff between two plan document revisions.
     * Uses simple LCS-based line diff — no external dependency.
     * Tenant-safe: verifies all resources belong to the issue's company (C-1).
     * Memory-safe: rejects documents exceeding MAX_DIFF_LINES (C-2).
     */
    computePlanDiff: async (
      issueId: string,
      revisionId: string,
      againstRevisionId?: string,
    ) => {
      const issue = await db
        .select({ id: issues.id, companyId: issues.companyId })
        .from(issues)
        .where(eq(issues.id, issueId))
        .then((rows) => rows[0] ?? null);
      if (!issue) throw notFound("Issue not found");

      const planDoc = await db
        .select({ id: documents.id, companyId: documents.companyId })
        .from(issueDocuments)
        .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
        .where(and(
          eq(issueDocuments.issueId, issueId),
          eq(issueDocuments.companyId, issue.companyId),
          eq(issueDocuments.key, "plan"),
        ))
        .then((rows) => rows[0] ?? null);
      if (!planDoc) throw notFound("Plan document not found");

      const targetRevision = await db
        .select({
          id: documentRevisions.id,
          companyId: documentRevisions.companyId,
          revisionNumber: documentRevisions.revisionNumber,
          body: documentRevisions.body,
        })
        .from(documentRevisions)
        .where(and(
          eq(documentRevisions.id, revisionId),
          eq(documentRevisions.documentId, planDoc.id),
          eq(documentRevisions.companyId, issue.companyId),
        ))
        .then((rows) => rows[0] ?? null);
      if (!targetRevision) throw notFound("Revision not found");

      if (!againstRevisionId) {
        // Diff against previous revision
        const prevRevision = await db
          .select({
            id: documentRevisions.id,
            companyId: documentRevisions.companyId,
            revisionNumber: documentRevisions.revisionNumber,
            body: documentRevisions.body,
          })
          .from(documentRevisions)
          .where(and(
            eq(documentRevisions.documentId, planDoc.id),
            eq(documentRevisions.companyId, issue.companyId),
            lt(documentRevisions.revisionNumber, targetRevision.revisionNumber),
          ))
          .orderBy(desc(documentRevisions.revisionNumber))
          .limit(1)
          .then((rows) => rows[0] ?? null);

        if (!prevRevision) {
          return {
            revision: { id: targetRevision.id, revisionNumber: targetRevision.revisionNumber },
            previousRevision: null,
            bodyDiff: computeLineDiff("", targetRevision.body ?? ""),
          };
        }

        return {
          revision: { id: targetRevision.id, revisionNumber: targetRevision.revisionNumber },
          previousRevision: { id: prevRevision.id, revisionNumber: prevRevision.revisionNumber },
          bodyDiff: computeLineDiff(prevRevision.body ?? "", targetRevision.body ?? ""),
        };
      }

      const againstRevision = await db
        .select({
          id: documentRevisions.id,
          companyId: documentRevisions.companyId,
          revisionNumber: documentRevisions.revisionNumber,
          body: documentRevisions.body,
        })
        .from(documentRevisions)
        .where(and(
          eq(documentRevisions.id, againstRevisionId),
          eq(documentRevisions.documentId, planDoc.id),
          eq(documentRevisions.companyId, issue.companyId),
        ))
        .then((rows) => rows[0] ?? null);
      if (!againstRevision) throw notFound("Against revision not found");

      return {
        revision: { id: targetRevision.id, revisionNumber: targetRevision.revisionNumber },
        previousRevision: { id: againstRevision.id, revisionNumber: againstRevision.revisionNumber },
        bodyDiff: computeLineDiff(againstRevision.body ?? "", targetRevision.body ?? ""),
      };
    },
  };
}

type DiffLine = {
  type: "added" | "removed" | "unchanged";
  value: string;
  oldLineNumber?: number;
  newLineNumber?: number;
};

function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  const m = oldLines.length;
  const n = newLines.length;

  // C-2: reject diffs that would exceed memory budget
  if (m > MAX_DIFF_LINES || n > MAX_DIFF_LINES) {
    throw unprocessableEntity(
      `Document too large for line diff (max ${MAX_DIFF_LINES} lines, got ${Math.max(m, n)})`,
    );
  }

  // LCS table — standard full matrix, bounded by MAX_DIFF_LINES check above.
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = new Array(n + 1).fill(0);
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack
  const reversed: DiffLine[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      reversed.push({ type: "unchanged", value: oldLines[i - 1], oldLineNumber: i, newLineNumber: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      reversed.push({ type: "added", value: newLines[j - 1], newLineNumber: j });
      j--;
    } else {
      reversed.push({ type: "removed", value: oldLines[i - 1], oldLineNumber: i });
      i--;
    }
  }

  return reversed.reverse();
}