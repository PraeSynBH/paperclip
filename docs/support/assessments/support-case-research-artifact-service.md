---
title: Support Case Assessment — Research Artifact Service (R1a Foundation)
version: r1a-v3
applies_to: VOY-2172 (Research Deep Dive — Phase R1a Foundation)
status: Draft — R1a-1..4 committed on fix/m-series-tech-debt, P0 pre-ship blocker in VOY-2267, NOT complete or deployed
maintained_by: Support Engineer (88b72065)
---

# Support Case Assessment: Research Artifact Service (R1a Foundation)

## Feature Summary

The Research Deep Dive (VOY-2172) builds a structured research pipeline on top of the existing M1+M2 async job infrastructure. Phase R1a (Foundation) establishes the data models, REST API, and background job processors for research queries, research artifacts, and trips. It enables submitting natural language travel queries, extracting structured entities (destinations, dates, hotels, airlines, budget), and persisting citation results.

**Current status:** R1a-1 (DB schemas + migration), R1a-2 (entity resolver), R1a-3 (artifact service + routes), and R1a-4 (background job processors) are committed on `fix/m-series-tech-debt`. A Staff Engineer structural audit (A1-A9) has been fully resolved, and an N+1 batch-lookup fix landed in `VERIFY_CITATIONS`. A **P0 pre-ship review (VOY-2267) found a state machine bug that breaks every REST query submission** — the route handler enqueues `RESEARCH_GATHER_CITATIONS` while the query is in `resolving` status, and the transition `resolving → complete` is not permitted by the state machine. This must be fixed before any R1a release ships. Web search integration (R1a-5) and TripPage UI (R1a-6) are not yet built. This feature is **NOT released**.

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
| Background job processor — `RESEARCH_RESOLVE_ENTITIES` | `server/src/services/background-job-worker.ts` | ✅ Committed |
| Background job processor — `RESEARCH_GATHER_CITATIONS` | `server/src/services/background-job-worker.ts` | ✅ Committed (creates placeholder stub artifacts pending R1a-5) |
| Background job processor — `RESEARCH_VERIFY_CITATIONS` | `server/src/services/background-job-worker.ts` | ✅ Committed (N+1 batch fix landed) |
| **REST query submission end-to-end** | Route → service → job chain | ❌ **BLOCKED by P0 (VOY-2267)** |

### What Is NOT Yet Built

- Web search, email search, or travel portal API integrations (R1a-5) — the gather processor currently creates placeholder stub artifacts from the search plan
- TripPage UI (R1a-6) — no customer-facing frontend for viewing research artifacts alongside trip itineraries
- Trip planner service — artifacts are stored but not consumed by any planner
- Entity resolver Phase R1b (LLM-based fallback) — regex-only, may miss ambiguous or complex queries

### P0 Pre-ship Blocker (VOY-2267) — ⛔ Fix required before any ship

A Staff Engineer pre-ship review (2026-08-25 ~13:30 UTC, HEAD `671971efc8`) returned **Conditional Approve — fix P0 before shipping any R1a release**. Three findings:

| Finding | Severity | Detail |
|---------|----------|--------|
| **A — Broken state machine transition** | **P0** | The POST query route handler calls `submitQuery()` (query ends in `resolving`) and enqueues `RESEARCH_GATHER_CITATIONS` directly. The gather processor's final `resolving → complete` transition violates `VALID_QUERY_TRANSITIONS` (`resolving` only allows `gathering`/`failed`). **Every query submit via REST endpoint fails.** |
| B — Partial-failure orphan | P1 | Query is created but no gather job exists if `jobs.create` fails after `submitQuery`. |
| C — Duplicated entity resolution paths | P1 | `submitQuery()` and `RESEARCH_RESOLVE_ENTITIES` both call `resolveQuery` + `setQueryEntities`. |

**Adopted fix direction (Option A, per review):** enqueue `RESEARCH_RESOLVE_ENTITIES` from the route handler and strip entity resolution from `submitQuery` — resolves all three findings.

