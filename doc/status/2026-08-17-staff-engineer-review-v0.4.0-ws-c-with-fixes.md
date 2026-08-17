# Staff Engineer Review: v0.4.0-polaris-deep-planning-memory (Full Working Tree)

**Date**: 2026-08-17 ~03:00 UTC
**Branch**: v0.4.0-polaris-deep-planning-memory
**Base**: HEAD (f654460019) — docs commit; code changes are uncommitted in working tree

---

## Scope

This review covers the entire working tree diff against HEAD. It incorporates and reaffirms the previous C-fix re-review (doc/status/2026-08-17-staff-engineer-re-review-c-fixes.md), and extends the audit to all changes not previously reviewed: the plan review gates batch-count method, memory extraction jobs, live event wiring, UI improvements, and utility additions.

---

## Previously Reviewed: C-Fixes (Re-affirmed ✅)

### C-1 (VOY-1297) — LLM Trust Boundary
`server/src/routes/board-chat.ts`
- Zod schema validation of action signals ✅
- URL protocol restricted to http/https ✅
- MAX_ACTION_BLOCKS = 10 safety limit ✅
- Malformed blocks silently skipped with console.warn ✅
- **Verdict: APPROVED** (unchanged)

### C-2 (VOY-1298) — TOCTOU Race
`server/src/routes/issues.ts` (post-insert duplicate verification, lines 5583-5619)
- Post-INSERT dedup re-check after issue creation ✅
- Hidden + cancelled on duplicate detection ✅
- Narrow remaining race window (both txns simultaneously in-flight, Read Committed isolation) — bounded consequence, acceptable ✅
- **Verdict: APPROVED** (unchanged)

### C-3 (VOY-1299) — to_tsquery throws on User Input
`server/src/services/knowledge-documents.ts`, `server/src/services/memory-context-injection.ts`
- `plainto_tsquery('english', query)` replaces manual tsquery construction ✅
- Empty query guard simplified ✅
- **Verdict: APPROVED** (unchanged)

---

## NEW Structural Review Findings

### Finding 1 (MEDIUM) — `listGateCounts` missing tenant scope filter

**File**: `server/src/services/plan-review-gates.ts:222-246`
**What**: The new `listGateCounts` method counts active gates for a batch of (documentId, revisionId) pairs. Unlike every other method in `planReviewGateService`, it does NOT include a `companyId` WHERE clause.

**Risk**: The docstring says "caller must scope documentIds to a single company (C-1)" — this puts the tenant-safety burden entirely on the caller. If a future caller (or a bug in the current caller) mixes documentIds from different companies, the query will return gate counts across tenant boundaries. The `planReviewGates` table has a `companyId` column; the method should accept and filter by it.

**Current caller**: The issues list route (`server/src/routes/issues.ts:3406`) is properly scoped via `assertCompanyAccess(req, companyId)` and uses documentIds from `planDocumentsSvc.listPlanDocuments(issueIds)` which is also company-scoped. So the current code is safe in practice. But defense-in-depth is violated.

**Fix**: Add a `companyId` parameter to `listGateCounts` and add `eq(planReviewGates.companyId, companyId)` to the WHERE clause. This is a 3-line change and brings the method in line with the rest of the service.

```typescript
// Current (tenant-unsafe):
listGateCounts: async (pairs: { documentId: string; revisionId: string }[]) => {

// Fix:
listGateCounts: async (companyId: string, pairs: { documentId: string; revisionId: string }[]) => {
  // ... add to WHERE:
  eq(planReviewGates.companyId, companyId),
```

---

### Finding 2 (LOW) — Missing live events for gate supersession

**Files**: `server/src/services/plan-review-gates.ts:173-214`
**What**: When gates are superseded (via `supersedeGatesForRevision` or `supersedeGatesForPreviousRevisions`), no `plan.gate_*` live event is emitted. The UI has handlers for `plan.gate_created` and `plan.gate_resolved`, but not for supersession.

**Impact**: If a revision is superseded while a user is viewing the plan gates, the stale pending gates will still appear as "pending" until the user manually refreshes. Plan status indicators and gate counts (including `gatesCount` on plan cards) will be stale.

