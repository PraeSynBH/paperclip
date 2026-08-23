# VOY-1983 — M6 Phase 3 Billing Integration — Structural Audit

**Reviewer:** Staff Engineer
**Branch:** `feat/clean-m5-pricing-pr`
**Date:** 2026-08-23
**Priority:** Critical

---

## Summary

This is a structural audit of the M6 Phase 3 billing integration on the `feat/clean-m5-pricing-pr` branch.

**Status compared to previous audit (2026-08-23, `feat/m6-self-serve-trial-onboarding`):**
- 3 issues resolved (portal link, grace period, trial reaper not in scope)
- 7 issues still present (P0 crash bug, P1 retry backoff, 2× P2, 3× P3)
- 1 critical test coverage gap

---

## P0 — Trial→paid conversion crashes with unique constraint violation

**File:** `server/src/services/billing.ts`
- `handleSubscriptionUpdated` (line 323-339) — `ON CONFLICT ("stripe_subscription_id")`
- `handleCheckoutSessionCompleted` (line 540-562) — `ON CONFLICT ("stripe_subscription_id")`

**Bug:** When a trial subscription row has `stripe_subscription_id = NULL` (created by `startTrial()` or equivalent), and the user completes Stripe Checkout, both webhook handlers do:

```typescript
INSERT INTO "company_subscriptions" (...)
VALUES (... ${non-null subId} ...)
ON CONFLICT ("stripe_subscription_id") DO UPDATE SET ...
```

SQL `NULL ≠ 'sub_xxx'`, so the conflict never fires. The INSERT then violates the `company_id` UNIQUE constraint (`company_subscriptions_company_unique_idx`), producing error 23505.

**Impact:** Every trial user who completes checkout gets a 500 error. Their Stripe subscription IS created and charged, but the local subscription record is never updated. The company remains on the trial tier with NULL stripe_subscription_id.

**Fix:**
1. Change the conflict target from `("stripe_subscription_id")` to `("company_id")` in both handlers.
2. Update the preliminary SELECT lookups (lines 266-270, 486-490) to also search by `company_id` as a fallback, since the trial row has `stripe_subscription_id = NULL`.
3. The `ON CONFLICT ("company_id") DO UPDATE SET` will correctly match the existing trial row and update it with the new Stripe subscription details.

**Schema:** `packages/db/src/schema/company_subscriptions.ts` confirms both constraints:
- `unique("company_subscriptions_company_unique_idx").on(table.companyId)` — UNIQUE on `company_id`
- `uniqueIndex("company_subscriptions_stripe_subscription_idx").on(table.stripeSubscriptionId)` — UNIQUE INDEX on `stripe_subscription_id` (nullable)

---

## P1 — `withStripeRetry` backoff is too aggressive

**File:** `server/src/services/billing.ts` — line 38

```typescript
const STRIPE_RETRY_BASE_DELAY_MS = 200;
const STRIPE_RETRY_MAX_ATTEMPTS = 3;
```

The retry strategy burns through all 3 attempts in ~600ms (200ms → 400ms → fail). Stripe's recommended retry strategy starts at 1-2 seconds with jitter. Transient 429 rate limits and network hiccups frequently need longer than 200ms.

**Fix:** Increase `STRIPE_RETRY_BASE_DELAY_MS` to at least 1000ms and add jitter (random factor 0-500ms). This is especially important for user-facing endpoints like `createCheckoutSession` and `getBillingPortalLink`.

---

## P2 — No `subscription_data` for trial conversion in checkout session

**File:** `server/src/services/billing.ts` — `createCheckoutSession` (lines 883-923)

The checkout session is created without `subscription_data` or `trial_settings`:

```typescript
stripe.checkout.sessions.create({
  mode: "subscription",
  customer: stripeCustomerId,
  line_items: [{ price: stripePriceId, quantity: 1 }],
  // No subscription_data or trial_settings
  metadata: { paperclipCompanyId, paperclipTierId, billingPeriod },
  success_url, cancel_url,
});
```

**Consequence:** Stripe may extend the trial period rather than ending it, or behave unpredictably depending on the customer's existing trial state in Stripe.

**Fix:** Add `subscription_data` with `trial_settings.end_behavior: "cancel"` or `trial_period_days: 0` to ensure the user immediately starts paying upon checkout completion.

---

## P2 — `handleSubscriptionDeleted` can't clean up trial rows

**File:** `server/src/services/billing.ts` — `handleSubscriptionDeleted` (lines 416-447)

The handler uses:
```typescript
.where(eq(companySubscriptionsTable.stripeSubscriptionId, stripeSub.id))
```

