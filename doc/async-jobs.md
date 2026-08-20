# Async Jobs (Background Jobs) — Internal Reference

**Last updated:** 2026-08-20 (v3)
**Applies to:** Commit `21e006a3d6` (branch `fix/m-series-tech-debt`), VOY-1493 (M2)
**Status:** M2 committed — worker, 5 real processors, export routes, tray, freshness cues, skeleton loading all implemented and under Staff Engineer review (VOY-1494).

## Overview

The background jobs system allows the application to execute work outside the
request-response cycle. Clients submit a job and receive a `jobId` immediately
(HTTP 202). The client then polls (or subscribes via SSE) for status updates
while the job is processed asynchronously.

This eliminates UI blocking on long-running operations such as activity search,
export generation, or data aggregation.

## Architecture

```
Client                          Server                          DB
  │                               │                               │
  │  POST /research/activities     │                               │
  │  ─────────────────────────►   │                               │
  │  ◄─── 202 { jobId: "…" }     │                               │
  │                               │  INSERT background_jobs       │
  │                               │  ─────────────────────────►  │
  │                               │  ◄─── row (status: queued)    │
  │                               │                               │
  │  GET /background-jobs/:id     │                               │
  │  ─────────────────────────►   │                               │
  │  ◄─── { status: "running" }  │                               │
  │                               │                               │
  │  ─── OR ───                  │                               │
  │                               │                               │
  │  EventSource(/events)         │                               │
  │  ─────────────────────────►   │  SSE stream: background_job   │
  │  ◄─── status updates         │                               │
```

### Data Model

- **Table:** `background_jobs` (company-scoped, cascade deletes)
- **Statuses:** `queued` → `running` → `succeeded` / `failed`
- **Key columns:** `job_type` (discriminator), `payload` (JSONB input),
  `result` (JSONB output), `progress` (0–100), `progress_message`
- **Indexes:** company+status, company+createdAt, jobType

### API Endpoints

| Method | Path | Auth | Description |
|------|------|------|-------------|
| `GET` | `/api/companies/:companyId/background-jobs` | Board/Agent (scope read) | List jobs (paginated, filterable by status/jobType) |
| `GET` | `/api/companies/:companyId/background-jobs/:id` | Board/Agent (scope read) | Get single job by ID |
| `GET` | `/api/companies/:companyId/background-jobs/events` | Board/Agent | SSE stream of job status changes |
| `POST` | `/api/companies/:companyId/background-jobs` | Board only | Create a background job |
| `POST` | `/api/companies/:companyId/research/activities` | Board/Agent (scope read) | Submit an activity search (creates a background job) |
| `POST` | `/api/companies/:companyId/research/auto-assess` | Board/Agent (scope read) | Submit an auto-assessment job (M2) |
| `POST` | `/api/companies/:companyId/research/search` | Board/Agent (scope read) | Keyword-first search (sync) with optional async semantic upgrade via `semanticJobId` → SSE (M2) |
| `POST` | `/api/companies/:companyId/exports/pdf` | Board/Agent (scope read) | Queue a PDF export job (M2) |
| `POST` | `/api/companies/:companyId/exports/ics` | Board/Agent (scope read) | Queue an iCalendar (.ics) export job (M2) |

### SSE Event Format

```
data: {
  "type": "background_job.status",
  "companyId": "…",
  "payload": {
    "jobId": "…",
    "status": "running",
    "progress": 42,
    "progressMessage": "Processing…",
    "result": null,
    "error": null,
    "durationMs": null,
    "startedAt": null,
    "finishedAt": null,
    "updatedAt": "…"
  }
}
```

### UI Components

- **`useJobStatus(companyId, jobId, options?)`** — React hook that polls
  `GET /background-jobs/:id` every 2 seconds, with optional SSE
  subscription for live updates (best-effort, falls back to polling).
- **`StatusCue`** — Compact inline status indicator: colored dot, label,
  optional progress bar + percentage + message + error text.
- **`IncompleteDataNotice`** — Banner shown while data is being prepared
  (e.g. search queued/running, results pending).
- **`ActivitySearchPanel`** — Search input + scope selector + job status
  display. Submits `POST /research/activities`, tracks via `useJobStatus`.
- **`BackgroundProcessTray`** (M2) — Consolidated tray of all background
  work for a company. Subscribes to SSE `/events`, falls back to 5s
  polling; running jobs sort to the top with progress bars and timing.
- **`FreshnessCue` / `FreshnessDot`** (M2) — Visual freshness/staleness
  indicator for research items (green fresh / amber stale / grey unknown).
- **`SkeletonBone` / `SkeletonText` / `FadeIn`** (M2) — Skeleton loading
  placeholders + fade-in wrapper for non-blocking trip-page data.

### Job Types (M2)

