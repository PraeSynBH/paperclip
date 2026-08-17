import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import { memoryRecords } from "@paperclipai/db";
import {
  knowledgeDocumentCreateSchema,
  knowledgeDocumentUpdateSchema,
  knowledgeDocumentPublishSchema,
  knowledgeDocumentSubmitReviewSchema,
  knowledgeDocumentReviewDecisionSchema,
  knowledgeDocumentListQuerySchema,
  knowledgeCreateBacklinkSchema,
  knowledgePromoteFromMemorySchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertBoardOrAgent, assertCompanyAccess } from "./authz.js";
import { knowledgeDocumentService, knowledgeStarterPackService } from "../services/index.js";
import { notFound } from "../errors.js";

export function knowledgeRoutes(db: Db) {
  const router = Router();
  const svc = knowledgeDocumentService(db);
  const starterPackSvc = knowledgeStarterPackService(db);

  // ─── Search ─────────────────────────────────────────────────────────────
  //
  // NOTE: registered BEFORE the /:documentId routes — otherwise Express would
  // match /knowledge/search against :documentId and the searchPublished
  // endpoint would be unreachable.

  /**
   * POST /companies/:companyId/knowledge/promote-from-memory
   * Promote a memory record into a draft knowledge document.
   * The document enters the normal draft → review → publish lifecycle.
   */
  router.post(
    "/companies/:companyId/knowledge/promote-from-memory",
    validate(knowledgePromoteFromMemorySchema),
    async (req, res) => {
      assertBoardOrAgent(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const result = await svc.promoteFromMemory(
        companyId,
        req.body,
        (req as any).actor?.agentId,
      );
      res.status(201).json(result);
    },
  );

  /**
   * GET /companies/:companyId/knowledge/search
   * Search across all published knowledge documents.
   */
  router.get("/companies/:companyId/knowledge/search", async (req, res) => {
    assertBoardOrAgent(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const q = req.query.q as string;
    if (!q || q.trim().length === 0) {
      res.status(400).json({ error: "Query parameter 'q' is required" });
      return;
    }

    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const result = await svc.searchPublished(companyId, q, limit);
    res.json(result);
  });

  // ─── CRUD ────────────────────────────────────────────────────────────────

  /**
   * GET /companies/:companyId/knowledge
   * List knowledge documents with pagination, filtering, and search.
   */
  router.get("/companies/:companyId/knowledge", async (req, res) => {
    assertBoardOrAgent(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const query = knowledgeDocumentListQuerySchema.parse(req.query);
    const result = await svc.list(companyId, query);
    res.json(result);
  });

  /**
   * POST /companies/:companyId/knowledge
   * Create a new knowledge document.
   */
  router.post(
    "/companies/:companyId/knowledge",
    validate(knowledgeDocumentCreateSchema),
    async (req, res) => {
      assertBoardOrAgent(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const result = await svc.create(
        companyId,
        req.body,
        (req as any).actor?.agentId,
      );
      res.status(201).json(result);
    },
  );

  /**
   * GET /companies/:companyId/knowledge/:documentId
   * Get a single knowledge document.
   */
  router.get(
    "/companies/:companyId/knowledge/:documentId",
    async (req, res) => {
      assertBoardOrAgent(req);
      const companyId = req.params.companyId as string;
      const documentId = req.params.documentId as string;
      assertCompanyAccess(req, companyId);

      try {
        const result = await svc.get(companyId, documentId);
        res.json(result);
      } catch (err: any) {
        if (err?.status === 404 || err?.message === "Knowledge document not found") {
          res.status(404).json({ error: "Knowledge document not found" });
          return;
        }
        throw err;
      }
    },
  );

  /**
   * PATCH /companies/:companyId/knowledge/:documentId
   * Update a draft knowledge document.
   */
  router.patch(
    "/companies/:companyId/knowledge/:documentId",
    validate(knowledgeDocumentUpdateSchema),
    async (req, res) => {
      assertBoardOrAgent(req);
      const companyId = req.params.companyId as string;
      const documentId = req.params.documentId as string;
      assertCompanyAccess(req, companyId);

      const result = await svc.update(companyId, documentId, req.body);
      res.json(result);
    },
  );

  /**
   * DELETE /companies/:companyId/knowledge/:documentId
   * Delete a draft or archived knowledge document.
   */
  router.delete(
    "/companies/:companyId/knowledge/:documentId",
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      const documentId = req.params.documentId as string;
      assertCompanyAccess(req, companyId);

      await svc.delete(companyId, documentId);
      res.status(204).end();
    },
  );

  // ─── Lifecycle Transitions ──────────────────────────────────────────────

  /**
   * POST /companies/:companyId/knowledge/:documentId/submit-review
   * Submit a draft document for review.
   */
  router.post(
    "/companies/:companyId/knowledge/:documentId/submit-review",
    validate(knowledgeDocumentSubmitReviewSchema),
    async (req, res) => {
      assertBoardOrAgent(req);
      const companyId = req.params.companyId as string;
      const documentId = req.params.documentId as string;
      assertCompanyAccess(req, companyId);

      const result = await svc.submitForReview(
        companyId,
        documentId,
        req.body,
        (req as any).actor?.agentId,
      );
      res.json(result);
    },
  );

  /**
   * POST /companies/:companyId/knowledge/:documentId/review
   * Review a document (approve or request changes).
   */
  router.post(
    "/companies/:companyId/knowledge/:documentId/review",
    validate(knowledgeDocumentReviewDecisionSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      const documentId = req.params.documentId as string;
      assertCompanyAccess(req, companyId);

      const result = await svc.review(
        companyId,
        documentId,
        req.body,
        (req as any).actor?.agentId,
      );
      res.json(result);
    },
  );

  /**
   * POST /companies/:companyId/knowledge/:documentId/publish
   * Publish an approved document.
   */
  router.post(
    "/companies/:companyId/knowledge/:documentId/publish",
    validate(knowledgeDocumentPublishSchema),
    async (req, res) => {
      assertBoardOrAgent(req);
      const companyId = req.params.companyId as string;
      const documentId = req.params.documentId as string;
      assertCompanyAccess(req, companyId);

      const result = await svc.publish(companyId, documentId, req.body);
      res.json(result);
    },
  );

  /**
   * POST /companies/:companyId/knowledge/:documentId/archive
   * Archive a published document.
   */
  router.post(
    "/companies/:companyId/knowledge/:documentId/archive",
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      const documentId = req.params.documentId as string;
      assertCompanyAccess(req, companyId);

      const result = await svc.archive(companyId, documentId);
      res.json(result);
    },
  );

  // ─── Revisions ──────────────────────────────────────────────────────────

  /**
   * GET /companies/:companyId/knowledge/:documentId/revisions
   * List all revisions for a document.
   */
  router.get(
    "/companies/:companyId/knowledge/:documentId/revisions",
    async (req, res) => {
      assertBoardOrAgent(req);
      const companyId = req.params.companyId as string;
      const documentId = req.params.documentId as string;
      assertCompanyAccess(req, companyId);

      const result = await svc.listRevisions(companyId, documentId);
      res.json(result);
    },
  );

  /**
   * GET /companies/:companyId/knowledge/:documentId/revisions/:revisionId
   * Get a specific revision.
   */
  router.get(
    "/companies/:companyId/knowledge/:documentId/revisions/:revisionId",
    async (req, res) => {
      assertBoardOrAgent(req);
      const companyId = req.params.companyId as string;
      const documentId = req.params.documentId as string;
      const revisionId = req.params.revisionId as string;
      assertCompanyAccess(req, companyId);

      try {
        const result = await svc.getRevision(companyId, documentId, revisionId);
        res.json(result);
      } catch (err: any) {
        if (err?.status === 404 || err?.message === "Revision not found") {
          res.status(404).json({ error: "Revision not found" });
          return;
        }
        throw err;
      }
    },
  );

  /**
   * GET /companies/:companyId/knowledge/:documentId/revisions/:revA/diff/:revB
   * Diff two revisions.
   */
  router.get(
    "/companies/:companyId/knowledge/:documentId/revisions/:revA/diff/:revB",
    async (req, res) => {
      assertBoardOrAgent(req);
      const companyId = req.params.companyId as string;
      const documentId = req.params.documentId as string;
      const revA = req.params.revA as string;
      const revB = req.params.revB as string;
      assertCompanyAccess(req, companyId);

      try {
        const result = await svc.diff(companyId, documentId, revA, revB);
        res.json(result);
      } catch (err: any) {
        if (err?.status === 404 || err?.message?.includes?.("not found")) {
          res.status(404).json({ error: "Revision not found" });
          return;
        }
        throw err;
      }
    },
  );

  // ─── Backlinks ──────────────────────────────────────────────────────────

  /**
   * GET /companies/:companyId/knowledge/:documentId/backlinks
   * List backlinks for a document.
   */
  router.get(
    "/companies/:companyId/knowledge/:documentId/backlinks",
    async (req, res) => {
      assertBoardOrAgent(req);
      const companyId = req.params.companyId as string;
      const documentId = req.params.documentId as string;
      assertCompanyAccess(req, companyId);

      const result = await svc.listBacklinks(companyId, documentId);
      res.json(result);
    },
  );

  /**
   * POST /companies/:companyId/knowledge/:documentId/backlinks
   * Create a backlink from a document to an issue.
   */
  router.post(
    "/companies/:companyId/knowledge/:documentId/backlinks",
    validate(knowledgeCreateBacklinkSchema),
    async (req, res) => {
      assertBoardOrAgent(req);
      const companyId = req.params.companyId as string;
      const documentId = req.params.documentId as string;
      assertCompanyAccess(req, companyId);

      const result = await svc.createBacklink(companyId, documentId, req.body);
      res.status(201).json(result);
    },
  );

  /**
   * POST /companies/:companyId/knowledge/maintenance/rebuild-index
   * Rebuild the pgvector HNSW embedding index for improved query performance.
   * Runs REINDEX on the memory_records embedding index — table-level lock
   * for the duration of the operation. Use during low-traffic periods.
   */
  router.post(
    "/companies/:companyId/knowledge/maintenance/rebuild-index",
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const start = Date.now();
      await db.execute(
        sql`REINDEX INDEX IF EXISTS memory_records_embedding_hnsw_idx`,
      );
      const latencyMs = Date.now() - start;

      res.json({
        success: true,
        index: "memory_records_embedding_hnsw_idx",
        latencyMs,
      });
    },
  );

  // ─── Starter Packs ──────────────────────────────────────────────────────

  /**
   * GET /companies/:companyId/knowledge/starter-packs
   * List available knowledge base starter packs (without full document bodies).
   */
  router.get(
    "/companies/:companyId/knowledge/starter-packs",
    async (req, res) => {
      assertBoardOrAgent(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const packs = await starterPackSvc.listPacks();
      res.json(packs);
    },
  );

  /**
   * GET /companies/:companyId/knowledge/starter-packs/:packKey
   * Get a starter pack by key, including full document content.
   */
  router.get(
    "/companies/:companyId/knowledge/starter-packs/:packKey",
    async (req, res) => {
      assertBoardOrAgent(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const pack = await starterPackSvc.getPack(req.params.packKey as string);
      if (!pack) {
        res.status(404).json({ error: `Starter pack '${req.params.packKey}' not found` });
        return;
      }
      res.json(pack);
    },
  );

  /**
   * POST /companies/:companyId/knowledge/starter-packs/:packKey/install
   * Install a starter pack into the company's knowledge base.
   * Creates all documents as published and returns their IDs.
   */
  router.post(
    "/companies/:companyId/knowledge/starter-packs/:packKey/install",
    async (req, res) => {
      assertBoardOrAgent(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      try {
        const result = await starterPackSvc.installPack(
          companyId,
          req.params.packKey as string,
          (req as any).actor?.agentId,
        );
        res.status(201).json(result);
      } catch (err: any) {
        if (err?.message?.startsWith("Starter pack")) {
          res.status(404).json({ error: err.message });
          return;
        }
        throw err;
      }
    },
  );

  return router;
}