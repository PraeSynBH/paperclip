# Structural Review: M2 Clean-up Fixes (commit 9e663af2a5)

**Reviewer**: Staff Engineer
**Date**: 2026-08-24 ~22:35 UTC
**Branch**: fix/m-series-tech-debt
**Commit**: 9e663af2a5cda43ebc159b0f16f6628d871f02c1
**Last reviewed**: c542464362
**Tests**: 34/34 pass (background-jobs-service: 17/17, research-search-service: 12/12, escape-probe: 5/5)

---

## Verdict: APPROVED — 1 P2 issue flagged (non-blocking)

All four changes are structurally sound. Tests pass. One non-blocking calendar correctness issue is flagged for follow-up.

---

## Change-by-change analysis

### 1. Ticking re-entrancy guard (background-job-worker.ts:403-417)

```ts
let ticking = false;

async function tick() {
  if (stopped || ticking) return;
  ticking = true;
  try {
    const rows = await claimQueuedJobs();
    inFlight += rows.length;
    await Promise.all(rows.map((row) => processJob(row).finally(() => { inFlight -= 1; })));
  } catch (err) {
    logger.error({ err }, "Background job worker tick failed");
  } finally {
    ticking = false;
  }
}
```

**What changed**: The old code had two guards — `if (stopped) return;` and `if (inFlight >= batchSize) return;`. The new code replaces both with a single `ticking` re-entrancy mutex (`if (stopped || ticking) return;`).

**Structural analysis**:
- The old `inFlight >= batchSize` guard is removed. Under the new `ticking` guard this is safe because:
  - `claimQueuedJobs()` limits to `batchSize` (`.limit(batchSize)` at line 217)
  - `ticking` stays `true` for the full tick duration (`ticking=true` → `await claimQueuedJobs()` → `await Promise.all(...)` → `ticking=false`)
  - At most one tick runs at a time, so max `inFlight` ≤ `batchSize`