| Job type | Processor | Result |
|---|---|---|
| `research.activity_search` | Keyword search over issues, documents, activity | `{ query, results, total }` |
| `research.semantic_search` | Keyword candidates + embedding cosine rerank (falls back to keyword when no embedding provider configured) | `{ query, upgraded, model, results, total }` |
| `research.auto_assess` | Heuristic freshness/completeness/relevance per research item | `{ assessedAt, items[] }` |
| `export.pdf` | Placeholder renderer | `{ kind, title, items, generatedAt }` |
| `export.ics` | iCalendar text builder | `{ kind, title, calendarText, eventCount }` |

## Known Issues (as of 2026-08-20 — M1+M2 complete)

1. **[RESOLVED in M2] No job worker / executor.** The worker
   (`server/src/services/background-job-worker.ts`) now polls for queued
   jobs every 2 seconds and dispatches to per-type processors. The
   `update()` service has active callers. The async pipeline is live.

2. **[RESOLVED in M2] Activity search job type has no concrete processor.**
   `research.activity_search` now does real keyword search across issues,
   documents, and activity log. All five job types (`research.activity_search`,
   `research.semantic_search`, `research.auto_assess`, `export.pdf`,
   `export.ics`) have working processors.

3. **[RESOLVED] Route order fix applied.** The SSE `/events` route is
   registered before the `/:id` wildcard so Express matches it correctly.

4. **SSE is best-effort only.** The UI (`BackgroundProcessTray`,
   `useJobStatus`) falls back to polling if SSE fails. The
   `BackgroundProcessTray` uses 5s polling when SSE is down.
   Individual `useJobStatus` hooks use 2s polling. Poll intervals
   are hardcoded — configurable in a future version.

5. **No job cancellation.** There is no endpoint to cancel a running
   or queued job. The schema has no `cancelled` status. This is a
   future feature.

6. **No retry mechanism.** Failed jobs are not automatically retried.
   A user or operator must resubmit.

7. **No job history / retention cleanup.** Rows accumulate in the
   `background_jobs` table indefinitely. A future version should
   clean up old terminal jobs.

8. **Export processors use real renderers.** `export.pdf` uses pdfkit
   to produce a paginated PDF with title page, item cards, and
   separators — result includes a base64 `dataUri` for direct client
   download. `export.ics` produces valid iCalendar v2.0 text with
   VEVENT entries (sanitized SUMMARY, DTSTART, DTEND, LOCATION,
   DESCRIPTION). ICS includes a 300ms simulated delay before building
   calendar text. Both run inside the worker's 2s tick loop and
   briefly block the event loop during rendering. No blob storage
   integration yet — PDF content is embedded in the result object.

9. **Semantic upgrade requires an embedding provider.** Without
   `PAPERCLIP_EMBEDDING_API_KEY`, `research.semantic_search` falls back
   to keyword ranking automatically, so the job still completes
   successfully.

10. **[RESOLVED in M2] Research activity search processor.** The
    `research.activity_search` processor now executes real keyword
    search (issues, documents, activity log) instead of being a
    no-op placeholder.

11. **SSE `/events` endpoint missing `company_scope:read` check.** The
    SSE route authenticates and verifies company access but does NOT
    call `assertCompanyScopeReadAllowed`. This means an authenticated
    user with basic company access (but no scope-read permission) can
    subscribe to the job-status event stream. The list and get-by-id
    routes DO require scope:read. This is a known authz inconsistency.
    Workaround: SSE subscribers only see job status events — no
    sensitive job payload data is streamed over SSE.

12. **Research routes use read-level auth for write operations.** The
    `POST /research/activities`, `POST /research/auto-assess`, and
    `POST /research/search` all gate on `assertCompanyScopeReadAllowed`
    — a permission intended for read operations. By contrast, the
    general `POST /background-jobs` endpoint is board-only. This means
    any agent or user with company_scope:read can enqueue background
    jobs. The Staff Engineer review flagged this as MEDIUM-severity
    (recommended fix: require board-level auth or create a dedicated
    `background_job:create` permission).

## Troubleshooting Guide

### Job stays in "queued" forever
- **Root cause:** The worker is not running (server not started, or the
  worker loop crashed).
- **Workaround:** Restart the server; verify the startup log shows
  "Background job worker started".
- **Expected fix:** The worker claims queued jobs every 2 seconds
  (`server/src/services/background-job-worker.ts`). If jobs remain
  queued, check the server logs for worker tick errors.

### SSE connection returns 404
- **Check:** Ensure the `/events` route is registered before the `/:id`
  route in `server/src/routes/background-jobs.ts`.
- **Fallback:** `BackgroundProcessTray` and `useJobStatus` fall back to
  polling automatically. Verify polling works by calling
  `GET /api/companies/:companyId/background-jobs/:id` directly.

### Activity search returns no results
- **Check:** The `research.activity_search` processor runs keyword
  search over issues, documents, and activity log. Verify the query
  contains terms present in company data.
- **Fallback:** Broad queries ("all") may return more results.

### Semantic search upgrade never arrives
- **Check:** The `/research/search` endpoint returns keyword-first
  results immediately with a `semanticJobId`. The client subscribes to
  SSE and waits for the job to complete.
- **Root cause:** No `PAPERCLIP_EMBEDDING_API_KEY` configured — the job
  finishes immediately with `upgraded: false`. The result is identical to
  keyword search.
