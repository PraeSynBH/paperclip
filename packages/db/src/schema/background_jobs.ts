import { pgTable, uuid, text, timestamp, jsonb, integer, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

/**
 * `background_jobs` table — tracks asynchronous jobs that are
 * executed outside the request-response cycle.
 *
 * Status values:
 * - `queued` — job has been accepted and is waiting to run
 * - `running` — job is currently being processed
 * - `succeeded` — job completed successfully
 * - `failed` — job terminated with an error
 *
 * @see doc/async-jobs.md
 */
export const backgroundJobs = pgTable(
  "background_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Company scope. */
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** Discriminator — e.g. "research.activity_search", "export.csv". */
    jobType: text("job_type").notNull(),
    /** Current lifecycle status. */
    status: text("status").notNull().default("queued"),
    /**
     * Input payload for the job.  Schema depends on `job_type`.
     * Stored as JSON so the job worker can deserialize it.
     */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /**
     * Output result produced by the job.  Written when the job
     * reaches a terminal status (`succeeded`).
     */
    result: jsonb("result").$type<Record<string, unknown>>(),
    /**
     * Error message / stack trace when `status === "failed"`.
     */
    error: text("error"),
    /** Wall-clock duration in milliseconds.  Null until the job finishes. */
    durationMs: integer("duration_ms"),
    /** % progress (0–100).  Updated periodically by the worker. */
    progress: integer("progress").notNull().default(0),
    /** Human-readable message describing current progress. */
    progressMessage: text("progress_message"),
    /** Who created this job (actor identifier). */
    createdByActorId: text("created_by_actor_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("background_jobs_company_status_idx").on(
      table.companyId,
      table.status,
    ),
    companyCreatedIdx: index("background_jobs_company_created_idx").on(
      table.companyId,
      table.createdAt,
    ),
    jobTypeIdx: index("background_jobs_job_type_idx").on(table.jobType),
  }),
);

export type BackgroundJob = typeof backgroundJobs.$inferSelect;
export type NewBackgroundJob = typeof backgroundJobs.$inferInsert;