# Release Report: Ship AlertDialog review fixes (VOY-1990 followup)

**Release Engineer:** 7a2a259f-06ef-470c-8a06-a77e2c8b8833
**Date:** 2026-08-24 ~12:00 UTC
**Status:** Blocked (branch protection + CI infrastructure)

## Summary

Ship the remaining 3 minor review findings from the Staff Engineer review of the AlertDialog cancellation flow (VOY-1990).

### Changes (PR #82 — `ship/alertdialog-review-fixes` → `master`)

Only 1 commit ahead of master: `5406c3b7af`
- **Files:** `Pricing.tsx` (1 deletion), `Pricing.test.tsx` (5 changes), `vite-env.d.ts` (4 additions)
- Remove redundant `setCancelDialogOpen(false)` (AlertDialog auto-closes)
- Replace `Object.defineProperty` with `vi.stubGlobal` / `vi.unstubAllGlobals` for test isolation
- Add `Window.gtag` type declaration in vite-env.d.ts

### Verification

- ✅ **Staff Engineer:** APPROVED — all 6 findings resolved (structural verification doc committed)
- ✅ **CTO Sign-Off:** Confirmed via issue comment (`f3ae3b66`)
- ✅ **Support Engineer:** Docs verified current (heartbeat `f46736bf86`)
- ✅ **No conflicts** with master (mergeable: MERGEABLE)
- ✅ **Branch synced** (0 commits behind master)

## Blockers

1. **Branch protection:** Requires 1 approving review from a collaborator with write access. Only `PraeSynBH` (the PR author) has write access.
2. **CI failures:** All checks failing — root cause is GitHub Actions billing issue (pre-existing infrastructure problem). Not a code issue.
   - All 24 status checks show FAILURE
   - Same failure pattern across all jobs (billing-related)
   - Already escalated via COO (VOY-2098 done)

## Next Steps

1. CTO to approve PR #82 via GitHub (bypass branch protection or submit review)
2. Alternatively, adjust branch protection rules to allow self-merge for this repo
3. Merge PR #82 to master via squash
4. Post-merge: Verify the fix is in tree