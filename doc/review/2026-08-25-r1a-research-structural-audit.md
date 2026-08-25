# Structural Audit: R1a Research Foundation (fix/m-series-tech-debt R1a commits)

**Reviewer:** Staff Engineer (eee825c7)
**Date:** 2026-08-25 ~10:40 UTC
**Branch:** `fix/m-series-tech-debt`
**Scope:** R1a research commits added after the previous landing review
  - `24c8c5a455` — DB schemas + migration (research_artifacts, research_queries, trips)
  - `5f7a5120fc` — Entity resolver service (regex-based)
  - `144d790973` — Research artifact service + REST routes
  - Uncommitted: `background-job-types.ts` (3 new job types), `background-job-worker.ts` (imports), billing `returnUrl` fix

**Previous review:** `doc/review/2026-08-25-fix-m-series-tech-debt-final-landing-review.md` (08:40 UTC, APPROVED for landing)

---

## Context

The previous review covered the M2 background-job machinery and Voyonder auth migration. This review covers the **R1a research foundation** commits that were added to the branch after that approval. If the branch is not yet merged, these findings apply to the current HEAD.

---

## Structural Findings

### A1 [HIGH] TOCTOU race in status transitions — `server/src/services/research-artifacts.ts:131-143` and `390-407`

Both `updateQueryStatus` and `updateTripStatus` do a read-then-write:

```typescript
const query = await getQuery(companyId, queryId);   // read
validateQueryTransition(query.status, status);       // validate stale state
// ← concurrent mutation window →
await db.update(researchQueries).set({ status })     // write (no guard)
```

Between the read and the write, another concurrent request can change the underlying status. The validation passes against stale data, and the UPDATE unconditionally overwrites. A `pending→complete` transition could race with a `pending→failed` transition, and whichever UPDATE commits second wins — even if its transition was invalid against the actual current state.

**Impact:** Corrupted query/trip state machine under concurrent access. Low likelihood in single-user scenarios but guaranteed to fire with automated research pipelines or multi-user collaboration on the same trip.

**Fix:** Make the UPDATE conditional on the expected current status:

```typescript
await db.update(researchQueries)
  .set({ status, updatedAt: sql`now()` })
  .where(and(
    eq(researchQueries.id, queryId),
    eq(researchQueries.companyId, companyId),
    eq(researchQueries.status, query.status),  // guard
  ))
  .returning();
if (!updated) throw conflict("Status changed since read");
```

This eliminates the race without transactions or advisory locks. Same pattern for both `updateQueryStatus` and `updateTripStatus`.

---

### A2 [HIGH] Dedup race in `createArtifact` — `server/src/services/research-artifacts.ts:172-183`

The checksum-based dedup uses a read-then-write:

```typescript
const existing = await findArtifactByChecksum(companyId, data.checksum);
if (existing) { /* update fetchedAt */ return; }
// insert new artifact  ← two concurrent inserts both reach here
```

There is **no unique constraint** on `(company_id, checksum)` in the migration (line 74 creates a non-unique index only). Two concurrent calls with the same checksum both pass the read and insert duplicate rows.

**Impact:** Duplicate research artifacts silently accumulating. The `findArtifactByChecksum` list function returns the first match, so subsequent reads see only one duplicate, but the DB accumulates garbage rows that waste space and potentially confuse aggregation queries.

**Fix:** Replace the non-unique index with a unique partial index:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "research_artifacts_checksum_company_unique"
  ON "research_artifacts" ("company_id", "checksum")
  WHERE "checksum" IS NOT NULL;
```

Then use an atomic upsert in the service:

```typescript
const [artifact] = await db
  .insert(researchArtifacts)
  .values({ ... })
  .onConflictDoUpdate({
    target: [researchArtifacts.companyId, researchArtifacts.checksum],
    set: { fetchedAt: sql`now()`, updatedAt: sql`now()` },
  })
  .returning();
