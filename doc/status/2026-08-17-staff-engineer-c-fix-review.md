# Staff Engineer — C-Fix Structural Review (2026-08-17)

## Review Scope

Working tree changes to the v0.4.0-polaris-deep-planning-memory branch targeting three critical findings (C-1/C-2/C-3) from the Workstream C structural audit, plus tangential memory extraction jobs infrastructure.

## C-Fixes: Structural Verdict — APPROVED (Conditional)

### C-1: LLM Trust Boundary — Zod schema for SSE action signals
**File:** `server/src/routes/board-chat.ts`

✅ Zod schema (`resolutionActionSchema`) validates all action blocks before they reach the SSE stream
✅ Type enum restricted to known types (issue/plan/approval/knowledge/memory)
✅ Action enum restricted to (create/update)
✅ URL protocol restricted to http/https via `.refine()`
✅ Max length limits on title (500), id (200), summary (2000), rationale (5000)
✅ MAX_ACTION_BLOCKS = 10 hard cap prevents unbounded processing
✅ Malformed JSON blocks silently skipped
✅ Validation failures logged via console.warn (acceptable for local_trusted)
✅ Cleaned response still strips raw markup before persisting

### C-2: TOCTOU Race — Post-insert duplicate verification
**File:** `server/src/routes/issues.ts`

✅ Second `checkPremiumSLABreachDuplicate()` call after INSERT closes the detection window
✅ Duplicate hidden (hiddenAt + cancelled), linked to original via comment
✅ Response includes deduplication metadata for the caller
✅ Only applies to non-watchdog, non-child issues (correct scope narrowing)

### C-3: to_tsquery from user input — plainto_tsquery migration
**Files:** `server/src/services/knowledge-documents.ts`, `server/src/services/memory-context-injection.ts`

✅ `plainto_tsquery('english', query)` replaces manual tsquery construction in both files
✅ Punctuation, operators, and special characters stripped by PostgreSQL instead of causing 400 errors
✅ Empty-query early-return simplified in memory-context-injection.ts (was redundant with removed tsquery building)
✅ SQL injection not a concern — drizzle-orm parameterizes all inputs

## Fixes Applied During This Review

### FINDING 1 (MEDIUM, FIXED): TOCTOU in memory-extraction-jobs.ts:retry()
**File:** `server/src/services/memory-extraction-jobs.ts:103-136`

The `retry()` function read the job status first, then updated — classic TOCTOU. Two concurrent retries would both pass the status check and both apply the UPDATE, double-queuing the job.

**Fix applied:** Added `eq(memoryExtractionJobs.status, "failed")` to the UPDATE WHERE clause, turning it into a compare-and-swap. Only one concurrent retry can match the row; the second gets zero rows and throws a conflict error.

### FINDING 2 (LOW, FIXED): serializeTurn regex narrowed defense-in-depth
**File:** `server/src/routes/board-chat.ts:123`

The regex change from `/<(\/?turn\b)/gi` to `/<(\/?turn\b)/gi` (escaped `<` only) stopped escaping opening `<turn>` tags, allowing a potential history-injection vector through user input.

**Fix applied:** Restored original regex `/(<\/?turn\b)/gi` which escapes both `<turn>` and `</turn>`.

## Memory Extraction Jobs: Structural Assessment

The new extraction job service + UI (untracked files) were included in this branch and reviewed:

- ✅ Routes guarded by `assertBoard()` — correct authorization boundary
- ✅ Company-scoped queries on all reads/writes
- ✅ `retry()` now has proper CAS guard (see Finding 1 fix)
- ✅ Drizzle uses parameterized queries throughout
- ⚠️ No OpenAPI spec registration for the new endpoints (deferrable)
- ⚠️ 15s auto-refresh in UI is aggressive for polling (acceptable for pre-release)

## Previously Approved (Committed)

Commit `266e0ad11b` resolves three earlier findings from the VOY-1210 review:

| Finding | Fix | Status |
|---------|-----|--------|
| C-1: cross-tenant IDOR | companyId filtering on all plan queries | ✅ |
| C-2: LCS OOM | MAX_DIFF_LINES=2000 guard | ✅ |
| C-3: re-resolve invariant | status=pending filter on resolveGate | ✅ |
| Tests | 36 new tests covering all three | ✅ |

## Disposition

**APPROVED — conditional on applied fixes.** Both findings identified during this review have been fixed in the working tree. No remaining structural issues block shipping.

The branch is ready for:
1. Committing the working tree changes (C-fixes + extraction jobs)
2. Release to staging (VOY-1264)

Routing approval to CTO: the C-fixes and applied fixups are structurally sound and ready for final sign-off.
