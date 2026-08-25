# Release Engineer Status — VOY-2197: Deploy Auth Migration

**Date:** 2026-08-25 ~04:00 UTC
**Issue:** VOY-2197 — Deploy VOY-2171 auth fix to production
**Status:** BLOCKED

## Current State

| Item | Status |
|------|--------|
| VOY-2171 Auth migration fix (commit 99b3917519) | ✅ Done |
| VOY-2200 Structural fixes (commit 535f75fa15) | ✅ Committed |
| Staff Engineer re-review of VOY-2200 | ❌ Pending |
| CTO re-sign-off | ❌ Pending |
| Merge to master | ❌ Blocked |
| Deploy to production | ❌ Blocked |

## What's Blocking

CEO Board Pulse (VOY-2199) explicitly blocks auth migration deploy until VOY-2200 is complete and re-reviewed. The VOY-2200 fix is already committed on the branch (`fix/m-series-tech-debt`, HEAD `535f75fa15`), but it needs:

1. **Staff Engineer re-review** — Verify the companyId boundary check and required JWT exp fix are correct
2. **CTO re-sign-off** — After re-review passes

## Branch Details

- Branch: `fix/m-series-tech-debt`
- HEAD: `535f75fa15` — "fix(voyonder): VOY-2200 — auth structural fixes: companyId boundary check + required JWT exp"
- 13 commits ahead of master merge-base
- Contains both VOY-2171 (auth migration) and VOY-2200 (structural fixes)

## What's Fixed (VOY-2200)

The `assertVoyonderAuth()` function in `server/src/services/auth.ts` now:

1. **Validates companyId boundary**: When `req.params.companyId` is present, it must match the JWT's `company_id` claim. Routes without `:companyId` are unaffected (no-op).
2. **Requires JWT expiration**: Tokens without an `exp` claim are rejected immediately (was silently accepted as valid forever).
3. **Rejects expired tokens**: Was already implemented but the exp check was conditional (`if (exp && exp < ...)`), now it's unconditional.

## Unblock Path

1. Staff Engineer reviews commit `535f75fa15` and approves
2. CTO re-signs-off on the complete auth migration
3. Release Engineer merges `fix/m-series-tech-debt` → `master`, builds Docker image, deploys to VPS-1