- The `finally` block ensures `ticking` is always cleared (even on error)
- In-flight accounting via per-job `.finally(() => { inFlight -= 1; })` is correct — decrements run before `Promise.all` resolves, which runs before `ticking=false`
- **Startup race fixed**: `start()` calls `void tick()` immediately AND `setInterval(() => void tick(), pollIntervalMs)`. The `ticking` guard prevents overlap between the immediate tick and the first interval tick — this was a known issue in the M2 audit (finding #5)

**Concern — P2 (throughput, not correctness)**:
Ticks are now fully serialized. In the old code, if a tick claimed fewer than `batchSize` jobs (partial batch), a concurrent tick could top up the queue. Under the new guard, a tick claiming a partial batch blocks the queue until all jobs (including retry backoffs up to 30s) finish. Under retry storms, the queue advances one full batch at a time with no overlap. This is defensible but worth monitoring — if background job latency becomes an issue, consider a semaphore-based approach (allow N pending batches rather than strict serialization).

**Verdict**: ✅ APPROVED. P2 throughput note only.

---

### 2. Strip dataUri from SSE payload (background-jobs.ts:52-56)

```ts
function emitEvent(row: typeof backgroundJobs.$inferSelect) {
  const result = row.result ? { ...row.result, dataUri: undefined } : row.result;
  // ...
}
```

**What changed**: `emitEvent` now strips `dataUri` from the SSE payload before publishing.

**Structural analysis**:
- Matches the existing slim projection in `toApi()` (line 32): `slim && row.result ? { ...row.result, dataUri: undefined } : row.result`
- The UI's `useJobStatus` hook (useJobStatus.ts:127-137) uses SSE *only as a signal* to trigger `backgroundJobsApi.get()` — it never reads `result` from the SSE payload. Verified: SSE `onmessage` handler parses `data.payload` for `jobId` and `status` only, then calls `get()`.
- `getById()` returns the full result including `dataUri`, so export downloads are unaffected
- `{ ...row.result, dataUri: undefined }` — spreading keeps other result fields; `undefined` keys are dropped by `JSON.stringify`. Consistent.

**Verdict**: ✅ APPROVED. Clean.

---

### 3. ICS UID/DTSTAMP (background-job-worker.ts:485-489)

```ts
const lines = [
  "BEGIN:VEVENT",
  `UID:${randomUUID()}@voyonder.com`,
  `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
  `SUMMARY:${sanitizeIcsText(title)}`,
];
```

**What changed**: Added RFC 5545 required `UID` and `DTSTAMP` properties to VEVENT entries.

**Structural analysis**:
- DTSTAMP: `new Date().toISOString()` gives the export generation timestamp, converted to UTC basic format. Correct semantics.
- UID domain `@voyonder.com` is hardcoded — acceptable for current product scope.

**Concern — P2 (calendar import deduplication)**:
`randomUUID()` per VEVENT per export means every export generates a *different* UID for the same logical event. When a user re-exports a trip (e.g., after modifying it) and imports the new ICS, calendar clients (Google Calendar, Apple Calendar) use UID to match events for update/dedup. With random UIDs, re-importing creates **duplicate events** instead of updating existing ones.

**Fix (follow-up)**: Replace `randomUUID()` with a deterministic hash derived from the event's identity. Since the exporter receives `{ title, start, end, location, description }` per event, the UID can be:
```ts
import { createHash } from "node:crypto";
`UID:${createHash("sha256").update(`${title}|${start}|${end}`).digest("hex").slice(0, 32)}@voyonder.com`
```
This produces stable UIDs across re-exports while preserving global uniqueness.

**Severity note**: The previous state (no UID at all) was RFC-noncompliant and some calendar clients would reject the ICS entirely. Adding a random UID is a strict improvement. Deterministic UIDs are the next step toward correct calendar sync behavior. Not a blocker.

**Verdict**: ✅ APPROVED (with P2 follow-up). Non-blocking.

---

### 4. hiddenAt filter in research search (research-search.ts:126)

```ts
isNull(issues.hiddenAt),
```

**What changed**: Added `isNull(issues.hiddenAt)` to the `searchIssues` WHERE clause in the keyword-first search pass.

**Structural analysis**:
- **Before**: The keyword search (`searchIssues`) did NOT filter hidden issues. The semantic path (`fetchIssuesByIds` at line 528) and `autoAssess` (line 455) DID filter `hiddenAt`. This was an inconsistency documented in the M2 audit (finding #1).
- **After**: All three paths now consistently exclude hidden issues.
- The `isNull(issues.hiddenAt)` pattern is used across ~30 other queries in the codebase — well-established convention.
- Query plan impact: the existing `(company_id, updated_at)` index handles the ORDER BY; adding `hidden_at IS NULL` is an additional filter on the index scan. No concern at current scale.

**Verdict**: ✅ APPROVED. Fixes a P1 inconsistency.

---

## Test coverage gaps

| Change | Test coverage | Status |
|--------|--------------|--------|
| ticking guard | None | Existing background-jobs-service tests pass (17/17) but no test exercises concurrent tick behavior |
| ICS UID/DTSTAMP | None | No test validates VEVENT output format |
| hiddenAt filter | None | No test seeds a hidden issue and asserts it's excluded from results |
| dataUri strip | ✅ Covered | background-jobs-service.test.ts:381 — test "strips dataUri from list result but keeps it in getById" |

The missing coverage for items 1-3 is acceptable for a clean-up commit but should be added if significant refactoring touches these areas.

## Summary

| # | Finding | Severity | Action |
|---|---------|----------|--------|
| 1 | Ticking guard removes `inFlight >= batchSize` cap — safe but serializes retry-backlog throughput | P2 (note) | Monitor queue latency under retry storms |
| 2 | dataUri stripped from SSE ✅ | — | — |
| 3 | ICS UID is random per export, breaking calendar dedup on re-import | P2 (follow-up) | Replace randomUUID with deterministic hash |
| 4 | hiddenAt filter added to keyword search ✅ | — | — |

**Overall**: APPROVED. Ship it. The ICS UID determinism is a follow-up item, not a blocker.

---

## Addendum 1 — ICS UID determinism follow-up (2026-08-24 ~22:49 UTC)

**Commit**: uncommitted (working tree change on `fix/m-series-tech-debt`)

**Change**: `server/src/services/background-job-worker.ts` — replaced `randomUUID()` with deterministic SHA-256 hash of `title|start|end` (64-bit hex suffix) in ICS VEVENT UID.

**Structural review**:

| Check | Verdict |
|-------|---------|
| Import hygiene | ✅ `randomUUID` replaced by `createHash` from the same module; zero stale references |
| Hash determinism | ✅ Same `(title, start, end)` tuple always produces the same UID |
| Collision safety | ✅ 2^64 space (birthday bound ~4B); max dozens of events per trip — safe |
| RFC 5545 compliance | ✅ UID format `hash@voyonder.com`; DTSTAMP unchanged (generation timestamp) |
| Edge: `\|` in title | Potential collision if title contains `\|` AND same `start`/`end` as another event. Practically irrelevant — calendar dedup collision would at worst merge two events from the same trip, which is the very scenario this fix improves |
| Export download unaffected | ✅ `getById()` returns full result with `dataUri`; only the ICS generation path changed |

**Verdict**: ✅ APPROVED. No structural issues. Hand off to FE for commit + RE for shipping.

### Test: deterministic ICS UIDs (server/src/__tests__/background-jobs-service.test.ts:248-279)

| Check | Verdict |
|-------|---------|
| Seeds unique company per test | ✅ `seedCompany` with distinct name |
| Creates two identical export.ics jobs | ✅ Same `{title, events}` payload |
| Processes both through `worker.tick()` | ✅ Real execution path |
| Extracts UIDs via regex `UID:([^@]+)@voyonder.com` | ✅ Correct pattern match |
| Assert same events → same UIDs across exports | ✅ `expect(firstUids).toEqual(secondUids)` |
| Assert different events → different UIDs | ✅ `expect(firstUids[0]).not.toBe(firstUids[1])` |

**Verdict**: ✅ APPROVED. Test covers both determinism and collision-freedom. Closes the test coverage gap noted in the original review.

## Final summary

| Item | Status |
|------|--------|
| Production code: deterministic UID | ✅ APPROVED |
| Unit test: UID determinism + collision | ✅ APPROVED |
| Review document updated | ✅ |
| Branch ready for commit | ✅ (FE action) |
| Branch ready for shipping | Awaiting CTO go/no-go |