**Recommended before ship (not blocking):**
1. Add index on `research_queries.job_id`
2. Add `onDelete: "set null"` on `research_queries.job_id` FK
3. Fix `computeChecksum` delimiter collision — `[content, source].join("|")` collides when content contains `|`

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

**Also:** Removed stale `embedBatch()` stub (leftover from Finding #4/M2 P2). The real batch-single-request implementation was already in HEAD. `RESEARCH_VERIFY_CITATIONS` now uses `getArtifactsByIds()` batch lookup instead of `Promise.all(artifactIds.map(getArtifact))` — eliminating an N+1 query pattern (commit `2796196f91`).

These fixes harden the R1a code against production race conditions and state-machine violations. They apply to unreleased code on `fix/m-series-tech-debt` — no shipped behavior is affected.

### Background Job Processors (R1a-4)

Three processors registered in `background-job-worker.ts`:

| Processor | Behavior |
|-----------|----------|
| `RESEARCH_RESOLVE_ENTITIES` | Resolves entities from `rawQuery`, stores them via `setQueryEntities` (`pending → resolving`), transitions to `gathering`, fans out one `RESEARCH_GATHER_CITATIONS` job per search-plan entry, or marks `complete` if no plan. |
| `RESEARCH_GATHER_CITATIONS` | Iterates the search plan, creating one placeholder stub artifact per entry (source Types `web`/`email`/`portal`, "integration pending (R1a-5)"). Creates a single fallback artifact when the plan is empty. Marks the query `complete` only if not already. **NOTE:** the route handler currently enqueues this processor directly while the query is in `resolving`, which violates the state machine — the P0 in VOY-2267. |
| `RESEARCH_VERIFY_CITATIONS` | Re-fetches artifacts by checksum via batch `getArtifactsByIds()` lookup. |

## API Endpoints

### Research Queries

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/companies/:companyId/research/queries` | Voyonder JWT | Submit a natural language research query. Runs entity resolution synchronously, enqueues background job for citation gathering. Returns 202 with queryId and jobId. **⚠️ Currently broken (P0, VOY-2267)** — the enqueued gather job fails its terminal status transition. |
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

1. **Query submission is currently broken (P0)** — The REST query submit flow violates its own state machine (VOY-2267 finding A): `submitQuery()` leaves the query in `resolving`, then the route enqueues `RESEARCH_GATHER_CITATIONS`, whose terminal transition `resolving → complete` is not permitted. Every query submitted via REST ends in error. Engineering fix (enqueue `RESEARCH_RESOLVE_ENTITIES` from the route) is required before any release.
2. **Citation gathering is stubbed** — Web search, email search, and portal integration (R1a-5) are not wired. The gather processor creates placeholder artifacts from the search plan with "integration pending (R1a-5)" snippets and a fixed confidence of 40-50. Artifacts have no real source URLs or bodies.
3. **Trip planner not built** — Artifacts and trips exist as data but no planner service consumes them to generate itineraries. The data model supports it but the pipeline is incomplete.
4. **No blob storage for full artifact body** — Snippets and body text are stored directly in the DB row. Large bodies could inflate row sizes.
5. **No artifact archival/cleanup** — Soft-deleted artifacts (status=rejected) and terminal query rows accumulate indefinitely.
6. **Checksum delimiter collision** — `computeChecksum` joins `[content, source]` with `"|"`; content containing `|` can collide with a different (content, source) pair. Recommended fix before ship (VOY-2267).
7. **No index on `research_queries.job_id`** and `onDelete` is not `set null` — recommended pre-ship hardening (VOY-2267).

### Entity Resolution

8. **Regex-only parser** — The entity resolver uses pattern matching, not LLM-based NLP. Complex or ambiguous queries may yield poor entity extraction. LLM-based fallback is planned for R1b but not yet built.
9. **Limited airline & hotel databases** — Only ~30 airlines and ~30 hotel chains are known. Lesser-known brands or regional carriers are not recognized.
10. **Currency assumed USD** — Budget extraction assumes USD. Other currencies (`€500`, `£300`) are not parsed.
11. **No timezone handling** — Relative date resolution uses server timezone. Users in different timezones may see dates offset by a day.
12. **People count is basic** — Only simple patterns ("for 2", "family of 4") are supported. More complex group specifications are not parsed.

### Queries

13. **Query length limited to 500 characters** — Longer queries are rejected with 400.
14. **No query editing** — Once submitted, there's no endpoint to modify a query. Users must submit a new query.
15. **No query cancellation** — There's no endpoint to cancel a running query. If the background job is stuck, the query remains in its current status.
16. **No retry endpoint** — Failed queries can theoretically be retried (state machine allows `failed → pending`), but there's no API endpoint for this yet — only the service method exists.

### Auth & Security

17. **Company-scoped isolation** — All endpoints enforce company isolation via `assertVoyonderAuth`. The `companyId` is extracted from JWT claims, not the URL path. This matches the VOY-2171 auth migration pattern.
18. **No rate limiting** — Query submission endpoints have no application-level rate limiting. Relies on Stripe/network-level protections.
19. **Actor tracking** — `createdByActorId` records the Voyonder user ID from JWT `sub` claim.

## Troubleshooting

### Query submission returns 202 but the query never completes

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| Query stuck in "resolving" forever | P0 state machine bug (VOY-2267 finding A) — gather job fails the `resolving → complete` transition | **Known issue, pre-release.** Alert engineering — the route must enqueue `RESEARCH_RESOLVE_ENTITIES` instead of GATHER directly |
| Query stuck in "pending" | Entity resolver ran but status transition incomplete | Check service logs for `setQueryEntities` call; verify status transition logic |
| Query stuck in "gathering" | Citation gatherer has no real sources yet (R1a-5 not wired) — placeholder artifacts are created but nothing external is fetched | Expected for pre-release builds — artifacts are stubs until R1a-5 lands |

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
| Query submit fails / stuck in resolving | **Known P0 (VOY-2267)** — engineering must enqueue `RESEARCH_RESOLVE_ENTITIES` from the route and strip resolution from `submitQuery` | Engineering (Founding Engineer / CTO) — Support tracks until fix lands |
| Query stuck in gathering | **Expected pre-release** — R1a-5 sources not wired; artifacts are stubs. Document as known limitation. | Support Engineer (documentation) |
| Entity resolver misses obvious entities | Regex-based — submit a test case for pattern expansion | Support Engineer → Founding Engineer (pattern enhancement) |
| API returns 401/403 | Verify JWT is valid, not expired, has correct `sub` and `company_id` claims | Support Engineer + Engineering (auth config) |
| API returns 500 on any endpoint | Server-side error — check logs | Engineering (Founding Engineer / CTO) |
| Trip shows wrong status | Check state machine transition validity; if confirmed as bug, escalate | Founding Engineer |
| Soft-deleted data needs hard-deletion | No hard-delete endpoint exists — requires DB intervention | Engineering (CTO approval required) |

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| r1a-v3 | 2026-08-25 | Support Engineer | Corrected status: R1a-4 processors now built (RESOLVE_ENTITIES / GATHER_CITATIONS / VERIFY_CITATIONS). Added VOY-2267 pre-ship review section — P0 state machine bug (every REST query submit fails), P1 findings B/C, Option A fix direction, 3 recommended pre-ship fixes. N+1 batch lookup in VERIFY_CITATIONS noted. Updated limitations/troubleshooting/escalation to reflect the P0 and stubbed gatherer. |
| r1a-v2 | 2026-08-25 | Support Engineer | Added structural audit findings (A1-A9) all resolved. Documented TOCTOU guards, dedup upsert, test coverage, regex fixes, stale-transition guards. Pre-release hardening on fix/m-series-tech-debt. |
| r1a-v1 | 2026-08-25 | Support Engineer | Initial assessment for R1a Foundation (R1a-1/2/3 committed). Notes feature as incomplete — no citation gatherer, no web search, no TripPage UI. |