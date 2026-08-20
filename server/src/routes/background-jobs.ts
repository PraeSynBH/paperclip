import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { backgroundJobService, type BackgroundJobService } from "../services/background-jobs.js";
import { assertAuthenticated, assertCompanyAccess, assertBoard, assertCompanyScopeReadAllowed } from "./authz.js";
import { accessService, subscribeCompanyLiveEvents } from "../services/index.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  status: z.enum(["queued", "running", "succeeded", "failed"]).optional(),
  jobType: z.string().optional(),
});

const createJobSchema = z.object({
  jobType: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
});

export function backgroundJobRoutes(db: Db) {
  const router = Router();
  const svc = backgroundJobService(db);
  const access = accessService(db);

  /**
   * GET /api/companies/:companyId/background-jobs
   * List background jobs for a company.
   */
  router.get("/companies/:companyId/background-jobs", async (req, res) => {
    assertAuthenticated(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    if (!(await assertCompanyScopeReadAllowed(req, res, companyId, access))) return;

    const query = listQuerySchema.parse(req.query);
    const jobs = await svc.list(companyId, query);
    res.json(jobs);
  });

  /**
   * GET /api/companies/:companyId/background-jobs/events
   * SSE endpoint that streams background job status changes.
   * NOTE: defined BEFORE the /:id wildcard to avoid "events" matching as an id.
   */
  router.get("/companies/:companyId/background-jobs/events", async (req, res) => {
    assertAuthenticated(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Send initial comment to confirm connection
    res.write(":ok\n\n");

    const unsubscribe = subscribeCompanyLiveEvents(companyId, (event) => {
      if (event.type === "background_job.status") {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    });

    req.on("close", () => {
      unsubscribe();
    });
  });

  /**
   * GET /api/companies/:companyId/background-jobs/:id
   * Get a single background job by ID.
   */
  router.get("/companies/:companyId/background-jobs/:id", async (req, res) => {
    assertAuthenticated(req);
    const companyId = req.params.companyId as string;
    const jobId = req.params.id as string;
    assertCompanyAccess(req, companyId);
    if (!(await assertCompanyScopeReadAllowed(req, res, companyId, access))) return;

    const job = await svc.getById(jobId, companyId);
    if (!job) {
      res.status(404).json({ error: "Background job not found" });
      return;
    }
    res.json(job);
  });

  /**
   * POST /api/companies/:companyId/background-jobs
   * Create a new background job (board-only).
   */
  router.post(
    "/companies/:companyId/background-jobs",
    validate(createJobSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const job = await svc.create({
        companyId,
        jobType: req.body.jobType,
        payload: req.body.payload,
        createdByActorId: req.actor.type === "board" ? req.actor.userId : null,
      });
      res.status(201).json(job);
    },
  );

  return router;
}