**Mitigation**: The supersession flow typically happens when a new revision is created, which emits a `plan.updated` event. The UI's `plan.updated` handler could be extended to also invalidate gate-related queries. Or, a new `plan.gate_superseded` event could be emitted.

**Recommendation**: Add a `plan.gate_superseded` live event (or batch event) in both supersede methods, and handle it in `LiveUpdatesProvider` by invalidating `["issues", "plan-gates", issueId]` queries. For now, the gap is bounded since supersession is closely followed by new gate creation (which emits `plan.gate_created`), so the UI will refresh soon anyway. **Not blocking for shipping, but file a follow-up.**

---

### Finding 3 (LOW) — Extraction job retry TOCTOU race

**File**: `server/src/services/memory-extraction-jobs.ts:103-141`
**What**: The `retry` method first reads the job (`getById`), checks `status === "failed"`, then issues an UPDATE with `WHERE status = 'failed'`. Two concurrent retry calls on the same job can both pass the pre-check, but only one UPDATE succeeds (the second finds the status already changed). The second caller gets:

> Cannot retry extraction job "{id}": job not found or status already changed from "failed".

**Impact**: Low. The second caller gets a 400 error. No data corruption — the job is only retried once. But the error message is misleading: the job exists, it was just already claimed by another retry. A `409 Conflict` with a clearer message ("already being retried") would be more accurate.

**Note**: The pre-check + conditional UPDATE pattern _does_ prevent double-retry (the WHERE clause on `status = 'failed'` serializes concurrent attempts). The issue is only the UX of the error response, not data integrity.

**Recommendation**: Minor — change the error status code from 400 to 409 and improve the message. Not blocking.

---

### Finding 4 (LOW) — In-place mutation of plan document objects

**File**: `server/src/routes/issues.ts:3415-3416`
**What**: The gate count batch-fetch mutates plan document objects in the `planDocsByIssueId` map:
```typescript
(doc as IssueDocument).gatesCount = countsByDocId.get(doc.id) ?? 0;
```

**Risk**: If the same document objects are referenced elsewhere in the request lifecycle, this mutation is visible outside this scope. In the current code path, the documents are fresh from `planDocumentsSvc.listPlanDocuments()` and used only to attach to the response, so it's safe. But mutating incoming objects is a code smell that can lead to subtle bugs when the code is refactored.

**Recommendation**: Build new response objects or use a separate Map for gate counts rather than mutating. Minor — not blocking.

---

### Finding 5 (NOTE) — `listGateCounts` OR-based batch query scaling

**File**: `server/src/services/plan-review-gates.ts:226-231`
**What**: The method builds `conditions = pairs.map(p => and(eq(documentId, p.documentId), eq(revisionId, p.revisionId)))` and passes them to `or(...conditions)`. With N pairs, the WHERE clause has N branches, each with 2 equality checks.

**Risk**: For the issues list route (typically 20-50 issues), this is fine. PostgreSQL's `max_parameters` is 65536, so 2N parameters is not a limit issue. However, the query planner may struggle with hundreds of OR branches (planning time grows with `OR` branch count). If a future caller passes thousands of pairs, this could cause slow queries.

**Recommendation**: No action now. If scaling becomes an issue, restructure to use a VALUES join or a temporary table. Not blocking.

---

## UI Changes — Audit Summary

| File | Change | Assessment |
|------|--------|-----------|
| `ui/src/App.tsx` | Added CompanyMemoryTab route | ✅ Clean |
| `ui/src/api/memory.ts` | Memory binding/target/extraction-job API methods; typed interfaces | ✅ Clean |
| `ui/src/components/CompanySettingsSidebar.tsx` | "Memory" nav item | ✅ Clean |
| `ui/src/components/PlanDecompositionWizard.tsx` | Uses `parsePlanMetadata` instead of raw cast | ✅ Safer |
| `ui/src/components/PlanDetailSection.tsx` | Uses `parsePlanMetadata` instead of raw cast | ✅ Safer |
| `ui/src/components/PlanRevisionBrowser.tsx` | Error/retry state for diff loading | ✅ Correct |
| `ui/src/components/access/CompanySettingsNav.tsx` | "Memory" nav item | ✅ Clean |
| `ui/src/context/LiveUpdatesProvider.tsx` | Handlers for `plan.gate_created`, `plan.gate_resolved` | ✅ Correct (see Finding 2 for missing supersession handler) |
| `ui/src/lib/queryKeys.ts` | Memory extraction-jobs, targets, agent-config keys | ✅ Clean |
| `ui/src/pages/AgentDetail.tsx` | AgentMemoryTab integration | ✅ Clean |
| `ui/src/pages/MemoryBrowser.tsx` | Extractions tab, source hyperlinks, latency/cost display | ✅ Clean |
| `ui/src/pages/Plans.tsx` | Removed N+1 per-issue plan doc fetch; uses inline `planDocument` + `gatesCount` | ✅ Significant improvement |

