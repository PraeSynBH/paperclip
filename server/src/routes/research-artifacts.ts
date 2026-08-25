import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { BACKGROUND_JOB_TYPES } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { researchArtifactService } from "../services/research-artifacts.js";
import { backgroundJobService } from "../services/background-jobs.js";
import { resolveQuery } from "../services/entity-resolver.js";
import { assertVoyonderAuth } from "../services/auth.js";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const createResearchQuerySchema = z.object({
  query: z.string().min(1).max(500),
  tripId: z.string().uuid().optional(),
});

const listArtifactsQuerySchema = z.object({
  tripId: z.string().uuid().optional(),
  sourceType: z.enum(["web", "email", "portal", "manual"]).optional(),
  status: z.enum(["pending", "verified", "rejected"]).optional(),
  researchQueryId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const updateArtifactStatusSchema = z.object({
  status: z.enum(["pending", "verified", "rejected"]),
});

const listQueriesQuerySchema = z.object({
  tripId: z.string().uuid().optional(),
  status: z.enum(["pending", "resolving", "gathering", "complete", "failed"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const createTripSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

const updateTripSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

const updateTripStatusSchema = z.object({
  status: z.enum(["draft", "researching", "planning", "confirmed", "cancelled"]),
});

/**
 * Research artifact REST routes.
 *
 * All endpoints use `assertVoyonderAuth` for authentication (matching the
 * VOY-2171 fix pattern) and enforce company-level data isolation.
 *
 * Endpoints:
 * - POST   /companies/:companyId/research/queries       — Submit NL query
 * - GET    /companies/:companyId/research/queries        — List queries
 * - GET    /companies/:companyId/research/queries/:id    — Get query status
 * - GET    /companies/:companyId/research/artifacts      — List artifacts
 * - GET    /companies/:companyId/research/artifacts/:id  — Get single artifact
 * - PATCH  /companies/:companyId/research/artifacts/:id  — Update artifact status
 * - DELETE /companies/:companyId/research/artifacts/:id  — Soft-delete artifact
 * - POST   /companies/:companyId/research/trips          — Create trip
 * - GET    /companies/:companyId/research/trips          — List trips
 * - GET    /companies/:companyId/research/trips/:id      — Get trip
 * - PATCH  /companies/:companyId/research/trips/:id      — Update trip
 * - DELETE /companies/:companyId/research/trips/:id      - Delete trip
 */
export function researchArtifactRoutes(db: Db) {
  const router = Router();
  const artifacts = researchArtifactService(db);
  const jobs = backgroundJobService(db);

  // -----------------------------------------------------------------------
  // Research Queries
  // -----------------------------------------------------------------------

  /**
   * POST /companies/:companyId/research/queries
   *
   * Submit a natural language research query. The query is:
   * 1. Validated and stored as a pending research query
   * 2. Run through entity resolution (synchronous, regex-based)
   * 3. Enqueued as a background job for citation gathering
   *
   * Returns 202 with queryId and jobId.
   */
  router.post(
    "/companies/:companyId/research/queries",
    validate(createResearchQuerySchema),
    async (req, res, next) => {
      try {
        const auth = assertVoyonderAuth(req);
        const companyId = auth.companyId;

        // 1. Create the research query record
        const query = await artifacts.createQuery(companyId, {
          rawQuery: req.body.query,
          tripId: req.body.tripId,
          createdByActorId: auth.userId,
        });

        // 2. Run entity resolution (synchronous, regex-based)
        const resolved = resolveQuery(req.body.query);

        // Store resolved entities on the query record
        if (resolved.entities.length > 0) {
          // Use the service to update entities and transition status
          // (direct DB access avoided — the service layer handles it)
          await artifacts.setQueryEntities(companyId, query.id, resolved.entities as any);
        }

        // 3. Enqueue background job for citation gathering
        const job = await jobs.create({
          companyId,
          jobType: BACKGROUND_JOB_TYPES.RESEARCH_ACTIVITY_SEARCH,
          payload: {
            query: req.body.query,
            resolvedEntities: resolved.entities,
            searchPlan: resolved.searchPlan,
            researchQueryId: query.id,
          },
          createdByActorId: auth.userId,
        });

        // Link the job to the query
        await artifacts.linkQueryJob(companyId, query.id, job.id);

        res.status(202).json({
          queryId: query.id,
          jobId: job.id,
          entities: resolved.entities,
          searchPlan: resolved.searchPlan,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * GET /companies/:companyId/research/queries
   *
   * List research queries for the company.
   */
  router.get(
    "/companies/:companyId/research/queries",
    async (req, res, next) => {
      try {
        const auth = assertVoyonderAuth(req);
        const companyId = auth.companyId;

        // Validate query params inline
        const queryParams = listQueriesQuerySchema.parse(req.query);

        const queries = await artifacts.listQueries(companyId, {
          tripId: queryParams.tripId,
          status: queryParams.status,
          limit: queryParams.limit,
          offset: queryParams.offset,
        });

        res.json({ queries });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * GET /companies/:companyId/research/queries/:queryId
   *
   * Get a single research query with its current status and entities.
   */
  router.get(
    "/companies/:companyId/research/queries/:queryId",
    async (req, res, next) => {
      try {
        const auth = assertVoyonderAuth(req);
        const companyId = auth.companyId;
        const queryId = req.params.queryId as string;

        const query = await artifacts.getQuery(companyId, queryId);
        if (!query) {
          res.status(404).json({ error: "Research query not found" });
          return;
        }

        res.json({ query });
      } catch (err) {
        next(err);
      }
    },
  );

  // -----------------------------------------------------------------------
  // Research Artifacts
  // -----------------------------------------------------------------------

  /**
   * GET /companies/:companyId/research/artifacts
   *
   * List research artifacts, filterable by trip, source type, status, and query.
   */
  router.get(
    "/companies/:companyId/research/artifacts",
    async (req, res, next) => {
      try {
        const auth = assertVoyonderAuth(req);
        const companyId = auth.companyId;

        // Validate query params inline
        const queryParams = listArtifactsQuerySchema.parse(req.query);

        const artifactList = await artifacts.listArtifacts(companyId, {
          tripId: queryParams.tripId,
          sourceType: queryParams.sourceType,
          status: queryParams.status,
          researchQueryId: queryParams.researchQueryId,
          limit: queryParams.limit,
          offset: queryParams.offset,
        });

        res.json({ artifacts: artifactList });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * GET /companies/:companyId/research/artifacts/:artifactId
   *
   * Get a single research artifact with full body.
   */
  router.get(
    "/companies/:companyId/research/artifacts/:artifactId",
    async (req, res, next) => {
      try {
        const auth = assertVoyonderAuth(req);
        const companyId = auth.companyId;
        const artifactId = req.params.artifactId as string;

        const artifact = await artifacts.getArtifact(companyId, artifactId);
        if (!artifact) {
          res.status(404).json({ error: "Research artifact not found" });
          return;
        }

        res.json({ artifact });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * PATCH /companies/:companyId/research/artifacts/:artifactId
   *
   * Update artifact status (accept/reject).
   */
  router.patch(
    "/companies/:companyId/research/artifacts/:artifactId",
    validate(updateArtifactStatusSchema),
    async (req, res, next) => {
      try {
        const auth = assertVoyonderAuth(req);
        const companyId = auth.companyId;
        const artifactId = req.params.artifactId as string;

        const artifact = await artifacts.updateArtifactStatus(companyId, artifactId, req.body.status);
        res.json({ artifact });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * DELETE /companies/:companyId/research/artifacts/:artifactId
   *
   * Soft-delete a research artifact.
   */
  router.delete(
    "/companies/:companyId/research/artifacts/:artifactId",
    async (req, res, next) => {
      try {
        const auth = assertVoyonderAuth(req);
        const companyId = auth.companyId;
        const artifactId = req.params.artifactId as string;

        await artifacts.deleteArtifact(companyId, artifactId);
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  // -----------------------------------------------------------------------
  // Trips
  // -----------------------------------------------------------------------

  /**
   * POST /companies/:companyId/research/trips
   *
   * Create a new trip.
   */
  router.post(
    "/companies/:companyId/research/trips",
    validate(createTripSchema),
    async (req, res, next) => {
      try {
        const auth = assertVoyonderAuth(req);
        const companyId = auth.companyId;

        const trip = await artifacts.createTrip(companyId, {
          title: req.body.title,
          description: req.body.description,
          startDate: req.body.startDate,
          endDate: req.body.endDate,
          createdByActorId: auth.userId,
        });

        res.status(201).json({ trip });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * GET /companies/:companyId/research/trips
   *
   * List trips for the company.
   */
  router.get(
    "/companies/:companyId/research/trips",
    async (req, res, next) => {
      try {
        const auth = assertVoyonderAuth(req);
        const companyId = auth.companyId;

        const tripList = await artifacts.listTrips(companyId, {
          status: req.query.status as string | undefined,
          limit: req.query.limit ? Number(req.query.limit) : undefined,
          offset: req.query.offset ? Number(req.query.offset) : undefined,
        });

        res.json({ trips: tripList });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * GET /companies/:companyId/research/trips/:tripId
   *
   * Get a single trip.
   */
  router.get(
    "/companies/:companyId/research/trips/:tripId",
    async (req, res, next) => {
      try {
        const auth = assertVoyonderAuth(req);
        const companyId = auth.companyId;
        const tripId = req.params.tripId as string;

        const trip = await artifacts.getTrip(companyId, tripId);
        if (!trip) {
          res.status(404).json({ error: "Trip not found" });
          return;
        }

        res.json({ trip });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * PATCH /companies/:companyId/research/trips/:tripId
   *
   * Update trip details or status.
   */
  router.patch(
    "/companies/:companyId/research/trips/:tripId",
    async (req, res, next) => {
      try {
        const auth = assertVoyonderAuth(req);
        const companyId = auth.companyId;
        const tripId = req.params.tripId as string;

        // If status update, use status-specific method
        if (req.body.status) {
          const parsed = updateTripStatusSchema.parse(req.body);
          const trip = await artifacts.updateTripStatus(companyId, tripId, parsed.status);
          res.json({ trip });
          return;
        }

        // Otherwise update general fields
        const parsed = updateTripSchema.parse(req.body);
        const trip = await artifacts.updateTrip(companyId, tripId, parsed);
        res.json({ trip });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * DELETE /companies/:companyId/research/trips/:tripId
   *
   * Cancel a trip.
   */
  router.delete(
    "/companies/:companyId/research/trips/:tripId",
    async (req, res, next) => {
      try {
        const auth = assertVoyonderAuth(req);
        const companyId = auth.companyId;
        const tripId = req.params.tripId as string;

        await artifacts.deleteTrip(companyId, tripId);
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
