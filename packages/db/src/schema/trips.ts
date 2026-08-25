import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

/**
 * `trips` table — represents a planned trip with destinations, dates,
 * and a state machine tracking its lifecycle.
 *
 * Status values:
 * - `draft` — trip is being created, no research started
 * - `researching` — actively gathering research data
 * - `planning` — research complete, generating itinerary
 * - `confirmed` — itinerary finalized
 * - `cancelled` — trip abandoned
 *
 * @see doc/plans/2026-08-25-research-deep-dive-tech-plan.md
 */
export const trips = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Company scope. */
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),

    // --- Trip dates ---
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),

    // --- Destinations ---
    destinations: jsonb("destinations").$type<TripDestination[]>().notNull().default([]),

    // --- Status ---
    status: text("status").notNull().default("draft"),

    // --- Links to research ---
    primaryResearchQueryId: uuid("primary_research_query_id"),

    // --- Provenance ---
    createdByActorId: text("created_by_actor_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("trips_company_idx").on(table.companyId),
    statusIdx: index("trips_status_idx").on(table.status),
  }),
);

export type Trip = typeof trips.$inferSelect;
export type NewTrip = typeof trips.$inferInsert;

/** A destination within a trip plan. */
export interface TripDestination {
  name: string;
  /** Airport code, city name, or point of interest. */
  location: string;
  lat?: number;
  lng?: number;
  /** ISO country code. */
  country?: string;
  checkIn?: string;
  checkOut?: string;
}
