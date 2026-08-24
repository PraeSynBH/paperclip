# QA Verification Report: VOY-2137 — Trial-to-paid conversion fix

**Status:** ✅ PASS
**Date:** 2026-08-24 ~17:20 UTC
**Tester:** QA Engineer
**Scope:** Verify trial-to-paid conversion fix in production after deployment

---

## Test Results Summary

| # | Test Case | Result | Evidence |
|---|-----------|--------|----------|
| 1 | Code fix correctness review | ✅ PASS | Both `handleCheckoutSessionCompleted` and `handleSubscriptionUpdated` upsert conflict targets changed from `stripe_subscription_id` to `company_id`. Added `stripe_subscription_id`, `stripe_subscription_item_id`, and `trial_end` to DO UPDATE SET. |
| 2 | Database schema verification | ✅ PASS | `company_subscriptions_company_unique_idx` UNIQUE constraint on `company_id` exists and enforces one-subscription-per-company invariant. |
| 3 | Concurrency/upsert tests (7 tests) | ✅ ALL PASS | `billing-concurrency.test.ts` — tests ON CONFLICT (company_id) prevents duplicates, ON CONFLICT DO NOTHING race-lost handling, FOR UPDATE row lock serialization, usage upsert idempotency, concurrent safety. |
| 4 | E2E Stripe billing tests (18 tests) | ✅ ALL PASS | `billing-e2e-verify.test.ts` — full lifecycle: Stripe API connectivity, customer creation, Checkout Session, subscription creation (trial->active), simulated webhook upsert, feature gating, usage reporting, cancel/reactivate, invoice listing. |
| 5 | Pricing experiment integration (14 tests) | ✅ ALL PASS | `billing-experiment-integration.test.ts` — variant-aware tier listing, checkout session metadata, variant assignment, experiment results aggregation. |
| 6 | Production health check | ✅ STABLE | travel.praesyn.com/api/health returns 200. Stripe dependency: OK (1ms). App pages serving correctly. |
| 7 | No remaining stale references | ✅ CONFIRMED | Zero remaining `ON CONFLICT ("stripe_subscription_id")` in SQL — only comments documenting the fix. |

## Root Cause & Fix Summary

**Root Cause:** The `startTrial` function creates a subscription row with `stripe_subscription_id = NULL`. Both webhook handlers (`handleCheckoutSessionCompleted`, `handleSubscriptionUpdated`) used `ON CONFLICT (stripe_subscription_id)` for their upserts. PostgreSQL NULL comparison semantics mean `NULL = 'sub_abc'` evaluates to NULL (falsy), so the conflict did NOT match the trial row, causing the INSERT to attempt a second row for the same `company_id` — violating the unique constraint.

**Fix (commit 3885b6b5f0 / included in M6 merge 75c884f66d):**
- Changed both upsert conflict targets from `stripe_subscription_id` -> `company_id`
- Added `stripe_subscription_id`, `stripe_subscription_item_id`, and `trial_end` to the DO UPDATE SET clause so these columns are populated when converting a trial row
- The unique index on `stripe_subscription_id` remains as a secondary safety net

## Database Constraints

- `company_subscriptions_company_unique_idx` UNIQUE CONSTRAINT, btree (company_id)
- `company_subscriptions_stripe_subscription_idx` UNIQUE, btree (stripe_subscription_id)

## Risk Assessment

- **Trial to paid conversion:** Fixed. ON CONFLICT (company_id) correctly matches the trial row.
- **Existing paid subscriptions:** No regression. Upsert on company_id works identically for rows that already have stripe_subscription_id set.
- **Webhook idempotency:** Preserved. Second-and-later deliveries still safe no-ops via upsert.
- **Race conditions:** FOR UPDATE row lock + atomic upsert pattern (VOY-1669) remains intact.

## Verdict

The fix is correct, complete, and deployed. All automated tests pass. No regressions detected.

**QA Sign-off:** ✅ PASS — Ready for CTO approval.
