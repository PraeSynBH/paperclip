import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { memoryExtractionJobs } from "@paperclipai/db";
import { notFound, badRequest } from "../errors.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ExtractionJobResponse {
  id: string;
  companyId: string;
  bindingId: string;
  operationId: string | null;
  providerJobId: string;
  hookKind: string;
  status: string;
  errorMessage: string | null;
  submittedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ExtractionJobListOptions {
  companyId: string;
  status?: string;
  limit?: number;
}

// ─── Service Factory ─────────────────────────────────────────────────────────

export function memoryExtractionJobService(db: Db) {
  function rowToResponse(
    row: typeof memoryExtractionJobs.$inferSelect,
  ): ExtractionJobResponse {
    return {
      id: row.id,
      companyId: row.companyId,
      bindingId: row.bindingId,
      operationId: row.operationId ?? null,
      providerJobId: row.providerJobId,
      hookKind: row.hookKind,
      status: row.status,
      errorMessage: row.errorMessage ?? null,
      submittedAt: row.submittedAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
    };
  }

  /**
   * List extraction jobs for a company, newest first.
   * Supports optional status filter and limit.
   */
  async function list(
    options: ExtractionJobListOptions,
  ): Promise<ExtractionJobResponse[]> {
    const limit = Math.min(options.limit ?? 50, 200);

    const conditions = [eq(memoryExtractionJobs.companyId, options.companyId)];
    if (options.status) {
      conditions.push(eq(memoryExtractionJobs.status, options.status));
    }

    const rows = await db
      .select()
      .from(memoryExtractionJobs)
      .where(and(...conditions))
      .orderBy(desc(memoryExtractionJobs.submittedAt))
      .limit(limit);

    return rows.map(rowToResponse);
  }

  /**
   * Get a single extraction job by ID, scoped to a company.
   */
  async function getById(
    companyId: string,
    jobId: string,
  ): Promise<ExtractionJobResponse> {
    const rows = await db
      .select()
      .from(memoryExtractionJobs)
      .where(
        and(
          eq(memoryExtractionJobs.id, jobId),
          eq(memoryExtractionJobs.companyId, companyId),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      throw notFound("Extraction job not found");
    }

    return rowToResponse(rows[0]);
  }

  /**
   * Retry a failed extraction job by resetting its status to "queued"
   * and clearing the error message and timing fields.
   * Only jobs with status "failed" can be retried.
   */
  async function retry(
    companyId: string,
    jobId: string,
  ): Promise<ExtractionJobResponse> {
    const job = await getById(companyId, jobId);

    if (job.status !== "failed") {
      throw badRequest(
        `Cannot retry extraction job with status "${job.status}". Only failed jobs can be retried.`,
      );
    }

    const [updated] = await db
      .update(memoryExtractionJobs)
      .set({
        status: "queued",
        errorMessage: null,
        startedAt: null,
        finishedAt: null,
      })
      .where(
        and(
          eq(memoryExtractionJobs.id, jobId),
          eq(memoryExtractionJobs.companyId, companyId),
          eq(memoryExtractionJobs.status, "failed"),
        ),
      )
      .returning();

    if (!updated) {
      // Either the job doesn't exist, or its status was changed concurrently
      // from "failed" by another retry call. Throw conflict rather than
      // silently accepting the second transition.
      throw badRequest(
        `Cannot retry extraction job "${jobId}": job not found or status already changed from "failed".`,
      );
    }

    return rowToResponse(updated);
  }

  return {
    list,
    getById,
    retry,
  };
}

export type MemoryExtractionJobService = ReturnType<
  typeof memoryExtractionJobService
>;
