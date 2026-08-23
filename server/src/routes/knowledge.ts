import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { badRequest } from "../errors.js";
import { knowledgeService, logActivity } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

// ─── Validation Schemas ──────────────────────────────────────────────────────

const createSchema = {
  body: {
    title: { type: "string", required: true, minLength: 1 },
    summary: { type: "string", required: false },
    body: { type: "string", required: false },
    sourceIssueId: { type: "string", required: false },
  },
} as const;

const updateSchema = {
  body: {
    title: { type: "string", required: false, minLength: 1 },
    summary: { type: "string", required: false },
    body: { type: "string", required: false },
  },
} as const;

const reviewSchema = {
  body: {
    status: { type: "string", required: true, enum: ["approved", "changes_requested"] },
    comment: { type: "string", required: false },
  },
} as const;

const publishSchema = {
  body: {
    changeDescription: { type: "string", required: false },
  },
} as const;

const submitReviewSchema = {
  body: {
    reviewerAgentId: { type: "string", required: false },
  },
} as const;

// ─── Routes ──────────────────────────────────────────────────────────────────

export function knowledgeRoutes(db: Db) {
  const router = Router();
  const svc = knowledgeService(db);

  // ── List documents (with cursor pagination, status filter, search) ─────
  router.get("/companies/:companyId/knowledge", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const {
      status,
      cursor,
      limit: limitStr,
      search,
    } = req.query as Record<string, string | undefined>;

    const limit = limitStr ? parseInt(limitStr, 10) : undefined;
    if (limit !== undefined && (isNaN(limit) || limit < 1 || limit > 100)) {
      throw badRequest("limit must be between 1 and 100");
    }

    const result = await svc.list(companyId, {
      status: status as any,
      cursor,
      limit,
      search,
    });

    res.json(result);
  });

  // ── Search published documents ─────────────────────────────────────────
  router.get("/companies/:companyId/knowledge/search", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const { q, limit: limitStr } = req.query as Record<string, string | undefined>;

    if (!q || typeof q !== "string" || q.trim().length === 0) {
      res.json([]);
      return;
    }

    const limit = limitStr ? parseInt(limitStr, 10) : undefined;
    if (limit !== undefined && (isNaN(limit) || limit < 1 || limit > 100)) {
      throw badRequest("limit must be between 1 and 100");
    }

    const results = await svc.searchPublished(companyId, q, limit);
    res.json(results);
  });

  // ── Get single document ────────────────────────────────────────────────
  router.get("/companies/:companyId/knowledge/:documentId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const documentId = req.params.documentId as string;
    assertCompanyAccess(req, companyId);

    const doc = await svc.get(companyId, documentId);
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    res.json(doc);
  });

  // ── Create document ────────────────────────────────────────────────────
  router.post("/companies/:companyId/knowledge", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const { title, summary, body, sourceIssueId } = req.body ?? {};
    if (!title || typeof title !== "string" || title.trim().length === 0) {
      throw badRequest("title is required");
    }

    const actor = getActorInfo(req);
    const doc = await svc.create(
      companyId,
      {
        title: title.trim(),
        summary: typeof summary === "string" ? summary : undefined,
        body: typeof body === "string" ? body : undefined,
        sourceIssueId: typeof sourceIssueId === "string" ? sourceIssueId : undefined,
      },
      actor.agentId ?? actor.actorId,
    );

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "knowledge.created",
      entityType: "knowledge_document",
      entityId: doc.id,
      details: { title: doc.title },
    });

    res.status(201).json(doc);
  });

  // ── Update document ────────────────────────────────────────────────────
  router.patch("/companies/:companyId/knowledge/:documentId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const documentId = req.params.documentId as string;
    assertCompanyAccess(req, companyId);

    const { title, summary, body } = req.body ?? {};
    const updateData: { title?: string; summary?: string; body?: string } = {};

    if (title !== undefined) {
      if (typeof title !== "string" || title.trim().length === 0) {
        throw badRequest("title must be a non-empty string");
      }
      updateData.title = title.trim();
    }
    if (summary !== undefined) {
      if (typeof summary !== "string") throw badRequest("summary must be a string");
      updateData.summary = summary;
    }
    if (body !== undefined) {
      if (typeof body !== "string") throw badRequest("body must be a string");
      updateData.body = body;
    }

    const doc = await svc.update(companyId, documentId, updateData);
    if (!doc) {
      res.status(404).json({ error: "Document not found or not editable" });
      return;
    }

    res.json(doc);
  });

  // ── Delete document ────────────────────────────────────────────────────
  router.delete("/companies/:companyId/knowledge/:documentId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const documentId = req.params.documentId as string;
    assertCompanyAccess(req, companyId);

    const deleted = await svc.remove(companyId, documentId);
    if (!deleted) {
      res.status(404).json({ error: "Document not found or cannot be deleted" });
      return;
    }

    res.status(204).end();
  });

  // ── Submit for review ──────────────────────────────────────────────────
  router.post("/companies/:companyId/knowledge/:documentId/submit-review", async (req, res) => {
    const companyId = req.params.companyId as string;
    const documentId = req.params.documentId as string;
    assertCompanyAccess(req, companyId);

    const { reviewerAgentId } = req.body ?? {};
    const result = await svc.submitForReview(
      companyId,
      documentId,
      typeof reviewerAgentId === "string" ? reviewerAgentId : undefined,
    );

    if (!result) {
      res.status(404).json({ error: "Document not found or not in draft status" });
      return;
    }

    res.json(result);
  });

  // ── Review document ────────────────────────────────────────────────────
  router.post("/companies/:companyId/knowledge/:documentId/review", async (req, res) => {
    const companyId = req.params.companyId as string;
    const documentId = req.params.documentId as string;
    assertCompanyAccess(req, companyId);

    const { status, comment } = req.body ?? {};
    if (!status || !["approved", "changes_requested"].includes(status)) {
      throw badRequest("status must be 'approved' or 'changes_requested'");
    }

    const actor = getActorInfo(req);
    const result = await svc.review(
      companyId,
      documentId,
      { status, comment: typeof comment === "string" ? comment : undefined },
      actor.agentId ?? actor.actorId,
    );

    if (!result) {
      res.status(404).json({ error: "Document not found or not in review" });
      return;
    }

    res.json(result);
  });

  // ── Publish document ───────────────────────────────────────────────────
  router.post("/companies/:companyId/knowledge/:documentId/publish", async (req, res) => {
    const companyId = req.params.companyId as string;
    const documentId = req.params.documentId as string;
    assertCompanyAccess(req, companyId);

    const { changeDescription } = req.body ?? {};
    const result = await svc.publish(
      companyId,
      documentId,
      typeof changeDescription === "string" ? changeDescription : undefined,
    );

    if (!result) {
      res.status(404).json({ error: "Document not found or cannot be published" });
      return;
    }

    res.json(result);
  });

  // ── Archive document ───────────────────────────────────────────────────
  router.post("/companies/:companyId/knowledge/:documentId/archive", async (req, res) => {
    const companyId = req.params.companyId as string;
    const documentId = req.params.documentId as string;
    assertCompanyAccess(req, companyId);

    const doc = await svc.archive(companyId, documentId);
    if (!doc) {
      res.status(404).json({ error: "Document not found or not published" });
      return;
    }

    res.json(doc);
  });

  // ── List revisions ─────────────────────────────────────────────────────
  router.get("/companies/:companyId/knowledge/:documentId/revisions", async (req, res) => {
    const companyId = req.params.companyId as string;
    const documentId = req.params.documentId as string;
    assertCompanyAccess(req, companyId);

    const revisions = await svc.listRevisions(companyId, documentId);
    res.json(revisions);
  });

  // ── Get specific revision ──────────────────────────────────────────────
  router.get(
    "/companies/:companyId/knowledge/:documentId/revisions/:revisionId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const documentId = req.params.documentId as string;
      const revisionId = req.params.revisionId as string;
      assertCompanyAccess(req, companyId);

      const revision = await svc.getRevision(companyId, documentId, revisionId);
      if (!revision) {
        res.status(404).json({ error: "Revision not found" });
        return;
      }

      res.json(revision);
    },
  );

  // ── Diff two revisions ─────────────────────────────────────────────────
  router.get(
    "/companies/:companyId/knowledge/:documentId/revisions/:revAId/diff/:revBId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const documentId = req.params.documentId as string;
      const revAId = req.params.revAId as string;
      const revBId = req.params.revBId as string;
      assertCompanyAccess(req, companyId);

      const diff = await svc.diff(companyId, documentId, revAId, revBId);
      if (!diff) {
        res.status(404).json({ error: "Revisions not found" });
        return;
      }

      res.json(diff);
    },
  );

  // ── List backlinks ─────────────────────────────────────────────────────
  router.get("/companies/:companyId/knowledge/:documentId/backlinks", async (req, res) => {
    const companyId = req.params.companyId as string;
    const documentId = req.params.documentId as string;
    assertCompanyAccess(req, companyId);

    const backlinks = await svc.listBacklinks(companyId, documentId);
    res.json(backlinks);
  });

  return router;
}
