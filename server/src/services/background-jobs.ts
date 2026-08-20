import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { backgroundJobs } from "@paperclipai/db";
import type { BackgroundJobStatus } from "@paperclipai/shared";
import { publishLiveEvent } from "./live-events.js";

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
  function toApi(row: typeof backgroundJobs.$inferSelect) {
    return {
      id: row.id,
      companyId: row.companyId,
      jobType: row.jobType,
      status: row.status as BackgroundJobStatus,
      payload: row.payload,
      result: row.result,
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
    publishLiveEvent({
      companyId: row.companyId,
      type: "background_job.status",
      payload: {
        jobId: row.id,
        companyId: row.companyId,
        status: row.status,
        progress: row.progress,
        progressMessage: row.progressMessage,
        result: row.result,
        error: row.error,
        durationMs: row.durationMs,
        startedAt: row.startedAt?.toISOString() ?? null,
        finishedAt: row.finishedAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(),
      },
    });
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
      emitEvent(row);
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
      return rows.map(toApi);
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
        .where(and(eq(backgroundJobs.id, id), eq(backgroundJobs.companyId, companyId)))
        .returning();

      if (row) emitEvent(row);
      return row ? toApi(row) : null;
    },
  };
}

export type BackgroundJobService = ReturnType<typeof backgroundJobService>;