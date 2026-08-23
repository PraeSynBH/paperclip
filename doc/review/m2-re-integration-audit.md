# Structural Audit: M2 Background Job System Re-integration

**Reviewer:** Staff Engineer (eee825c7)
**Date:** 2026-08-22 ~16:00 UTC
**Scope:** 7 untracked files implementing background job infrastructure + integration wiring
**Status:** REVIEW COMPLETE — changes applied, structural issues documented below

## Files Reviewed

| File | Status | Notes |
|------|--------|-------|
| `packages/shared/src/types/background-job.ts` | UPDATED | Added `CreateBackgroundJobRequest`, `BackgroundJobEvent` interfaces; uses `BackgroundJobStatus` from shared constants |
| `server/src/services/background-jobs.ts` | FIXED | Fixed `toApi()` slim mode to preserve non-dataUri fields; added progress/progressMessage reset to `requeueStaleJobs` |
| `server/src/services/background-job-worker.ts` | REVIEWED | Clean architecture with detached processor registration pattern. Recursive retry bounded to 3 attempts. |
| `server/src/services/research-search.ts` | REWRITTEN | Upgraded from simple LIKE to `ilike` (case-insensitive), tokenized search with scoring, comment body + document body search |
| `server/src/services/research-export.ts` | REVIEWED | Stub implementations — real PDFKit/ICS generation deferred |
| `server/src/routes/background-jobs.ts` | REVIEWED | SSE `/events` route, list + get-by-id. Auth via `assertCompanyAccess`. |
| `server/src/routes/research.ts` | UPDATED | Refactored to use `BACKGROUND_JOB_TYPES` constants; processor registration moved inline; auth uses `assertCompanyAccess` |

## Integration Work Applied

### Exports wired
- ✅ `backgroundJobs` table exported from `packages/db/src/schema/index.ts`
- ✅ `BackgroundJob`, `CreateBackgroundJobRequest`, `BackgroundJobEvent` types exported from `packages/shared/src/index.ts`
- ✅ `BackgroundJobStatus`, `BACKGROUND_JOB_TYPES`, `BackgroundJobType` exported from new `packages/shared/src/background-job-types.ts`
- ✅ `background_job.status` added to `LIVE_EVENT_TYPES` in constants.ts

### Routes + Worker wired
- ✅ `backgroundJobRoutes` mounted at `/api/companies/:companyId/background-jobs`
- ✅ `researchRoutes` mounted at `/api/companies/:companyId/research`
- ✅ Worker started in `createApp()` after `jobCoordinator.start()`
- ✅ Worker shutdown added to `shutdownAppServices()`

### Existing dependencies confirmed
- ✅ `server/src/services/live-events.ts` exists (EventEmitter-based pub/sub)
- ✅ `packages/shared/src/types/live.ts` exports `LiveEvent` interface
- ✅ `accessService` exported from `server/src/services/index.ts`

## Structural Issues Found and Fixed

### 1. [CRITICAL - FIXED] Slim mode data loss in `toApi()`
The `slim=true` path in `background-jobs.ts:toApi()` set `result: null`, which stripped ALL result data from list responses (not just the binary `dataUri`). This would break any client that reads non-binary result fields (e.g. `query`, `total`, `upgraded`) from list endpoints. Fixed to `slim && row.result ? { ...row.result, dataUri: undefined } : row.result`.

### 2. [MEDIUM - FIXED] Case-sensitive search
`research-search.ts` used PostgreSQL `LIKE` (case-sensitive). Upgraded to `ilike` (case-insensitive) with tokenized search, scoring, and document/comment body search.

### 3. [LOW - FIXED] Stale job recovery didn't reset progress
`requeueStaleJobs()` didn't reset `progress` to 0 and `progressMessage` to null, so a stale-recovered job would show its previous misleading progress value. Fixed.

### 4. [LOW - MONITOR] Auth level alignment
Research routes use `assertCompanyAccess` (general company membership) rather than the stricter `assertCompanyScopeReadAllowed` (scoped read permission). The stricter version doesn't exist in the authz module. If tighter auth is needed, `assertCompanyScopeReadAllowed` must be added to authz.ts — tracked as a future hardening item.

### 5. [INFO] Export implementations are stubs
Both `export.pdf` and `export.ics` return minimal placeholder data. The branch version on `fix/m-series-tech-debt` has real PDFKit-based PDF rendering and proper iCalendar generation that should be merged when ready.

### 6. [INFO] Semantic search is a stub
`upgradeSemanticResults` returns the same keyword results unchanged. The branch version has embedding-based re-ranking with cosine similarity that should be merged when an embedding provider is configured.

### 7. [INFO] No tests
No unit or integration tests exist for the background job system. Recommended: add tests for `backgroundJobService` (create, succeed, fail, claimNext, requeueStaleJobs) and for the worker's processJob retry logic.

## Deployment Checklist

Before shipping to production:
- [ ] Run DB migrations (0229 already applied — `background_jobs` table exists)
- [ ] Verify `PAPERCLIP_EMBEDDING_API_KEY` configured if semantic search is desired
- [ ] Verify `pdfkit` npm dependency installed if real PDF export is needed
- [ ] Smoke-test: POST `/api/companies/:cid/research/search` returns keyword results
- [ ] Smoke-test: POST `/api/companies/:cid/research/auto-assess` returns 202 with jobId
- [ ] Smoke-test: GET `/api/companies/:cid/background-jobs` returns slim list
- [ ] Smoke-test: SSE `/events` stream delivers `background_job.status` events

## Sign-off

**Disposition:** APPROVED with conditions (items 4-7 above are known gaps, not blockers).
**Next:** Route to CTO for go/no-go on shipping.
