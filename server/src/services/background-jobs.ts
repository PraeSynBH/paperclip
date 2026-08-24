import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { backgroundJobs } from "@paperclipai/db";
import type { BackgroundJobStatus } from "@paperclipai/shared";
import { publishLiveEvent } from "./live-events.js";
import { logger } from "../middleware/logger.js";

export interface CreateBackgroundJobInput {
  companyId: string;
  jobType: string;
  payload: Record<string, unknown>;
  createdByActorId?: string | null;
}

export interface UpdateBackgroundJobInput {
  status?: BackgroundJobStatus;
  progress?: number;
  progressMessage?: string | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
  durationMs?: number | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}

export function backgroundJobService(db: Db) {
  function toApi(row: typeof backgroundJobs.$inferSelect, slim?: boolean) {
    // Strip large binary result data from list/slim responses to avoid
    // bandwidth amplification on tray polls and DB TOAST bloat on every
    // list query. The full result (including dataUri) is available via
    // the single-job getById() endpoint.
    const result = slim && row.result ? { ...row.result, dataUri: undefined } : row.result;
    return {
      id: row.id,
      companyId: row.companyId,
      jobType: row.jobType,
      status: row.status as BackgroundJobStatus,
      payload: row.payload,
      result,
      error: row.error,
      durationMs: row.durationMs,
      progress: row.progress,
      progressMessage: row.progressMessage,
      createdByActorId: row.createdByActorId,
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  function emitEvent(row: typeof backgroundJobs.$inferSelect) {
    // Strip large binary data from SSE payload — the client uses SSE as a
    // signal to re-fetch via getById(), never reads dataUri from the event.
    // Matches the slim projection in toApi().
    const result = row.result ? { ...row.result, dataUri: undefined } : row.result;
    try {
      publishLiveEvent({
        companyId: row.companyId,
        type: "background_job.status",
        payload: {
          jobId: row.id,
          companyId: row.companyId,
          status: row.status,
          progress: row.progress,
          progressMessage: row.progressMessage,
          result,
          error: row.error,
          durationMs: row.durationMs,
          startedAt: row.startedAt?.toISOString() ?? null,
          finishedAt: row.finishedAt?.toISOString() ?? null,
          updatedAt: row.updatedAt.toISOString(),
        },
      });
    } catch (err) {
      // Live events are best-effort fire-and-forget fan-out: a subscriber
      // throwing must never fail the DB write that already happened. The
      // job state is durable; the UI tray catches up on next poll.
      try {
        logger.warn({ err, jobId: row.id, status: row.status }, "Failed to publish background job live event");
      } catch {
        // Swallow logger failures too — emitEvent must absolutely never throw.
        // The row is already committed; failing here would orphan the job.
      }
    }
  }

  return {
    create: async (input: CreateBackgroundJobInput) => {
      const now = new Date();
      const [row] = await db
        .insert(backgroundJobs)
        .values({
          companyId: input.companyId,
          jobType: input.jobType,
          payload: input.payload,
          createdByActorId: input.createdByActorId ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      // emitEvent must not fail the create — the row is already committed.
      try { emitEvent(row); } catch { /* already logged inside emitEvent */ }
      return toApi(row);
    },

    list: async (
      companyId: string,
      opts?: { limit?: number; offset?: number; status?: BackgroundJobStatus; jobType?: string },
    ) => {
      const conditions = [eq(backgroundJobs.companyId, companyId)];
      if (opts?.status) conditions.push(eq(backgroundJobs.status, opts.status));
      if (opts?.jobType) conditions.push(eq(backgroundJobs.jobType, opts.jobType));

      const rows = await db
        .select()
        .from(backgroundJobs)
        .where(and(...conditions))
        .orderBy(desc(backgroundJobs.createdAt))
        .limit(opts?.limit ?? 50)
        .offset(opts?.offset ?? 0);
      return rows.map((r) => toApi(r, true));
    },

    getById: async (id: string, companyId: string) => {
      const [row] = await db
        .select()
        .from(backgroundJobs)
        .where(and(eq(backgroundJobs.id, id), eq(backgroundJobs.companyId, companyId)))
        .limit(1);
      return row ? toApi(row) : null;
    },

    update: async (id: string, companyId: string, input: UpdateBackgroundJobInput) => {
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.status !== undefined) updates.status = input.status;
      if (input.progress !== undefined) updates.progress = input.progress;
      if (input.progressMessage !== undefined) updates.progressMessage = input.progressMessage;
      if (input.result !== undefined) updates.result = input.result;
      if (input.error !== undefined) updates.error = input.error;
      if (input.durationMs !== undefined) updates.durationMs = input.durationMs;
      if (input.startedAt !== undefined) updates.startedAt = input.startedAt;
      if (input.finishedAt !== undefined) updates.finishedAt = input.finishedAt;

      const [row] = await db
        .update(backgroundJobs)
        .set(updates)
        .where(
          and(
            eq(backgroundJobs.id, id),
            eq(backgroundJobs.companyId, companyId),
            // Never overwrite a terminal status. A job that already reached
            // `succeeded`/`failed` must stay terminal — otherwise a stale
            // retry loop could flip a succeeded job to failed, or a late
            // progress report could resurrect a finished job.
            inArray(backgroundJobs.status, ["queued", "running"]),
          ),
        )
        .returning();

      if (row) {
        // emitEvent must not fail the update — the row is already committed.
        try { emitEvent(row); } catch { /* already logged inside emitEvent */ }
      }
      return row ? toApi(row) : null;
    },
  };
}

export type BackgroundJobService = ReturnType<typeof backgroundJobService>;