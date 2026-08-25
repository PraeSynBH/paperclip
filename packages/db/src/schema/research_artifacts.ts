import { pgTable, uuid, text, timestamp, jsonb, integer, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import type { ResolvedEntity } from "./research-types.js";

/**
 * `research_artifacts` table — stores citation results with source metadata,
 * freshness tracking, dedup checksum, and confidence scores.
 *
 * Each row represents a single citation from a source (web, email, portal, manual)
 * that was gathered in response to a research query.
 *
 * @see doc/plans/2026-08-25-research-deep-dive-tech-plan.md
 */
export const researchArtifacts = pgTable(
  "research_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Company scope. */
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** Optional link to the trip this artifact belongs to. */
    tripId: uuid("trip_id"),
    /** Link to the research query that produced this artifact. */
    researchQueryId: uuid("research_query_id"),

    // --- Resolved entities from NL parsing ---
    entities: jsonb("entities").$type<ResolvedEntity[]>().notNull().default([]),

    // --- Citation source metadata ---
    sourceType: text("source_type").notNull(), // "web", "email", "portal", "manual"
    sourceUrl: text("source_url"),
    sourceName: text("source_name"),
    title: text("title").notNull(),
    snippet: text("snippet"),
    body: text("body"),

    // --- Freshness tracking ---
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    /** When this citation is considered stale. Null = never expires. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    // --- Citation metadata ---
    confidence: integer("confidence"), // 0-100
    relevanceScore: integer("relevance_score"), // 0-100
    /** SHA-256 hash of title + snippet for dedup. */
    checksum: text("checksum"),

    // --- Status ---
    status: text("status").notNull().default("pending"), // pending, verified, rejected

    // --- Provenance ---
    createdByActorId: text("created_by_actor_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("research_artifacts_company_idx").on(table.companyId),
    tripIdx: index("research_artifacts_trip_idx").on(table.tripId),
    queryIdx: index("research_artifacts_query_idx").on(table.researchQueryId),
    sourceTypeIdx: index("research_artifacts_source_type_idx").on(table.sourceType),
    checksumIdx: index("research_artifacts_checksum_idx").on(table.checksum),
  }),
);

export type ResearchArtifact = typeof researchArtifacts.$inferSelect;
export type NewResearchArtifact = typeof researchArtifacts.$inferInsert;
