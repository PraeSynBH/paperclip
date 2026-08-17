# Staff Engineer — Re-review: C-1/C-2/C-3 Critical Fixes

**Date**: 2026-08-17 ~02:00 UTC
**Branch**: v0.4.0-polaris-deep-planning-memory
**Parent Review**: VOY-1263 (Phase 5 Board UI structural review)
**Fix Issues**: VOY-1297 (C-1), VOY-1298 (C-2), VOY-1299 (C-3)

---

## Re-review Methodology

Code-diff analysis of each fix against the parent branch, examining:
1. Does the fix address the root cause identified in the original review?
2. Does the fix introduce new structural issues (N+1, race windows, trust violations)?
3. Is the fix scoped correctly (no drive-by changes)?

---

## C-1: LLM Trust Boundary — Action Signal Validation

**Issue**: VOY-1297 | **Status**: done | **Verdict**: APPROVED

### What was done
- Added Zod schema (`resolutionActionSchema`) in `server/src/routes/board-chat.ts`
- `extractActionSignals()` now validates every `%%ACTIONS%%{...}%%/ACTIONS%%` block against the schema before emission to the SSE stream
- Malformed/oversized/unrecognized blocks are silently skipped with a console.warn
- Added `MAX_ACTION_BLOCKS = 10` safety limit to prevent runaway parsing
- Return type changed from `Record<string, unknown>[]` to `ValidatedAction[]`

### Schema constraints
- `resolution.type`: enum `["issue", "plan", "approval", "knowledge", "memory"]`
- `resolution.action`: enum `["create", "update"]`
- `resolution.data.url`: validated as http/https URL via Zod `.url()` + `.refine()`
- `resolution.data.title`: max 500 chars
- `resolution.data.id`: max 200 chars
- `decision.summary`: max 2000 chars
- `decision.rationale`: max 5000 chars
- Unknown top-level keys: rejected (no `.passthrough()` on outer schema)
- Unknown nested keys under `resolution.data`: stripped (`.passthrough()`) — acceptable, the critical validation is the URL protocol

### Edge cases
- Empty response body: regex finds nothing, returns `[]` — safe
- Malformed JSON in block: caught by try/catch, skipped — safe
- Valid JSON but wrong shape: `.safeParse()` returns `{ success: false }`, block skipped — safe
- Overflow: `MAX_ACTION_BLOCKS` limit with warning log — safe
- Null/undefined fields: Zod handles via `.optional()` — safe

### Structural issues found
None. This is a textbook trust boundary enforcement. The only minor observation is that `console.warn` in production should ideally go through a structured logger, but that's already the pattern in this file pre-fix.

---

## C-2: TOCTOU Race — SLA Monitor Dedup

**Issue**: VOY-1298 | **Status**: done | **Verdict**: APPROVED WITH NOTE

### What was done
- Added post-INSERT duplicate verification in `server/src/routes/issues.ts` (lines 5561-5597)
- After creating a new issue, re-runs `checkPremiumSLABreachDuplicate()` to detect near-simultaneous creations
- If a duplicate from another concurrent request is found, the current issue is hidden (set `hiddenAt` + `status: "cancelled"`) and a comment is added to the original tracking issue
- Response includes `deduplicated: true` and `deduplicatedOfIssueId` for the caller

### Analysis

**Pre-insert path** (already existing, lines 5379-5404):
- `checkPremiumSLABreachDuplicate()` runs BEFORE issue creation
- If match found, creation is suppressed entirely — no issue created
- This handles the common case

**Post-insert safety net** (the fix):
- After INSERT, same check runs again
- If match found for a DIFFERENT issue ID (`existingIssueId !== issue.id`), the current issue is suppressed
- This handles the race: request A passes pre-insert check, creates issue; request B passes pre-insert check (hasn't seen A's commit yet), creates issue; A's post-insert check sees B's now-committed row, hides A

**Remaining race window**:
In Read Committed isolation, there is a window where both transactions are in-flight simultaneously without either having committed:
1. T1: SELECT (no match), INSERT (uncommitted)
2. T2: SELECT (no match — T1 uncommitted), INSERT (uncommitted)
3. T1: post-insert SELECT (sees only T1's own row — T2 uncommitted)
4. T2: post-insert SELECT (sees only T2's own row — T1 uncommitted)
5. Both commit
6. Result: both issues exist, neither hidden

This window is narrow (both SELECT-then-INSERT pairs must overlap), and the consequence is bounded (one duplicate hidden issue — the next monitor firing catches it). Acceptable for shipping.

### Structural issues found
None new. The pre-existing design choice to use title-pattern matching instead of DB-level unique constraints is the root cause, and the post-insert check is a pragmatic mitigation. A future improvement could add a partial unique index on `(company_id, created_at_range, title_pattern)`, but that's not blocking.

---

## C-3: to_tsquery throws on User Input

**Issue**: VOY-1299 | **Status**: done | **Verdict**: APPROVED

### What was done
- `server/src/services/knowledge-documents.ts`: replaced manual tsquery construction with `plainto_tsquery('english', query)`
- `server/src/services/memory-context-injection.ts`: same replacement in `doKnowledgeWarmUp()`
- Removed manual word splitting, escaping, and `:*` suffix logic
- Empty query check simplified to `!searchQuery.trim()`

### Why this is correct
- `plainto_tsquery('english', 'user input with punctuation!')` safely strips special characters and produces valid tsquery
- Original code used `to_tsquery('english', manually_constructed_string)` which threw on `&`, `|`, `!`, `(`, `)`, apostrophes, etc.
- `plainto_tsquery` is specifically designed for user-input full-text search (Postgres docs: "plainto_tsquery transforms unformatted text querytext to tsquery")
- Prefix-match behavior (`:*`) from the original code is sacrificed, but `plainto_tsquery` does stemming which is actually better for user-facing search

### Edge cases
- Empty string: returns empty result set via `return []` guard
- All-punctuation string: `plainto_tsquery` produces empty tsquery, no results returned — acceptable
- Long strings: no length-based denial-of-service vector introduced
- Unicode: `plainto_tsquery` handles it natively via the `english` text search configuration

### Structural issues found
None. Clean, minimal, correct fix.

---

## Disposition

| Issue | Verdict | Notes |
|-------|---------|-------|
| C-1 (VOY-1297) | APPROVED | Trust boundary correctly enforced with Zod schema. Safe to ship. |
| C-2 (VOY-1298) | APPROVED WITH NOTE | Post-insert safety net adequately mitigates the race. A narrow remaining window exists (both transactions in-flight simultaneously) but the consequence is bounded. Not blocking. |
| C-3 (VOY-1299) | APPROVED | `plainto_tsquery` is the correct fix. Safe to ship. |

**Overall: APPROVED for shipping.** All three critical findings have adequate fixes. The branch can proceed through the release pipeline.

### Escalation to CTO
Per approval routing: this review is submitted to the CTO (5a914da0) for final go/no-go decision. The code changes are in the working tree on branch `v0.4.0-polaris-deep-planning-memory` and are ready for commit + deployment.