Trial subscription rows have `stripe_subscription_id = NULL`. If Stripe fires a `customer.subscription.deleted` event for a subscription that was created from a trial, the `WHERE` clause won't match the trial row.

**Mitigation:** This is partially addressed by the P0 fix (the trial row gets a non-null `stripe_subscription_id` once converted). But there's a window where the trial row has NULL and Stripe fires delete. Add a fallback lookup by `company_id` when `stripe_subscription_id` is NULL.

---

## P3 — Event dedup is after-the-fact

**File:** `server/src/services/billing.ts` — `handleWebhook` (lines 1476-1495)

The dedup INSERT happens AFTER the handler runs. While handlers are idempotent (upsert-based), this means Stripe retries during handler execution will run the handler again.

**Fix (optimization):** Move the dedup check to BEFORE handler dispatch. Check `stripe_webhook_events` for the event ID and return early if already processed. This is safe because the dedup INSERT is wrapped in a try/catch for 23505.

---

## P3 — `handleTrialWillEnd` is logging-only, no notification path

**File:** `server/src/services/billing.ts` — `handleTrialWillEnd` (lines 624-659)

Stripe sends `customer.subscription.trial_will_end` 3 days before trial expiry — the ideal time to send a reminder. The current implementation only logs the event and updates `trialEnd` on the subscription record.

**Fix:** At minimum, emit a `publishLiveEvent` so the frontend can surface an upgrade prompt. Ideally, send an email or in-app notification.

---

## P3 — N+1 queries in feature/subscription lookups

**Files:**
- `getSubscriptionInternal` (lines 728-758) — 3 queries: subscription → tier → usage
- `checkFeatureAccess` (lines 773-827) — 3 queries: subscription → tier → (feature tier check)

Each makes three sequential DB queries that could be expressed as a single JOIN. These are called per-request, not in loops, so not an emergency — but worth consolidating for the traffic growth path.

**Fix:** Use Drizzle `leftJoin` or a raw SQL JOIN.

---

## ✅ Resolved issues (not present in this PR)

| Issue | Status | Evidence |
|-------|--------|----------|
| Billing portal session | ✅ Fixed | `getBillingPortalLink` implemented (line 925), route at `billing.ts:135-149` |
| Grace period | ✅ Fixed | `TRIAL_GRACE_PERIOD_DAYS = 7` (line 617), handled in `handlePostTrialStatus` (lines 684-725) |
| Trial reaper (unconditional run) | ✅ N/A | Not present in this branch — no `expireTrials` or trial reaper interval |

---

## Test Coverage Gap — Critical

**File:** `server/src/__tests__/billing-e2e.test.ts`

The E2E tests cover:
- ✅ Checkout session creation (test 3)
- ✅ Normal subscription via Stripe + checkout handler (test 4)
- ✅ Webhook race: handleSubscriptionUpdated before handleCheckoutSessionCompleted (test 4b)
- ✅ Cancel/reactivate (test 7)
- ✅ Webhook event dedup (test 8)
- ✅ Invoice upsert (test 9)
- ✅ Billing overview (test 10)
- ✅ Usage reporting (test 11)
- ✅ Tier change (test 12)
- ✅ Invoice sync (test 13)
- ✅ Portal link (test 14)
- ✅ Trial will end handler (test 15)
- ✅ Grace period entry (test 16)
- ✅ Grace period expiry (test 17)

**MISSING — Trial→paid conversion:**
- No test creates a local subscription row with `stripe_subscription_id = NULL` and then exercises the checkout webhook
- Tests 4 and 4b create subscriptions directly via Stripe API (which sets `stripe_subscription_id` immediately), so they never trigger the `ON CONFLICT ("stripe_subscription_id")` bug
- Add a test: (1) insert a subscription row with `stripe_subscription_id = NULL` and status "trialing", (2) call `handleCheckoutSessionCompleted` with a mock session pointing to a real Stripe subscription, (3) verify the row is updated in-place (not a duplicate INSERT crash)

---

## Assessment

| Severity | Issues | Must fix before shipping? |
|----------|--------|--------------------------|
| **P0**   | 1      | **YES** — trial→paid conversion crash on every conversion |
| **P1**   | 1      | **YES** — aggressive retry backoff will cause Stripe API failures under load |
| **P2**   | 2      | Recommend — subscription_data missing, handleSubscriptionDeleted cleanup gap |
| **P3**   | 3      | Defer — dedup ordering, trial_will_end notification, N+1 queries |
| **Test** | 1      | **Critical gap** — no test exercises the P0 bug path |

## Approval

**BLOCKED** — pending P0 fix and P1 mitigation.

Route to the CTO for go/no-go after fixes are applied.