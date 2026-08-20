---
title: Async UX Release — Background Jobs + Process Visibility (M1+M2)
version: voy-1474
date: 2026-08-20
commits: 7211f8ba87, 01009090bf, daa8360578, f81d572a40
status: Pre-release — committed on fix/m-series-tech-debt, pending merge to fork/master
---

# Async UX Release: Background Jobs + Process Visibility (M1+M2)

**Branches:** `fix/m-series-tech-debt`
**Release status:** Pre-release — committed on `fix/m-series-tech-debt`, pending merge to `fork/master`. Documentation verified in sync (VOY-1525).
**Applies to:** VOY-1474 (M1) + VOY-1493 (M2 post-review fixes)

---

## What Changed

This release ships the async job framework and background process visibility improvements. Long-running operations no longer block the UI — they return immediately with a job ID, and the client tracks progress via polling or Server-Sent Events (SSE).

### M1: Async Job Foundation (VOY-1474)

The first milestone established the core background job infrastructure:

- **Background jobs table + data model** — `background_jobs` table with `queued → running → succeeded → failed` status lifecycle, company-scoped with cascade delete, JSONB payload/result columns, progress tracking (0–100 + message), and indexed for query performance.
- **Job creation API** — `POST /api/companies/:companyId/background-jobs` creates a job (board-only). Returns HTTP 201 with the job row.
- **Job list/detail API** — `GET .../background-jobs` (paginated, filterable by status/job type) and `GET .../background-jobs/:id`.
- **SSE event stream** — `GET .../background-jobs/events` streams job status changes in real time. Authenticated users must have `company_scope:read` permission.
- **Activity search → background job** — `POST /api/companies/:companyId/research/activities` now creates a background job instead of running inline. Returns HTTP 202 with a `jobId`.
- **`useJobStatus` React hook** — Polls every 2 seconds with optional SSE subscription for live updates (best-effort, falls back to polling).
- **`StatusCue`** — Compact inline job status indicator (colored dot, label, optional progress bar).
- **`IncompleteDataNotice`** — Banner shown while data is being prepared.
- **`ActivitySearchPanel`** — Search input + scope selector + job status display.

### M2: Process Visibility + Additional Job Types (VOY-1493)

The second milestone added the remaining job types, visual process indicators, and post-review hardening:

| Feature | Description |
|---------|-------------|
| **Auto-assess → background job** | `POST /api/companies/:companyId/research/auto-assess` now returns HTTP 202 with a `jobId` instead of running inline |
| **Keyword-first search + async semantic upgrade** | `POST /api/companies/:companyId/research/search` returns keyword results synchronously and optionally enqueues a semantic re-ranking job. The response includes a `semanticJobId` — clients subscribe to SSE for upgraded results |
| **PDF export** | `POST /api/companies/:companyId/exports/pdf` queues a PDF generation job using pdfkit. Returns HTTP 202. Payloads over 512 KB are rejected with HTTP 413 |
| **iCalendar export** | `POST /api/companies/:companyId/exports/ics` queues an iCalendar v2.0 generation job. Returns HTTP 202. Payloads over 512 KB are rejected with HTTP 413 |
| **BackgroundProcessTray** | Consolidated tray in the sidebar showing all background work for a company. Subscribes to SSE, falls back to 5-second polling. Running jobs sort to the top with progress bars and timing |
| **FreshnessCue / FreshnessDot** | Visual freshness/staleness indicators on research items — green (fresh, ≤7 days), amber (stale, ≤30 days), grey (unknown, >30 days) |
| **Skeleton loading** | `SkeletonBone` / `SkeletonText` components with `FadeIn` wrapper for non-blocking trip-page reveal |

### Post-Review Hardening (f81d572a40, M2)

All Staff Engineer findings from the M2 structural audit were addressed:

