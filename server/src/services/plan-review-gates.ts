import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { documents, issueDocuments, planReviewGates } from "@paperclipai/db";
import { notFound, conflict } from "../errors.js";

async function resolvePlanDocumentIds(db: Db, issueId: string) {
  const doc = await db
    .select({ documentId: issueDocuments.documentId })
    .from(issueDocuments)
    .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
    .where(and(eq(issueDocuments.issueId, issueId), eq(issueDocuments.key, "plan")))
    .then((rows) => rows[0] ?? null);
  if (!doc) throw notFound("Plan document not found for this issue");
  return doc.documentId;
}

export function planReviewGateService(db: Db) {
  return {
    /**
     * List review gates for an issue's plan document.
     */
    listGates: async (input: { issueId: string; revisionId?: string | null }) => {
      const documentId = await resolvePlanDocumentIds(db, input.issueId);
      const conditions = [eq(planReviewGates.documentId, documentId)];
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
     */
    createGate: async (input: {
      issueId: string;
      milestoneId?: string | null;
      acceptanceCriteria: string[];
      assignedAgentId?: string | null;
      createdByAgentId?: string | null;
      createdByUserId?: string | null;
    }) => {
      const issueDoc = await db
        .select({ documentId: issueDocuments.documentId })
        .from(issueDocuments)
        .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
        .where(and(eq(issueDocuments.issueId, input.issueId), eq(issueDocuments.key, "plan")))
        .then((rows) => rows[0] ?? null);
      if (!issueDoc) throw notFound("Plan document not found for this issue");

      const doc = await db
        .select({ companyId: documents.companyId, latestRevisionId: documents.latestRevisionId })
        .from(documents)
        .where(eq(documents.id, issueDoc.documentId))
        .then((rows) => rows[0] ?? null);
      if (!doc) throw notFound("Document not found");
      const revisionId = doc.latestRevisionId;
      if (!revisionId) throw conflict("Plan document has no revisions yet");

      const [gate] = await db
        .insert(planReviewGates)
        .values({
          companyId: doc.companyId,
          documentId: issueDoc.documentId,
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
     * Takes gateId as first arg, then the resolution input.
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
        .where(eq(planReviewGates.id, gateId))
        .returning();
      if (!gate) throw notFound("Plan review gate not found");

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
     */
    supersedeGatesForRevision: async (input: {
      issueId: string;
      oldRevisionId: string;
    }) => {
      const documentId = await resolvePlanDocumentIds(db, input.issueId);
      const now = new Date();
      await db
        .update(planReviewGates)
        .set({ status: "superseded", updatedAt: now })
        .where(and(
          eq(planReviewGates.documentId, documentId),
          eq(planReviewGates.revisionId, input.oldRevisionId),
        ));
    },

    /**
     * Auto-supersede gates from all previous revisions of a document.
     */
    supersedeGatesForPreviousRevisions: async (documentId: string, currentRevisionId: string) => {
      const now = new Date();
      await db
        .update(planReviewGates)
        .set({ status: "superseded", updatedAt: now })
        .where(and(
          eq(planReviewGates.documentId, documentId),
          sql`${planReviewGates.revisionId} != ${currentRevisionId}`,
        ));
    },
  };
}