# Structural Audit: M2 Async Conversion + Process Visibility (VOY-1493)

**Branch:** `fix/m-series-tech-debt`
**Review type:** Post-deployment structural audit (code shipped, in production)
**Date:** 2026-08-25 ~06:30 UTC
**Reviewer:** Staff Engineer

**Files audited:** `routes/research.ts`, `routes/exports.ts`, `routes/background-jobs.ts`, `services/background-jobs.ts`, `services/background-job-worker.ts`, `services/research-search.ts`, `services/embedding.ts`, `services/live-events.ts`, `services/auth.ts`, `packages/db/src/schema/background_jobs.ts`, `packages/shared/src/background-job-types.ts`, `packages/shared/src/types/background-job.ts`, `packages/shared/src/types/live.ts`, `ui/src/components/BackgroundProcessTray.tsx`, `packages/db/src/migrations/0144_background_jobs.sql`, `server/src/__tests__/background-jobs-service.test.ts`, `server/src/__tests__/research-search-service.test.ts`, `server/src/__tests__/voyonder-auth.test.ts`

---

## Verdict: APPROVED with follow-up issues

The core architecture is sound. The auth boundary, transaction safety, terminal-status guards, SSE lifecycle management, and SQL injection defenses are all correctly implemented. The following items should be tracked as follow-up work.

---

## 🔴 MUST FIX — Production stability risks

### 1. Embedding API: N+1 HTTP calls instead of batch request
**File:** `server/src/services/embedding.ts:154-156`

`embedBatch()` calls `Promise.all(texts.map((t) => embed(t)))`, making one HTTP request per text. OpenAI's embeddings API natively supports batched inputs — a single request can accept an array of strings. For a typical 20-result semantic upgrade, this is 20 HTTP requests instead of 1.

**Impact:** Severe latency amplification on every semantic search. Each embedding call carries network round-trip overhead + model inference latency (typically 200-500ms per call). With 20 candidates and no concurrency limit on `Promise.all`, this also risks hitting API rate limits.

**Fix:** Modify `embedBatch` to send all texts in a single API request using OpenAI's batch input format (`{ input: [...], model: "..." }`) and parse the response's `data` array in order.

---

### 2. In-process PDF rendering blocks the event loop
**File:** `server/src/services/background-job-worker.ts:99-175`

PDFKit rendering is CPU-bound and runs synchronously. The `await new Promise<void>(...)` wrapper does NOT yield to the event loop — it's waiting for the PDF stream to end. For exports up to 500 items, this blocks all other request handling for the duration.

**Impact:** A single large PDF export starves the entire Node.js event loop. Other requests (including health checks, API calls, and SSE heartbeats) are delayed or timeout.

**Fix:** Either (a) offload PDF generation to a worker thread, (b) add periodic `setImmediate()`/`queueMicrotask()` yields during item iteration, or (c) implement the existing TODO comment to upload to blob storage and return a URL instead of rendering in-process.

---

### 3. Base64 PDF data stored in JSONB column — unbounded growth
**File:** `server/src/services/background-job-worker.ts:164-170`, `server/src/services/background-jobs.ts:32`

PDF exports are stored as base64 data URIs in the `result` JSONB column. A multi-page PDF can be multiple megabytes as base64. The `background_jobs` table has no retention/cleanup policy — every research search, auto-assess, PDF export, and ICS export creates a permanent row.

**Impact:** Database bloat. JSONB with large base64 strings triggers TOAST storage and degrades query performance on the `background_jobs` table over time. The `list()` endpoint scans this table even though it strips the `dataUri` from responses.

**Fix:** Implement blob storage (S3/etc.) per the existing TODO comment. Store only a URL in the result. Add a TTL/retention policy for completed job rows (e.g., delete after 7 days, or archive to a separate table).

---

### 4. Missing periodic stale-job requeue sweep
**File:** `server/src/services/background-job-worker.ts:350-401`

`requeueStaleJobs()` runs only on worker startup. If `processJob()` crashes during the final `svc.update()` call that sets status to "failed" — or if the DB connection is lost at that exact moment — the job remains stuck in "running" with no recovery path until the next worker restart.

**Impact:** Eternal "running" spinner in the UI tray for orphaned jobs. Currently only rescued on process restart.

**Fix:** Run the stale-job requeue sweep periodically (e.g., every 5 minutes via `setInterval`) in addition to the startup sweep. The function is already written — just needs a periodic timer.

---

## 🟡 SHOULD FIX — Performance and correctness

### 5. `tick()` batch processing is serialized
**File:** `server/src/services/background-job-worker.ts:405-417`

