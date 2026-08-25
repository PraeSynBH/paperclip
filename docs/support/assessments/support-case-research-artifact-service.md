---
title: Support Case Assessment — Research Artifact Service (R1a Foundation)
version: r1a-v6
applies_to: VOY-2172 (Research Deep Dive — Phase R1a Foundation)
status: Draft — P0 infinite-loop fix committed (6a8fbad1c3, resolves VOY-2301) and verified (33 tests pass); code review passed (VOY-2298 done); R1a release (VOY-2304) now blocked on M2 P1 fixes (VOY-2318, VOY-2319 awaiting StaffE re-verify); NOT yet deployed to production
maintained_by: Support Engineer (88b72065)
---

# Support Case Assessment: Research Artifact Service (R1a Foundation)

## Feature Summary

The Research Deep Dive (VOY-2172) builds a structured research pipeline on top of the existing M1+M2 async job infrastructure. Phase R1a (Foundation) establishes the data models, REST API, and background job processors for research queries, research artifacts, and trips. It enables submitting natural language travel queries, extracting structured entities (destinations, dates, hotels, airlines, budget), and persisting citation results.

**Current status:** R1a-1 (DB schemas + migration), R1a-2 (entity resolver), R1a-3 (artifact service + routes), and R1a-4 (background job processors) are committed on `fix/m-series-tech-debt`. The Staff Engineer structural audit (A1-A9) is fully resolved, the N+1 batch-lookup fix landed, and the **P0 pre-ship blocker (VOY-2267) plus all P1/P2 findings are resolved by commit `8976083b9b` (2026-08-25 ~16:00 UTC)** — the route handler now enqueues `RESEARCH_RESOLVE_ENTITIES`, entity resolution is fully asynchronous, and the state machine flow works end-to-end.

**However, a P0 infinite-loop bug was discovered in the Staff Engineer's final structural audit v2 (VOY-2298, 2026-08-25 ~17:10 UTC):** non-global regexes (`AIRLINE_RE`, `CATEGORY_RE`) in entity-resolver.ts caused an infinite loop on ANY query containing a travel category word (flights, hotels, activities, restaurants, transport, …) or a recognized airline name (Delta, United, Emirates, …) — every such query pinned a worker slot at 100% CPU for 5 minutes, then failed, and the CI test suite hung on it.

**✅ P0 FIX LANDED (2026-08-25 ~18:10 UTC):** commit `6a8fbad1c3` (resolves VOY-2301) added the missing `/g` flag to `AIRLINE_RE` and `CATEGORY_RE`, reset `lastIndex` before each match loop, and added P0 regression tests. **Verified: all 33 entity-resolver tests pass and the suite terminates (no hang).** The R1a release (VOY-2189 / R1a-8) is now **awaiting code review of the fix (VOY-2298) + CTO sign-off** — no longer blocked by the infinite loop. Web search integration (R1a-5) and TripPage UI (R1a-6) are not yet built.

### What Is Built

| Component | Files | Status |
|-----------|-------|--------|
| DB schema — `research_artifacts` table | `packages/db/src/schema/research_artifacts.ts`, migration 0145 | ✅ Committed |
| DB schema — `research_queries` table | `packages/db/src/schema/research_queries.ts`, migrations 0145 + 0147 (trigram index) + 0148 (job_id index + FK onDelete) | ✅ Committed |
| DB schema — `trips` table | `packages/db/src/schema/trips.ts`, migration 0145 | ✅ Committed |
| Shared types (ResolvedEntity, TripDestination) | `packages/db/src/schema/research-types.ts` | ✅ Committed |
| Entity resolver service (regex-based) | `server/src/services/entity-resolver.ts` | ✅ Committed |
| Entity resolver unit tests (217 lines) | `server/src/__tests__/entity-resolver.test.ts` | ✅ Committed |
| Research artifact store service | `server/src/services/research-artifacts.ts` | ✅ Committed |
| REST routes (12 endpoints) | `server/src/routes/research-artifacts.ts` | ✅ Committed |
| Background job processor — `RESEARCH_RESOLVE_ENTITIES` | `server/src/services/background-job-worker.ts` | ✅ Committed (single resolution path — Finding C) |
| Background job processor — `RESEARCH_GATHER_CITATIONS` | `server/src/services/background-job-worker.ts` | ✅ Committed (creates placeholder stub artifacts pending R1a-5) |
| Background job processor — `RESEARCH_VERIFY_CITATIONS` | `server/src/services/background-job-worker.ts` | ✅ Committed (N+1 batch fix landed) |
| **REST query submission end-to-end** | Route → service → job chain | ✅ **Committed (P0 resolved by 8976083b9b)** |
| Background job download endpoint | `server/src/routes/background-jobs.ts` → `GET /background-jobs/:id/download` | ✅ Committed (blob-stored export artifacts) |
| PDF export → blob storage | `server/src/services/background-job-worker.ts` (EXPORT_PDF) | ✅ Committed (objectKey in job result; inline base64 fallback when no storage configured) |