**Key improvement in Plans.tsx**: The previous code fetched plan documents in a per-issue loop (`Promise.all(issues.map(...))`) which caused an N+1 pattern. The new code uses the inline `issue.planDocument` from the batch list endpoint, eliminating the N+1. Combined with the batch `gatesCount`, this is a solid efficiency win. ✅

---

## Remaining Code Quality Notes

### `parsePlanMetadata` utility (`ui/src/lib/plan-metadata.ts`)
Uses `planMetadataSchema.safeParse()` with a `console.warn` fallback on invalid data. Correct pattern — Zod schema provides runtime validation, and the fallback prevents crashes on malformed server data. ✅

### Extraction jobs dashboard polling (`ui/src/components/ExtractionJobsDashboard.tsx:176`)
Polling interval of 15s with `refetchInterval` — reasonable for a dashboard that shows async job progress. The interval persists even when the tab is in the background; this could be optimized with `refetchIntervalInBackground` but is fine for v1. ✅

### Board chat regex fix (`server/src/routes/board-chat.ts:124`)
```
-  const safeBody = body.replace(/<(\/?turn\b)/gi, "&lt;$1");
+  const safeBody = body.replace(/(<\/?turn\b)/gi, "&lt;$1");
```
The parentheses were moved to wrap the entire alternation, fixing the capture group. The old regex captured only the `\/?` part (which was a no-op since `$1` was just `/` or empty). The new regex correctly captures the full tag opener including the optional `/`. **Correct fix, not part of the C-fixes but found in the diff.** ✅

### Missing newline at EOF (`server/src/routes/board-chat.ts:496`, `server/src/routes/memory.ts:471`)
Both files now lack a trailing newline. Minor POSIX compliance issue (`\n` at end of file). Not structural, but worth cleaning up.

---

## Disposition

| Category | Verdict |
|----------|---------|
| C-1 (VOY-1297) — LLM Trust Boundary | ✅ APPROVED (re-affirmed) |
| C-2 (VOY-1298) — TOCTOU Race | ✅ APPROVED (re-affirmed) |
| C-3 (VOY-1299) — to_tsquery throws | ✅ APPROVED (re-affirmed) |
| Plan review gates batch-count + live events | **APPROVED with Finding 1** (MEDIUM: add companyId to listGateCounts) |
| Memory extraction jobs | **APPROVED with Finding 3** (LOW: retry TOCTOU, 400→409) |
| UI changes | ✅ APPROVED |

### Required Before Shipping

**Finding 1 (MEDIUM)**: ~~Add `companyId` parameter to `listGateCounts` and add the tenant filter to the WHERE clause. This is a 3-line change. Without this, the method is inconsistent with the rest of the service and violates defense-in-depth.~~ **RESOLVED during review.** `companyId` parameter added and tenant filter applied. See `server/src/services/plan-review-gates.ts:222` and `server/src/routes/issues.ts:3414`.

### Recommended But Not Blocking

**Finding 2 (LOW)**: File a follow-up to add live events for gate supersession.
**Finding 3 (LOW)**: Change retry error status 400→409 and improve message.
**Finding 4 (LOW)**: Avoid in-place mutation of document objects.

### Overall

**CONDITIONALLY APPROVED** — resolved during review. The three C-fixes are re-affirmed. Finding 1 (tenant-scope in `listGateCounts`) was applied as part of this review. The branch is ready for CTO sign-off and release pipeline.

## Routing

Per approval routing protocol: this review is submitted to the **CTO (5a914da0)** for final go/no-go decision. The CTO should evaluate whether Finding 1 must be fixed before shipping or can be addressed in a follow-up. The changes are in the working tree on `v0.4.0-polaris-deep-planning-memory`.