| Finding | Fix |
|---------|-----|
| **Transaction-atomic claim** | Job claim (`FOR UPDATE SKIP LOCKED` + status update to `running`) wrapped in a single `db.transaction()` — eliminates race where two workers could claim the same job |
| **Processor timeout** | Each processor runs under `Promise.race` with a 5-minute timeout (configurable). Prevents stuck jobs from blocking the queue |
| **Retry with exponential backoff** | Transient processor failures retry up to 2 times with delays of 1s, 2s, and 4s (capped at 30s). After all retries exhausted, job marked `failed` permanently |
| **candidateIds scoping** | `research.semantic_search` processor accepts optional `candidateIds` to scope semantic upgrade to the keyword-first result set the user saw. The route passes these automatically |
| **SSE authz enforcement** | SSE `/events` endpoint now checks `assertCompanyScopeReadAllowed`, matching the list and get-by-id routes |
| **Export payload size cap** | PDF and ICS export payloads over 512 KB are rejected with HTTP 413 at submission time |
| **DB CHECK constraints** | Migration 0144 adds CHECK constraints on `status`, `progress`, and `duration_ms` |
| **Partial queued index** | Partial index on `status = 'queued'` serves the worker's claim query |
| **Graceful shutdown** | Worker supports draining in-flight jobs with a configurable grace period (default 30s) |

## Job Types

| Job Type | Processor | Result |
|----------|-----------|--------|
| `research.activity_search` | Keyword search over issues, documents, activity | `{ query, results, total }` |
| `research.semantic_search` | Keyword candidates + embedding cosine rerank (falls back to keyword when no embedding provider configured) | `{ query, upgraded, model, results, total }` |
| `research.auto_assess` | Heuristic freshness/completeness/relevance per research item | `{ assessedAt, items[] }` |
| `export.pdf` | pdfkit paginated PDF (title page, item cards, separators) — result carries base64 `dataUri` | `{ kind, title, items, generatedAt, dataUri }` |
| `export.ics` | iCalendar text builder (v2.0, VEVENT entries with sanitized fields) | `{ kind, title, calendarText, eventCount }` |

## Known Limitations

| Issue | Status |
|-------|--------|
| SSE is best-effort — UI falls back to polling on failure | Open |
| No job cancellation endpoint — schema has no `cancelled` status | Open |
| No job history/retention cleanup — terminal rows accumulate indefinitely | Open |
| Research routes use `company_scope:read` (read-level auth) for write operations — any agent or user with scope:read can enqueue jobs | Open (Staff Engineer recommendation C4) |
| No blob storage — export results embed base64 data (PDF) or calendar text (ICS) in the result object | Open |
| Semantic upgrade requires `PAPERCLIP_EMBEDDING_API_KEY` — falls back to keyword ranking without it | Open (infra config) |

## Support Impact

### For Support Staff

| Change | What to know |
|--------|-------------|
| **Activity search now async** | Users see a "Search queued — results will appear shortly" message while the job runs. If this persists, verify the worker is running (restart server) |
| **Export generates via background job** | PDF/ICS requests return immediately with a job ID. The download must be constructed client-side from the job result (`result.dataUri` for PDF, `result.calendarText` for ICS) |
| **Export payload limit** | Payloads over 512 KB receive HTTP 413. Advise users to reduce item counts before exporting |
| **Semantic search is optional** | The search endpoint returns keyword results synchronously. Semantic upgrade is an enhancement — if it never arrives, check `PAPERCLIP_EMBEDDING_API_KEY` |
| **BackgroundProcessTray shows live progress** | Running jobs appear with progress bars at the top. The tray only renders when there are jobs |
| **Freshness indicators** | Research items show age via green/amber/grey dots. "Unknown" may indicate a timestamp parse failure |
| **SSE authz enforced** | The SSE `/events` endpoint requires `company_scope:read`. Users without this permission will see 404/forbidden |

## Related Documentation

- [Async Jobs Internal Reference](/doc/async-jobs.md) — Full internal reference with architecture, API details, troubleshooting guide, and escalation paths
- [Background Jobs API](/api/background-jobs) — API reference for background job endpoints
- [Research API](/api/research) — API reference for research endpoints (activity search, auto-assess, keyword-first search)
- [Exports API](/api/exports) — API reference for PDF/ICS export endpoints
