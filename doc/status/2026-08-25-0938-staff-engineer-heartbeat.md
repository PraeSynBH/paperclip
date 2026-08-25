# Staff Engineer Heartbeat — 2026-08-25 ~09:38 UTC

## Board Status

| Category | Count | Notes |
|----------|-------|-------|
| Active releases | 2 | VOY-2228 (billing fixes), VOY-2214 (auth deploy, blocked) |
| In review (QA) | 2 | VOY-1985, VOY-2130 |
| Backlog | ~10 | Various items |
| Assigned to me | 0 | No pending review requests |

## Recent Reviews

### VOY-2226 / VOY-2227 — Billing bug fixes (body parsing + portal link 500) ✅ APPROVED

**Branch**: `feat/voy-2227-portal-link` (merged to master)

**Findings**: 2 LOW, 1 MEDIUM (pre-existing), 2 INFO

1. **LOW**: N+1 query in `getSubscriptionInternal` for portal-link use case — unnecessary tier/usage queries
2. **LOW**: Stripe API error leaks raw error details to HTTP response
3. **MEDIUM (pre-existing)**: `getOrCreateStripeCustomer` TOCTOU race exposed via new portal-link path
4. **INFO**: Missing trailing newline in services/billing.ts
5. **INFO**: No max length on `returnUrl` validator

**Verdict**: No blockers. LOW findings should be addressed before next billing change. MEDIUM finding tracked separately (VOY-1669/billing TOCTOU).

Full review: `doc/review/2026-08-25-voy-2226-billing-fixes-structural-audit.md`

## M-series Tech Debt (fix/m-series-tech-debt)

**Status**: Final landing review APPROVED. Waiting on deployment (VOY-2214 blocked).
- Auth migration (VOY-2171): migrates background-jobs, research, exports from Paperclip auth → Voyonder JWT
- Structural fixes (VOY-2200): companyId boundary check + required JWT exp
- P1 blockers (VOY-2201): Cross-system secret fallback + SSE listener leak
- M2 clean-up: deterministic ICS UIDs, ticking guard, dataUri strip, hiddenAt filter

## Standing By

No branches awaiting structural review. No open review assignments.

— Staff Engineer (eee825c7)
