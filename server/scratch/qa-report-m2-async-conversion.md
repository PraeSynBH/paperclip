# QA Assessment Report — M2 Research Async Conversion + Process Visibility

**Agent:** QA Engineer (689a1e64-5151-4c46-bb98-3ea5f650c4b0)
**Branch:** fix/m-series-tech-debt
**Date:** 2026-08-24

## Test Results

| Test file | Tests | Result |
|-----------|-------|--------|
| `background-jobs-service.test.ts` | 17 | ✅ ALL PASSED |
| `research-search-service.test.ts` | 12 | ✅ ALL PASSED |
| **Total** | **29** | **✅ ALL PASSED** |

## Scope Verification

### 1. POST /api/research/autoAssess → fire-and-forget background job
- Route creates `research.auto_assess` job → returns `202 { jobId }`
- Processor: heuristic freshness/completeness/relevance scoring
- SSE events published for real-time UI updates

### 2. POST /api/research/search → keyword-first + async semantic upgrade via SSE
- Immediate sync keyword-first results returned
- Optional `semanticJobId` for async semantic upgrade
- Client subscribes to SSE `/events` for upgrade result
- Embedding cosine similarity (70/30 keyword blend) with graceful fallback

### 3. Background Process Tray (consolidated background work)
- Full API: list, getById, SSE events, create (board-only)
- Worker: 5 processors, transaction-atomic claim, retry with backoff, timeout
- Stale-job recovery on startup

### 4. PDF/ICS export → background job
- `POST /exports/pdf` and `/exports/ics` → `202 { jobId }`
- pdfkit PDF renderer, iCalendar v2.0 builder
- 512KB payload cap (413 on oversized requests)

### 5. Freshness/staleness cues
- `autoAssess` returns `freshness: "fresh" | "stale" | "unknown"`
- Thresholds: ≤7d fresh, ≤30d stale, >30d unknown

### 6. Trip page skeleton loading
- UI components: SkeletonBone, SkeletonText, FadeIn

## Architecture Review

| Component | Status | Notes |
|-----------|--------|-------|
| Terminal-status guard | ✅ | `update()` refuses to overwrite succeeded/failed |
| Transaction-atomic claim | ✅ | FOR UPDATE SKIP LOCKED + status update single tx |
| Processor timeout | ✅ | Promise.race 5-min default |
| Retry loop | ✅ | 2 retries, exponential backoff capped 30s |
| EmitEvent guard | ✅ | try/catch prevents SSE failure corrupting DB |
| Stale-job recovery | ✅ | Startup sweep requeues orphaned running jobs |
| Slim projection | ✅ | list() strips dataUri; getById() returns full |
| Company isolation | ✅ | All queries WHERE-scoped |
| Live events integration | ✅ | background_job.status in LIVE_EVENT_TYPES |
| DB CHECK constraints | ✅ | status, progress (0-100), duration_ms >= 0 |
| Partial index queued | ✅ | Serves worker claim query |

## Verdict: **PASS** ✅

Implementation complete. All tests pass. Architecture is solid with proper error handling, retries, isolation, and graceful degradation. Remaining known issues are documented enhancements, not defects.