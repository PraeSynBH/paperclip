import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { backgroundJobs } from "@paperclipai/db";
import { BACKGROUND_JOB_TYPES, type BackgroundJobType } from "@paperclipai/shared";
import { backgroundJobService } from "./background-jobs.js";
import { researchSearchService } from "./research-search.js";
import { logger } from "../middleware/logger.js";
import PDFDocument from "pdfkit";

/**
 * Background job worker.
 *
 * Polls the `background_jobs` table for `queued` jobs and dispatches them
 * to a processor based on `jobType`. Each job transitions through
 * `queued → running → succeeded|failed`, with progress updates published
 * via the live-events bus so the UI tray can reflect them in real time.
 *
 * The worker is intentionally simple: a single in-process polling loop
 * with bounded concurrency. It is safe to run multiple instances — each
 * claim uses `FOR UPDATE SKIP LOCKED`, so two workers never process the
 * same job.
 */

export interface BackgroundJobWorkerOptions {
  /** Poll interval in ms. Default 2000. */
  pollIntervalMs?: number;
  /** Max jobs claimed per tick. Default 5. */
  batchSize?: number;
}

type JobProcessor = (ctx: {
  db: Db;
  companyId: string;
  jobId: string;
  payload: Record<string, unknown>;
  report: (progress: number, message: string) => Promise<void>;
}) => Promise<Record<string, unknown>>;

