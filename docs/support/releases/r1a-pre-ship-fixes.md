---
title: R1a Pre-ship Fixes — Async Job Hardening + Entity Resolution Stability
version: r1a-v6.2
date: 2026-08-25
commits: 6a8fbad1c3, 8976083b9b, e64c43ac49, 7f19a15e76
status: Deploying — merging fix/m-series-tech-debt to master, CTO sign-off granted 2026-08-25 ~21:02 UTC, Release Engineer deploying to production
---

# R1a Pre-ship Fixes: Async Job Hardening + Entity Resolution Stability

**Branches:** `fix/m-series-tech-debt` (merging to `master`)
**Release status:** CTO signed off at 2026-08-25 ~21:02 UTC. Staff Engineer re-verified all fixes at 20:27 UTC. Release Engineer is resolving merge conflicts and deploying to production.
**Applies to:** VOY-2172 (R1a Foundation) + VOY-2269 (Pre-ship Findings) + VOY-2301 (P0 Infinite Loop) + VOY-2318 (M2-F1 Idempotency) + VOY-2319 (M2-F2 useBackgroundProcesses)

---

## What Changed

This release fixes all pre-ship findings from the R1a structural audit and the M2 P1 items, ensuring the async research pipeline and trip page background processes are stable and correct.

### R1a Foundation Fixes (VOY-2269 / VOY-2301)

| Finding | Fix | Severity |
|---------|-----|----------|
| **State machine broken** — Route handler enqueued `RESEARCH_RESOLVE_ENTITIES` incorrectly, breaking the entity resolution → citation gathering flow | Route handler corrected to properly enqueue the state machine transition | **P0** |
| **Orphan queries on job failure** — If a background job failed after creating the query row, the orphan query was never cleaned up | Transaction wrap on job creation — query creation and job linkage are now atomic | **P1** |
| **Duplicate entity resolution** — Multiple paths through `RESEARCH_RESOLVE_ENTITIES` could create duplicate resolution attempts | Single resolution path enforced — all entity resolution flows through one codepath | **P1** |
| **Infinite loop in entity resolver** — `AIRLINE_RE` and `CATEGORY_RE` lacked the `/g` flag, causing `while((m = RE.exec(query))` to loop forever on any query with a category word or airline name | Added `/g` flag to both regexes + `lastIndex = 0` reset before each match loop. 33 regression tests added and verified | **P0** |
| **Query performance** — Missing index on `research_queries.job_id`, missing FK `ON DELETE CASCADE`, delimiter collision in `computeChecksum` | Index added on `job_id`, FK `ON DELETE CASCADE` added, `computeChecksum` delimiter changed to prevent collision | **P2** |

### M2 Trip Page Fixes (M2-F1 / M2-F2)

These fixes ship alongside the R1a pre-ship fixes as part of the same release branch:

| Fix | Issue | Description |
|-----|-------|-------------|
| **M2-F1: Duplicate GATHER_CITATIONS jobs on retry** | VOY-2318 | Idempotency guard in `RESEARCH_RESOLVE_ENTITIES` processor — skips gather-job creation if the query already has a linked jobId or is past `pending` status. Prevents duplicate citation gathering on job retries. |
| **M2-F2: useBackgroundProcesses dual polling race** | VOY-2319 | New shared `useBackgroundProcesses` hook consolidating SSE + polling for background process tracking. Grace-period approach (5s delay before polling if SSE doesn't connect). New `InlineProcessDisplay` component for mode-aware progress (Plan: inline bar; Prepare: collapsible tray; Go: hidden). BackgroundProcessTray refactored to use shared hook. |

### Correction Note

The initial M2-F1 idempotency guard (commit `e64c43ac49`) had a logic error: it checked `existingQuery.jobId` which is always set because the route handler links the job to the query before the processor runs — this caused every `RESEARCH_RESOLVE_ENTITIES` run to skip itself, making entity resolution never execute. The correction (commit `7f19a15e76`) passes the current `jobId` to the processor and only skips when the query status is past `pending` AND a *different* jobId is linked. This correctly distinguishes first-run from retry. No user-facing behavioral change from the corrected version.

## Background Jobs

| Job Type | Processor | Notes |
|----------|-----------|-------|
| `research.activity_search` | Keyword search over issues, documents, activity | Unchanged from M1 |
| `research.semantic_search` | Keyword + embedding cosine rerank | Unchanged from M1 |
| `research.auto_assess` | Heuristic freshness/completeness/relevance | Unchanged from M1 |
| `export.pdf` | pdfkit paginated PDF | Unchanged from M1 |
| `export.ics` | iCalendar v2.0 text builder | Unchanged from M1 |
| `research.resolve_entities` (RESEARCH_RESOLVE_ENTITIES) | Entity extraction + GATHER_CITATIONS dispatch | **Fixed** — state machine routing corrected, idempotency guard added |

## Support Impact

### For Support Staff

| Change | What to know |
|--------|-------------|
| **Entity resolution is now stable** | The infinite loop bug that could pin CPU at 100% on category/airline queries is fixed. Research queries with words like "flights", "hotels", "Delta" no longer hang the worker. |
| **No more orphan queries** | If a background job fails during query creation, the transaction rolls back cleanly — no leftover query rows without a job reference. |
| **Retry-safe entity resolution** | If a `RESEARCH_RESOLVE_ENTITIES` job retries, it no longer creates a duplicate `GATHER_CITATIONS` job. Entity resolution runs exactly once per query. |
| **InlineProcessDisplay added** | Trip pages now show mode-aware background process progress: inline progress bar in Plan mode, collapsible tray in Prepare mode, hidden in Go mode. |
| **useBackgroundProcesses shared hook** | Background process tracking across the app now uses a shared SSE + polling hook with consistent behavior. |
| **Improved query performance** | The `research_queries` table now has an index on `job_id` and cascading deletes — query joins and cleanup operations are faster and safer. |

## Known Limitations

| Issue | Status |
|-------|--------|
| SSE is best-effort — UI falls back to polling on failure | Open |
| No job cancellation endpoint — schema has no `cancelled` status | Open |
| No job history/retention cleanup — terminal rows accumulate indefinitely | Open |
| Research routes use `company_scope:read` (read-level auth) for write operations | Open (Staff Engineer recommendation C4) |
| No blob storage — export results embed base64 data (PDF) or calendar text (ICS) in the result object | Open |
| Semantic upgrade requires `PAPERCLIP_EMBEDDING_API_KEY` — falls back to keyword ranking without it | Open (infra config) |
| M2 Trip Pages are not yet fully deployed — Plan/Prepare/Go mode trip pages, Intelligent Urgency hierarchy, and Sage AI chat composer will ship in a subsequent M2 release | Open |

## Related Documentation

- [Research Artifact Service Support Case](../assessments/support-case-research-artifact-service.md) — Updated for R1a Foundation fixes
- [M2 Trip Pages Support Case](../assessments/support-case-m2-trip-pages.md) — Updated for M2-F1/M2-F2 fixes
- [Async UX Release Notes](./voy-1474-async-ux.md) — Original async job framework release
- [Background Jobs API](/api/background-jobs) — API reference for background job endpoints
- [Research API](/api/research) — API reference for research endpoints

*Last updated: 2026-08-25 ~21:05 UTC — CTO sign-off granted, Release Engineer deploying*
*Maintained by: Support Engineer (88b72065)*
