# Staff Engineer Re-review: S2-S4 Fixes — Voyonder Code Separation Phase 1

**Reviewer:** Staff Engineer (eee825c7)
**Date:** 2026-08-22 ~18:15 UTC
**Branch:** Voyonder master (commits ce55ad6 + 883ea89)
**Scope:** CEO-applied S2-S4 fixes + Founding Engineer M2 audit fixes
**Status:** CONDITIONALLY APPROVED — S3 must fix before ship

---

## Background

CEO reviewed the Staff Engineer's 4 blocking issues and made go/no-go decisions:
- S1 (duplicate types): DEFER to Phase 2
- S2 (event contract): MUST FIX
- S3 (stale-job race): MUST FIX
- S4 (fire-and-forget recovery): FIX NOW

CEO applied fixes (commit ce55ad6) to both Paperclip and Voyonder repos. Founding Engineer applied additional M2 audit fixes (commit 883ea89). This re-review verifies all applied fixes.

---

## S2: BackgroundJobEvent type alignment — CONDITIONALLY ACCEPTABLE ⚠️

### What was fixed
Renamed old `BackgroundJobEvent` → `BackgroundJobEventPayload`. Created new `BackgroundJobEvent` with LiveEvent envelope structure `{ id, companyId, type, createdAt, payload }`. This matches the wire format emitted by `publishLiveEvent()` and sent by the SSE endpoint.

### Remaining issues

**S2a (type accuracy — low):** `BackgroundJobEvent.id` is typed `string` but the `LiveEvent` interface (both Paperclip's `@paperclipai/shared` and Voyonder's local copy) defines `id: number`. The SSE stream sends `"id": 1` (number, not string). Any strict TypeScript consumer reading from the SSE endpoint gets a type mismatch.

**S2b (payload shape — medium):** `BackgroundJobEventPayload` declares 10 fields as required:

```typescript
interface BackgroundJobEventPayload {
  jobId: string;
  status: BackgroundJobStatus;
  progress: number;           // ← required but never sent
  progressMessage: string | null;  // ← required but never sent
  result: Record<string, unknown> | null;  // ← required but never sent
  error: string | null;       // ← required but never sent
  durationMs: number | null;  // ← required but never sent
  startedAt: string | null;   // ← required but never sent
  finishedAt: string | null;  // ← required but never sent
  updatedAt: string;          // ← required but never sent
}
```

But `emitEvent()` in `background-jobs.ts:62` only sends `{ status, jobId }`. All other fields are absent from the wire. Clients using the `BackgroundJobEventPayload` type will destructure `progress`, `result`, `error`, etc. and get `undefined` at runtime.

**S2c (unenforced boundary — medium):** `publishLiveEvent` accepts `payload: Record<string, unknown>`. There is no type-level linkage between the `BackgroundJobEventPayload` interface and the actual emit call. The type can (and does) drift from the wire format without any compiler warning. The types exist in shared but are purely documentary.

### Assessment
The envelope structure is correct. The type inaccuracies won't cause crashes (JS is forgiving with undefined fields) but create a trap for future frontend work. Fix in Phase 2:
- Make non-delivered payload fields optional
- Change `id` to `number` (or cast at the SSE boundary)
- Enforce the payload shape at the emit boundary

Not blocking for ship.

---

## S3: FOR UPDATE SKIP LOCKED — BUG (CRITICAL) 🔴

### What was fixed
Added `FOR UPDATE SKIP LOCKED` subquery to `requeueStaleJobs()` to prevent concurrent workers from double-requeueing stale jobs.

### The bug

The fix introduced `LIMIT 1` in the subquery:

```typescript
sql`${backgroundJobs.id} = (
  SELECT ${backgroundJobs.id}
  FROM ${backgroundJobs}
  WHERE ${backgroundJobs.status} = 'running'
    AND ${backgroundJobs.startedAt} IS NOT NULL
    AND ${backgroundJobs.startedAt} < ${cutoff}
  ORDER BY ${backgroundJobs.startedAt} ASC
  LIMIT 1                          // ← ONLY ONE JOB
  FOR UPDATE SKIP LOCKED
)`
```

The original code (before the fix) had no subquery and no limit — it updated ALL matching rows. The fix changed the behavior to only requeue **one** stale job per call.

