import { Router } from "express";
import { z } from "zod";
import type { Request, Response } from "express";
import type { Db } from "@paperclipai/db";
import { BACKGROUND_JOB_TYPES } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { backgroundJobService } from "../services/background-jobs.js";
import { accessService } from "../services/index.js";
import { assertAuthenticated, assertCompanyAccess, assertCompanyScopeReadAllowed } from "./authz.js";

const exportPdfSchema = z.object({
  title: z.string().max(200).optional(),
  items: z.array(z.record(z.unknown())).max(500).optional(),
});

const exportIcsSchema = z.object({
  title: z.string().max(200).optional(),
  events: z
    .array(
      z.object({
        title: z.string().max(200),
        start: z.string().optional(),
        end: z.string().optional(),
        location: z.string().max(200).optional(),
        description: z.string().max(2000).optional(),
      }),
    )
    .max(500),
});

/**
 * Reject export payloads whose serialized size exceeds `limitBytes`.
 * Guards against a large payload tying up the PDF/ICS worker in-process
 * (exacerbating the per-processor timeout), and caps the base64 data-URI
 * stored on the job result row.
 */
function assertPayloadSize(req: Request, limitBytes = 512 * 1024): void {
  const body = req.body as unknown;
  if (body === undefined || body === null) return;
  const size = Buffer.byteLength(JSON.stringify(body), "utf8");
  if (size > limitBytes) {
    throw Object.assign(new Error(`Export payload too large (${size} bytes, max ${limitBytes})`), { status: 413 });
  }
}

/**
 * Export routes — PDF and ICS generation run as background jobs so the
 * request returns immediately and the client tracks progress via the
 * background-jobs API/SSE.
 */
export function exportRoutes(db: Db) {
  const router = Router();
  const jobs = backgroundJobService(db);
  const access = accessService(db);

  /**
   * POST /api/companies/:companyId/exports/pdf
   * Queue a PDF export. Returns 202 { jobId }.
   */
  router.post(
    "/companies/:companyId/exports/pdf",
    validate(exportPdfSchema),
    async (req, res) => {
      assertAuthenticated(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      if (!(await assertCompanyScopeReadAllowed(req, res, companyId, access))) return;
      assertPayloadSize(req);

      const job = await jobs.create({
        companyId,
        jobType: BACKGROUND_JOB_TYPES.EXPORT_PDF,
        payload: {
          title: req.body.title,
          items: req.body.items,
        },
        createdByActorId:
          req.actor.type === "board" ? req.actor.userId : req.actor.type === "agent" ? req.actor.agentId : null,
      });

      res.status(202).json({ jobId: job.id });
    },
  );

  /**
   * POST /api/companies/:companyId/exports/ics
   * Queue an iCalendar export. Returns 202 { jobId }.
   */
  router.post(
    "/companies/:companyId/exports/ics",
    validate(exportIcsSchema),
    async (req, res) => {
      assertAuthenticated(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      if (!(await assertCompanyScopeReadAllowed(req, res, companyId, access))) return;
      assertPayloadSize(req);

      const job = await jobs.create({
        companyId,
        jobType: BACKGROUND_JOB_TYPES.EXPORT_ICS,
        payload: {
          title: req.body.title,
          events: req.body.events,
        },
        createdByActorId:
          req.actor.type === "board" ? req.actor.userId : req.actor.type === "agent" ? req.actor.agentId : null,
      });

      res.status(202).json({ jobId: job.id });
    },
  );

  return router;
}