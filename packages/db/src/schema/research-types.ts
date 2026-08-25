/**
 * Shared types for the research pipeline.
 *
 * These types are used by the DB schemas and the service layer.
 * They are intentionally defined here (not in @paperclipai/shared) because
 * the DB schemas in this package cannot depend on the shared package.
 */

/** A resolved entity extracted from a natural language query. */
export interface ResolvedEntity {
  type: "destination" | "date_range" | "hotel" | "airline" | "budget" | "category" | "people";
  value: string;
  normalized: string;
  confidence: number;
  metadata?: Record<string, unknown>;
}

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