`await Promise.all(rows.map(...))` means if one job in a batch gets stuck (before its per-processor timeout fires), all other jobs in the batch are blocked. With `batchSize: 5` and `processorTimeoutMs: 300000`, a single stuck processor blocks 4 other jobs for up to 5 minutes.

**Fix:** Use `Promise.allSettled` with per-job timeout enforcement, or assign each job its own independent timeout rather than sharing the batch's `Promise.all`.

---

### 6. Keyword search performs full table scans
**File:** `server/src/services/research-search.ts:110-163`

The ILIKE queries with `%pattern%` cannot use standard B-tree indexes. Every keyword search does a sequential scan of `issues`, `documents`, and `activityLog` tables. For companies with large datasets this will become prohibitively slow.

**Impact:** O(n) scan per search, repeated for each scope. No index can serve these pattern-matching queries.

**Fix:** Use pg_trgm indexes (trigram) for ILIKE queries, or implement a full-text search column (tsvector) for the searchable fields. Add a GIN index on a tsvector column and use `@@ to_tsquery(...)` for the primary search path, falling back to ILIKE only when pg_trgm is available.

---

### 7. In-memory embedding cache uses FIFO eviction, not LRU
**File:** `server/src/services/embedding.ts:135-139`

When the cache exceeds 1000 entries, it evicts the first-inserted key (FIFO), not the least-recently-used one. For an embedding cache, LRU would provide significantly better hit rates.

**Fix:** Replace the `Map`+FIFO eviction with a proper LRU cache (e.g., `lru-cache` package or a `Map` with access-time tracking).

---

### 8. Missing admin authorization on POST /background-jobs
**File:** `server/src/routes/background-jobs.ts:114-129`

The direct job creation endpoint (`POST /companies/:companyId/background-jobs`) is protected only by JWT auth — any authenticated user can create arbitrary job types. While no dangerous processors currently exist, this is a soft trust boundary.

**Fix:** Add admin-only authorization check, or at minimum restrict allowed `jobType` values to those registered in `processors`.

---

### 9. No test coverage for SSE endpoint and worker shutdown
**Files:** `server/src/__tests__/background-jobs-service.test.ts`

The test suite covers the service layer well but is missing integration tests for:
- SSE `/background-jobs/events` endpoint behavior (connection, heartbeat, lifetime cap)
- Worker shutdown with in-flight jobs
- Concurrent worker safety (multiple workers claiming jobs)
- `assertPayloadSize` export limit enforcement
- `emitEvent` failure path

---

## ✅ Passed — Correctly implemented

- **Auth layer** (`auth.ts`): Dual-secret JWT validation, algorithm check (only HS256), companyId boundary match, required expiry enforcement. Solid.
- **Claim transaction** (`background-job-worker.ts:202-247`): `FOR UPDATE SKIP LOCKED` + status update inside same transaction. Correct atomic claim.
- **Terminal status guard** (`background-jobs.ts:156`): `inArray(status, ['queued','running'])` prevents overwriting completed jobs. Verified by test.
- **`emitEvent` soft-fail pattern**: DB write happens before event publish; event failure is caught and logged without aborting the DB transaction. Correct.
- **SSE lifecycle** (`background-jobs.ts:53-91`): 30s heartbeat + 300s lifetime cap + clean close handler. Correct leak prevention.
- **dataUri strip on list** (`background-jobs.ts:32`): Large binary data excluded from list/slim responses but available via `getById()`. Correct bandwidth protection.
- **SQL injection**: All user input is parameterized through drizzle-orm's SQL template. Correct.
- **ICS UID determinism** (`background-job-worker.ts:490-493`): SHA256 hash of event identity produces consistent UIDs across re-exports. Verified by test.
- **`escapeLikePattern`** (`research-search.ts:82-84`): Correctly escapes `\`, `%`, `_` for LIKE patterns.
- **`assertPayloadSize`** (`exports.ts:37-44`): 512KB limit prevents DoS via oversized export payloads. Correct.
- **Route ordering** (`background-jobs.ts:47`): `/events` defined before `/:id` to avoid route collision. Correct.
- **Event scoping** (`live-events.ts:27-34`): Events emitted per-company using `companyId` as the event key. SSE listener filters by company. Correct.
- **`ticking` guard** (`background-job-worker.ts:405-406`): Prevents re-entrant tick execution. Correct.
- **`BackgroundProcessTray` UI** (`BackgroundProcessTray.tsx`): SSE subscription with polling fallback, running jobs sorted to top, progress bars, error display, duration formatting. Correct UX.
