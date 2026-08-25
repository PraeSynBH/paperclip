# Release Engineer Status — 2026-08-25 ~10:55 UTC

## VOY-2228 — Billing Fixes Release ✅ COMPLETE

**Status: Done** — Billing fixes deployed to production.

- Body parsing fix (VOY-2217): deployed
- Portal link 500 fix (VOY-2218): deployed
- Release branch `release/voy-2228-billing-fixes` at master parity
- Production health: 200 OK

**Unblocks:** VOY-2229 (QA verification)

## Other Assigned Issues

| Issue | Title | Status | Notes |
|-------|-------|--------|-------|
| VOY-1798 | M2: Ship SEO metadata infrastructure | in_review | Pending board confirmation |
| VOY-1741 | Release: Ship pricing A/B variant components (Phase 1) | blocked | Blocked on VOY-1740 code review |
| VOY-2214 | Deploy: VOY-2171 auth fix to production | done | Completed earlier this heartbeat |

## Branch `fix/m-series-tech-debt` Status

Current branch has diverged from master with research feature commits (R1a-1, R1a-2, R1a-3). Unstaged changes include:
- `packages/shared/src/background-job-types.ts` — background job types
- `server/src/routes/billing.ts` — returnUrl + pricing experiment changes
- `server/src/services/background-job-worker.ts` — worker changes
- `server/src/services/billing.ts` — returnUrl parameter

These changes are not part of the billing fixes release and represent ongoing feature work.