export function createBackgroundJobWorker(db: Db, options?: BackgroundJobWorkerOptions) {
  const pollIntervalMs = options?.pollIntervalMs ?? 2_000;
  const batchSize = options?.batchSize ?? 5;
  const svc = backgroundJobService(db);
  const research = researchSearchService(db);

  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let inFlight = 0;

  const processors: Record<string, JobProcessor> = {
    [BACKGROUND_JOB_TYPES.RESEARCH_ACTIVITY_SEARCH]: async ({ companyId, payload, report }) => {
      const query = typeof payload.query === "string" ? payload.query : "";
      const scope = payload.scope === "issues" || payload.scope === "activity" || payload.scope === "documents" || payload.scope === "all"
        ? payload.scope
        : "all";
      const limit = typeof payload.limit === "number" ? payload.limit : undefined;

      await report(20, "Searching issues, documents, and activity…");
      const result = await research.searchKeywordFirst(companyId, { query, scope, limit });
      await report(100, `Found ${result.total} results`);
      return result;
    },

    [BACKGROUND_JOB_TYPES.RESEARCH_SEMANTIC_SEARCH]: async ({ companyId, payload, report }) => {
      const query = typeof payload.query === "string" ? payload.query : "";
      const scope = payload.scope === "issues" || payload.scope === "activity" || payload.scope === "documents" || payload.scope === "all"
        ? payload.scope
        : "all";
      const limit = typeof payload.limit === "number" ? payload.limit : undefined;

      await report(20, "Keyword pass complete — upgrading with semantic ranking…");
      const result = await research.upgradeSemanticResults(companyId, { query, scope, limit });
      await report(100, result.upgraded ? "Semantic ranking applied" : "Keyword results returned");
      return result;
    },

    [BACKGROUND_JOB_TYPES.RESEARCH_AUTO_ASSESS]: async ({ companyId, payload, report }) => {
      const itemIds = Array.isArray(payload.itemIds)
        ? payload.itemIds.filter((id): id is string => typeof id === "string")
        : undefined;
      const limit = typeof payload.limit === "number" ? payload.limit : undefined;

      await report(30, "Gathering research items…");
      const result = await research.autoAssess(companyId, { itemIds, limit });
      await report(100, `Assessed ${result.items.length} items`);
      return result;
    },

    [BACKGROUND_JOB_TYPES.EXPORT_PDF]: async ({ payload, report }) => {
      const title = typeof payload.title === "string" ? payload.title : "Research Export";
      await report(40, "Rendering PDF…");

      const items = Array.isArray(payload.items) ? payload.items : [];
      const buffers: Buffer[] = [];
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        info: {
          Title: title,
          Creator: "Voyonder",
          Producer: "Voyonder Export Service",
        },
      });

      doc.on("data", (chunk: Buffer) => buffers.push(chunk));
      await new Promise<void>((resolve, reject) => {
        doc.on("end", () => resolve());
        doc.on("error", (err) => reject(err));

        // Title page
        doc.fontSize(24).font("Helvetica-Bold").text(title, { align: "center" });
        doc.moveDown(0.5);
        doc.fontSize(10).font("Helvetica").fillColor("#666")
          .text(`Generated: ${new Date().toISOString()}`, { align: "center" });
        doc.moveDown(1.5);

        // Items
        doc.fontSize(12).font("Helvetica-Bold").fillColor("#000");
        for (const item of items) {
          const itemTitle = typeof item.title === "string" ? item.title : typeof item.name === "string" ? item.name : "Item";
          const itemDesc = typeof item.description === "string" ? item.description : typeof item.body === "string" ? item.body : "";

          doc.moveDown(0.75);
          doc.fontSize(11).font("Helvetica-Bold").text(itemTitle, { underline: true });
          doc.moveDown(0.25);

          if (itemDesc) {
            doc.fontSize(9).font("Helvetica").fillColor("#333").text(itemDesc, {
              width: doc.page.width - 100,
              align: "justify",
            });
          }

          // Add a thin separator
          doc.moveDown(0.25);
          doc.fontSize(7).fillColor("#ccc").text("─".repeat(80));
          doc.fillColor("#000");

          // Page break safeguard — if we're near the bottom, start a new page
          if (doc.y > doc.page.height - 120) {
            doc.addPage();
          }
        }

        doc.end();
      });

      const pdfBuffer = Buffer.concat(buffers);

      await report(90, "PDF rendered — storing…");
      // In production, upload pdfBuffer to blob storage (S3 etc.) and return a URL.
      // For now we store the buffer as a base64 data-URL so the client can
      // download it directly from the job result.
      const base64 = pdfBuffer.toString("base64");

      await report(100, "Export complete");
      return {
        kind: "pdf",
        title,
        dataUri: `data:application/pdf;base64,${base64}`,
        byteLength: pdfBuffer.length,
        itemCount: items.length,
        generatedAt: new Date().toISOString(),
      };
    },

    [BACKGROUND_JOB_TYPES.EXPORT_ICS]: async ({ payload, report }) => {
      const title = typeof payload.title === "string" ? payload.title : "Trip Calendar";
      await report(50, "Building iCalendar…");
      // Placeholder for the real ICS generator — returns the calendar text
      // that the client can download as a .ics file.
      await sleep(300);
      const events = Array.isArray(payload.events) ? payload.events : [];
      const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Voyonder//Trip Calendar//EN",
        `X-WR-CALNAME:${sanitizeIcsText(title)}`,
        ...events.flatMap((event) => buildVEvent(event as Record<string, unknown>)),
        "END:VCALENDAR",
      ];
      return {
        kind: "ics",
        title,
        calendarText: lines.join("\r\n"),
        eventCount: events.length,
        generatedAt: new Date().toISOString(),
      };
    },
  };

  async function claimQueuedJobs(): Promise<Array<typeof backgroundJobs.$inferSelect>> {
    // Claim up to batchSize queued jobs, skipping rows locked by other workers.
    // NOTE: deliberately NOT filtered by known job types — a job whose type has
    // no registered processor must still be claimed so processJob() can fail it
    // with "No processor registered" instead of leaving it queued forever.
    const rows = await db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.status, "queued"))
      .orderBy(backgroundJobs.createdAt)
      .limit(batchSize)
      .for("update", { skipLocked: true });

    return rows;
  }

  async function processJob(row: typeof backgroundJobs.$inferSelect) {
    const processor = processors[row.jobType];
    if (!processor) {
      logger.warn({ jobId: row.id, jobType: row.jobType }, "No processor registered for background job type");
      await svc.update(row.id, row.companyId, {
        status: "failed",
        error: `No processor registered for job type ${row.jobType}`,
        finishedAt: new Date(),
      });
      return;
    }

    const startedAt = new Date();
    await svc.update(row.id, row.companyId, {
      status: "running",
      startedAt,
      progress: 5,
      progressMessage: "Starting…",
    });

    const report = async (progress: number, message: string) => {
      await svc.update(row.id, row.companyId, { progress, progressMessage: message });
    };

    try {
      const result = await processor({
        db,
        companyId: row.companyId,
        jobId: row.id,
        payload: row.payload,
        report,
      });
      const finishedAt = new Date();
      await svc.update(row.id, row.companyId, {
        status: "succeeded",
        result,
        progress: 100,
        progressMessage: "Complete",
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      });
      logger.info({ jobId: row.id, jobType: row.jobType }, "Background job succeeded");
    } catch (err) {
      const finishedAt = new Date();
      const message = err instanceof Error ? err.message : String(err);
      await svc.update(row.id, row.companyId, {
        status: "failed",
        error: message,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      });
      logger.error({ err, jobId: row.id, jobType: row.jobType }, "Background job failed");
    }
  }

  async function tick() {
    if (stopped) return;
    if (inFlight >= batchSize) return;
    try {
      const rows = await claimQueuedJobs();
      inFlight += rows.length;
      await Promise.all(rows.map((row) => processJob(row).finally(() => { inFlight -= 1; })));
    } catch (err) {
      logger.error({ err }, "Background job worker tick failed");
    }
  }

  return {
    start: () => {
      if (timer) return;
      stopped = false;
      timer = setInterval(() => void tick(), pollIntervalMs);
      timer.unref?.();
      void tick();
      logger.info({ pollIntervalMs, batchSize }, "Background job worker started");
    },
    stop: () => {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      logger.info("Background job worker stopped");
    },
    /** Exposed for tests — runs one poll cycle. */
    tick,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeIcsText(value: string): string {
  return value.replace(/[\\;,]/g, (match) => `\\${match}`).replace(/\r?\n/g, "\\n");
}

function buildVEvent(event: Record<string, unknown>): string[] {
  const title = typeof event.title === "string" ? event.title : "Trip event";
  const start = typeof event.start === "string" ? event.start : undefined;
  const end = typeof event.end === "string" ? event.end : undefined;
  const location = typeof event.location === "string" ? event.location : undefined;
  const description = typeof event.description === "string" ? event.description : undefined;

  const lines = ["BEGIN:VEVENT", `SUMMARY:${sanitizeIcsText(title)}`];
  if (start) lines.push(`DTSTART:${toIcsDate(start)}`);
  if (end) lines.push(`DTEND:${toIcsDate(end)}`);
  if (location) lines.push(`LOCATION:${sanitizeIcsText(location)}`);
  if (description) lines.push(`DESCRIPTION:${sanitizeIcsText(description)}`);
  lines.push("END:VEVENT");
  return lines;
}

function toIcsDate(value: string): string {
  // Accept ISO strings; convert to UTC basic format YYYYMMDDTHHMMSSZ
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/[-:]/g, "").replace(/\.\d{3}Z?$/, "Z");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export type BackgroundJobWorker = ReturnType<typeof createBackgroundJobWorker>;