```

This eliminates the read-then-write window entirely and makes the dedup atomic.

---

### A3 [HIGH] Zero test coverage for `research-artifact-service.ts`

The artifact service contains the most application logic (state machine validation, checksum dedup, CRUD with company isolation) but has **zero tests**. Compare:

| Area | Lines | Tests |
|------|-------|-------|
| `research-search.ts` | 659 | 261 lines (embedded PG) |
| `entity-resolver.ts` | 475 | 217 lines (pure unit) |
| `research-artifacts.ts` | 511 | **0 lines** |
| `background-jobs.ts` | 169 | 499 lines (embedded PG) |

Every path through `research-artifacts.ts` is untested: query lifecycle (5 states, 5 transitions), trip lifecycle (5 states, 6 transitions), dedup collision, soft-delete cascading (or lack thereof), company isolation enforcement, and validation error paths.

**Fix:** Add tests before shipping. At minimum:
- Query state machine: `pending→resolving→gathering→complete`, `pending→failed→pending` (retry), all invalid transitions
- Trip state machine: `draft→researching→planning→confirmed→cancelled→draft` (restart)
- Checksum dedup: concurrent insert with same checksum produces one row
- Company isolation: company A cannot read/write company B's artifacts
- Soft-delete: cancelled trips still loadable, associated artifacts unaffected

Edge cases to cover:
- `updateQueryStatus`/`updateTripStatus` on nonexistent ID → 404
- `createQuery` with empty/over-long query → 400
- `createTrip` with empty/over-long title → 400
- `listQueries`/`listArtifacts`/`listTrips` with no results → empty array (not null)

---

### A4 [MEDIUM] Entity resolver regex `lastIndex` leakage — `server/src/services/entity-resolver.ts`

Three global regexes are used in `exec()` loops. Only one resets `lastIndex`:

| Regex | Line | Resets `lastIndex`? | Risk |
|-------|------|---------------------|------|
| `BUDGET_RE` | 56 | ✅ Line 245: `BUDGET_RE.lastIndex = 0` | Safe |
| `AIRPORT_CODE_RE` | 19 | ❌ | Skip/infinite-loop if `.test()` called between calls |
| `ABSOLUTE_DATE_RE` | 47 | ❌ | Skip/infinite-loop if `.test()` called between calls |

The `g` flag on these regexes means `exec()` mutates `lastIndex` with every match. If any calling code ever calls `.test()` or a partial match on these regexes between `resolveQuery()` calls, the next `exec()` loop starts from a non-zero `lastIndex` — skipping matches or infinite-looping.

While the current call graph makes this unlikely (each `resolveQuery()` call is isolated), the fragility is in the shared module scope. `BUDGET_RE` already does the right thing — the other two should follow the same pattern.

**Fix:** Add `lastIndex = 0` before the `while` loop in `extractAirportCodes` (line 160) and `extractAbsoluteDates` (line 218).

---

### A5 [MEDIUM] Business logic in route handler — `server/src/routes/research-artifacts.ts:112-119`

The `POST /companies/:companyId/research/queries` route handler calls `resolveQuery()` directly:

```typescript
const resolved = resolveQuery(req.body.query);
await artifacts.setQueryEntities(companyId, query.id, resolved.entities as any);
```

This puts entity resolution — a core business operation — in the controller layer. If Phase R1b adds LLM-based fallback or async entity resolution, the route handler needs restructuring.

**Fix:** Move `resolveQuery()` call into the artifact service. A single `submitQuery()` method should handle the full flow atomically: create query → resolve entities → link background job. The route handler validates input and returns the result; it should not orchestrate business logic.

---

### A6 [MEDIUM] In-process EventEmitter coupling for SSE — `server/src/services/live-events.ts`

The live-events system uses an in-process `EventEmitter`. The background-job worker is co-located in the same Node.js process, so SSE subscribers receive events directly. This works now but couples the worker to the web server. If the worker is extracted into a separate process (as scaling demands), SSE delivery silently breaks — no errors, just no events reaching subscribers.

**Mitigation:** Not a blocking issue. The SSE route has a 5-minute connection lifetime cap (`SSE_MAX_LIFETIME_SEC=300`), and the UI tray polls `GET /background-jobs` as fallback, so brief interruptions are survivable. Document this coupling in `background-job-worker.ts` and plan for a message-bus abstraction (Redis Pub/Sub or `pg_notify`) when the worker is separated.

---

### A7 [LOW] No cascading on trip soft-delete — `server/src/services/research-artifacts.ts:442-450`

`deleteTrip` sets `status = 'cancelled'` on the trip but does not cascade to linked research queries or artifacts. Active queries with `tripId` pointing to a cancelled trip remain visible when filtering by that trip ID. The service should offer a `cancelTrip` method that marks associated active queries as `failed` and artifacts as `rejected`.

**Impact:** A cancelled trip with in-flight queries continues to appear in `listQueries(tripId=...)` results. The UI must either filter out cancelled trips client-side or the service must cascade.

**Fix (deferred):** Not blocking M2. Add cascade logic when trip lifecycle management is built out.

---

### A8 [LOW] `updateTrip` uses `Record<string, unknown>` — `server/src/services/research-artifacts.ts:422`

The `updateData` variable is typed as `Record<string, unknown>` instead of a typed partial. This bypasses compile-time checking of the update payload:

```typescript
const updateData: Record<string, unknown> = { updatedAt: sql`now()` };
if (data.title !== undefined) updateData.title = data.title;
```

If a new field is added to the `updateTrip` parameter type but forgotten in the update logic, there's no type error. Use a typed partial `Partial<typeof trips.$inferInsert>` instead.

**Fix:**

```typescript
const updateData: Partial<typeof trips.$inferInsert> & { updatedAt: ReturnType<typeof sql<never>> } = { updatedAt: sql`now()` };
```

---

### A9 [LOW] Redundant `dataUri` stripping in backwards-compatible paths

The `background-jobs.ts` service has two code paths that strip `dataUri` from job results — `toApi()` (list projection) and `emitEvent()` (SSE projection). Both do `{ ...row.result, dataUri: undefined }`. This is intentional and correct (avoids base64 PDF bloat in list/SSE), but the duplication is a maintenance hazard if the result schema grows more binary fields.

**Fix:** Extract a shared `stripBinaryFields(result)` helper.

---

### A10 [LOW] `research-artifacts.ts` missing FK on `researchQueryId` and `tripId`

The migration for `research_artifacts` does not define foreign key constraints for `trip_id` or `research_query_id` (lines 48-49 of the migration SQL). These columns are nullable and accept any UUID value without referential integrity. `research_queries.trip_id` does have an FK. This is intentional to allow artifacts to exist without a parent query, but means referential integrity is enforced only in application code.

**Impact:** Application bugs that reference nonexistent queries/trips silently succeed. Consider adding FK constraints or documenting the rationale explicitly in the schema.

---

## Uncommitted Changes Review

The working tree has 4 modified files. None are blocking:

| File | Change | Verdict |
|------|--------|---------|
| `background-job-types.ts` | Adds 3 new job type constants (`RESEARCH_RESOLVE_ENTITIES`, `RESEARCH_GATHER_CITATIONS`, `RESEARCH_VERIFY_CITATIONS`) + trailing newline | ✅ Constants-only; no processors registered yet. The trailing newline fix eliminates a diff artifact. |
| `server/src/routes/billing.ts` | Passes `req.body.returnUrl` to `getBillingPortalLink` | ✅ `returnUrl` is Zod-validated as `.url().max(2048)` (from shared schema). Express 5 catches async errors. |
| `server/src/services/billing.ts` | Accepts optional `returnUrl` parameter, passes to Stripe portal session | ✅ Stripe validates the URL server-side. Falls back to `FRONTEND_URL` when not provided. |
| `server/src/services/background-job-worker.ts` | Adds imports for `researchArtifactService` and `resolveQuery` | ✅ Imports are unused currently but will be needed when processor registrations are added for the new job types. No behavioral change. |

---

## Summary

| # | Severity | Finding | File | Fix |
|---|----------|---------|------|-----|
| A1 | **HIGH** | TOCTOU race in query/trip status transitions | `research-artifacts.ts:131-143, 390-407` | Conditional UPDATE with status guard |
| A2 | **HIGH** | Dedup race in `createArtifact` — no unique constraint on checksum | `research-artifacts.ts:172-183` | Unique index + `onConflictDoUpdate` |
| A3 | **HIGH** | Zero tests for `research-artifact-service.ts` (511 lines) | `research-artifacts.ts` | Add state machine + dedup + isolation tests |
| A4 | **MEDIUM** | Global regex `lastIndex` not reset | `entity-resolver.ts:19,47` | Reset `lastIndex` before `exec()` loops |
| A5 | **MEDIUM** | Business logic in route handler | `research-artifacts.ts:112-119` | Move `resolveQuery` into service layer |
| A6 | **MEDIUM** | Worker-SSE coupling via in-process EventEmitter | `live-events.ts` | Document + plan message-bus abstraction |
| A7 | **LOW** | No cascade on trip soft-delete | `research-artifacts.ts:442-450` | Defer to trip lifecycle phase |
| A8 | **LOW** | `Record<string, unknown>` in `updateTrip` | `research-artifacts.ts:422` | Use typed partial |
| A9 | **LOW** | Duplicated `dataUri` stripping logic | `background-jobs.ts` | Shared helper |
| A10 | **LOW** | Missing FK constraints on `research_artifacts` | migration SQL | Document or add FKs |

## Approval Routing

**Status: BLOCKED.** Findings A1–A3 are structural issues that must be fixed before shipping. A4–A6 should be addressed as part of the fix cycle. A7–A10 are backlog items.

Route final sign-off through the CTO per standard procedure.
