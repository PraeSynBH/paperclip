import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { backgroundJobService, type BackgroundJobService } from "../services/background-jobs.js";
import { assertVoyonderAuth } from "../services/auth.js";
import { subscribeCompanyLiveEvents } from "../services/index.js";
import { getStorageService } from "../storage/index.js";
import { BACKGROUND_JOB_TYPES } from "@paperclipai/shared";
import { HttpError } from "../errors.js";

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

/** Set of job types that can be created via the direct POST endpoint.
 *  Only types with registered processors are allowed — unregistered types
 *  would get stuck in `queued` forever. See processJob() in the worker
 *  for the one-to-one mapping between job types and processor functions. */
const ALLOWED_JOB_TYPES = new Set<string>(Object.values(BACKGROUND_JOB_TYPES));

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
   * GET /api/companies/:companyId/background-jobs/:id/download
   * Stream a blob-stored export artifact (e.g. PDF) from the job result.
   * Returns 404 when the job result has no storage objectKey (e.g. legacy
   * inline dataUri results which the client fetches from getById directly).
   */
  router.get("/companies/:companyId/background-jobs/:id/download", async (req, res, next) => {
    const auth = assertVoyonderAuth(req);
    const companyId = auth.companyId;
    const jobId = req.params.id as string;

    const job = await svc.getById(jobId, companyId);
    if (!job) {
      res.status(404).json({ error: "Background job not found" });
      return;
    }
    const result = job.result as Record<string, unknown> | null;
    const objectKey = typeof result?.objectKey === "string" ? result.objectKey : null;
    if (!objectKey || !result) {
      res.status(404).json({ error: "Export artifact not stored on object storage" });
      return;
    }

    const storage = getStorageService();
    const object = await storage.getObject(companyId, objectKey);
    const contentType =
      object.contentType ?? (result.kind === "pdf" ? "application/pdf" : "application/octet-stream");
    const safeName = result.kind === "pdf" ? "export.pdf" : "export.bin";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Length", String(object.contentLength ?? 0));
    object.stream.on("error", (err) => {
      next(err);
    });
    object.stream.pipe(res);
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

      // Restrict direct job creation to registered job types. Unregistered
      // types would be claimed by the worker and then failed with "No
      // processor registered" — better to reject at the API boundary.
      if (!ALLOWED_JOB_TYPES.has(req.body.jobType)) {
        throw new HttpError(400, `Unsupported background job type: ${req.body.jobType}`);
      }

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