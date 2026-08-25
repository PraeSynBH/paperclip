import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { backgroundJobService, type BackgroundJobService } from "../services/background-jobs.js";
import { assertVoyonderAuth } from "../services/auth.js";
import { subscribeCompanyLiveEvents } from "../services/index.js";

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

/** Heartbeat interval for SSE connections (seconds). */
const SSE_HEARTBEAT_INTERVAL_SEC = 30;

/** Max lifetime of a single SSE connection before forced cleanup (seconds). */
const SSE_MAX_LIFETIME_SEC = 300;

export function backgroundJobRoutes(db: Db) {
  const router = Router();
  const svc = backgroundJobService(db);

  /**
   * GET /api/companies/:companyId/background-jobs
   * List background jobs for a company.
   */
  router.get("/companies/:companyId/background-jobs", async (req, res) => {
    const auth = assertVoyonderAuth(req);
    const companyId = auth.companyId;

    const query = listQuerySchema.parse(req.query);
    const jobs = await svc.list(companyId, query);
    res.json(jobs);
  });

  /**
   * GET /api/companies/:companyId/background-jobs/events
   * SSE endpoint that streams background job status changes.
   * NOTE: defined BEFORE the /:id wildcard to avoid "events" matching as an id.
   *
   * Includes a heartbeat interval and connection lifetime cap to prevent
   * listener leaks on unclean TCP disconnects (network partition, laptop
   * close, mobile signal loss — where `req.on("close")` may never fire).
   */
  router.get("/companies/:companyId/background-jobs/events", async (req, res) => {
    const auth = assertVoyonderAuth(req);
    const companyId = auth.companyId;

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

    // Heartbeat — detect dead connections by sending a periodic comment.
    // Browsers and proxies will drop the connection if the client has gone
    // away, which triggers the `close` event for clean teardown.
    const heartbeatTimer = setInterval(() => {
      res.write(":heartbeat\n\n");
    }, SSE_HEARTBEAT_INTERVAL_SEC * 1000);

    // Connection lifetime cap — forcefully clean up after max lifetime
    // even if the `close` event never fires (e.g. unclean TCP drop).
    const lifetimeTimer = setTimeout(() => {
      res.end();
    }, SSE_MAX_LIFETIME_SEC * 1000);

    req.on("close", () => {
      unsubscribe();
      clearInterval(heartbeatTimer);
      clearTimeout(lifetimeTimer);
    });
  });

  /**
   * GET /api/companies/:companyId/background-jobs/:id
   * Get a single background job by ID.
   */
  router.get("/companies/:companyId/background-jobs/:id", async (req, res) => {
    const auth = assertVoyonderAuth(req);
    const companyId = auth.companyId;
    const jobId = req.params.id as string;

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
      const auth = assertVoyonderAuth(req);
      const companyId = auth.companyId;

      const job = await svc.create({
        companyId,
        jobType: req.body.jobType,
        payload: req.body.payload,
        createdByActorId: auth.userId,
      });
      res.status(201).json(job);
    },
  );

  return router;
}