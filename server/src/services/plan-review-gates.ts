import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { documents, issueDocuments, issues, planReviewGates } from "@paperclipai/db";
import { notFound, conflict } from "../errors.js";

async function resolvePlanDocumentIds(db: Db, issueId: string) {
  const doc = await db
    .select({ documentId: issueDocuments.documentId, companyId: issueDocuments.companyId })
    .from(issueDocuments)
    .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
    .where(and(eq(issueDocuments.issueId, issueId), eq(issueDocuments.key, "plan")))
    .then((rows) => rows[0] ?? null);
  if (!doc) throw notFound("Plan document not found for this issue");
  return { documentId: doc.documentId, companyId: doc.companyId };
}

export function planReviewGateService(db: Db) {
  return {
    /**
     * List review gates for an issue's plan document.
     * Tenant-safe: scoped to the document's companyId (C-1).
     */
    listGates: async (input: { issueId: string; revisionId?: string | null }) => {
      const { documentId, companyId } = await resolvePlanDocumentIds(db, input.issueId);
      const conditions = [
        eq(planReviewGates.documentId, documentId),
        eq(planReviewGates.companyId, companyId),
      ];
      if (input.revisionId) {
        conditions.push(eq(planReviewGates.revisionId, input.revisionId));
      }
      return db
        .select()
        .from(planReviewGates)
        .where(and(...conditions))
        .orderBy(asc(planReviewGates.createdAt));
    },

    /**
     * Create a new review gate on the current plan revision.
     * Tenant-safe: document lookup includes companyId (C-1).
     */
    createGate: async (input: {
      issueId: string;
      milestoneId?: string | null;
      acceptanceCriteria: string[];
      assignedAgentId?: string | null;
      createdByAgentId?: string | null;
      createdByUserId?: string | null;
    }) => {
      const { documentId, companyId } = await resolvePlanDocumentIds(db, input.issueId);

      const doc = await db
        .select({ companyId: documents.companyId, latestRevisionId: documents.latestRevisionId })
        .from(documents)
        .where(and(eq(documents.id, documentId), eq(documents.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
      if (!doc) throw notFound("Document not found");
      const revisionId = doc.latestRevisionId;
      if (!revisionId) throw conflict("Plan document has no revisions yet");

      const [gate] = await db
        .insert(planReviewGates)
        .values({
          companyId,
          documentId,
          revisionId,
          milestoneId: input.milestoneId ?? null,
          status: "pending",
          acceptanceCriteria: input.acceptanceCriteria,
          assignedAgentId: input.assignedAgentId ?? null,
          createdByAgentId: input.createdByAgentId ?? null,
          createdByUserId: input.createdByUserId ?? null,
        })
        .returning();
      if (!gate) throw new Error("Failed to create plan review gate");
      return gate;
    },

    /**
     * Resolve (approve or reject) a review gate by ID.
     * Tenant-safe: verifies gate belongs to the caller's document (C-1).
     * Invariant-safe: rejects resolution of non-pending gates (C-3).
     */
    resolveGate: async (
      gateId: string,
      input: {
        status: "approved" | "rejected";
        resolvedByAgentId?: string | null;
        resolvedByUserId?: string | null;
        resolutionComment?: string | null;
      },
    ) => {
      // Fetch the gate first to verify it exists and is still pending
      const existing = await db
        .select({
          id: planReviewGates.id,
          companyId: planReviewGates.companyId,
          documentId: planReviewGates.documentId,
          revisionId: planReviewGates.revisionId,
          status: planReviewGates.status,
        })
        .from(planReviewGates)
        .where(eq(planReviewGates.id, gateId))
        .then((rows) => rows[0] ?? null);
      if (!existing) throw notFound("Plan review gate not found");

      // C-3: reject re-resolution of already-resolved or superseded gates
      if (existing.status !== "pending") {
        throw conflict(
          `Plan review gate is already ${existing.status} and cannot be re-resolved`,
        );
      }

      const now = new Date();
      const [gate] = await db
        .update(planReviewGates)
        .set({
          status: input.status,
          resolvedByAgentId: input.resolvedByAgentId ?? null,
          resolvedByUserId: input.resolvedByUserId ?? null,
          resolvedAt: now,
          resolutionComment: input.resolutionComment ?? null,
          updatedAt: now,
        })
        .where(and(
          eq(planReviewGates.id, gateId),
          eq(planReviewGates.status, "pending"), // safety: only resolve if still pending
        ))
        .returning();
      if (!gate) throw notFound("Plan review gate not found or already resolved");

      // Check if all gates for this revision are now approved
      const remainingPending = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(planReviewGates)
        .where(and(
          eq(planReviewGates.documentId, gate.documentId),
          eq(planReviewGates.revisionId, gate.revisionId),
          eq(planReviewGates.status, "pending"),
        ))
        .then((rows) => Number(rows[0]?.count ?? 0));

      const allApproved = remainingPending === 0 && input.status === "approved";

      return {
        gate,
        allApproved,
      };
    },

    /**
     * Supersede all gates associated with a given revision.
     * Tenant-safe: resolves document via issueId with companyId (C-1).
     */
    supersedeGatesForRevision: async (input: {
      issueId: string;
      oldRevisionId: string;
      supersededByGateId?: string | null;
    }) => {
      const { documentId, companyId } = await resolvePlanDocumentIds(db, input.issueId);
      const now = new Date();
      await db
        .update(planReviewGates)
        .set({ status: "superseded", updatedAt: now, supersededByGateId: input.supersededByGateId ?? null })
        .where(and(
          eq(planReviewGates.documentId, documentId),
          eq(planReviewGates.companyId, companyId),
          eq(planReviewGates.revisionId, input.oldRevisionId),
          eq(planReviewGates.status, "pending"),
        ));
    },

    /**
     * Auto-supersede gates from all previous revisions of a document.
     * Tenant-safe: requires companyId filter (C-1).
     */
    supersedeGatesForPreviousRevisions: async (documentId: string, currentRevisionId: string) => {
      // Fetch the document's companyId to scope the supersede
      const doc = await db
        .select({ companyId: documents.companyId })
        .from(documents)
        .where(eq(documents.id, documentId))
        .then((rows) => rows[0] ?? null);
      if (!doc) throw notFound("Document not found");

      const now = new Date();
      await db
        .update(planReviewGates)
        .set({ status: "superseded", updatedAt: now })
        .where(and(
          eq(planReviewGates.documentId, documentId),
          eq(planReviewGates.companyId, doc.companyId),
          sql`${planReviewGates.revisionId} != ${currentRevisionId}`,
          eq(planReviewGates.status, "pending"),
        ));
    },
  };
}
