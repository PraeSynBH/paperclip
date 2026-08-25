# Technical Execution Plan: Research Deep Dive (Phase R1)

**Author:** CTO
**Date:** 2026-08-25
**Parent Initiative:** Research & trip intelligence pipeline
**Branch:** `fix/m-series-tech-debt` (continue on this branch)

---

## 1. Executive Summary

Build a structured research pipeline on top of the M1+M2 async job infrastructure. The pipeline ingests natural language queries, resolves travel entities (destinations, dates, hotels, airlines), gathers citations from web/email/portal sources, persists results as research artifacts, and feeds them into a trip planner.

---

## 2. Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  User sends NL  │ ──> │  Entity Resolver  │ ──> │  Citation Gatherer  │
│  research query │     │  (NL parser +     │     │  (web, email,       │
│                 │     │   geo/date/airline │     │   travel portal)    │
└─────────────────┘     │   entity extract)  │     └──────────┬──────────┘
                         └──────────────────┘                │
                                                              ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  Trip Planner   │ <── │  Research        │ <── │  Citation Verifier  │
│  (consumes      │     │  Artifact Store  │     │  (dedup, rank,      │
│   artifacts)    │     │  (DB + blob)     │     │   freshness check)  │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
         │
         ▼
┌─────────────────┐
│  Trip Page UI   │
│  (shows research │
│   + itinerary)  │
└─────────────────┘
```

### Data Flow

1. **NL Query → Entity Resolution** — User types `"flights to Paris next week under $800"`. Entity resolver extracts: destination=Paris, date_range=next_week (Mon-Sun), max_price=800, category=flights.
2. **Entity → Search Plan** — Resolver expands entities into structured search plan: {sources: [web, email, portal], queries: ["flights Paris price under 800", "cheap flights to Paris"], constraints: {maxPrice: 800, dates: [...], destination: "Paris"}}.
3. **Search → Citations** — Each source (web search API, email index, travel portal API) runs its query in parallel via background jobs. Results return as structured citations with metadata.
4. **Citations → Artifacts** — Citations are deduplicated, ranked, freshness-checked, and persisted as `research_artifact` rows.
5. **Artifacts → Planner** — Trip planner reads artifacts, incorporates them into itinerary generation.
6. **Planner → Trip Page** — Trip page UI shows research artifacts alongside the generated itinerary with freshness cues (existing FreshnessCue).

---

## 3. Component Breakdown

### 3.1 Database Schema — `research_artifacts` table

**File:** `packages/db/src/schema/research_artifacts.ts`

```typescript
export const researchArtifacts = pgTable(
  "research_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    tripId: uuid("trip_id").references(() => trips.id, { onDelete: "cascade" }),
    researchQueryId: uuid("research_query_id").references(() => researchQueries.id),
    
    // The resolved entities from NL parsing
    entities: jsonb("entities").$type<ResolvedEntity[]>().notNull().default([]),
    
    // The citation data
    sourceType: text("source_type").notNull(), // "web", "email", "portal", "manual"
    sourceUrl: text("source_url"),
    sourceName: text("source_name"),
    title: text("title").notNull(),
    snippet: text("snippet"),
    body: text("body"),
    
    // Freshness tracking
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }), // when this citation is considered stale
    
    // Citation metadata
    confidence: integer("confidence"), // 0-100
    relevanceScore: integer("relevance_score"), // 0-100
    checksum: text("checksum"), // dedup hash
    
    // Status
    status: text("status").notNull().default("pending"), // pending, verified, rejected
    
    // Provenance
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