### What Is NOT Yet Built

- Web search, email search, or travel portal API integrations (R1a-5) — the gather processor currently creates placeholder stub artifacts from the search plan
- TripPage UI (R1a-6) — no customer-facing frontend for viewing research artifacts alongside trip itineraries
- Trip planner service — artifacts are stored but not consumed by any planner
- Entity resolver Phase R1b (LLM-based fallback) — regex-only, may miss ambiguous or complex queries

### R1a Pre-ship Findings — All Resolved ✅ (commit 8976083b9b, VOY-2189)

The Staff Engineer pre-ship review (VOY-2267, 2026-08-25 ~13:30 UTC) returned Conditional Approve with findings A/B/C. The implementation fix (VOY-2269) went through code review (VOY-2270, done 15:40 UTC) and landed as commit `8976083b9b` (2026-08-25 ~16:00 UTC, branch `fix/m-series-tech-debt`). **Every finding is resolved:**

| Finding | Severity | Resolution (commit 8976083b9b) |
|---------|----------|--------------------------------|
| **A — Broken state machine transition (P0):** route handler enqueued `RESEARCH_GATHER_CITATIONS` while the query sat in `resolving`; the `resolving → complete` transition is invalid. Every query submit failed. | **P0** | Route handler now enqueues `RESEARCH_RESOLVE_ENTITIES`; `submitQuery` stripped of entity resolution. The resolve processor advances `pending → resolving → gathering` and fans out gather jobs. ✅ |
| B — Partial-failure orphan (P1): query created but no job if `jobs.create` fails | P1 | Compensating `failed` status written on job-create/link failure — a query can never orphan in `pending`. ✅ |
| C — Duplicated entity resolution paths (P1) | P1 | Single resolution path: processor only, `submitQuery` no longer resolves. ✅ |
| D — No index on `research_queries.job_id` (recommended) | P2 | Migration 0148. ✅ |
| E — `job_id` FK without `ON DELETE SET NULL` (recommended) | P2 | Migration 0148. ✅ |
| G — `computeChecksum` delimiter collision (`join("|")`) | P2 | Null-byte delimiter `\0`. ✅ |