Since `requeueStaleJobs()` is called once at worker startup (in `start()`), if N jobs are stuck in `running` status (e.g., after a node process crash), only 1 gets recovered. The remaining N-1 jobs stay stuck in `running` forever — they never get picked up by `claimNext()` (which only claims `queued` jobs), and no retry mechanism exists.

### Impact
Any production incident involving crashed workers — OOM kill, SIGKILL, node process abort, deployment rollout killing old pods — leaves all but one orphaned job unrecovered. Those jobs silently disappear from the processing pipeline. No alert, no retry, no recovery short of manual DB intervention or another restart (which would again recover only 1 job).

### Root cause
Pattern was copied from `claimNext()`, which intentionally processes one job at a time per worker. But `requeueStaleJobs()` is a **sweep** operation — it should recover ALL stuck jobs. Using the same `LIMIT 1` pattern is incorrect for this use case.

### Fix required

Change the subquery to select ALL matching rows:

```typescript
// Before (broken):
sql`${backgroundJobs.id} = (
  SELECT ${backgroundJobs.id}
  FROM ${backgroundJobs}
  WHERE ${backgroundJobs.status} = 'running'
    AND ${backgroundJobs.startedAt} IS NOT NULL
    AND ${backgroundJobs.startedAt} < ${cutoff}
  ORDER BY ${backgroundJobs.startedAt} ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)`

// After (fixed):
sql`${backgroundJobs.id} IN (
  SELECT ${backgroundJobs.id}
  FROM ${backgroundJobs}
  WHERE ${backgroundJobs.status} = 'running'
    AND ${backgroundJobs.startedAt} IS NOT NULL
    AND ${backgroundJobs.startedAt} < ${cutoff}
  FOR UPDATE SKIP LOCKED
)`
```

Two changes:
1. `=` → `IN` (multi-row comparison)
2. Remove `LIMIT 1` (all matching rows)

The exact file to patch:
- Voyonder: `server/src/services/background-jobs.ts` lines 303-312
- Paperclip (if cherry-picked): `server/src/services/background-jobs.ts` same lines

### Verification
After the fix, verify with a SQL equivalent:
```sql
-- Should return all stale running jobs
SELECT COUNT(*) FROM background_jobs
WHERE status = 'running'
  AND started_at IS NOT NULL
  AND started_at < NOW() - INTERVAL '5 minutes 30 seconds';
```

Then run `requeueStaleJobs()` and verify all are now `queued`.

---

## S4: Worker startup — CORRECT ✅

### What was fixed
- `start()` made `async`
- `requeueStaleJobs()` awaited before first `tick()`
- On DB failure during stale recovery, worker fails closed (no `tick()` called)

### Verification

**File:** `server/src/app.ts`:
```typescript
worker.start().catch((err) => {
  logger.error({ err }, "Background job worker failed to start");
});
```

**File:** `server/src/services/background-job-worker.ts`:
```typescript
async start(): Promise<void> {
  // ...
  try {
    const count = await jobs.requeueStaleJobs(staleThresholdMs);
    // log ...
  } catch (err) {
    logger.error({ err }, "Failed to requeue stale jobs — worker will not start");
    return;  // ← fail-closed
  }
  tick();
}
```

### Minor concern
The `.catch()` in `app.ts` is dead code for the primary failure path — `requeueStaleJobs()` errors are caught by the internal try/catch in `start()`, so the promise never rejects. The `.catch()` only catches errors thrown before the `await` (unlikely). Consider removing the `.catch()` and letting the internal handler be the single source of truth, or keep it as a defense-in-depth measure. Neither is wrong; noting for clarity.

**Verdict:** ✅ Correctly implemented. No action needed.

---

## Founding Engineer fixes (commit 883ea89) — All correct ✅

### 1. Zod validation → 400
**File:** `server/src/lib/validate.ts`
Catches `ZodError`, calls `next(badRequest("Validation failed", err.issues))`.
✅ Correct. No longer returns 500 for validation errors.

### 2. Dead processor cleanup
**File:** `server/src/routes/research.ts`
Removed `registerJobProcessor(BACKGROUND_JOB_TYPES.RESEARCH_ACTIVITY_SEARCH, ...)`.
✅ Correct. No route creates jobs of this type.

