# Staff Engineer Review: v0.4.0-polaris-deep-planning-memory

**Date:** 2026-08-17
**Branch:** v0.4.0-polaris-deep-planning-memory
**Base:** fork/master
**Files reviewed:** 216 changed code files + uncommitted working-tree changes
**Reference:** Commit 809292a6e7 (feat(v0.4.0): promoteFromMemory, search cache, REINDEX endpoint, capabilities, docs sync)

## Overall Assessment: CONDITIONAL APPROVAL

The architecture is sound and the team did good work on tenant-scoping (C-1), memory bounds (C-2), and invariant protection (C-3). Several structural issues must be fixed before shipping.

---

## 🔴 CRITICAL (must fix before ship)

### C-1: Missing transaction wrapping in `promoteFromMemory`
**File:** `server/src/services/knowledge-documents.ts:914-998`

The multi-table insert (document + revision + backlink) is not wrapped in a DB transaction. If the revision insert or backlink insert fails after the document insert succeeds, the result is an orphan document with no revision and a phantom backlink.

**Fix:** Wrap the three `db.insert()` calls in `db.transaction(async (tx) => { ... })`.

### C-2: No deduplication guard for memory-to-knowledge promotion
**File:** `server/src/services/knowledge-documents.ts:914-998`

Concurrent calls to `promoteFromMemory` for the same `memoryRecordId` create duplicate knowledge documents. There is no unique constraint and no application-level check.

**Fix:** Add a unique index on `(memory_record_id)` in the `knowledge_documents` table and handle constraint violations gracefully.

### C-3: Knowledge search cache has no invalidation
**File:** `server/src/services/knowledge-documents.ts:846-897`

The in-memory cache in `searchPublished` has a 5-minute TTL but zero invalidation hooks. After a knowledge document is created, updated, or deleted, stale results are served for up to 5 minutes.

**Fix:** Add cache invalidation in `createDocument`, `updateDocument`, and `deleteDocument`. At minimum, clear the entire cache on any knowledge document mutation; ideally use a tagging scheme for finer-grained invalidation.

---

## 🟠 HIGH (fix before ship)

### H-1: Knowledge search cache LRU eviction is actually FIFO
**File:** `server/src/services/knowledge-documents.ts:892-895`

`Map.keys().next()` returns the oldest *inserted* key, not the least-recently-used one. This reduces cache hit rate over time.

**Fix:** Re-insert the entry on cache hit to promote it to the end (Map insertion order), or use `lru-cache` from npm.

### H-2: `resolveGate` plan metadata flip may race with concurrent document saves
**File:** `server/src/services/plan-review-gates.ts:171-185`

The `resolveGate` function wraps the gate update + allApproved check + metadata flip in a transaction. However, the metadata flip on the `documents` table sets `planMetadata.status` to `"approved"` unconditionally — it doesn't verify that the document's `latestRevisionId` still matches the gate's revisionId. If a new revision is created concurrently, the metadata could be flipped on a revision that still has pending gates.

**Fix:** Add a WHERE clause checking `documents.latestRevisionId = gate.revisionId` to the metadata update, or skip the flip entirely if the revision is no longer current.

### H-3: `isZombieRun` now queries DB on every check with no caching
**File:** `server/src/services/heartbeat.ts:4480-4493`

The new `liveRunExecutions.has()` queries `heartbeatRuns` on every agent wakeup. During a cold start or recovery storm, this adds unnecessary load.

**Fix:** Add an in-memory `Set<string>` of known-active run IDs that is populated on startup and invalidated when runs complete. Use the DB query only as a fallback after a configurable staleness threshold (e.g., 5s).

---

## 🟡 MEDIUM (address before next release)

### M-1: REINDEX uses blocking form, not CONCURRENTLY
**File:** `server/src/routes/knowledge.ts:370-380`

`REINDEX INDEX` acquires ACCESS EXCLUSIVE lock. For production, prefer `REINDEX INDEX CONCURRENTLY` to avoid downtime.

### M-2: Hardcoded index name in REINDEX
**File:** `server/src/routes/knowledge.ts:370-380`

`memory_records_embedding_hnsw_idx` is hardcoded. `IF EXISTS` prevents crash if renamed, but the endpoint silently no-ops.

**Fix:** Store the canonical index name in a constant referenced by both the migration and the route.

---

## ✅ Already done well

- **Approval flow security is correct**: agents CANNOT approve their own knowledge documents. The `submitForReview` route requires `assertBoardOrAgent` (agents can submit), but the `review` route (approve/reject) requires `assertBoard` — only board-level actors (humans, CTO, CEO, COO) can approve. The `publish` route uses `assertBoardOrAgent` which is safe because a board actor must have already approved.
- Tenant-scoping is consistently applied across all services and routes.
- `resolveGate` atomicity wraps gate resolution and allApproved check in a single transaction.
- `plan_review_gates` has a DB-level CHECK constraint (migration 0135).
- SLA monitor dedup partial unique index (migration 0134) is well-designed.
- Test coverage for `plan-review-gates.ts` is thorough.

## Tracked In

All critical and high findings are tracked in **VOY-1325** (Fix critical and high issues found in Staff Engineer review), assigned to Founding Engineer.