# R1a Final Structural Audit (v2) — Branch fix/m-series-tech-debt

- Date: 2026-08-25 (~16:10 UTC)
- Reviewer: Staff Engineer (eee825c7-6509-485f-b25f-f6f057c50d6b)
- Scope: Commits `24c8c5a455..8976083b9b` (research feature + R1a structural fixes),
  re-audited at HEAD `fb2b9c9d37` after the R1a fix commit `8976083b9b` landed.
- Prior review: doc/review/2026-08-25-r1a-pre-ship-review.md (Findings A–G; A/B/C fixed in 8976083b9b)

## Verdict: DO NOT SHIP — new P0 found (plus 2 P1, 4 P2)

The R1a fix commit addressed Findings A–G correctly (verify: resolve-vs-gather
enqueue order, compensating `failed` on job-create failure, single resolution
path, job_id index + SET NULL FK, null-byte checksum delimiter, LRU cache
helper, download endpoint, lifecycle tests). Those fixes are structurally sound.

However, a full read of the processor surface surfaced a **new P0 that was
missed in the prior review and is not caught by CI** — the CI test suite
itself hangs on it.

---

## P0 — Event-loop-blocking infinite loop in entity-resolver

File: `server/src/services/entity-resolver.ts`

- `AIRLINE_RE` (line 62) and `CATEGORY_RE` (line 65) are non-global regexes
  (no `/g` flag).
- `extractAirlines()` (line 278) and `extractCategories()` (line 290) consume
  them in a `while ((match = RE.exec(query)) !== null)` loop. Without `/g`,
  `lastIndex` never advances, so a **match → match → match → … forever**.

Evidence (reproduced locally):
- `resolveQuery("trip to Tokyo on Delta airlines")` → infinite loop (airline).
- `resolveQuery("flights to Paris")` / `"hotels in Tokyo"` → infinite loop (category).
- `npx vitest run src/__tests__/entity-resolver.test.ts --testTimeout=5000`
  **hangs the whole test process** (timeout 124 after 120s, zero output).
  Why the config-level `testTimeout: 30000` doesn't save CI: the loop is
  CPU-bound in the same thread as the vitest worker, so the timeout timer
  never gets to fire. Any CI job that runs this suite hangs until the job
  wrapper kills it.

Impact in production:
- Every research query containing a travel category word (flights, hotels,
  activities, restaurants, transport, …) or a recognized airline name
  (Delta, United, Emirates, …) pins a worker slot for the full 5-minute
  `processorTimeoutMs` at 100% CPU, then fails the job with a timeout.
- `batchSize` is 5 — 5 such queries saturate the entire worker, stalling all
  other jobs (semantic search, PDF exports) behind them. The server process
  shares this event loop → request latency spikes for everyone.
- This is a very common query shape ("flights to Tokyo", "hotels in Paris"),
  so it will be hit on day one, not in an edge case.

Tests already exercise the bug (they hang): the added lifecycle test
"RESEARCH_RESOLVE_ENTITIES enqueues GATHER_CITATIONS…" uses rawQuery
`"flights to Tokyo under $1000"`, and entity-resolver.test.ts uses
`"flights to London"`, `"hotels in Paris"`, `"Delta flights to London"`.
These suites must never have actually completed; they were committed un-run
or the run was force-killed.

### Required fix (minimal, matches existing pattern)

Add `/g` and reset `lastIndex` before each loop, exactly like the already-safe
`extractAirportCodes` / `extractBudget` / `extractAbsoluteDates`:

```ts
const AIRLINE_RE = /\b(…)\b/gi;
const CATEGORY_RE = /\b(…)\b/gi;
// in extractAirlines / extractCategories:
AIRLINE_RE.lastIndex = 0;
CATEGORY_RE.lastIndex = 0;
```

### Required regression test

A test that runs `resolveQuery` on a category query and an airline query with a
bounded execution guard (e.g. `Promise.race` + timeout or simply the fixed
suite completing under testTimeout) — proves the loop terminates. Note: a
plain `it()` re-firing the old bug would hang CI the same way, so the fix and
test must land together.

---