// Supporting table: research_queries
export const researchQueries = pgTable(
  "research_queries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    tripId: uuid("trip_id").references(() => trips.id, { onDelete: "cascade" }),
    
    // The original NL query
    rawQuery: text("raw_query").notNull(),
    normalizedQuery: text("normalized_query"),
    
    // Resolved entities
    entities: jsonb("entities").$type<ResolvedEntity[]>().notNull().default([]),
    
    // Execution tracking
    status: text("status").notNull().default("pending"), // pending, resolving, gathering, complete, failed
    jobId: uuid("job_id").references(() => backgroundJobs.id),
    
    createdByActorId: text("created_by_actor_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
```

**Migration:** `packages/db/src/migrations/` — new migration file creating both tables + indexes.

### 3.2 Entity Resolver Service

**File:** `server/src/services/entity-resolver.ts`

**Purpose:** Parse natural language travel queries and extract structured entities.

**Entity Types:**
- `Destination` — city, airport code, country, region, point of interest
- `DateRange` — specific dates, relative dates ("next week", "tomorrow"), date ranges
- `Hotel` — hotel name, brand, star rating, amenity keywords
- `Airline` — airline name, alliance, flight number patterns
- `Budget` — price constraints, currency
- `Category` — flights, hotels, activities, dining, transport
- `People` — traveler count, room count

**Architecture:**

```typescript
interface ResolvedEntity {
  type: "destination" | "date_range" | "hotel" | "airline" | "budget" | "category" | "people";
  value: string;
  normalized: string;
  confidence: number;
  metadata?: Record<string, unknown>;
}

interface ResolvedQuery {
  raw: string;
  entities: ResolvedEntity[];
  searchPlan: SearchPlanEntry[];
}

interface SearchPlanEntry {
  source: "web" | "email" | "portal";
  query: string;
  priority: number; // 0-100, higher = more important
}
```

**Implementation approaches (phased):**
1. **Phase R1a — Regex + keyword patterns** (ship first): Pattern-based extraction for dates, prices, known airport codes, hotel chains, airlines. Covers ~70% of common travel queries.
2. **Phase R1b — LLM-based extraction** (follow-up): Use a chat-completion call to parse ambiguous queries. The entity resolver enqueues a background job that calls the LLM, then stores extracted entities.

**Key edge cases:**
- Ambiguous destinations ("Paris" = France vs Texas) → return both with lower confidence, let the citation gatherer disambiguate by result volume
- Relative dates ("next week") → resolve to absolute date range at query time
- No entities found → fall back to keyword search (existing M1 mechanism)

### 3.3 Citation Gatherer Service

**File:** `server/src/services/citation-gatherer.ts`

**Purpose:** Execute the search plan against live sources and return structured citations.

**Architecture (background job processor):**

```typescript
// Job type: research.gather_citations
// Payload: { researchQueryId: string, searchPlan: SearchPlanEntry[] }
// Result: { artifactIds: string[], total: number, failures: string[] }
```

**Source Integrations:**

| Source | Integration Method | Status |
|--------|-------------------|--------|
| Web search | Configurable search API (SerpAPI, Brave, etc.) via env vars | New |
| Email | IMAP search or email indexing service | New |
| Travel Portal | HTTP client to configured portal API | New |
| Internal (issues/docs) | Existing `researchSearchService.searchKeywordFirst` | Already built |

**Dedup strategy:** Content hash (SHA-256 of title + snippet) stored in `research_artifacts.checksum`. Before inserting, check for existing artifact with same checksum + companyId. If found, update `fetchedAt` instead of inserting duplicate.

### 3.4 Research Artifact Store API

**File:** `server/src/routes/research-artifacts.ts`

**Endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/companies/:companyId/research/queries` | Submit NL query → returns queryId + jobId (202) |
| GET | `/companies/:companyId/research/queries/:queryId` | Get query status + resolved entities |
| GET | `/companies/:companyId/research/artifacts` | List artifacts (filterable by tripId, sourceType, status) |
| GET | `/companies/:companyId/research/artifacts/:id` | Get single artifact with full body |
| PATCH | `/companies/:companyId/research/artifacts/:id` | Update artifact status (accept/reject) |
| DELETE | `/companies/:companyId/research/artifacts/:id` | Soft-delete artifact |

### 3.5 Trip Data Model

**File:** `packages/db/src/schema/trips.ts` (New)

```typescript
export const trips = pgTable("trips", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  
  // Trip dates
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  
  // Destinations
  destinations: jsonb("destinations").$type<TripDestination[]>().notNull().default([]),
  
  // Status
  status: text("status").notNull().default("draft"), // draft, researching, planning, confirmed, cancelled
  
  // Links to research
  primaryResearchQueryId: uuid("primary_research_query_id"),
  
  createdByActorId: text("created_by_actor_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

### 3.6 Background Job Processors (New)

Add to `server/src/services/background-job-worker.ts`:

| Job Type | Processor | Description |
|----------|-----------|-------------|
| `research.resolve_entities` | `resolveEntitiesProcessor` | Takes raw query, runs NL entity resolution, stores entities on researchQuery row |
| `research.gather_citations` | `gatherCitationsProcessor` | Takes search plan, fans out to sources, deduplicates, writes artifacts |
| `research.verify_citations` | `verifyCitationsProcessor` | Checks artifact freshness, re-fetches stale ones |

### 3.7 Trip Page UI

**File:** `ui/src/pages/TripPage.tsx` (New)

**Layout:**
- Header: Trip title, status badge, date range, destinations
- Research artifacts section (collapsible by source type)
  - Each artifact: title, snippet, source badge, FreshnessCue, confidence bar
  - Inline actions: Accept/Reject, View full, Copy citation
- Itinerary section (generated by planner, shown when ready)
- New research query input (NL search bar at top)
- BackgroundProcessTray integration (inline progress for active research jobs)

**States to handle:**
- **Empty state:** No research yet — show the NL search bar prominently with example queries
- **Loading state:** Skeleton placeholders (existing FadeIn component) while artifacts load
- **In-progress state:** Inline progress bar showing citation gathering progress
- **Error state:** Failed artifact rows with retry button
- **Stale state:** Artifacts with FreshnessCue showing "stale" — option to refresh

### 3.8 Planner Integration

**File:** `server/src/services/trip-planner.ts` (New)

The trip planner is the consumer of research artifacts. It:
1. Reads all verified artifacts for a trip
2. Builds a structured itinerary from them
3. Stores the itinerary as a document linked to the trip

For Phase R1, the planner is a thin wrapper that:
- Groups artifacts by category (flights, hotels, activities)
- Presents them to the agent/LLM as context via a structured prompt
- The agent generates an itinerary that gets stored as a trip-plan document
- Future phases can add automated booking, price monitoring, etc.

---

## 4. State Machine & Data Flow

### Research Query State Machine

```
pending ──> resolving ──> gathering ──> complete
                  │            │
                  v            v
               failed       failed
```

Transitions:
- `pending → resolving`: Entity resolver job accepted
- `resolving → gathering`: Entities resolved, search plan generated
- `resolving → failed`: Entity resolution failed (unparseable query)
- `gathering → complete`: All sources queried, artifacts written
- `gathering → failed`: All sources failed

### Trip State Machine

```
draft ──> researching ──> planning ──> confirmed ──> cancelled
   ^            │              │
   └────────────┴──────────────┘
```

---

## 5. Failure Modes & Edge Cases

| # | Failure Mode | Detection | Recovery |
|---|-------------|-----------|----------|
| 1 | Entity resolver can't parse query | Returns empty entities | Fall back to keyword search (existing M1 path) |
| 2 | Web search API timeout/error | HTTP error from source | Retry with backoff (3 attempts, existing worker retry mechanism); mark source as failed, continue with other sources |
| 3 | Email search unavailable | Connection error | Log warning, skip email source, continue |
| 4 | Portal API rate-limited | 429 response | Backoff and retry; if exhausted, skip portal source |
| 5 | All sources fail | All entries in search plan fail | Mark query as `failed`, return error to UI with troubleshooting guidance |
| 6 | Duplicate artifacts (same content from multiple sources) | checksum collision | Update fetchedAt on existing artifact, don't duplicate |
| 7 | Extremely long query (>500 chars) | Validation in route | Reject with 400, max query length |
| 8 | Too many entities (>20) | Validation in resolver | Truncate to top-20 by confidence |
| 9 | Trip deleted while research in progress | FK constraint on tripId | Cascade delete artifacts; worker checks trip existence before processing |
| 10 | Citation freshness expires while trip is active | expiresAt < now | Background re-fetch job; FreshnessCue shows stale in UI |

---

## 6. Security & Trust Boundaries

| Boundary | Risk | Mitigation |
|----------|------|------------|
| Web search API key leak | Cost exposure, data exfiltration | Server-side only, never exposed to client; stored in env vars or secrets manager |
| Email credentials | Account compromise | Scoped read-only IMAP credentials; never stored in DB |
| Portal API token | Unauthorized access | Short-lived tokens; audit-logged |
| Cross-company data access | Data leak | All endpoints require `assertCompanyAccess` + `assertCompanyScopeReadAllowed` |
| Actor impersonation | Unauthorized query submission | `assertAuthenticated` on all mutation endpoints |

---

## 7. Test Coverage Plan

### Unit Tests
| Component | Test File | Key Cases |
|-----------|-----------|-----------|
| Entity Resolver | `server/src/__tests__/entity-resolver.test.ts` | Date parsing, destination extraction, airline codes, ambiguous entities, empty query, special characters |
| Citation Gatherer | `server/src/__tests__/citation-gatherer.test.ts` | Dedup logic, source fallback, all-sources-fail, partial success |
| Research Artifact Store | `server/src/__tests__/research-artifacts-service.test.ts` | CRUD, company isolation, status transitions, trip-scoped queries |
| Trip Service | `server/src/__tests__/trip-service.test.ts` | Create/update/delete trips, state transitions, company isolation |
| Research Query Flow | `server/src/__tests__/research-query-flow.test.ts` | End-to-end: submit query → entities resolved → artifacts created |

### Integration Tests (embedded Postgres)
| Test File | Scope |
|-----------|-------|
| `server/src/__tests__/research-artifacts-routes.test.ts` | All REST endpoints for artifacts + queries |
| `server/src/__tests__/trip-routes.test.ts` | Trip CRUD endpoints |
| `server/src/__tests__/background-job-worker.test.ts` | New processor types (resolve_entities, gather_citations) |

### UI Tests
| Test File | Scope |
|-----------|-------|
| `ui/src/__tests__/TripPage.test.tsx` | Empty state, loading skeletons, artifact rendering, error states |
| `ui/src/__tests__/ResearchQueryBar.test.tsx` | Submit query, progress display, error display |

---

## 8. Migration Plan

### Phase R1a — Foundation (3-5 days)
1. Create `research_artifacts` + `research_queries` + `trips` DB schemas + migration
2. Implement entity resolver (regex-based) — `entity-resolver.ts`
3. Implement research artifact service + routes
4. Implement background job processors for entity resolution + citation gathering
5. Wire up web search integration (configurable API)
6. Build TripPage UI shell with research artifact display
7. Add research query bar component

### Phase R1b — Intelligence (2-3 days, after R1a ships)
1. Add LLM-based entity resolution as fallback
2. Add email search integration
3. Add travel portal integration
4. Implement citation verification/re-fetch job
5. Wire trip planner to consume artifacts
6. Add itinerary display to TripPage

### Phase R1c — Polish (1-2 days)
1. Performance optimization (caching, query result pagination)
2. Analytics tracking for research query success rate
3. Export research as PDF (reuse existing export infrastructure)
4. Share trip with team members

---

## 9. Dependencies & External Services

| Dependency | Configuration | Status |
|-----------|--------------|--------|
| Web search API | `PAPERCLIP_WEB_SEARCH_API_BASE` + `PAPERCLIP_WEB_SEARCH_API_KEY` | New — choose SerpAPI or Brave Search |
| Email search | `PAPERCLIP_EMAIL_IMAP_HOST` + credentials | New — optional, graceful degradation |
| Travel portal | `PAPERCLIP_TRAVEL_PORTAL_API_BASE` + `PAPERCLIP_TRAVEL_PORTAL_API_KEY` | New — optional, graceful degradation |
| Existing M1+M2 infra | Background job worker, SSE, tray, useJobStatus hook | Already built and tested |

---

## 10. Open Questions & Decisions Needed

1. **Web search provider:** SerpAPI vs Brave Search vs Google Custom Search? Recommendation: Start with Brave Search (free tier, no API key needed for basic, easy to switch later).
2. **Email search scope:** Full mailbox vs label/folder-scoped? Recommend: Start with inbox-only, add folder config later.
3. **Trip planner scope:** Agent-driven generation (LLM writes itinerary) vs template-based? Recommend: Phase R1a uses template-based grouping, R1b adds LLM generation.
4. **Artifact storage:** Full body in DB vs blob storage? Recommend: Snippets in DB, full body in S3/blob when available (reuse existing asset service patterns from company-artifacts.ts).
5. **Real-time vs batch:** Should citation gathering be real-time (SSE-streamed per artifact) or batch (all artifacts at once)? Recommend: Batch for simplicity, SSE for query-level progress only (reuse existing pattern).

---

## 11. Child Issue Creation

When this plan is approved, I'll create the following child issues:

1. **R1a-1: DB schemas + migration for research_artifacts, research_queries, trips** → FE
2. **R1a-2: Entity resolver service (regex-based)** → FE
3. **R1a-3: Research artifact service + REST routes** → FE
4. **R1a-4: Background job processors (resolve_entities, gather_citations)** → FE
5. **R1a-5: Web search integration** → FE
6. **R1a-6: TripPage UI with artifact display** → FE
7. **R1a-7: Code review for all R1a items** → Staff Engineer (blocked on R1a-1..6)
8. **R1a-8: Release R1a** → Release Engineer (blocked on R1a-7)
9. **R1a-9: QA verify R1a** → QA Engineer (blocked on R1a-8)

Then rinse and repeat for R1b, R1c with the same pattern.
