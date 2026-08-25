---
title: Support Case Assessment — Research Artifact Service (R1a Foundation)
version: r1a-v2
applies_to: VOY-2172 (Research Deep Dive — Phase R1a Foundation)
status: Draft — R1a-1/2/3 committed + R1a structural audit (A1-A9 all resolved) on fix/m-series-tech-debt, NOT complete or deployed
maintained_by: Support Engineer (88b72065)
---

# Support Case Assessment: Research Artifact Service (R1a Foundation)

## Feature Summary

The Research Deep Dive (VOY-2172) builds a structured research pipeline on top of the existing M1+M2 async job infrastructure. Phase R1a (Foundation) establishes the data models and REST API for research queries, research artifacts, and trips. It enables submitting natural language travel queries, extracting structured entities (destinations, dates, hotels, airlines, budget), and persisting citation results.

**Current status:** R1a-1 (DB schemas + migration), R1a-2 (entity resolver), and R1a-3 (artifact service + routes) are committed on `fix/m-series-tech-debt`. A Staff Engineer structural audit of the R1a codebase identified 9 findings (A1-A9), all of which have been addressed and committed. Background job processors for entity resolution and citation gathering (R1a-4), web search integration (R1a-5), and TripPage UI (R1a-6) are not yet built. This feature is **NOT released** — the API endpoints exist but citation gathering and the trip planner are not wired.

### What Is Built

| Component | Files | Status |
|-----------|-------|--------|
| DB schema — `research_artifacts` table | `packages/db/src/schema/research_artifacts.ts`, migration 0145 | ✅ Committed |
| DB schema — `research_queries` table | `packages/db/src/schema/research_queries.ts`, migration 0145 | ✅ Committed |
| DB schema — `trips` table | `packages/db/src/schema/trips.ts`, migration 0145 | ✅ Committed |
| Shared types (ResolvedEntity, TripDestination) | `packages/db/src/schema/research-types.ts` | ✅ Committed |
| Entity resolver service (regex-based) | `server/src/services/entity-resolver.ts` | ✅ Committed |
| Entity resolver unit tests (217 lines) | `server/src/__tests__/entity-resolver.test.ts` | ✅ Committed |
| Research artifact store service | `server/src/services/research-artifacts.ts` | ✅ Committed |
| REST routes (12 endpoints) | `server/src/routes/research-artifacts.ts` | ✅ Committed |
| Background job processors (R1a-4) | Not yet built | ❌ Not started |
| Web search integration (R1a-5) | Not yet built | ❌ Not started |
| TripPage UI (R1a-6) | Not yet built | ❌ Not started |

### What Is NOT Yet Built

- Background job processors for `research.resolve_entities` and `research.gather_citations` — citation gathering cannot run
- Web search, email search, or travel portal API integrations — no external data sources connected
- TripPage UI — no customer-facing frontend for viewing research artifacts alongside trip itineraries
- Trip planner service — artifacts are stored but not consumed by any planner
- Citation verification / re-fetch job — no freshness re-check mechanism
- Entity resolver Phase R1b (LLM-based fallback) — regex-only, may miss ambiguous or complex queries

### Structural Audit Hardening (A1-A9) — All Resolved ✅

A Staff Engineer structural audit of the R1a codebase (commits `eaab8740d2`, `a9b0c208c1`) identified 9 findings. All have been addressed:

| Finding | Severity | Fix |
|---------|----------|-----|
| A1 — TOCTOU race in `updateQueryStatus`/`updateTripStatus` | HIGH | Conditional UPDATE with `WHERE status = ...` guard rejects stale-read transitions |
| A2 — Dedup race in `createArtifact` | HIGH | Replaced read-then-write with atomic `INSERT ... ON CONFLICT DO UPDATE` upsert (migration 0146 adds unique partial index) |
| A3 — Zero test coverage | HIGH | 24 tests added covering query/trip state machines, invalid transitions, company isolation, TOCTOU guard, dedup upsert, list edge cases |
| A4 — Global regex `lastIndex` leakage | MEDIUM | Reset `AIRPORT_CODE_RE` and `ABSOLUTE_DATE_RE` `lastIndex` before `exec()` loops |
| A5 — Missing `submitQuery()` service entry point | MEDIUM | Consolidated create+resolve+set flow into single `submitQuery()` method exposed from service |
| A6 — `setQueryEntities` stale-transition guard | MEDIUM | Only transition from `pending` status; conditional UPDATE prevents rolling state machine backward on retry |
| A7 — INSERT...ON CONFLICT `targetWhere` clause | MEDIUM | Added `checksum IS NOT NULL` guard to upsert target, matching the unique partial index |
| A8 — Global regex `lastIndex` (BUDGET_RE) | MEDIUM | Already correctly reset; verified and documented |
| A9 — Research cite-gather complete-status guard | MEDIUM | Background job worker checks query status before transitioning to `complete`; no-ops if already complete |