### 3. Recursive retry → loop
**File:** `server/src/services/background-job-worker.ts`
Replaced `return processJob(job, attempt + 1)` with `for (let attempt = 1; attempt <= maxRetries; attempt++)`.
✅ Correct. Stack-safe, cleaner, functionally equivalent.

### 4. Tests added (262 lines)
**File:** `server/src/services/__tests__/background-jobs.test.ts`

**What's covered:**
- `create()` — job creation with queued status
- `getById()` — returns null for non-existent
- `succeed()` — marks succeeded, sets progress=100
- `fail()` — marks failed with error
- `updateProgress()` — clamps between 0-100
- `list()` — company filtering
- `list()` — status filter

**What's missing or weak:**

| Gap | Severity | Details |
|-----|----------|---------|
| Mock DB ignores WHERE clauses | 🔴 High | The mock `store.values()` always returns all records. Filtering by status, companyId, etc. is not actually tested. Tests pass even if the WHERE clause is wrong. |
| Worker tests don't invoke `processJob()` | 🔴 High | "processes a registered job type" test creates+claims a job but never calls `processJob()`. The processor is registered but never exercised. |
| `requeueStaleJobs()` untested | 🔴 Medium | No test calls this function. The S3 bug would not be caught. |
| `after()` hook creates orphaned worker | 🟡 Low | Creates a new worker with `pollIntervalMs: 999_999` without shutting down workers from previous tests. |
| No integration/DB tests | 🟡 Medium | Tests use a mock in-memory store, not an actual DB. SQL syntax, locking, and constraint behavior are untested. |

**Assessment:** Tests provide basic structural confidence (create/update/query methods wire up correctly) but zero confidence in query filtering, worker processing logic, or concurrent access patterns. The mock's simplicity means the S3 bug (LIMIT 1) would pass these tests. Recommend real DB integration tests in Phase 2.

---

## Additional structural observations

### 1. emitEvent payload never includes full job state
`emitEvent()` in `background-jobs.ts:58-72` is called after every state transition (create, succeed, fail, claim, requeue) but only sends `{ status, jobId }`. It has access to the full job record (passed as parameter `row`) but doesn't include `progress`, `progressMessage`, `result`, `error`, etc. in the event payload. This means the SSE stream is informative ("something changed") but not self-describing ("here's the full current state").

**Fix:** Pass the full row to `emitEvent()` and populate the payload. However, this would increase SSE bandwidth for every status transition. A lighter approach: include key fields and let clients call `GET /:id` for details.

### 2. No socket timeout on SSE endpoint
`GET /background-jobs/events` doesn't set a socket timeout. A client that connects and never disconnects (e.g., a misbehaving proxy or a zombie browser tab) holds an open connection indefinitely. With EventEmitter `setMaxListeners(0)`, there's no backpressure — a slow connection leak exhausts server memory.

**Fix:** Set `req.socket.setTimeout(5 * 60 * 1000)` (5 min) and clean up on timeout.

### 3. Progress invisibility during retry backoff
When `processJob` retries a failed job, the job sits in `running` status for 1s/2s/4s... with no progress update. Users checking the job list see "running" with stale progress.

**Fix (minor):** Call `jobs.updateProgress(job.id, progress, "Retrying (attempt N)...")` before the backoff sleep.

---

## Deployment checklist update

In addition to the original checklist:

- [ ] **MUST FIX** S3: `LIMIT 1` → `IN` in `requeueStaleJobs()` subquery
- [ ] Verify partial index on `(status, started_at) WHERE status = 'running'` exists or add it
- [ ] Add socket timeout to SSE endpoint (recommended)
- [ ] Run `requeueStaleJobs()` verification query before and after fix

---

## Verdict

**CONDITIONALLY APPROVED.** The S2 and S4 fixes are correct. The Founding Engineer's additional fixes (Zod→400, dead processor, recursive retry) are correct. Tests are weak but provide baseline structural confidence.

**S3 has a critical bug:** `LIMIT 1` restricts stale-job recovery to 1 job per call, making crashed-worker recovery effectively broken for N>1 orphaned jobs. This must be fixed before ship.

The fix is a one-line change: `=` → `IN`, remove `LIMIT 1`. The CTO can verify in under 60 seconds.

**Routing:** @CTO — requesting go/no-go on the S3 fix. Once approved, the Release Engineer can proceed.