**Additional changes in the same commit:**
- LRU eviction helper for the embedding cache (was a raw Map with first-key heuristic that could stall before filling)
- `GET /api/companies/:companyId/background-jobs/:id/download` — streams blob-stored export artifacts (e.g. PDF) with `Content-Disposition: attachment`; returns 404 when the job result has no `objectKey` (legacy inline dataUri results are fetched via the job's getById endpoint instead)
- `POST /api/companies/:companyId/background-jobs` now rejects unregistered/unknown `jobType` at the API boundary with 400 (`Unsupported background job type: ...`) instead of letting the worker claim and fail them
- EXPORT_PDF stores the rendered PDF on blob storage (`kind: "pdf"`, `objectKey`, `byteLength`, `itemCount`, `generatedAt`) when a storage service is configured; falls back to inline base64 dataUri otherwise (dev/test)
- Stale-job requeue sweep (default every 5 min) plus terminal-job retention cleanup in the worker

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

**Also:** Removed stale `embedBatch()` stub (leftover from Finding #4/M2 P2). `RESEARCH_VERIFY_CITATIONS` now uses `getArtifactsByIds()` batch lookup instead of `Promise.all(artifactIds.map(getArtifact))` — eliminating an N+1 query pattern (commit `2796196f91`).

These fixes harden the R1a code against production race conditions and state-machine violations. They apply to unreleased code on `fix/m-series-tech-debt` — no shipped behavior is affected.

### Background Job Processors (R1a-4)

Three processors registered in `background-job-worker.ts`:

| Processor | Behavior |
|-----------|----------|
| `RESEARCH_RESOLVE_ENTITIES` | Enqueued from the route handler on query submit (POST `/research/queries`). Resolves entities from `rawQuery`, always stores them via `setQueryEntities` (even when empty — keeps the `pending → resolving → gathering` chain valid), transitions to `gathering`, fans out one `RESEARCH_GATHER_CITATIONS` job per search-plan entry, or marks `complete` if no plan. **This is now the single entity-resolution path (Finding C).** |
| `RESEARCH_GATHER_CITATIONS` | Iterates the search plan, creating one placeholder stub artifact per entry (source Types `web`/`email`/`portal`, "integration pending (R1a-5)"). Creates a single fallback artifact when the plan is empty. Marks the query `complete` only if not already. |
| `RESEARCH_VERIFY_CITATIONS` | Re-fetches artifacts by checksum via batch `getArtifactsByIds()` lookup. |

## API Endpoints

### Research Queries

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/companies/:companyId/research/queries` | Voyonder JWT | Submit a natural language research query. Creates the query, enqueues `RESEARCH_RESOLVE_ENTITIES`, and returns **202 with `queryId` and `jobId`**. Entity resolution is **asynchronous** — poll `GET /research/queries/:queryId` for status. If job creation/linking fails, the query is marked `failed` (compensation, Finding B) and the original error surfaces to the caller. |
| GET | `/companies/:companyId/research/queries` | Voyonder JWT | List queries, filterable by tripId and status. Paginated (default 50, max 100). |
| GET | `/companies/:companyId/research/queries/:id` | Voyonder JWT | Get single query with resolved entities and status. |

### Research Artifacts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/companies/:companyId/research/artifacts` | Voyonder JWT | List artifacts, filterable by tripId, sourceType, status, researchQueryId. Paginated (default 50, max 100). |
| GET | `/companies/:companyId/research/artifacts/:id` | Voyonder JWT | Get single artifact with full body. |
| PATCH | `/companies/:companyId/research/artifacts/:id` | Voyonder JWT | Update artifact status (pending → verified / rejected). |
| DELETE | `/companies/:companyId/research/artifacts/:id` | Voyonder JWT | Soft-delete artifact (status → rejected). |

### Background Jobs (export / download surface)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/companies/:companyId/background-jobs/:id/download` | Voyonder JWT | Streams a blob-stored export artifact (e.g. PDF) as an attachment. Returns 404 when the job result has no `objectKey` (legacy inline dataUri results — fetch from the job's getById endpoint instead). Content-Type from storage or inferred (`application/pdf`). |
| POST | `/companies/:companyId/background-jobs` | Voyonder JWT | Create a background job (board-only). **New:** rejects any `jobType` not in `BACKGROUND_JOB_TYPES` with 400 `Unsupported background job type: ...` — prevents jobs with no registered processor from getting stuck in `queued`. |

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
- **resolving**: Entity resolution in progress (now always via the background resolve processor)
- **gathering**: Citation gathering from external sources
- **complete**: All sources queried, artifacts written
- **failed**: Entity resolution or all citation sources failed; also set by the compensating write when job creation/linking fails (Finding B) — the query is never left orphaned in `pending`
- **Retry allowed**: `failed → pending` (retry the query; no API endpoint yet — service method only)

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

1. **Query submission is asynchronous now** — POST `/research/queries` returns only `queryId`/`jobId`; resolved entities and search plan are **no longer returned synchronously** in the 202 response. Clients must poll `GET /research/queries/:queryId`. (Behavior change vs the original R1a-3 design; intentional per Option A.)
2. **Citation gathering is stubbed** — Web search, email search, and portal integration (R1a-5) are not wired. The gather processor creates placeholder artifacts from the search plan with "integration pending (R1a-5)" snippets and a fixed confidence of 40-50. Artifacts have no real source URLs or bodies.
3. **Trip planner not built** — Artifacts and trips exist as data but no planner service consumes them to generate itineraries. The data model supports it but the pipeline is incomplete.
4. **PDF export storage varies by environment** — When blob storage is configured, export results carry `objectKey` and are downloaded via `GET /background-jobs/:id/download`. In dev/test without storage, results fall back to inline base64 dataUri in the job result (no `objectKey`) — the download endpoint returns 404 for those; fetch the job's getById result directly instead.
5. **No artifact archival/cleanup** — Soft-deleted artifacts (status=rejected) and terminal query rows accumulate indefinitely (worker performs terminal-job retention cleanup on background_jobs only; research tables not covered).

### Entity Resolution

6. **Regex-only parser** — The entity resolver uses pattern matching, not LLM-based NLP. Complex or ambiguous queries may yield poor entity extraction. LLM-based fallback is planned for R1b but not yet built.
7. **Limited airline & hotel databases** — Only ~30 airlines and ~30 hotel chains are known. Lesser-known brands or regional carriers are not recognized.
8. **Currency assumed USD** — Budget extraction assumes USD. Other currencies (`€500`, `£300`) are not parsed.
9. **No timezone handling** — Relative date resolution uses server timezone. Users in different timezones may see dates offset by a day.
10. **People count is basic** — Only simple patterns ("for 2", "family of 4") are supported. More complex group specifications are not parsed.

### Queries

11. **Query length limited to 500 characters** — Longer queries are rejected with 400.
12. **No query editing** — Once submitted, there's no endpoint to modify a query. Users must submit a new query.
13. **No query cancellation** — There's no endpoint to cancel a running query. If the background job is stuck, the query remains in its current status. (The worker's stale-job requeue sweep mitigates orphaned `running` jobs.)
14. **No retry endpoint** — Failed queries can theoretically be retried (state machine allows `failed → pending`), but there's no API endpoint for this yet — only the service method exists.

### Auth & Security

15. **Company-scoped isolation** — All endpoints enforce company isolation via `assertVoyonderAuth`. The `companyId` is extracted from JWT claims, not the URL path. This matches the VOY-2171 auth migration pattern.
16. **No rate limiting** — Query submission endpoints have no application-level rate limiting. Relies on Stripe/network-level protections.
17. **Actor tracking** — `createdByActorId` records the Voyonder user ID from JWT `sub` claim.

## Troubleshooting

### Query submission

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| POST returns 202 but query shows `failed` immediately | Job creation/linking failed after the query was created — compensating write (Finding B) marked it failed | The query is retryable by submitting a new query; check server logs for the original job-create error. Escalate if recurring. |
| Query stuck in `pending` | Worker not running, or resolve job never claimed | Verify the background job worker is up; the stale-job requeue sweep (every 5 min) re-queues orphaned jobs. |
| Query stuck in `resolving` | Resolve processor crashed mid-flight | Check logs for `RESEARCH_RESOLVE_ENTITIES` processor errors; worker retry loop should retry, then mark failed. |
| Query stuck in `gathering` | Citation gatherer has no real sources yet (R1a-5 not wired) — placeholder artifacts are created but nothing external is fetched | Expected for pre-release builds — artifacts are stubs until R1a-5 lands |
| Response no longer contains `entities`/`searchPlan` | Intentional (r1a-v4) — resolution is async | Poll `GET /research/queries/:queryId`; entities and status are available there once the resolve processor runs |

### Entity resolution returns unexpected results

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| "Paris" resolves to wrong country | Regex-based resolver returns both Paris, France and Paris, Texas with lower confidence | Re-run query with more specific terms ("Paris France flights") |
| Date "next week" resolves incorrectly | Server timezone mismatch | Verify server timezone configuration; dates are absolute, not relative |
| No entities found | Query doesn't match any patterns | Query falls through to keyword search (existing M1 path). Results will still work but without entity enrichment. |

### Exports and background jobs

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| `GET /background-jobs/:id/download` returns 404 "Export artifact not stored on object storage" | Job result has no `objectKey` — legacy inline dataUri result (dev/test without blob storage) | Fetch the job result via the job's getById endpoint and decode the inline dataUri client-side |
| `POST /background-jobs` returns 400 "Unsupported background job type" | Unknown/unregistered jobType (added 8976083b9b) | Use an allowed type from `BACKGROUND_JOB_TYPES`; unregistered types would never run |

### Trip management

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| Cannot delete a trip | DELETE sets status to "cancelled" (soft-delete) | The trip remains in the database but is hidden from default list queries. No hard-delete endpoint exists. |
| Invalid status transition error | Client attempted a transition not in the state machine | Check allowed transitions: draft→researching, researching→planning/draft, planning→confirmed/researching, confirmed→cancelled, cancelled→draft |
| Trip not found (404) | Wrong company scope or tripId | Verify the tripId is correct and belongs to the authenticated company |

## Escalation Path

| Issue | Action | Escalate to |
|-------|--------|-------------|
| Query stuck in `pending`/`resolving` | Verify worker health + retries first; stale sweep re-queues orphans; if still stuck, escalate | Engineering (Founding Engineer / CTO) |
| Query submit returns error after 202 | Check job-create error in logs; query is marked `failed` (compensation); resubmit | Support Engineer + Engineering if recurring |
| Query stuck in gathering | **Expected pre-release** — R1a-5 sources not wired; artifacts are stubs. Document as known limitation. | Support Engineer (documentation) |
| Entity resolver misses obvious entities | Regex-based — submit a test case for pattern expansion | Support Engineer → Founding Engineer (pattern enhancement) |
| API returns 401/403 | Verify JWT is valid, not expired, has correct `sub` and `company_id` claims | Support Engineer + Engineering (auth config) |
| API returns 500 on any endpoint | Server-side error — check logs | Engineering (Founding Engineer / CTO) |
| Trip shows wrong status | Check state machine transition validity; if confirmed as bug, escalate | Founding Engineer |
| Soft-deleted data needs hard-deletion | No hard-delete endpoint exists — requires DB intervention | Engineering (CTO approval required) |

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
|| r1a-v6 | 2026-08-25 | Support Engineer | **P0 infinite-loop fix landed** (commit `6a8fbad1c3`, resolves VOY-2301) — added `/g` flag to AIRLINE_RE/CATEGORY_RE + lastIndex reset. Verified 33 tests pass, suite no longer hangs. Status updated to awaiting code review (VOY-2298) + CTO sign-off. Release no longer BLOCKED by infinite loop. |
|| r1a-v5 | 2026-08-25 | Support Engineer | Updated status: release BLOCKED by new P0 infinite-loop bug (VOY-2298, non-global regexes in entity-resolver). Added finding details: category/airline queries spin forever at 100% CPU, CI test suite hangs. Assigned to Founding Engineer. |
|| r1a-v4 | 2026-08-25 | Support Engineer | Rebased on commit `8976083b9b` (R1a fix impl, VOY-2189): all pre-ship findings resolved (A/B/C + D/E/G). P0 removed. Documented async entity resolution (202 response = queryId+jobId only; poll GET query), compensating `failed` status (Finding B), single resolution path (Finding C), new `GET /background-jobs/:id/download` endpoint, POST background-jobs jobType validation (400), PDF blob-storage results vs inline dataUri fallback, embedding LRU cache, worker stale-sweep. Updated status → committed, release in progress (R1a-8), NOT deployed. |
| r1a-v3 | 2026-08-25 | Support Engineer | Corrected status: R1a-4 processors now built (RESOLVE_ENTITIES / GATHER_CITATIONS / VERIFY_CITATIONS). Added VOY-2267 pre-ship review section — P0 state machine bug (every REST query submit fails), P1 findings B/C, Option A fix direction, 3 recommended pre-ship fixes. N+1 batch lookup in VERIFY_CITATIONS noted. Updated limitations/troubleshooting/escalation to reflect the P0 and stubbed gatherer. |
| r1a-v2 | 2026-08-25 | Support Engineer | Added structural audit findings (A1-A9) all resolved. Documented TOCTOU guards, dedup upsert, test coverage, regex fixes, stale-transition guards. Pre-release hardening on fix/m-series-tech-debt. |
| r1a-v1 | 2026-08-25 | Support Engineer | Initial assessment for R1a Foundation (R1a-1/2/3 committed). Notes feature as incomplete — no citation gatherer, no web search, no TripPage UI. |