## P1 — RESEARCH_RESOLVE_ENTITIES retry is not idempotent across the state machine

File: `server/src/services/background-job-worker.ts` (processor lines 205–270)
+ `server/src/services/research-artifacts.ts` (`updateQueryStatus`, lines 169–197)

Processor sequence: `setQueryEntities` (pending→resolving, guarded WHERE) →
`updateQueryStatus("gathering")` (validated + guarded) → create gather job →
`linkQueryJob` → `report(100)`.

Failure modes when the worker's retry loop (up to 2 retries) re-runs the
processor:

1. **Transient failure between the `gathering` transition and the fan-out**
   (e.g. `svc.create` of the gather job hits a DB blip). Retry:
   - `setQueryEntities` correctly no-ops (status no longer `pending`);
   - `updateQueryStatus("gathering")` → `validateQueryTransition("gathering" → "gathering")`
     **throws 400 "Invalid query status transition: gathering → gathering"**.
   - The retry loop treats this as transient, burns both retries, and marks
     the job permanently `failed`. The query is left in `gathering` **with no
     gather job ever created** → orphaned query (the exact class of bug
     Finding B was meant to eliminate, re-appears on a different path).
2. **Transient failure after the gather job exists but before `linkQueryJob`/
   `report`** → retry throws on the state check; meanwhile the already-created
   gather job runs and the query completes — job shows `failed` while work
   succeeded (noisy failure, broken invariant between query.status and
   job.status).

Suggested fix: make the advance idempotent — in the processor, read current
status and skip/advance conditionally:

```ts
const current = await artifactSvc.getQuery(companyId, researchQueryId);
if (current?.status === "pending") await artifactSvc.setQueryEntities(...);
if (current && ["pending","resolving"].includes(current.status)) {
  await artifactSvc.updateQueryStatus(companyId, researchQueryId, "gathering");
}
// only enqueue gather job if none exists yet (query.jobId is null or not a GATHER job)
```

