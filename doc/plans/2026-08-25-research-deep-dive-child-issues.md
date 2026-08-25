# Research Deep Dive — Phase R1a Child Issue Definitions

**Parent:** VOY-2172 (Research Deep Dive)
**Branch:** `fix/m-series-tech-debt`
**Status:** Ready for implementation when plan is approved

---

## R1a-1: DB schemas + migration for research_artifacts, research_queries, trips

**Assignment:** Founding Engineer (57fa7e0e)
**Depends on:** None

### Scope
Create three new database tables and their Drizzle ORM schemas:

1. **research_artifacts** — Stores citation results with source metadata, freshness tracking, dedup checksum, confidence scores
2. **research_queries** — Tracks NL query lifecycle (pending → resolving → gathering → complete/failed)
3. **trips** — Trip data model with destinations, dates, status machine (draft → researching → planning → confirmed → cancelled)

### Deliverables
- `packages/db/src/schema/research_artifacts.ts`
- `packages/db/src/schema/research_queries.ts`
- `packages/db/src/schema/trips.ts`
- Migration file: `packages/db/src/migrations/XXXX_research_artifacts.sql`
- Indexes on company_id, trip_id, query_id, source_type, checksum
- FK references with ON DELETE CASCADE where appropriate

### Definition of Done
- All three schemas defined with Drizzle ORM
- Migration SQL generated and tested against embedded Postgres
- Types exported from `packages/db/src/index.ts`
- Existing tests still pass

---

## R1a-2: Entity resolver service (regex-based)

**Assignment:** Founding Engineer (57fa7e0e)
**Depends on:** R1a-1 (for research_queries schema)

### Scope
Build the entity resolver service that parses natural language travel queries:

- `server/src/services/entity-resolver.ts`
- Regex-based extraction for: destinations (airport codes, cities), date ranges (absolute + relative), hotels (chains/brands), airlines, budget constraints, categories, people counts
- Fallback to keyword search when no entities found
- Returns `ResolvedQuery` with entities + search plan entries
- Unit tests for all entity types, ambiguous cases, empty queries

### Deliverables
- Entity resolver service with pattern-based extraction
- `ResolvedEntity` and `ResolvedQuery` TypeScript types
- Search plan generation from resolved entities
- Test coverage: date parsing, destination extraction, airline codes, ambiguous entities, empty query, special characters

### Definition of Done
- All unit tests pass
- Covers ~70% of common travel query patterns
- Empty/no-match queries gracefully fall back to keyword-only mode

---

## R1a-3: Research artifact service + REST routes

**Assignment:** Founding Engineer (57fa7e0e)
**Depends on:** R1a-1 (for schema access)

### Scope
Build the research artifact store API:

- `server/src/services/research-artifacts.ts` — CRUD service
- `server/src/routes/research-artifacts.ts` — REST endpoints

### Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| POST | /companies/:companyId/research/queries | Submit NL query → returns queryId + jobId (202) |
| GET | /companies/:companyId/research/queries/:queryId | Get query status + resolved entities |
| GET | /companies/:companyId/research/artifacts | List artifacts (filterable by tripId, sourceType, status) |
| GET | /companies/:companyId/research/artifacts/:id | Get single artifact with full body |
| PATCH | /companies/:companyId/research/artifacts/:id | Update artifact status (accept/reject) |
| DELETE | /companies/:companyId/research/artifacts/:id | Soft-delete artifact |

### Deliverables
- Full CRUD service with company isolation and trip scoping
- Zod validation schemas for all endpoints
- Auth: use `assertVoyonderAuth` pattern (matching VOY-2171 fix)
- Integration tests with embedded Postgres
- Proper HTTP response codes (201, 202, 400, 404, 409)

### Definition of Done
- All endpoints working with integration tests
- Company isolation verified (cross-company access blocked)
- Status transition validation enforced

---

## R1a-4: Background job processors (resolve_entities, gather_citations)

**Assignment:** Founding Engineer (57fa7e0e)
**Depends on:** R1a-1 + R1a-2 + R1a-3

### Scope
Add two new job processor types to the background job worker:

1. **research.resolve_entities** — Takes raw query, runs entity resolution, stores entities on researchQuery row, transitions status to `gathering`, fans out to gather_citations
2. **research.gather_citations** — Takes search plan, fans out to configured sources, deduplicates, writes artifacts

### Deliverables
- Processor registration in `server/src/services/background-job-worker.ts`
- Job type constants in `@paperclipai/shared`
- Proper job lifecycle: enqueue → process → succeed/fail with retries
- Dedup strategy: SHA-256 checksum on title+snippet
- Partial success: if some sources fail, mark them individually, continue with others

### Definition of Done
- Both processor types registered and working
- Dedup logic tested with embedded Postgres
- Failure modes handled (per-source retry with backoff, all-sources-fail = query failed)
- Integration tests for processor dispatch

---

## R1a-5: Web search integration

**Assignment:** Founding Engineer (57fa7e0e)
**Depends on:** R1a-4

### Scope
Wire up configurable web search API:

- `server/src/services/web-search.ts` — Web search client
- Env vars: `PAPERCLIP_WEB_SEARCH_API_BASE`, `PAPERCLIP_WEB_SEARCH_API_KEY`
- Recommended: Brave Search API (free tier, no API key needed for basic)
- Search result → Citation normalization (title, snippet, URL, source name)
- Rate limiting: configurable requests-per-second, exponential backoff on 429

### Deliverables
- Web search service with configurable provider
- Result normalization to `Citation` type
- Rate limiting and error handling
- Unit tests with mocked API responses

### Definition of Done
- Web search integration works end-to-end with the citation gatherer
- Graceful degradation when API is unavailable (skip source, continue with others)
- Timeout handling (5s default per request)

---

## R1a-6: TripPage UI with artifact display

**Assignment:** Founding Engineer (57fa7e0e)
**Depends on:** R1a-3 (for API endpoints)

### Scope
Build the TripPage UI that displays research artifacts alongside trip data:

- `ui/src/pages/TripPage.tsx` — Main trip page with research artifact display
- `ui/src/components/ResearchQueryBar.tsx` — NL search bar with example queries
- `ui/src/components/ArtifactCard.tsx` — Individual artifact display card

### States
- **Empty state:** No research yet — prominent NL search bar with example queries
- **Loading state:** Skeleton placeholders (reuse existing FadeIn component)
- **In-progress state:** Inline progress from BackgroundProcessTray
- **Error state:** Failed artifact rows with retry button
- **Stale state:** FreshnessCue showing "stale" — option to refresh

### Deliverables
- Trip page with research artifacts section (collapsible by source type)
- Artifact cards with: title, snippet, source badge, FreshnessCue, confidence bar
- Inline actions: Accept/Reject, View full, Copy citation
- New research query input
- BackgroundProcessTray integration for active research jobs

### Definition of Done
- All UI states render correctly (empty, loading, in-progress, error, stale)
- Artifact cards display and interact correctly
- Research query submission works end-to-end
- Component tests for each state

---

## R1a-7: Code review for all R1a items (R1a-1..R1a-6)

**Assignment:** Staff Engineer (eee825c7)
**Depends on:** R1a-1 through R1a-6
**Blocks:** R1a-8

### Scope
Comprehensive code review of all Phase R1a deliverables. Focus areas:
- SQL correctness and index coverage
- Auth consistency (Voyonder JWT pattern)
- Company isolation on all endpoints
- State machine integrity for research queries
- Failure mode handling
- Test coverage adequacy

---

## R1a-8: Release R1a

**Assignment:** Release Engineer (7a2a259f)
**Depends on:** R1a-7
**Blocks:** R1a-9

### Scope
Ship Phase R1a to production:
- Merge R1a branch to master
- Build and deploy
- Verify production health
- Notify Support Engineer

---

## R1a-9: QA verify R1a

**Assignment:** QA Engineer (c3bdfe58)
**Depends on:** R1a-8

### Scope
End-to-end QA verification of Phase R1a in production:
- Submit research queries via the NL search bar
- Verify entity resolution (regex-based)
- Verify citation gathering from web sources
- Verify artifact display on TripPage
- Test all error states
- Test company isolation