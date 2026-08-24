import { createHash } from "node:crypto";
import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { backgroundJobs } from "@paperclipai/db";
import { BACKGROUND_JOB_TYPES, type BackgroundJobType } from "@paperclipai/shared";
import { backgroundJobService } from "./background-jobs.js";
import { researchSearchService } from "./research-search.js";
import { publishLiveEvent } from "./live-events.js";
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
 * claim uses `FOR UPDATE SKIP LOCKED` inside a transaction, so two workers
 * never process the same job.
 */

export interface BackgroundJobWorkerOptions {
  /** Poll interval in ms. Default 2000. */
  pollIntervalMs?: number;
  /** Max jobs claimed per tick. Default 5. */
  batchSize?: number;
  /** Per-processor timeout in ms. Default 5 minutes. */
  processorTimeoutMs?: number;
  /** Max retries for transient processor failures. Default 2. */
  maxRetries?: number;
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
  const processorTimeoutMs = options?.processorTimeoutMs ?? 300_000; // 5 min default
  const maxRetries = options?.maxRetries ?? 2;
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
      const candidateIds = Array.isArray(payload.candidateIds)
        ? payload.candidateIds.filter((id): id is string => typeof id === "string")
        : undefined;

      await report(20, "Keyword pass complete — upgrading with semantic ranking…");
      const result = await research.upgradeSemanticResults(companyId, { query, scope, limit, candidateIds });
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
    // The claim + status update MUST be inside a transaction: in auto-commit mode
    // (postgres-js default), FOR UPDATE SKIP LOCKED releases row locks as soon as
    // the SELECT completes — before the subsequent UPDATE to status='running'.
    // Wrapping both in a single transaction ensures atomic claim ownership.
    // NOTE: deliberately NOT filtered by known job types — a job whose type has
    // no registered processor must still be claimed so processJob() can fail it
    // with "No processor registered" instead of leaving it queued forever.
    const rows = await db.transaction(async (tx) => {
      const claimed = await tx
        .select()
        .from(backgroundJobs)
        .where(eq(backgroundJobs.status, "queued"))
        .orderBy(backgroundJobs.createdAt)
        .limit(batchSize)
        .for("update", { skipLocked: true });

      if (claimed.length > 0) {
        const claimedIds = claimed.map((r) => r.id);
        await tx
          .update(backgroundJobs)
          .set({
            status: "running",
            startedAt: new Date(),
            progress: 5,
            progressMessage: "Starting…",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(backgroundJobs.status, "queued"),
              inArray(backgroundJobs.id, claimedIds),
            ),
          );
        // Mark the claimed rows as running in-memory for the caller.
        for (const row of claimed) {
          row.status = "running";
        }
      }

      return claimed;
    });

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

