/**
 * API client for research trip endpoints.
 *
 * Mounted under /api/companies/:companyId/research/trips in the Paperclip
 * server (see server/src/routes/research-artifacts.ts).
 */
import { api } from "./client";

// ── Types ────────────────────────────────────────────────────────────────────

export interface TripDestination {
  name: string;
  location: string;
  lat?: number;
  lng?: number;
  country?: string;
  checkIn?: string;
  checkOut?: string;
}

export interface Trip {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  destinations: TripDestination[];
  status: "draft" | "researching" | "planning" | "confirmed" | "cancelled";
  primaryResearchQueryId: string | null;
  createdByActorId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTripRequest {
  title: string;
  description?: string;
  startDate?: string;
  endDate?: string;
}

export interface UpdateTripRequest {
  title?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
}

export interface ResearchQuery {
  id: string;
  companyId: string;
  tripId: string | null;
  rawQuery: string;
  normalizedQuery: string;
  status: "pending" | "resolving" | "gathering" | "complete" | "failed";
  entities: ResolvedEntity[];
  searchPlan: SearchPlanEntry[];
  jobId: string | null;
  error: string | null;
  createdByActorId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedEntity {
  type: string;
  value: string;
  confidence: number;
}

export interface SearchPlanEntry {
  source: "web" | "email" | "portal";
  query: string;
  priority: number;
}

export interface ResearchArtifact {
  id: string;
  companyId: string;
  tripId: string | null;
  researchQueryId: string | null;
  sourceType: "web" | "email" | "portal" | "manual";
  sourceUrl: string | null;
  sourceName: string | null;
  title: string;
  snippet: string | null;
  body: string | null;
  confidence: number | null;
  relevanceScore: number | null;
  checksum: string | null;
  status: "pending" | "verified" | "rejected";
  fetchedAt: string | null;
  createdByActorId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── API Client ────────────────────────────────────────────────────────────────

export const researchTripsApi = {
  // ── Trips ──
  list: (companyId: string, opts?: { status?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.status) params.set("status", opts.status);
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    if (opts?.offset !== undefined) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return api.get<{ trips: Trip[] }>(
      `/companies/${companyId}/research/trips${qs ? `?${qs}` : ""}`,
    );
  },

  get: (companyId: string, tripId: string) =>
    api.get<{ trip: Trip }>(`/companies/${companyId}/research/trips/${tripId}`),

  create: (companyId: string, data: CreateTripRequest) =>
    api.post<{ trip: Trip }>(`/companies/${companyId}/research/trips`, data),

  update: (companyId: string, tripId: string, data: UpdateTripRequest) =>
    api.patch<{ trip: Trip }>(`/companies/${companyId}/research/trips/${tripId}`, data),

  updateStatus: (companyId: string, tripId: string, status: Trip["status"]) =>
    api.patch<{ trip: Trip }>(
      `/companies/${companyId}/research/trips/${tripId}`,
      { status },
    ),

  delete: (companyId: string, tripId: string) =>
    api.delete<void>(`/companies/${companyId}/research/trips/${tripId}`),

  // ── Research Queries ──
  submitQuery: (companyId: string, data: { query: string; tripId?: string }) =>
    api.post<{ queryId: string; jobId: string }>(
      `/companies/${companyId}/research/queries`,
      data,
    ),

  listQueries: (companyId: string, opts?: { tripId?: string; status?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.tripId) params.set("tripId", opts.tripId);
    if (opts?.status) params.set("status", opts.status);
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    if (opts?.offset !== undefined) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return api.get<{ queries: ResearchQuery[] }>(
      `/companies/${companyId}/research/queries${qs ? `?${qs}` : ""}`,
    );
  },

  getQuery: (companyId: string, queryId: string) =>
    api.get<{ query: ResearchQuery }>(`/companies/${companyId}/research/queries/${queryId}`),

  // ── Research Artifacts ──
  listArtifacts: (
    companyId: string,
    opts?: { tripId?: string; sourceType?: string; status?: string; researchQueryId?: string; limit?: number; offset?: number },
  ) => {
    const params = new URLSearchParams();
    if (opts?.tripId) params.set("tripId", opts.tripId);
    if (opts?.sourceType) params.set("sourceType", opts.sourceType);
    if (opts?.status) params.set("status", opts.status);
    if (opts?.researchQueryId) params.set("researchQueryId", opts.researchQueryId);
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    if (opts?.offset !== undefined) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return api.get<{ artifacts: ResearchArtifact[] }>(
      `/companies/${companyId}/research/artifacts${qs ? `?${qs}` : ""}`,
    );
  },

  getArtifact: (companyId: string, artifactId: string) =>
    api.get<{ artifact: ResearchArtifact }>(
      `/companies/${companyId}/research/artifacts/${artifactId}`,
    ),

  updateArtifactStatus: (companyId: string, artifactId: string, status: ResearchArtifact["status"]) =>
    api.patch<{ artifact: ResearchArtifact }>(
      `/companies/${companyId}/research/artifacts/${artifactId}`,
      { status },
    ),

  deleteArtifact: (companyId: string, artifactId: string) =>
    api.delete<void>(`/companies/${companyId}/research/artifacts/${artifactId}`),
};
