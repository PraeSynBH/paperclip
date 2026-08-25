# M2 Structural Audit — VOY-1493

**Branch:** `fix/m-series-tech-debt`
**Commits audited:** `21e006a3d6` (feat) + `f81d572a40` (fixes) + subsequent hotfix commits
**Date:** 2026-08-24
**Reviewer:** Staff Engineer

## Scope

The M2 change set implements six features:
1. POST /api/research/auto-assess → fire-and-forget background job (202 + jobId)
2. POST /api/research/search → keyword-first sync + async semantic upgrade via SSE
3. BackgroundProcessTray — SSE + polling, running/terminal states, progress bars, collapsible, sidebar-wired
4. PDF/ICS export → 202 + jobId (PDF uses pdfkit, ICS produces v2.0 calendar text)
5. FreshnessCue + FreshnessDot — staleness visual cues on research items
6. FadeIn — skeleton loading + fade-in for non-blocking data reveal

Plus supporting infrastructure:
- Background job worker with polling, FOR UPDATE SKIP LOCKED, bounded concurrency, status transitions
- BackgroundJobService (CRUD) with live-event emission
- ResearchSearchService (keyword search across issues/documents/activity, semantic upgrade, auto-assess)
- StandardSLABreach duplicate suppression (wired into issues.ts)
- Authz helper `assertCompanyScopeReadAllowed` extraction
- SSE events endpoint for `background_job.status`
- useJobStatus React hook (polling + optional SSE)
- DB migration 0144: background_jobs table, indexes, CHECK constraints
- Shared types and constants for background jobs
- Escape-probe test for LIKE ESCAPE correctness
- Test files: background-jobs-service (467 lines), research-search-service (261 lines), authz-company-scope-read (50 lines)

## Status

