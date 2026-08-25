import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  researchArtifacts,
  researchQueries,
  trips,
  type NewResearchArtifact,
  type NewResearchQuery,
  type NewTrip,
  type ResearchArtifact,
  type ResearchQuery,
  type Trip,
  type ResolvedEntity,
} from "@paperclipai/db";
import { badRequest, notFound } from "../errors.js";

/**
 * Research artifact store service — CRUD operations for research artifacts,
 * queries, and trips.
 *
 * All functions enforce company isolation and proper status transitions.
 *
 * @see doc/plans/2026-08-25-research-deep-dive-tech-plan.md
 */

export function researchArtifactService(db: Db) {
  // -----------------------------------------------------------------------
  // Research Queries
  // -----------------------------------------------------------------------

  /**
   * Create a new research query in the `pending` state.
   * Returns the created query record.
   */
  async function createQuery(
    companyId: string,
    data: {
      rawQuery: string;
      tripId?: string;
      createdByActorId?: string;
    },
  ): Promise<ResearchQuery> {
    if (!data.rawQuery || data.rawQuery.length > 500) {
      throw badRequest("Query must be between 1 and 500 characters");
    }

    const [query] = await db
      .insert(researchQueries)
      .values({
        companyId: companyId,
        rawQuery: data.rawQuery,
        normalizedQuery: data.rawQuery.trim().toLowerCase().replace(/\s+/g, " "),
        tripId: data.tripId ?? null,
        status: "pending",
        createdByActorId: data.createdByActorId ?? null,
      })
      .returning();

    return query;
  }

  /**
   * Update entities on a query and transition status to `resolving`.
   */
  async function setQueryEntities(
    companyId: string,
    queryId: string,
    entities: ResolvedEntity[],
  ): Promise<void> {
    await db
      .update(researchQueries)
      .set({
        entities: entities as any,
        status: "resolving",
        updatedAt: sql`now()`,
      })
      .where(and(eq(researchQueries.id, queryId), eq(researchQueries.companyId, companyId)));
  }

  /**
   * Get a research query by ID, scoped to company.
   */
  async function getQuery(companyId: string, queryId: string): Promise<ResearchQuery | null> {
    const [query] = await db
      .select()
      .from(researchQueries)
      .where(and(eq(researchQueries.id, queryId), eq(researchQueries.companyId, companyId)))
      .limit(1);

    return query ?? null;
  }

  /**
   * List research queries for a company, optionally filtered by trip and status.
   */
  async function listQueries(
    companyId: string,
    options?: {
      tripId?: string;
      status?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<ResearchQuery[]> {
    const conditions = [eq(researchQueries.companyId, companyId)];

    if (options?.tripId) {
      conditions.push(eq(researchQueries.tripId, options.tripId));
    }
    if (options?.status) {
      conditions.push(eq(researchQueries.status, options.status));
    }

    return db
      .select()
      .from(researchQueries)
      .where(and(...conditions))
      .orderBy(desc(researchQueries.createdAt))
      .limit(options?.limit ?? 50)
      .offset(options?.offset ?? 0);
  }

  /**
   * Update a research query's status with validation.
   */
  async function updateQueryStatus(
    companyId: string,
    queryId: string,
    status: ResearchQuery["status"],
  ): Promise<ResearchQuery> {
    const query = await getQuery(companyId, queryId);
    if (!query) throw notFound("Research query not found");

    validateQueryTransition(query.status, status);

    const [updated] = await db
      .update(researchQueries)
      .set({ status, updatedAt: sql`now()` })
      .where(and(eq(researchQueries.id, queryId), eq(researchQueries.companyId, companyId)))
      .returning();

    return updated;
  }

  /**
   * Link a background job to a research query.
   */
  async function linkQueryJob(companyId: string, queryId: string, jobId: string): Promise<void> {
    await db
      .update(researchQueries)
      .set({ jobId, updatedAt: sql`now()` })
      .where(and(eq(researchQueries.id, queryId), eq(researchQueries.companyId, companyId)));
  }

  // -----------------------------------------------------------------------
  // Research Artifacts
  // -----------------------------------------------------------------------

  /**
   * Create a new research artifact.
   */
  async function createArtifact(
    companyId: string,
    data: Omit<NewResearchArtifact, "id" | "createdAt" | "updatedAt">,
  ): Promise<ResearchArtifact> {
    // Validate source type
    const validSources = ["web", "email", "portal", "manual"];
    if (!validSources.includes(data.sourceType)) {
      throw badRequest(`Invalid source type. Must be one of: ${validSources.join(", ")}`);
    }

    // Check dedup: if same checksum exists for this company, update fetchedAt instead
    if (data.checksum) {
      const existing = await findArtifactByChecksum(companyId, data.checksum);
      if (existing) {
        const [updated] = await db
          .update(researchArtifacts)
          .set({ fetchedAt: sql`now()`, updatedAt: sql`now()` })
          .where(eq(researchArtifacts.id, existing.id))
          .returning();
        return updated;
      }
    }

    const [artifact] = await db
      .insert(researchArtifacts)
      .values({
        companyId: companyId,
        tripId: data.tripId ?? null,
        researchQueryId: data.researchQueryId ?? null,
        entities: (data.entities ?? []) as any,
        sourceType: data.sourceType,
        sourceUrl: data.sourceUrl ?? null,
        sourceName: data.sourceName ?? null,
        title: data.title,
        snippet: data.snippet ?? null,
        body: data.body ?? null,
        confidence: data.confidence ?? null,
        relevanceScore: data.relevanceScore ?? null,
        checksum: data.checksum ?? null,
        status: data.status ?? "pending",
        createdByActorId: data.createdByActorId ?? null,
      })
      .returning();

    return artifact;
  }

  /**
   * Get a research artifact by ID, scoped to company.
   */
  async function getArtifact(companyId: string, artifactId: string): Promise<ResearchArtifact | null> {
    const [artifact] = await db
      .select()
      .from(researchArtifacts)
      .where(
        and(eq(researchArtifacts.id, artifactId), eq(researchArtifacts.companyId, companyId)),
      )
      .limit(1);

    return artifact ?? null;
  }

  /**
   * List research artifacts, filterable by trip, source type, and status.
   */
  async function listArtifacts(
    companyId: string,
    options?: {
      tripId?: string;
      sourceType?: string;
      status?: string;
      researchQueryId?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<ResearchArtifact[]> {
    const conditions = [eq(researchArtifacts.companyId, companyId)];

    if (options?.tripId) conditions.push(eq(researchArtifacts.tripId, options.tripId));
    if (options?.sourceType) conditions.push(eq(researchArtifacts.sourceType, options.sourceType));
    if (options?.status) conditions.push(eq(researchArtifacts.status, options.status));
    if (options?.researchQueryId) conditions.push(eq(researchArtifacts.researchQueryId, options.researchQueryId));

    return db
      .select()
      .from(researchArtifacts)
      .where(and(...conditions))
      .orderBy(desc(researchArtifacts.relevanceScore), desc(researchArtifacts.fetchedAt))
      .limit(options?.limit ?? 50)
      .offset(options?.offset ?? 0);
  }

  /**
   * Update an artifact's status (accept/reject).
   */
  async function updateArtifactStatus(
    companyId: string,
    artifactId: string,
    status: ResearchArtifact["status"],
  ): Promise<ResearchArtifact> {
    const validStatuses = ["pending", "verified", "rejected"];
    if (!validStatuses.includes(status)) {
      throw badRequest(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
    }

    const [updated] = await db
      .update(researchArtifacts)
      .set({ status, updatedAt: sql`now()` })
      .where(
        and(eq(researchArtifacts.id, artifactId), eq(researchArtifacts.companyId, companyId)),
      )
      .returning();

    if (!updated) throw notFound("Research artifact not found");
    return updated;
  }

  /**
   * Soft-delete (reject) an artifact.
   */
  async function deleteArtifact(companyId: string, artifactId: string): Promise<void> {
    const [updated] = await db
      .update(researchArtifacts)
      .set({ status: "rejected", updatedAt: sql`now()` })
      .where(
        and(eq(researchArtifacts.id, artifactId), eq(researchArtifacts.companyId, companyId)),
      )
      .returning();

    if (!updated) throw notFound("Research artifact not found");
  }

  /**
   * Find an artifact by checksum for dedup (company-scoped).
   */
  async function findArtifactByChecksum(
    companyId: string,
    checksum: string,
  ): Promise<ResearchArtifact | null> {
    const [existing] = await db
      .select()
      .from(researchArtifacts)
      .where(
        and(eq(researchArtifacts.checksum, checksum), eq(researchArtifacts.companyId, companyId)),
      )
      .limit(1);

    return existing ?? null;
  }

  // -----------------------------------------------------------------------
  // Trips
  // -----------------------------------------------------------------------

  /**
   * Create a new trip in `draft` status.
   */
  async function createTrip(
    companyId: string,
    data: {
      title: string;
      description?: string;
      startDate?: string;
      endDate?: string;
      createdByActorId?: string;
    },
  ): Promise<Trip> {
    if (!data.title || data.title.length > 200) {
      throw badRequest("Trip title must be between 1 and 200 characters");
    }

    const [trip] = await db
      .insert(trips)
      .values({
        companyId,
        title: data.title,
        description: data.description ?? null,
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
        createdByActorId: data.createdByActorId,
      })
      .returning();

    return trip;
  }

  /**
   * Get a trip by ID, scoped to company.
   */
  async function getTrip(companyId: string, tripId: string): Promise<Trip | null> {
    const [trip] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.companyId, companyId)))
      .limit(1);

    return trip ?? null;
  }

  /**
   * List trips for a company, optionally filtered by status.
   */
  async function listTrips(
    companyId: string,
    options?: {
      status?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<Trip[]> {
    const conditions = [eq(trips.companyId, companyId)];

    if (options?.status) {
      conditions.push(eq(trips.status, options.status));
    }

    return db
      .select()
      .from(trips)
      .where(and(...conditions))
      .orderBy(desc(trips.createdAt))
      .limit(options?.limit ?? 50)
      .offset(options?.offset ?? 0);
  }

  /**
   * Update a trip's status with validation.
   */
  async function updateTripStatus(
    companyId: string,
    tripId: string,
    status: Trip["status"],
  ): Promise<Trip> {
    const trip = await getTrip(companyId, tripId);
    if (!trip) throw notFound("Trip not found");

    validateTripTransition(trip.status, status);

    const [updated] = await db
      .update(trips)
      .set({ status, updatedAt: sql`now()` })
      .where(and(eq(trips.id, tripId), eq(trips.companyId, companyId)))
      .returning();

    return updated;
  }

  /**
   * Update trip details.
   */
  async function updateTrip(
    companyId: string,
    tripId: string,
    data: {
      title?: string;
      description?: string;
      startDate?: string;
      endDate?: string;
    },
  ): Promise<Trip> {
    const updateData: Record<string, unknown> = { updatedAt: sql`now()` };

    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate);
    if (data.endDate !== undefined) updateData.endDate = new Date(data.endDate);

    const [updated] = await db
      .update(trips)
      .set(updateData)
      .where(and(eq(trips.id, tripId), eq(trips.companyId, companyId)))
      .returning();

    if (!updated) throw notFound("Trip not found");
    return updated;
  }

  /**
   * Delete a trip (soft-delete via status change).
   */
  async function deleteTrip(companyId: string, tripId: string): Promise<void> {
    const [updated] = await db
      .update(trips)
      .set({ status: "cancelled", updatedAt: sql`now()` })
      .where(and(eq(trips.id, tripId), eq(trips.companyId, companyId)))
      .returning();

    if (!updated) throw notFound("Trip not found");
  }

  // -----------------------------------------------------------------------
  // Status transition validation
  // -----------------------------------------------------------------------

  const VALID_QUERY_TRANSITIONS: Record<string, string[]> = {
    pending: ["resolving", "failed"],
    resolving: ["gathering", "failed"],
    gathering: ["complete", "failed"],
    complete: [],
    failed: ["pending"], // allow retry
  };

  const VALID_TRIP_TRANSITIONS: Record<string, string[]> = {
    draft: ["researching", "cancelled"],
    researching: ["planning", "draft", "cancelled"],
    planning: ["confirmed", "researching", "cancelled"],
    confirmed: ["cancelled"],
    cancelled: ["draft"], // allow restart
  };

  function validateQueryTransition(from: string, to: string): void {
    const allowed = VALID_QUERY_TRANSITIONS[from];
    if (!allowed?.includes(to)) {
      throw badRequest(`Invalid query status transition: ${from} → ${to}`);
    }
  }

  function validateTripTransition(from: string, to: string): void {
    const allowed = VALID_TRIP_TRANSITIONS[from];
    if (!allowed?.includes(to)) {
      throw badRequest(`Invalid trip status transition: ${from} → ${to}`);
    }
  }

  return {
    // Queries
    createQuery,
    getQuery,
    listQueries,
    updateQueryStatus,
    linkQueryJob,
    setQueryEntities,
    // Artifacts
    createArtifact,
    getArtifact,
    listArtifacts,
    updateArtifactStatus,
    deleteArtifact,
    findArtifactByChecksum,
    // Trips
    createTrip,
    getTrip,
    listTrips,
    updateTripStatus,
    updateTrip,
    deleteTrip,
  };
}

export type ResearchArtifactService = ReturnType<typeof researchArtifactService>;