    // Run the processor with a timeout to prevent stuck jobs from blocking
    // the worker permanently. Uses Promise.race — the processor promise is
    // the primary; the timeout signal rejects after processorTimeoutMs.
    const processorWithTimeout = async (): Promise<Record<string, unknown>> => {
      let timeout: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<Record<string, unknown>>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Processor timed out after ${processorTimeoutMs}ms`));
        }, processorTimeoutMs);
      });

      try {
        const result = await Promise.race([
          processor({
            db,
            companyId: row.companyId,
            jobId: row.id,
            payload: row.payload,
            report,
          }),
          timeoutPromise,
        ]);
        return result;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    };

    // Retry loop for transient failures.
    let lastError: Error | null = null;
    let attempt = 0;
    const maxAttempts = 1 + maxRetries; // first attempt + retries

    while (attempt < maxAttempts) {
      attempt++;
      try {
        const result = await processorWithTimeout();
        const finishedAt = new Date();
        await svc.update(row.id, row.companyId, {
          status: "succeeded",
          result,
          progress: 100,
          progressMessage: "Complete",
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
        });
        logger.info({ jobId: row.id, jobType: row.jobType, attempt }, "Background job succeeded");
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxAttempts) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30_000); // exponential backoff, cap at 30s
          logger.warn(
            { err, jobId: row.id, jobType: row.jobType, attempt, maxAttempts, delayMs: delay },
            "Background job attempt failed, will retry",
          );
          await svc.update(row.id, row.companyId, {
            progress: Math.min(95, 5 + attempt * 20),
            progressMessage: `Failed (attempt ${attempt}/${maxAttempts}) — retrying…`,
          });
          await sleep(delay);
        }
      }
    }

    // All attempts exhausted — mark permanently failed.
    const finishedAt = new Date();
    const message = lastError?.message ?? "Unknown error";
    await svc.update(row.id, row.companyId, {
      status: "failed",
      error: message,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    });
    logger.error({ err: lastError, jobId: row.id, jobType: row.jobType, attempts: attempt }, "Background job failed after all retries");
  }

  async function requeueStaleJobs() {
    // Requeue jobs stuck in `running` for longer than processorTimeoutMs + 30s
    // grace period. Covers worker crashes or hard restarts that left claimed
    // jobs orphaned, preventing the eternal spinner in the UI tray.
    // Also handles the case where emitEvent failure after a successful DB
    // update orphaned a job in `running` state.
    try {
      const staleGracePeriod = processorTimeoutMs + 30_000;
      const staleCutoff = new Date(Date.now() - staleGracePeriod);
      const stale = await db
        .update(backgroundJobs)
        .set({
          status: "queued",
          progress: 0,
          progressMessage: null,
          startedAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(backgroundJobs.status, "running"),
            isNotNull(backgroundJobs.startedAt),
            lt(backgroundJobs.startedAt, staleCutoff),
          ),
        )
        .returning();
      if (stale.length > 0) {
        logger.info({ count: stale.length, staleCutoff }, "Requeued stale-running background jobs");
        // Emit live events for each requeued job so the UI tray can react.
        for (const r of stale) {
          try {
            publishLiveEvent({
              companyId: r.companyId,
              type: "background_job.status",
              payload: {
                jobId: r.id,
                companyId: r.companyId,
                status: "queued",
                progress: 0,
                progressMessage: null,
                updatedAt: r.updatedAt.toISOString(),
              },
            });
          } catch {
            // Best-effort — the tray catches up on next poll.
          }
        }
      }
    } catch (err) {
      logger.error({ err }, "Failed to requeue stale-running jobs — continuing");
    }
  }

  let ticking = false;

  async function tick() {
    if (stopped || ticking) return;
    ticking = true;
    try {
      const rows = await claimQueuedJobs();
      inFlight += rows.length;
      await Promise.all(rows.map((row) => processJob(row).finally(() => { inFlight -= 1; })));
    } catch (err) {
      logger.error({ err }, "Background job worker tick failed");
    } finally {
      ticking = false;
    }
  }

  return {
    start: async () => {
      if (timer) return;
      stopped = false;

      // Startup sweep: requeue jobs stuck in `running` for longer than
      // processorTimeoutMs + 30s grace period. This covers worker crashes
      // or hard restarts that left claimed jobs orphaned, preventing the
      // eternal spinner in the UI tray.
      await requeueStaleJobs();

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
    /** Graceful shutdown — waits for in-flight jobs up to the given timeout. */
    shutdown: async (gracePeriodMs = 30_000) => {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (inFlight === 0) {
        logger.info("Background job worker shut down (no in-flight jobs)");
        return;
      }
      logger.info({ inFlight, gracePeriodMs }, "Background job worker waiting for in-flight jobs to complete…");
      const deadline = Date.now() + gracePeriodMs;
      while (inFlight > 0 && Date.now() < deadline) {
        await sleep(200);
      }
      if (inFlight > 0) {
        logger.warn({ inFlight, elapsed: gracePeriodMs }, "Background job worker shutdown timed out — in-flight jobs abandoned");
      } else {
        logger.info("Background job worker shut down gracefully");
      }
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

  // Deterministic UID derived from the event's identity so re-exports of the
  // same trip produce the same UID. Calendar clients (Google/Apple) use UID to
  // match events for update/dedup on re-import — random UIDs would create
  // duplicate events every time the user re-exports. A 64-bit hex hash keeps
  // the UID short while remaining collision-safe for a trip's event set.
  const uidHash = createHash("sha256")
    .update([title, start ?? "", end ?? ""].join("|"))
    .digest("hex")
    .slice(0, 16);

  const lines = [
    "BEGIN:VEVENT",
    `UID:${uidHash}@voyonder.com`,
    `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
    `SUMMARY:${sanitizeIcsText(title)}`,
  ];
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
