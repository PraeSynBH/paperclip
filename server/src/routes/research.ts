import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { BACKGROUND_JOB_TYPES } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { backgroundJobService } from "../services/background-jobs.js";
import { researchSearchService } from "../services/research-search.js";
import { assertVoyonderAuth } from "../services/auth.js";

const researchActivitySearchSchema = z.object({
  query: z.string().min(1).max(500),
  scope: z.enum(["issues", "activity", "documents", "all"]).optional().default("all"),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const researchAutoAssessSchema = z.object({
  itemIds: z.array(z.string().uuid()).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const researchSearchSchema = z.object({
  query: z.string().min(1).max(500),
  scope: z.enum(["issues", "activity", "documents", "all"]).optional().default("all"),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  /** If true, also enqueue a semantic upgrade job and return a jobId. */
  semanticUpgrade: z.boolean().optional().default(false),
});

/**
 * Research routes.
 *
 * Endpoints:
 * - POST /companies/:companyId/research/activities      → background job (M1)
 * - POST /companies/:companyId/research/auto-assess      → background job (M2)
 * - POST /companies/:companyId/research/search           → keyword-first sync +
 *                                                           optional async semantic
 *                                                           upgrade via jobId → SSE
 */
export function researchRoutes(db: Db) {
  const router = Router();
  const jobs = backgroundJobService(db);
  const research = researchSearchService(db);

  // ── POST /research/activities (M1 — fire-and-forget background job) ───

  router.post(
    "/companies/:companyId/research/activities",
    validate(researchActivitySearchSchema),
    async (req, res) => {
      const auth = assertVoyonderAuth(req);
      const companyId = auth.companyId;

      const job = await jobs.create({
        companyId,
        jobType: BACKGROUND_JOB_TYPES.RESEARCH_ACTIVITY_SEARCH,
        payload: {
          query: req.body.query,
          scope: req.body.scope,
          limit: req.body.limit,
        },
        createdByActorId: auth.userId,
      });

      res.status(202).json({ jobId: job.id });
    },
  );

  // ── POST /research/auto-assess (M2 — fire-and-forget background job) ──

  router.post(
    "/companies/:companyId/research/auto-assess",
    validate(researchAutoAssessSchema),
    async (req, res) => {
      const auth = assertVoyonderAuth(req);
      const companyId = auth.companyId;

      const job = await jobs.create({
        companyId,
        jobType: BACKGROUND_JOB_TYPES.RESEARCH_AUTO_ASSESS,
        payload: {
          itemIds: req.body.itemIds,
          limit: req.body.limit,
        },
        createdByActorId: auth.userId,
      });

      res.status(202).json({ jobId: job.id });
    },
  );

  // ── POST /research/search (M2 — keyword-first + async semantic) ───────

  router.post(
    "/companies/:companyId/research/search",
    validate(researchSearchSchema),
    async (req, res) => {
      const auth = assertVoyonderAuth(req);
      const companyId = auth.companyId;

      // 1. Keyword-first pass — synchronous, fast.
      const keywordResult = await research.searchKeywordFirst(companyId, {
        query: req.body.query,
        scope: req.body.scope,
        limit: req.body.limit,
      });

      // 2. Optionally enqueue a semantic upgrade job.
      let semanticJobId: string | null = null;
      if (req.body.semanticUpgrade && keywordResult.results.length > 0) {
        const job = await jobs.create({
          companyId,
          jobType: BACKGROUND_JOB_TYPES.RESEARCH_SEMANTIC_SEARCH,
          payload: {
            query: req.body.query,
            scope: req.body.scope,
            limit: req.body.limit,
            candidateIds: keywordResult.results.map((r) => r.id),
          },
          createdByActorId: auth.userId,
        });
        semanticJobId = job.id;
      }

      res.json({
        query: req.body.query,
        results: keywordResult.results,
        total: keywordResult.total,
        semanticJobId,
        // The client can subscribe to /background-jobs/events SSE and
        // filter for `payload.jobId === semanticJobId` to get upgraded
        // results when the semantic pass completes.
      });
    },
  );

  return router;
}