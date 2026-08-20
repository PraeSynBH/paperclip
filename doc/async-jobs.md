# Async Jobs (Background Jobs) — Internal Reference

**Last updated:** 2026-08-20
**Applies to:** Commit pending (branch `fix/m-series-tech-debt`), VOY-1492

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
|---|---|---|---|
| `GET` | `/api/companies/:companyId/background-jobs` | Board/Agent (scope read) | List jobs (paginated, filterable by status/jobType) |
| `GET` | `/api/companies/:companyId/background-jobs/:id` | Board/Agent (scope read) | Get single job by ID |
| `GET` | `/api/companies/:companyId/background-jobs/events` | Board/Agent | SSE stream of job status changes |
| `POST` | `/api/companies/:companyId/background-jobs` | Board only | Create a background job |
| `POST` | `/api/companies/:companyId/research/activities` | Board/Agent (scope read) | Submit an activity search (creates a background job) |

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

## Known Issues (as of 2026-08-20)

1. **No job worker / executor.** The infrastructure (table, API, UI) is
   complete, but there is no background worker that processes jobs. Jobs
   stay in `queued` status forever. The `update()` method exists in the
   service but has zero callers. Until a worker loop is added (reading
   `background_jobs` where status = `queued`, calling `svc.update()` to
   transition through `running` → terminal), the async pipeline is a
   dead end.

2. **Route order fix applied.** The SSE `/events` route is registered
   before the `/:id` wildcard so Express matches it correctly. This was
   flagged in review and corrected in the working tree.

3. **Activity search job type has no concrete processor.** The
   `research.activity_search` job type is the only consumer wired today,
   but the actual search logic must be added to the worker when it is
   built.

4. **SSE is best-effort only.** The UI falls back to polling if SSE
   fails. Polling is hardcoded to 2-second intervals. This is acceptable
   for the M1 scope but should be configurable in future versions.

5. **No job cancellation.** There is no endpoint to cancel a running
   or queued job. The schema has no `cancelled` status. This is an M2+
   feature.

6. **No retry mechanism.** Failed jobs are not automatically retried.
   A user or operator must resubmit.

7. **No job history / retention cleanup.** Rows accumulate in the
   `background_jobs` table indefinitely. A future version should
   clean up old terminal jobs.

## Troubleshooting Guide

### Job stays in "queued" forever
- **Root cause:** No worker is running. The job pipeline is a dead end
  until a worker loop is deployed.
- **Workaround:** Contact engineering to deploy the background worker.
- **Expected fix:** Worker loop reading `status = "queued"` rows and
  calling `svc.update()` to process them.

### SSE connection returns 404
- **Check:** Ensure the `/events` route is registered before the `/:id`
  route in `server/src/routes/background-jobs.ts`.
- **Fallback:** The UI falls back to polling. Verify polling works by
  calling `GET /api/companies/:companyId/background-jobs/:id` directly.

### Activity search returns no results
- **Root cause:** The `research.activity_search` job type has no
  concrete processor implemented yet.
- **Workaround:** None until the worker and search logic are deployed.
- **Expected fix:** Add search logic in the background worker.

### UI shows "Search queued — results will appear shortly" indefinitely
- **Root cause:** The job never transitions out of `queued` (see above).
- **Workaround:** Reload the page and try again — the job is still in
  the same state.
- **Escalation:** Report to engineering with the job ID (visible in
  network tab / browser console).

## Support Escalation Path

| Issue | Action | Escalate to |
|---|---|---|
| Job stuck in queued | Verify worker is deployed | Engineering (Founding Engineer / CTO) |
| SSE not working | Check route ordering, verify polling fallback works | Engineering |
| Activity search returns no data | This is expected until worker + search logic ships | Engineering |
| UI display issues (StatusCue blank, etc.) | Check browser console for errors, refresh | Support Engineer + Engineering |

## Version History

| Version | Date | Author | Changes |
|---|---|---|---|
| 1 | 2026-08-20 | Support Engineer | Initial support case assessment for VOY-1474/VOY-1492 (M1) |