All post-review fixes from commit `f81d572a40` are applied. Three subsequent hotfix commits (`dd2a41f9a0`, `10536a49ee`, `953249ae19`) resolve the P0/P1 items (#17-#20) from the prior audit.

Tests: 31/31 pass (background-jobs-service + research-search-service + authz + escape-probe).
Documentation: async-jobs.md updated through v6.

---

## Findings

### P1 — Must Fix Before Ship

#### 1. `searchIssues` missing `hiddenAt` filter (research-search.ts:124-161)

**File:** `server/src/services/research-search.ts` line 124 (function `searchIssues`)
**Severity:** P1 — Data exposure

The `searchIssues` function does **not** filter `isNull(issues.hiddenAt)` in its WHERE clause. By contrast, both `fetchIssuesByIds` (line 527) and `autoAssess` (line 454) include `isNull(issues.hiddenAt)`. This means the keyword-first search (both the sync path and the candidate build in the semantic upgrade path when `candidateIds` is empty) can return soft-deleted/hidden issues.

**Impact:** Deleted issues appear in research search results. A user who deletes an issue and then searches for related terms will see it in the results. This is a data exposure inconsistency.

**Fix:** Add `isNull(issues.hiddenAt)` to the WHERE clause in `searchIssues`, matching the pattern used in `fetchIssuesByIds`:

```typescript
and(
  eq(issues.companyId, companyId),
  isNull(issues.hiddenAt),
  or(
    ilike(issues.title, containsPattern),
    ...
  ),
),
```

**Evidence:**
- `searchIssues` (L124): only filters `eq(issues.companyId, companyId)` + `or(...)` — no `hiddenAt`
- `fetchIssuesByIds` (L527): filters `eq(issues.companyId, companyId)` + `inArray(issues.id, ids)` + `isNull(issues.hiddenAt)`
- `autoAssess` (L454): filters `eq(issues.companyId, companyId)` + optional `inArray(...)` + `isNull(issues.hiddenAt)`

---

### P2 — Should Fix Before Ship

#### 2. `emitEvent` pushes full `result` (including `dataUri`) to all SSE subscribers (background-jobs.ts:63)

**File:** `server/src/services/background-jobs.ts` line 63
**Severity:** P2 — Bandwidth amplification

The `emitEvent` function serializes `row.result` into the SSE event payload without stripping large binary fields. For PDF exports, `result.dataUri` contains the full base64-encoded PDF (potentially several MB). This payload is broadcast to **every** SSE subscriber for the company.

The client-side `useJobStatus` hook (useJobStatus.ts:127-137) only uses SSE as a signal to trigger a GET request — it never reads `result.dataUri` from the SSE event. So every SSE client on the company's events stream receives the full PDF data for every job, even though they only need a notification to re-fetch.

The `toApi` slim mode (background-jobs.ts:32) correctly strips `dataUri` from list responses, but `emitEvent` doesn't use a slim projection.

**Impact:** An SSE client with a 5 MB PDF export result receives ~6 MB of SSE data (base64 is ~1.37× the binary size). With multiple exports or many clients, this amplifies bandwidth and serialization cost for every status update.

**Fix:** Strip `result.dataUri` (and any future large blob fields) from the SSE payload, matching the slim projection logic:

```typescript
const payload = {
  ...,
  result: row.result ? { ...row.result, dataUri: undefined } : null,
};
```

Or extract the slim projection into a shared helper used by both `toApi(slim=true)` and `emitEvent`.

**Note from post-review fix commit (f81d572a40):** The terminal-status WHERE guard on `update()` prevents the worst case (emitEvent failure corrupting job state). The bandwidth amplification is the remaining concern.

#### 3. ICS output missing REQUIRED VEVENT properties `UID` and `DTSTAMP` (background-job-worker.ts:480-487)

**File:** `server/src/services/background-job-worker.ts` lines 480-487
**Severity:** P2 — Standards compliance

The `buildVEvent` function produces VEVENT components without `UID` or `DTSTAMP`. Both are **REQUIRED** by RFC 5545 (sections 3.8.4.7 and 3.8.7.2). Many calendar clients will still accept the file, but strict clients (Apple Calendar with validation enabled, some corporate Exchange setups) may reject the entire ICS file or drop events.

**Impact:** Exported ICS files may be silently rejected by strict calendar clients. The user sees a job completed successfully but the download doesn't import into their calendar.

**Fix:** Add `UID` (a unique UUID per event, stable across re-exports for update matching) and `DTSTAMP` (the UTC timestamp when the ICS was generated):

```typescript
import { randomUUID } from 'node:crypto';

function buildVEvent(event: Record<string, unknown>): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${randomUUID()}@voyonder.com`,
    `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
    `SUMMARY:${sanitizeIcsText(title)}`,
  ];
  // ...
}
```

#### 4. `embedBatch` sends N parallel HTTP requests instead of a single batch request (embedding.ts)

**File:** `server/src/services/embedding.ts` (not new in M2 but the M2 path exercises it)
**Severity:** P2 — Performance / reliability

The `embedBatch` function calls `Promise.all(texts.map((t) => embed(t)))`, which sends one HTTP request per input text to the embedding API. OpenAI's embedding API (and compatible providers) accept `input` as either a string or an array of strings, returning embeddings in the same order. Sending N individual requests is:

- Slower (N round-trips instead of 1)
- More likely to hit provider rate limits
- More expensive (each request has fixed overhead)

For a research search with limit=50, this means 51 concurrent HTTP requests (1 query + 50 candidates).

**Impact:** When an embedding provider is configured, the semantic upgrade path triggers 50+ concurrent outbound HTTP requests. Under load, this can cause connection pool exhaustion, rate-limit errors, or timeouts. The fallback to keyword results (research-search.ts:416-418) masks the failure but the semantic upgrade is silently degraded.

**Fix:** Modify `embed` to accept `string | string[]` for `input`, and have `embedBatch` call a single API request with all texts:

```typescript
async function embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return [];
  // Single API call with array input
  const result = await embedRequest(texts);
  // Map per-text results back to EmbeddingResult[]
  return texts.map((_, i) => extractResult(result, i));
}
```

(This is a refactor of the existing embedding service, not a M2-scope change, but the M2 semantic search path exercises it.)

#### 5. Startup race in `tick()` — concurrent ticks can exceed `batchSize` (background-job-worker.ts:402-411)

**File:** `server/src/services/background-job-worker.ts` lines 402-411
**Severity:** P2 — Concurrency control accuracy

The `start()` method (line 414) does:
```typescript
timer = setInterval(() => void tick(), pollIntervalMs);
timer.unref?.();
void tick();  // immediate first run
```

The immediate `void tick()` and the first scheduled `setInterval` tick can run concurrently if the first tick's initial `await` (inside `claimQueuedJobs`) yields before `inFlight` is incremented. Since both ticks pass the `inFlight >= batchSize` guard (both see `inFlight === 0`), they both call `claimQueuedJobs` and collectively claim up to `2 × batchSize` jobs.

**Impact:** Effective concurrency can transiently reach `2 × batchSize` (default 10) rather than the configured `batchSize` (default 5). `FOR UPDATE SKIP LOCKED` prevents double-claiming, so no data corruption, but the system operates above its configured parallelism budget.

**Fix:** Skip the initial `void tick()` and rely on the interval tick (which fires after `pollIntervalMs`). Or add a mutex in `tick()`:

```typescript
let ticking = false;
async function tick() {
  if (ticking || stopped) return;
  ticking = true;
  try { ... } finally { ticking = false; }
}
```

Or guard with a concurrency semaphore that counts claims rather than the racy `inFlight` counter.

---

### P3 — Should Document / Monitor

#### 6. Research routes use read-level auth for write operations (research.ts:55, 82, 108)

**File:** `server/src/routes/research.ts`
**Severity:** P3 — Known and documented (async-jobs.md #12)

All three POST endpoints (`/research/activities`, `/research/auto-assess`, `/research/search`) gate on `assertCompanyScopeReadAllowed` — a permission intended for read operations. By contrast, the general `POST /background-jobs` endpoint is board-only.

**Impact:** Any agent or user with `company_scope:read` can enqueue background jobs. Agents with read-only access can create research jobs that consume worker time and store results in the database.

**Status:** Documented as known issue #12 in async-jobs.md. Recommended fix: require board-level auth or create a dedicated `background_job:create` permission.

#### 7. No job cancellation capability (schema, API, worker)

**Severity:** P3 — Known and documented

There is no endpoint to cancel a queued or running job. The schema has no `cancelled` status. The worker polls exclusively for `status = 'queued'`. A running job must either complete or hit the processor timeout before the worker can claim another slot.

**Status:** Documented as known issue #5 in async-jobs.md.

#### 8. No job retention / cleanup policy

**Severity:** P3 — Known and documented

Rows accumulate in `background_jobs` indefinitely. Terminal jobs (succeeded/failed) are never cleaned up. For active companies doing research searches, this table grows without bound.

**Status:** Documented as known issue #7 in async-jobs.md.

#### 9. PDF export buffers entire document in memory, stores base64 in DB

**Severity:** P3 — Known and documented

The PDF processor buffers the full PDF in memory (`Buffer.concat`), base64-encodes it, and stores it in the job `result` jsonb column. For large exports this can produce multi-MB rows in the `background_jobs` table.

The slim projection fix (post-review hotfix #19) strips `dataUri` from list responses, so the tray poll is not affected. But `getById()` still returns the full blob, and the DB row includes it.

**Status:** Documented. Blob storage integration is the planned follow-up.

---

### Correct as Implemented (Verified)

The following items from the prior audit findings are correctly resolved in the current code:

| Finding | Status | Evidence |
|---------|--------|----------|
| `FOR UPDATE SKIP LOCKED` in transaction | ✅ Resolved | background-job-worker.ts:210-243 — `db.transaction` wraps SELECT + UPDATE |
| `candidateIds` threading | ✅ Resolved | research.ts:127 passes `candidateIds` from keyword results; worker passes to `upgradeSemanticResults` |
| Processor timeout via `Promise.race` | ✅ Resolved | background-job-worker.ts:275-298 — `processorWithTimeout` with 5 min default |
| Exponential backoff retry (max 2) | ✅ Resolved | background-job-worker.ts:300-335 — 1s/2s/4s, capped at 30s |
| Graceful shutdown with in-flight drain | ✅ Resolved | background-job-worker.ts:439-459 — 30s grace period, polling sleep |
| Partial index on `status = 'queued'` | ✅ Resolved | schema/background_jobs.ts:70 — `queuedStatusIdx` |
| SSE `/events` authz | ✅ Resolved | background-jobs.ts:50 — `assertCompanyScopeReadAllowed` check |
| Export payload size cap (512 KB) | ✅ Resolved | exports.ts:38-45 — `assertPayloadSize` |
| DB CHECK constraints | ✅ Resolved | schema/background_jobs.ts:71-73 — status, progress, duration checks |
| `emitEvent` try/catch guard | ✅ Resolved | background-jobs.ts:52-82 — nested try/catch, logs warning, never throws |
| Terminal-status WHERE guard on `update()` | ✅ Resolved | background-jobs.ts:152 — `inArray(backgroundJobs.status, ['queued', 'running'])` |
| Stale-job recovery startup sweep | ✅ Resolved | background-job-worker.ts:349-400 — requeues running jobs past `processorTimeoutMs + 30s` |
| List endpoint slim projection (strips dataUri) | ✅ Resolved | background-jobs.ts:32 — `toApi(r, true)` in `list()` |
| Escape-probe test for LIKE ESCAPE correctness | ✅ Resolved | escape-probe.test.ts — verifies `escapeLikePattern` + `ESCAPE '\\'` |
| SQL injection safety (parameterized queries) | ✅ Verified | All user input passed via drizzle `sql` template literals; no string concatenation |
| `prepare:false` rationale documented | ✅ Resolved | packages/db/src/client.ts — M1 C2 documented |

---

### SQL Safety Assessment

All user-supplied values in the research search queries are properly parameterized via drizzle's `sql` template literals (`${...}`). The `escapeLikePattern` function correctly escapes `\`, `%`, and `_` for LIKE patterns with `ESCAPE '\\'`. The correlated subqueries use `companyId` as a parameterized value. No raw string concatenation was found in the search query construction.

The `escape-probe.test.ts` (66 lines) verifies the LIKE ESCAPE behavior against embedded PostgreSQL, confirming that:
- `standard_conforming_strings` is ON (default PG behavior)
- LIKE with `ESCAPE '\\'` correctly matches literal underscores
- The `escapeLikePattern` pattern (`%login\_user%`) works end-to-end

**No SQL injection vectors found.**

---

### Trust Boundary Assessment

| Boundary | Assessment | Notes |
|----------|-----------|-------|
| User input → DB query | ✅ Safe | Parameterized queries throughout |
| User input → Search result snippet | ✅ Safe (inherent) | Search results naturally contain user content; LLM agents consuming results should sanitize independently |
| User input → PDF export → LLM | ⚠️ Inherent | PDF embeds user-provided title/description; LLM agents reading PDF content should apply standard input sanitization |
| User input → ICS export | ⚠️ Inherent | ICS exports user-provided event titles/descriptions |
| SSE event data → Client | ✅ Acceptable | Event payloads contain job status, not raw user content beyond job results |
| Job result → DB → API | ✅ Appropriate | `list()` strips large blobs (dataUri); full result only via `getById()` |

No new LLM trust boundary violations were introduced beyond what is inherent to the search/export features.

---

### N+1 Query Assessment

| Code Path | Query Pattern | Assessment |
|-----------|--------------|------------|
| `keywordSearch` with `scope='all'` | 3 parallel queries (issues, documents, activity) | ✅ Acceptable — fixed 3 queries, not N+1 |
| `upgradeSemanticResults` with `candidateIds` | 3 parallel ID-lookup queries | ✅ Acceptable — fixed 3 queries |
| `autoAssess` | 1 query (issues) | ✅ |
| `claimQueuedJobs` | 1 SELECT + 1 UPDATE (transaction) | ✅ |
| SSE events stream | Subscriber dispatch (EventEmitter) | ✅ O(1) per event |

**No N+1 queries found.**

---

### Race Condition Assessment

| Race | Documented | Risk | Mitigation |
|------|-----------|------|------------|
| Two workers claiming same job | ✅ Resolved | None | Transaction + FOR UPDATE SKIP LOCKED + status='queued' WHERE guard |
| Tick startup race (exceeds batchSize) | ⚠️ Finding #5 | Low | FOR UPDATE SKIP LOCKED prevents double-claiming; excess concurrency bounded by 2× batchSize |
| SSE emit failure after DB commit | ✅ Resolved | None | emitEvent try/catch + terminal-status WHERE guard |
| Late progress update after terminal status | ✅ Resolved | None | update() refuses to write to terminal rows |
| Stale job orphaned by crash | ✅ Resolved | None | Startup sweep requeues stale-running jobs |

---

### Index / Query Performance Assessment

| Query | Index Used | Assessment |
|-------|-----------|------------|
| Worker claim: `WHERE status='queued' ORDER BY created_at LIMIT N` | ✅ `background_jobs_queued_status_idx` (partial on status='queued') | Partial index correctly serves the filter. ORDER BY created_at requires a sort; if queued count grows large (>10K), a composite `(status, created_at)` partial index would be faster |
| List by company: `WHERE company_id=? AND status=? ORDER BY created_at DESC` | ✅ `background_jobs_company_status_idx` on (company_id, status) | Correct leftmost prefix for company_id + status filter. DESC order on created_at may require separate index for large datasets |
| Get by ID: `WHERE id=? AND company_id=?` | ✅ PK index on `id` | Fine for singleton lookup |

The indexing strategy is correct for the current access patterns. The partial `queued_status_idx` is the critical one for worker claim performance and is present.

---

### Test Coverage Assessment

| File | Lines | Scope | Assessment |
|------|-------|-------|------------|
| `background-jobs-service.test.ts` | 467 | CRUD operations, worker dispatch, terminal-status guard, slim projection, stale-job recovery | ✅ Good coverage. Includes the post-review failure-path tests |
| `research-search-service.test.ts` | 261 | Pure function existence, keyword search (empty results, title match, scope filter, empty query, limit clamping, scope isolation), autoAssess (freshness, empty company) | ⚠️ **Gap:** No test for the `upgradeSemanticResults` method (both with and without `candidateIds`). Semantic upgrade is only tested transitively through the worker's `research.semantic_search` processor (which calls `upgradeSemanticResults`), and only with empty query (which early-returns). |
| `authz-company-scope-read.test.ts` | 50 | `assertCompanyScopeReadAllowed` allowed/denied/custom error | ✅ Adequate |
| `escape-probe.test.ts` | 66 | LIKE ESCAPE correctness | ✅ Adequate |

**Test gaps:**
1. `upgradeSemanticResults` has no direct unit/integration test. The processor test calls it but only with an empty query (trivial path).
2. No tests for `research.search` route or `research.auto-assess` route (HTTP-level).
3. No tests for export routes (HTTP-level).
4. `searchIssues` with hidden issues is not tested — the `isNull(issues.hiddenAt)` gap (Finding #1) has no test coverage.

---

## Summary

| Severity | Count | Key Items |
|----------|-------|-----------|
| P1 (Must Fix) | 1 | `searchIssues` missing `hiddenAt` filter — keyword search returns deleted issues |
| P2 (Should Fix) | 4 | SSE payload includes full dataUri (bandwidth bloat), ICS missing UID+DTSTAMP (RFC noncompliance), embedBatch sends N requests (performance), tick startup race (concurrency accuracy) |
| P3 (Document/Monitor) | 4 | Research routes use read-level auth (documented #12), no job cancellation (#5), no retention cleanup (#7), PDF memory (#9) |

**Overall assessment:** The M2 code is structurally sound. The critical issue (P1) is the missing `hiddenAt` filter in `searchIssues`, which creates an inconsistency with `fetchIssuesByIds` and `autoAssess`. The P2 items are real but not blockers for shipping if tracked. All prior audit findings have been correctly resolved. SQL injection surface is clean. N+1 queries are absent. Race conditions are properly mitigated (with the minor tick-startup exception documented in Finding #5).

**Recommendation:** Fix P1 Finding #1 (`searchIssues` missing `hiddenAt`), then ship. Track P2-P3 items as follow-up issues.

---

*This audit covers commits `21e006a3d6` through `953249ae19` inclusive, branch `fix/m-series-tech-debt`.*
