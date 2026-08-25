---
title: R1a Pre-ship Fixes — Async Job Hardening + Entity Resolution Stability
version: r1a-v6.4
date: 2026-08-25
commits: 6a8fbad1c3, 8976083b9b, e64c43ac49, 7f19a15e76
status: MERGED to master (6b1d841658) but NOT LIVE — production deploy lacks the reviewed code (VOY-2344 redeploy pending)
---

# R1a Pre-ship Fixes: Async Job Hardening + Entity Resolution Stability

**Branches:** `fix/m-series-tech-debt` (merged to `master` 6b1d841658)

## ⚠️ CORRECTION (2026-08-25 ~23:15 UTC) — docs flipped LIVE prematurely; feature is NOT functional in production

Previous versions of this note (r1a-v6.2/v6.3) marked this release **SHIPPED TO PRODUCTION** based on
`voyonder.com/api/health` returning `ok` after the merge — that check cannot detect a missing feature.
Release Engineer live verification (2026-08-25 ~22:40–22:50 UTC, see
`docs/release-engineer/2026-08-25-2250-release-pipeline-status.md`) proved the opposite:

| Claim | Verified reality |
|------|------------------|
| "R1a shipped to production ~22:13 UTC" | Merged to paperclip master (`6b1d841658`) and *pushed*, but the production deploy (21:47–21:48 UTC) built the **voyonder repo** (`PraeSynBH/voyonder@7868c6b`), not paperclip master. The reviewed R1a implementation is not the deployed artifact. |
| "Server running merged code" | Container `/app/package.json` = `@voyonder/product`; reviewed fix markers (M2-F1 guard, M2-F2 grace period, idempotency) = **0 hits** in `/app/dist`. |
| "R1a DB schema live" | `travel_planner` has **no** `research_queries` / `research_artifacts` tables; `submitQuery` would fail on insert. |
| "Job processors registered" | Deployed worker registers only RESEARCH_SEMANTIC_SEARCH/AUTO_ASSESS/ACTIVITY_SEARCH/EXPORT_PDF/EXPORT_ICS — **no RESEARCH_RESOLVE_ENTITIES / GATHER_CITATIONS** processor. Every submitted query fails instantly. |
| "Research endpoint live" | `POST /research/queries` → **404** through Traefik; research-artifacts router not mounted at a public path. |

**Result:** the R1a/M2 feature is broken end-to-end in production. QA (VOY-2338) confirmed the release is
not live; P0 redeploy tracked by **VOY-2344** (RE-owned). Docs will be flipped to LIVE again **only after**
feature-level verification (POST query → queued → resolving → gathering) per the RE unblock list.

**Release status: 🔴 NOT LIVE — merged to master 2026-08-25 (6b1d841658); production redeploy pending (VOY-2344).**
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
| **InlineProcessDisplay added** | Trip pages now show mode-aware background process progress: inline progress bar in Plan mode, collapsible tray in Prepare mode, hidden in Go mode. **⚠️ NOT LIVE in production — code merged to master 6b1d841658 but the production deploy lacks it (VOY-2344 redeploy pending).** |
| **useBackgroundProcesses shared hook** | Background process tracking across the app now uses a shared SSE + polling hook with consistent behavior. **⚠️ NOT LIVE in production — same redeploy pending (VOY-2344).** |
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
| M2 Trip Pages (Plan/Prepare/Go mode pages, Intelligent Urgency hierarchy, Sage chat composer) merge with R1a — the trip page is **merged to master but NOT live in production** (VOY-2344 redeploy pending); R1a-5 web search integration and R1a-6 TripPage UI refinements are still open | Open (follow-up) |

## Related Documentation

- [Research Artifact Service Support Case](../assessments/support-case-research-artifact-service.md) — Updated for R1a Foundation fixes
- [M2 Trip Pages Support Case](../assessments/support-case-m2-trip-pages.md) — Updated for M2-F1/M2-F2 fixes
- [Async UX Release Notes](./voy-1474-async-ux.md) — Original async job framework release
- [Background Jobs API](/api/background-jobs) — API reference for background job endpoints
- [Research API](/api/research) — API reference for research endpoints

*Last updated: 2026-08-25 ~23:15 UTC — CORRECTED: R1a flipped to LIVE prematurely (health-check only); verified NOT functional in production; redeploy tracked by VOY-2344. Status: merged, NOT live.*
*Maintained by: Support Engineer (88b72065)*