Or make `updateQueryStatus` tolerant of same-status ("already at target =
success") — but keeping strict transitions for user-driven PATCH paths and a
separate idempotent advance for the worker is cleaner.

Also: `linkQueryJob` overwrites `researchQueries.jobId` (the resolve job id is
lost when the gather job id is written). Consider keeping the resolve job
reference (no-op or a second column) for observability.

## P1 — `getArtifactsByIds` limit cap can silently truncate verify sets

File: `server/src/services/research-artifacts.ts` lines 348–360

`getArtifactsByIds` passes `.limit(ids.length)` — fine when the DB returns all
requested ids, but combined with `inArray` semantics and the fixed 50-row
order of the callers, a payload with more ids than the batch returns partial
results with no indication. The VERIFY_CITATIONS processor then reports a
lower `verified` count than the caller requested. Not exploitable, but
surprising — cap `artifactIds` at the schema limit (100) or assert
`results.length === ids.length`.

## P2 — SSE listener writes after response end

File: `server/src/routes/background-jobs.ts` (SSE handler, lines 62–100)

The 300s `lifetimeTimer` calls `res.end()`; the heartbeat and live-event
callbacks keep firing afterwards. `res.write()` after `res.end()` throws
`ERR_STREAM_WRITE_AFTER_END`; the exception is caught by `emitEvent`'s
try/catch (good — no crash), but:
- every post-end event is dropped silently and logged as a "failed to publish"
  warning;
- the throw happens inside `emitter.emit`, so **one dead SSE subscriber can
  abort fan-out to other live subscribers** in the same emit.
Guard the callback: `if (res.writableEnded) return;` and also skip when
`req.destroyed`.

## P2 — RESEARCH_GATHER_CITATIONS double-completion / artifact re-creation on retry

File: `server/src/services/background-job-worker.ts` lines 285–362

Retry re-runs the full loop, re-creating artifacts. Checksum dedup
(ON CONFLICT DO UPDATE) prevents duplicate rows but still bumps
`fetchedAt`/`updatedAt` on the existing row, masking the retry and resetting
the freshness clock (a retried gather makes a 7-day-old citation look fresh).
The `complete` transition is guarded, but artifact writes are not idempotent
in effect. Consider `ON CONFLICT DO NOTHING` for gather artifacts (or only
touch a row if its content actually changed) so retries don't re-stamp
freshness.

## P2 — `autoAssess` silently ignores non-issue itemIds

File: `server/src/services/research-search.ts` lines 438–459

`AutoAssessPayload.itemIds` is documented as "research item ids" (issues,
documents, or activity), but the query only ever selects from `issues`.
Passing document/activity ids returns zero items with no error. Either
restrict the surface (schema + docs to issue ids) or implement the other two
lookups.

## P2 — Retry loop does not refresh `startedAt`; stale-sweep can reclaim a live retry

File: `server/src/services/background-job-worker.ts` lines 522–528, 611–662

`startedAt` is set once at the start of `processJob`; retries keep the old
timestamp. With a 5-minute processor timeout + up to 2 backoff retries
(2s, 4s → later attempts), total active time can exceed `processorTimeoutMs +
30s`, so `requeueStaleJobs` can move a job that is actively running attempt 2
back to `queued`. It then gets re-claimed and processed a third time while
attempt 2 is still in flight. Low probability, but it's a double-processing
hazard; refresh `startedAt` at the start of each retry attempt (and
intentionally leave old attempts running to completion — they must be
idempotent, which ties into P1/P2 above).

## P3 — misc (non-blocking)

- `RESEARCH_RESOLVE_ENTITIES` returns `gatherJobId: searchPlan.length > 0 ?
  undefined : null` — inverted/never populated (line 268). Cosmetic but
  misleading for clients.
- EXPORT_ICS stores full `calendarText` in the job result JSONB; the slim
  projection only strips `dataUri` (background-jobs.ts line 33). Multi-MB ICS
  results bloat the tray/list responses and DB. Strip or cap `calendarText`
  in slim projections.
- `download` route: `object.stream.pipe(res)` — on stream error, `next(err)`
  fires after headers are sent, and the stream is not destroyed; add
  `stream.destroy()` in the error path.
- entity-resolver: `extractHotels` hotel-name heuristics can mis-parse
  (e.g. "stay at Hilton" grabs "Hilton"), and BUDGET_RE hardcodes currency
  metadata USD even for EUR/GBP matches — data-quality P3s.

---

## What was verified as sound (no action)

- `assertVoyonderAuth`: HS256-only, `exp` required, URL-param companyId
  cross-checked against JWT companyId, dual-secret support — good trust
  boundary (matches VOY-2200 fixes).
- Job claim: `FOR UPDATE SKIP LOCKED` inside a transaction; unknown job types
  are claimed deliberately so they fail with "No processor registered" rather
  than queue forever — correct.
- Migration 0145→0148: journal registered in order; partial unique
  checksum index, job_id index, SET NULL FK — correct.
- Keyword search: all user input reaches SQL only as bound parameters
  (`escapeLikePattern` + `sql` template literals) — no injection surface
  found; LIKE metacharacters escaped with explicit `ESCAPE '\'`.
- Route company isolation: every research/job route keys on
  `auth.companyId`; `getById`/`list` always filter by companyId.
- `stripBinaryFields` on list/SSE projections prevents bandwidth
  amplification on tray polls.
- Direct POST /background-jobs restricted to registered job types.
- `createArtifact` ON CONFLICT with partial index + `targetWhere` is correct
  drizzle usage for the NULL-checksum case.

## Process note for CTO

The infinite loop shipped twice under review (VOY-2267 Finding list did not
include it; VOY-2270 approved the fix). The CI configuration explicitly
claims `testTimeout: 30000` "is short enough to fail a genuinely hung query"
— that invariant is false for event-loop-blocking loops, and the entity-
resolver suite hangs the whole test process. Recommend:
1. A worker-level processor watchdog that runs the processor in a child
   process or uses `worker_threads` (so CPU-bound hangs are killable), and
2. a CI hard cap + hang detection (e.g. `--testTimeout` alone is not enough;
   wrap the suite with an outer timeout or run vitest with a parent timeout),
   plus
3. pre-commit rule: a new test file must have a green isolated run recorded
   before landing (the entity-resolver suite provably never ran green).