**Also:** Removed stale `embedBatch()` stub (leftover from Finding #4/M2 P2). The real batch-single-request implementation was already in HEAD.

These fixes harden the R1a code against production race conditions and state-machine violations. They apply to unreleased code on `fix/m-series-tech-debt` — no shipped behavior is affected.

## API Endpoints

### Research Queries

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/companies/:companyId/research/queries` | Voyonder JWT | Submit a natural language research query. Runs entity resolution synchronously, enqueues background job for citation gathering. Returns 202 with queryId and jobId. |
| GET | `/companies/:companyId/research/queries` | Voyonder JWT | List queries, filterable by tripId and status. Paginated (default 50, max 100). |
| GET | `/companies/:companyId/research/queries/:id` | Voyonder JWT | Get single query with resolved entities and status. |

### Research Artifacts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/companies/:companyId/research/artifacts` | Voyonder JWT | List artifacts, filterable by tripId, sourceType, status, researchQueryId. Paginated (default 50, max 100). |
| GET | `/companies/:companyId/research/artifacts/:id` | Voyonder JWT | Get single artifact with full body. |
| PATCH | `/companies/:companyId/research/artifacts/:id` | Voyonder JWT | Update artifact status (pending → verified / rejected). |
| DELETE | `/companies/:companyId/research/artifacts/:id` | Voyonder JWT | Soft-delete artifact (status → rejected). |

### Trips

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/companies/:companyId/research/trips` | Voyonder JWT | Create a new trip in `draft` status. Returns 201. |
| GET | `/companies/:companyId/research/trips` | Voyonder JWT | List trips, filterable by status. |
| GET | `/companies/:companyId/research/trips/:id` | Voyonder JWT | Get single trip with full details. |
| PATCH | `/companies/:companyId/research/trips/:id` | Voyonder JWT | Update trip details or status (validates state machine transitions). |
| DELETE | `/companies/:companyId/research/trips/:id` | Voyonder JWT | Cancel trip (soft-delete via status → cancelled). |

## State Machines

### Research Query States

```
pending ──> resolving ──> gathering ──> complete
                  │            │
                  v            v
               failed       failed
```

- **pending**: Initial state after query submission
- **resolving**: Entity resolution in progress
- **gathering**: Citation gathering from external sources
- **complete**: All sources queried, artifacts written
- **failed**: Entity resolution or all citation sources failed
- **Retry allowed**: `failed → pending` (retry the query)

### Trip States

```
draft ──> researching ──> planning ──> confirmed ──> cancelled
   ^            │              │
   └────────────┴──────────────┘
```

- **draft**: Initial state after trip creation
- **researching**: Research artifacts being gathered
- **planning**: Artifacts consumed by planner, itinerary in progress
- **confirmed**: Trip is finalized
- **cancelled**: Trip is cancelled
- **Restart allowed**: `cancelled → draft`

## Entity Resolver Capabilities

The regex-based entity resolver (committed in R1a-2) can extract:

| Entity Type | Examples | Coverage |
|-------------|----------|----------|
| Airport codes | JFK, LHR, CDG, SFO, LAX, ORD, etc. | 200+ known codes |
| City names | After "to", "in", "from", "at" prepositions | Common travel cities |
| Absolute dates | "March 15", "2026-08-25", "August 25th" | Multiple formats |
| Relative dates | "next week", "tomorrow", "next month", "this weekend" | Resolves to absolute range |
| Date ranges | "March 15-20", "from Aug 10 to Aug 15" | Inclusive ranges |
| Budget | "under $800", "budget 500", "max $2000" | USD assumed unless specified |
| Hotels | Major chain names (Hilton, Marriott, Hyatt, etc.) | ~30 known brands |
| Airlines | Major carriers (Delta, United, American, etc.) | ~30 known carriers |
| Category | "flights", "hotels", "activities", "dining", "transport" | Keyword-based |
| People count | "for 2", "family of 4", "couple" | Basic patterns |

**Limitations:**
- Ambiguous destinations (Paris, France vs Paris, Texas) return both with lower confidence
- Relative dates are resolved at query time, not stored as relative offsets
- No entities found → falls back to keyword search (existing M1 mechanism)
- Regex-based only — no LLM fallback yet (planned for R1b)

## Known Limitations

### Data & Storage

1. **No citation gathering yet** — The background job processor for `research.gather_citations` is not built. Submitting a query via POST will run entity resolution and enqueue a job, but the job will never complete (no processor registered for the job type). The query will remain stuck in `gathering` status unless the processor is implemented.
2. **No web search integration** — Even when the gatherer processor is built, no web search API (SerpAPI, Brave, Google) is wired. Citation sources are not connected.
3. **Trip planner not built** — Artifacts and trips exist as data but no planner service consumes them to generate itineraries. The data model supports it but the pipeline is incomplete.
4. **No blob storage for full artifact body** — Snippets and body text are stored directly in the DB row. Large bodies could inflate row sizes.
5. **No artifact archival/cleanup** — Soft-deleted artifacts (status=rejected) and terminal query rows accumulate indefinitely.

### Entity Resolution

6. **Regex-only parser** — The entity resolver uses pattern matching, not LLM-based NLP. Complex or ambiguous queries may yield poor entity extraction. LLM-based fallback is planned for R1b but not yet built.
7. **Limited airline & hotel databases** — Only ~30 airlines and ~30 hotel chains are known. Lesser-known brands or regional carriers are not recognized.
8. **Currency assumed USD** — Budget extraction assumes USD. Other currencies (`€500`, `£300`) are not parsed.
9. **No timezone handling** — Relative date resolution uses server timezone. Users in different timezones may see dates offset by a day.
10. **People count is basic** — Only simple patterns ("for 2", "family of 4") are supported. More complex group specifications are not parsed.

### Queries

11. **Query length limited to 500 characters** — Longer queries are rejected with 400.
12. **No query editing** — Once submitted, there's no endpoint to modify a query. Users must submit a new query.
13. **No query cancellation** — There's no endpoint to cancel a running query. If the background job is stuck, the query remains in its current status.
14. **No retry endpoint** — Failed queries can theoretically be retried (state machine allows `failed → pending`), but there's no API endpoint for this yet — only the service method exists.

### Auth & Security

15. **Company-scoped isolation** — All endpoints enforce company isolation via `assertVoyonderAuth`. The `companyId` is extracted from JWT claims, not the URL path. This matches the VOY-2171 auth migration pattern.
16. **No rate limiting** — Query submission endpoints have no application-level rate limiting. Relies on Stripe/network-level protections.
17. **Actor tracking** — `createdByActorId` records the Voyonder user ID from JWT `sub` claim.

## Troubleshooting

### Query submission returns 202 but query stays in "pending" or "resolving" forever

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| Query stuck in "pending" | Entity resolver ran but status transition incomplete | Check service logs for `setQueryEntities` call; verify status transition logic |
| Query stuck in "resolving" or "gathering" | Background job processor not built (R1a-4 not implemented) | **Expected behavior** — citation gatherer processor doesn't exist yet. Query will never reach "complete". This is not a bug, it's a missing feature. |

### Entity resolution returns unexpected results

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| "Paris" resolves to wrong country | Regex-based resolver returns both Paris, France and Paris, Texas with lower confidence | Re-run query with more specific terms ("Paris France flights") |
| Date "next week" resolves incorrectly | Server timezone mismatch | Verify server timezone configuration; dates are absolute, not relative |
| No entities found | Query doesn't match any patterns | Query falls through to keyword search (existing M1 path). Results will still work but without entity enrichment. |

### Trip management

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| Cannot delete a trip | DELETE sets status to "cancelled" (soft-delete) | The trip remains in the database but is hidden from default list queries. No hard-delete endpoint exists. |
| Invalid status transition error | Client attempted a transition not in the state machine | Check allowed transitions: draft→researching, researching→planning/draft, planning→confirmed/researching, confirmed→cancelled, cancelled→draft |
| Trip not found (404) | Wrong company scope or tripId | Verify the tripId is correct and belongs to the authenticated company |

## Escalation Path

| Issue | Action | Escalate to |
|-------|--------|-------------|
| Query stuck in resolving/gathering | **Expected** — citation gatherer not built yet. Document as known limitation. | Support Engineer (documentation) |
| Entity resolver misses obvious entities | Regex-based — submit a test case for pattern expansion | Support Engineer → Founding Engineer (pattern enhancement) |
| API returns 401/403 | Verify JWT is valid, not expired, has correct `sub` and `company_id` claims | Support Engineer + Engineering (auth config) |
| API returns 500 on any endpoint | Server-side error — check logs | Engineering (Founding Engineer / CTO) |
| Trip shows wrong status | Check state machine transition validity; if confirmed as bug, escalate | Founding Engineer |
| Soft-deleted data needs hard-deletion | No hard-delete endpoint exists — requires DB intervention | Engineering (CTO approval required) |

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| r1a-v2 | 2026-08-25 | Support Engineer | Added structural audit findings (A1-A9) all resolved. Documented TOCTOU guards, dedup upsert, test coverage, regex fixes, stale-transition guards. Pre-release hardening on fix/m-series-tech-debt. |
| r1a-v1 | 2026-08-25 | Support Engineer | Initial assessment for R1a Foundation (R1a-1/2/3 committed). Notes feature as incomplete — no citation gatherer, no web search, no TripPage UI. |