- **Workaround:** The keyword results are available synchronously. The
  semantic upgrade is an enhancement, not a dependency.

### Auto-assessment stays "queued" or fails
- **Check:** `research.auto_assess` assesses the company's most recent
  issues (default) or a specific set of itemIds. Verify the company has
  non-hidden issues.
- **Root cause:** If `itemIds` are provided but none match visible issues,
  the result is an empty `items` array.
- **Fallback:** Call without `itemIds` to get the default assessment of
  recent issues.

### Export job completes with no downloadable file
- **Root cause:** Export processors (`export.pdf`, `export.ics`) are
  scaffolds. The result carries metadata (`kind`, `title`, `generatedAt`)
  but no rendered binary or file URL.
- **Expected:** A follow-up will wire a real PDF renderer and serve the
  generated .ics file for download.
- **Workaround:** The ICS processor does produce valid iCalendar v2.0
  text in `result.calendarText` — a client-side download button can
  construct a blob from that data.

### UI shows "Search queued — results will appear shortly" indefinitely
- **Root cause:** The job never transitions out of `queued` (worker not
  running — see first troubleshooting item).
- **Workaround:** Restart the server to restart the worker.
- **Escalation:** Report to engineering with the job ID (visible in
  network tab / browser console).

### BackgroundProcessTray not appearing
- **Check:** The tray only renders when there are jobs — if the company
  has no background jobs, the component returns null.
- **Check:** The tray subscribes to SSE for live updates. If SSE is
  unreachable, it falls back to 5s polling. Verify the companyId is
  correct.

### FreshnessCue shows "Unknown" for recently updated items
- **Check:** The cue computes age from the `updatedAt` timestamp. If
  the timestamp is in the future or parse failure, it returns "unknown".
- **Thresholds:** "fresh" = ≤7 days, "stale" = ≤30 days, "unknown" = >30
  days. These are defaults; `FreshnessCue` accepts custom thresholds as
  props.

### SSE events visible without proper permissions
- **Check:** The SSE `/events` endpoint does not check
  `company_scope:read`. Any authenticated user with company access can
  subscribe. If this is a concern, restrict SSE access at the
  infrastructure layer (reverse proxy ACL).
- **Impact:** SSE subscribers see job status events (progress, status
  transitions) but not the original job payload or sensitive result
  data.
- **Expected fix:** Add `assertCompanyScopeReadAllowed` to the SSE
  route (tracked as Staff Engineer recommendation C5 in VOY-1494).

### Agent/users can enqueue research jobs without board authorization
- **Check:** The research routes (`/research/activities`,
  `/research/auto-assess`, `/research/search`) use
  `assertCompanyScopeReadAllowed` — a read-level permission — to gate
  write operations (creating background jobs). Any agent or user with
  company_scope:read can submit jobs.
- **Contrast:** The general `POST /background-jobs` endpoint requires
  board-level auth.
- **Workaround:** If an agent is enqueueing excessive research jobs,
  revoke the agent's `company_scope:read` permission or remove the
  agent from the company.
- **Expected fix:** Add board-level auth or a dedicated
  `background_job:create` permission (tracked as Staff Engineer
  recommendation C4 in VOY-1494).

## Support Escalation Path

| Issue | Action | Escalate to |
|---|---|---|
| Job stuck in queued | Verify worker is deployed, restart server | Engineering (Founding Engineer / CTO) |
| SSE not working | Check route ordering, verify polling fallback works | Engineering |
| Activity search returns no data | Verify query terms exist in company data | Engineering |
| Semantic upgrade missing | Check `PAPERCLIP_EMBEDDING_API_KEY` is set; keyword results still returned | Engineering (config) |
| Export job result contains dataUri (PDF) or calendarText (ICS) | PDF is a real pdfkit-rendered document (base64 dataUri). ICS is valid v2.0 calendar text. No blob storage yet — client downloads from the result object. | Engineering (blob storage follow-up) |
| UI display issues (StatusCue blank, tray missing, etc.) | Check browser console for errors, refresh | Support Engineer + Engineering |
| SSE accessible without scope:read | Assess if this is a concern — restrict at reverse proxy if needed | Engineering (authz fix) |
| Research jobs submitted without board auth | Revoke agent's company_scope:read if abusive | Support Engineer + Engineering (authz fix) |

## Version History

| Version | Date | Author | Changes |
|---|---|---|---|
| 1 | 2026-08-20 | Support Engineer | Initial support case assessment for VOY-1474/VOY-1492 (M1) |
| 2 | 2026-08-20 | Support Engineer | M2 update: worker + 5 processors live, export routes, BackgroundProcessTray, FreshnessCue, skeleton loading, keyword-first semantic search (VOY-1493) |
| 3 | 2026-08-20 | Support Engineer | Corrected export processor accuracy (pdfkit real renderer, ICS v2.0 text), added SSE authz gap (#11) and research route authz inconsistency (#12), added troubleshooting for both authz items, updated escalation table (VOY-1493 post-commit audit) |