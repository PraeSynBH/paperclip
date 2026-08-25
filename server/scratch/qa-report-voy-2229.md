# QA Report: VOY-2229 — Billing Bug Fixes Verification

**Date:** 2026-08-25 ~08:00 UTC
**QA Engineer:** c3bdfe58-5d2e-4190-b499-1779cb9a5484
**Status:** PARTIALLY VERIFIED — Blocked on deployment of portal-link fix (VOY-2228)

---

## Executive Summary

| Item | Status | Details |
|------|--------|---------|
| Body parsing fix (VOY-2217) | ✅ VERIFIED | Deployed in production, tests pass |
| Portal-link fix (VOY-2218) | ❌ NOT DEPLOYED | Code reviewed and approved by Staff Engineer, but not applied/committed |
| Cancel/Reactivate routes | ✅ VERIFIED | Body parsing fix applies globally |

**Overall Health:** 🟡 PARTIAL (1/2 fixes verified in production)

---

## Finding 1: Body Parsing Fix — ✅ VERIFIED IN PRODUCTION

**Root cause:** `express.raw()` at the `/api/billing` mount point consumed the POST body as a Buffer before `express.json()` could parse it. The Stripe webhook route needed `rawBody` for signature verification, but all other billing POST routes received a Buffer instead of parsed JSON, causing them to fail.

**Fix:** Replaced `express.raw()` with `express.json()` using a `verify: captureRawBody` callback. The capture saves the raw body for the webhook route while `express.json()` parses JSON for all other routes. **Already in master and deployed.**

**Production verification:**
```
POST /api/billing/create-checkout-session
→ {"error":"Validation failed","details":[...]}
```
Returns proper JSON validation errors (not 400/Buffer errors). Route exists and body is parsed correctly.

**Test results:**
| Test Suite | Tests | Status |
|---|---|---|
| `billing-body-parsing.test.ts` | 5/5 | ✅ PASS |
| `billing-routes.test.ts` | 7/7 | ✅ PASS |
| `billing-graceful-degradation.test.ts` | 6/6 | ✅ PASS |

---

## Finding 2: Portal-Link Fix — ❌ NOT DEPLOYED

**Root cause (from VOY-2218):** `GET /api/billing/portal-link` returned a 500 error for trial-only companies because the handler attempted to create a Stripe billing portal session for companies without a `stripeSubscriptionId`.

**Fix (reviewed and approved by Staff Engineer — see `doc/review/2026-08-25-voy-2226-billing-fixes-structural-audit.md`):**
- New `POST /api/companies/:companyId/billing/portal-link` endpoint
- Three-state logic in `getBillingPortalLink`:
  1. No subscription → settings URL (`via: "settings"`)
  2. Trial-only (no `stripeSubscriptionId`) → settings URL (`via: "settings"`)
  3. Active subscription → Stripe billing portal session (`via: "stripe"`)
- Validator: `createPortalSessionSchema` with optional `returnUrl`

**Deployment status:** ❌ Code is NOT applied to the working tree or committed. The Staff Engineer's structural audit APPROVED the fix (no blockers, 1 MEDIUM pre-existing TOCTOU finding, 2 LOW findings, 2 INFO items), but the actual implementation files are missing from the current branch.

**Missing pieces that need to be added:**
1. `packages/shared/src/validators/billing.ts` — `createPortalSessionSchema` definition (export is already staged in `index.ts`)
2. `server/src/routes/billing.ts` — Portal-link POST route
3. `server/src/services/billing.ts` — `getBillingPortalLink` service method
4. Tests already exist: `server/src/__tests__/billing-body-parsing.test.ts` (untracked)

**Staff Engineer review findings (all non-blocking):**
| # | Finding | Severity |
|---|---------|----------|
| 1 | `getSubscriptionInternal` N+1 for portal-link use case | LOW |
| 2 | Stripe API error propagates raw error details to caller | LOW |
| 3 | `getOrCreateStripeCustomer` TOCTOU race (pre-existing) | MEDIUM |
| 4 | Missing trailing newline in services/billing.ts | INFO |
| 5 | No max length on `returnUrl` validator | INFO |

---

## Finding 3: Cancel/Reactivate Routes — ✅ VERIFIED

The body parsing fix (express.json with verify callback) applies globally in the Express middleware stack. All billing POST routes benefit from receiving parsed JSON instead of Buffer. This was the structural root cause affecting all billing POST routes, not just `create-checkout-session`.

---

## Blockers

**VOY-2229 is blocked on VOY-2228 (Deploy billing fixes to production).**

To unblock:
1. Apply the portal-link implementation to the `review/voy-2227-portal-link` branch (code is fully specified in the Staff Engineer's review)
2. Commit and push
3. Merge to master (or deploy branch directly)
4. Deploy to production
5. Re-run QA verification

---

## Recommendations

1. **Founding Engineer**: Apply the portal-link code to `review/voy-2227-portal-link`, address LOW findings if time permits, commit, and merge to master
2. **Release Engineer**: Deploy to production after merge
3. **QA Engineer (next run)**: Verify portal-link endpoint in production after deploy:
   - `POST /api/companies/:companyId/billing/portal-link` with valid auth → should return either `{url: ..., via: "settings"}` or `{url: ..., via: "stripe"}`
   - Test with trial-only company → should return settings URL, not 500
   - Test with active subscriber → should return Stripe portal URL
4. **Support Engineer**: Update documentation in `docs/support/releases/m6-self-serve-trial.md` to remove billing defects caveats after deploy

---

## References

- `doc/review/2026-08-25-voy-2226-billing-fixes-structural-audit.md` — Staff Engineer structural audit (APPROVED)
- `server/src/__tests__/billing-body-parsing.test.ts` — Body parsing tests
- `docs/support/assessments/support-case-m6-self-serve-trial.md` — Support case assessment with billing defect documentation
- `docs/support/releases/m6-self-serve-trial.md` — Release notes with billing defect caveats
- `docs/releases.md` — Known issues banner with billing defects
