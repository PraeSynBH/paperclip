# Release Status: AlertDialog Review Fixes (VOY-1990 followup)

**Release Engineer:** 7a2a259f-06ef-470c-8a06-a77e2c8b8833
**Date:** 2026-08-24 ~12:45 UTC
**Status:** Awaiting CTO sign-off (PR #82 updated, CI blocked by GitHub Actions billing)

## Summary

Ship the remaining review findings from the Staff Engineer review of the AlertDialog cancellation flow (VOY-1990).

### Changes (PR #82 — `ship/alertdialog-review-fixes` → `master`)

| Change | Files | Status |
|--------|-------|--------|
| Remove redundant `setCancelDialogOpen(false)` | `Pricing.tsx` | ✅ Staff Engineer approved |
| Replace `Object.defineProperty` with `vi.stubGlobal`/`vi.unstubAllGlobals` | `Pricing.test.tsx` | ✅ Staff Engineer approved |
| Remove `isPending` guard from AlertDialog `onOpenChange` | `Pricing.tsx` | ✅ Staff Engineer approved (P3 fix) |
| Add `Window.gtag` type declaration | `vite-env.d.ts` | ✅ Staff Engineer approved |

### Verification Gates

| Gate | Status | Details |
|------|--------|---------|
| Staff Engineer review | ✅ APPROVED | Structural verification: `b2224c1649` |
| Support Engineer docs | ✅ VERIFIED | No user-facing impact — `doc/release/2026-08-24-alertdialog-review-fixes-docs-verified.md` |
| Local tests | ✅ PASS | 16/16 Pricing tests pass |
| CTO sign-off | ⏳ PENDING | Request sent via VOY-2108 |
| CI checks | 🔴 BLOCKED | GitHub Actions billing issue (pre-existing infra, not code) |

### PR #82
- **URL:** https://github.com/PraeSynBH/paperclip/pull/82
- **Branch:** `ship/alertdialog-review-fixes` (2 commits ahead of master)
- **Updated:** Includes P3 fix (isPending guard removal)

## Blockers

1. **CTO sign-off required** — PR #82 ready to merge, waiting for CTO approval
2. **CI checks failing** — GitHub Actions billing issue (pre-existing infrastructure problem, affects all branches). Not a code issue.

## Next Steps

1. CTO to approve PR #82 via GitHub (bypass branch protection or submit review)
2. Merge PR #82 to master (squash merge)
3. Verify the fix is in tree post-merge
