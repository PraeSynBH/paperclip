import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { backgroundJobs } from "./background_jobs.js";
import { trips } from "./trips.js";
import type { ResolvedEntity } from "./research-types.js";

/**
 * `research_queries` table — tracks natural language research query lifecycle.
 *
 * Status values:
 * - `pending` — query submitted, awaiting processing
 * - `resolving` — entity resolution in progress
 * - `gathering` — citation gathering in progress
 * - `complete` — all sources queried, artifacts written
 * - `failed` — query processing terminated with error
 *
 * @see doc/plans/2026-08-25-research-deep-dive-tech-plan.md
 */
export const researchQueries = pgTable(
  "research_queries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Company scope. */
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** Optional link to the trip this query is for. */
    tripId: uuid("trip_id").references(() => trips.id, { onDelete: "cascade" }),

    // --- The query ---
    /** Original NL query text. */
    rawQuery: text("raw_query").notNull(),
    /** Normalized/cleaned version of the query. */
    normalizedQuery: text("normalized_query"),

    // --- Resolved entities ---
    entities: jsonb("entities").$type<ResolvedEntity[]>().notNull().default([]),

    // --- Execution tracking ---
    status: text("status").notNull().default("pending"),
    /** Link to the background job processing this query. */
    jobId: uuid("job_id").references(() => backgroundJobs.id, { onDelete: "set null" }),

    // --- Provenance ---
    createdByActorId: text("created_by_actor_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("research_queries_company_idx").on(table.companyId),
    tripIdx: index("research_queries_trip_idx").on(table.tripId),
    statusIdx: index("research_queries_status_idx").on(table.status),
    jobIdx: index("research_queries_job_idx").on(table.jobId),
  }),
);

export type ResearchQuery = typeof researchQueries.$inferSelect;
export type NewResearchQuery = typeof researchQueries.$inferInsert;
