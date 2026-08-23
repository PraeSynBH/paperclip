# Structural Audit: M6 Phase 3 Billing Integration

**Issue:** VOY-1983  
**Reviewer:** Staff Engineer  
**Date:** 2026-08-23  
**Status:** BLOCKED — cannot approve for shipping

**Tests:** All 18 E2E billing tests pass (verified 2026-08-23 15:27 UTC)

---

## Critical Issues (must fix before shipping)

### C1: No periodic sweep for trial expiry

**File:** `server/src/services/billing.ts:666-726`

`handlePostTrialStatus` is triggered **only** via `customer.subscription.updated` webhooks (called at line 413 from `handleSubscriptionUpdated`). There is no background cron, periodic sweep, or startup check that scans for subscriptions whose trial has expired.

**Impact:** If Stripe misses the webhook, or the webhook endpoint is down during a deployment, or there is a transient network failure, a subscription can remain in `"trialing"` status indefinitely. The company keeps full paid-feature access (`ACTIVE_SUBSCRIPTION_STATUSES` includes `"trialing"` at `packages/shared/src/billing-features.ts:48`). There is no recovery path until the next `customer.subscription.updated` webhook arrives.

**Fix required:** Add a periodic sweep (e.g. heartbeat scheduler or setInterval) that queries `company_subscriptions WHERE status = 'trialing' AND trial_end < NOW()` and applies the grace-period logic identically to `handlePostTrialStatus`.

### C2: Trial seed tier has no Stripe price IDs

**File:** `packages/db/src/migrations/0232_trial_tier_seed.sql` + `server/src/services/billing.ts:894-896`

Migration `0232_trial_tier_seed.sql` inserts a Trial tier with `price_monthly_cents = 0, price_yearly_cents = 0` but **no `stripe_price_monthly_id` or `stripe_price_yearly_id`**. `createCheckoutSession` throws `unprocessable("Selected tier does not have a Stripe price configured")` when `stripePriceId` is falsy.

The trial flow appears to rely on direct Stripe subscription creation with `trial_period_days` (as the test helper does), not through checkout sessions. These two paths conflict. Either:
1. The Trial tier needs $0 Stripe price IDs so checkout sessions work, **or**
2. The trial signup path should bypass `createCheckoutSession` and use a direct Stripe API call with `trial_period_days`

---

## High Issues

### H1: Grace period only handles `incomplete` and `past_due` — misses `unpaid`

**File:** `server/src/services/billing.ts:682`

```ts
const isNonPayableStatus = stripeSub.status === "incomplete" || stripeSub.status === "past_due"
```

Stripe subscriptions can also enter `"unpaid"` status (after dunning period ends). Subscriptions transitioning from trialing to `unpaid` would not enter the grace period.

**Fix:** Add `"unpaid"` to the check.

### H2: Webhook dedup INSERT is outside the processing transaction

**File:** `server/src/services/billing.ts:1476-1495`

The dedup record is written to `stripeWebhookEvents` **after** event processing completes, in a separate query — not inside the transaction.

**Risk:** If the process crashes between completing event processing and writing the dedup record, on restart the same event is re-processed. Handler-level upserts protect most cases but:
- `handleSubscriptionDeleted` (line 425) uses a plain UPDATE
- `handleInvoicePaymentFailed` (line 233) uses a plain UPDATE
- The existing-branch of `handleSubscriptionUpdated` (line 273) uses a plain UPDATE

Two concurrent webhook deliveries of the same event can also bypass the dedup check since neither has inserted yet.

**Recommendation:** Move the dedup insert into the processing transaction, or wrap the entire dispatch in `db.transaction()`.

---

## Medium Issues

### M1: `grace_period` not in `ACTIVE_SUBSCRIPTION_STATUSES`

**File:** `packages/shared/src/billing-features.ts:48`

```ts
ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing"]
```

During grace period, the subscription is set to `"grace_period"` (billing.ts:698) but this status is not in the active list, so `checkFeatureAccess` returns `subscription_inactive`. The comment at billing.ts:694 says "keep status as 'trialing' or set to 'grace_period'" — the code chose `"grace_period"`.

Either add `"grace_period"` to active statuses if features should work during grace, or update the error message in `requireFeature` to explain the grace period state.

### M2: Billing portal uses default Stripe configuration

**File:** `server/src/services/billing.ts:933`

```ts
stripe.billingPortal.sessions.create({
  customer: stripeCustomerId,
  return_url: portalReturnUrl,
})
```

No `configuration` parameter is passed. Stripe applies whatever default portal configuration exists in the dashboard. Add an env var `STRIPE_PORTAL_CONFIGURATION_ID` and pass it when set.

### M3: `handleInvoicePaymentFailed` not wrapped in a transaction

**File:** `server/src/services/billing.ts:221-253`

TOCTOU window between reading `currentSub` (line 226-230) and updating the subscription status (line 232-238).

### M4: GA4 trial event fires on subscription re-creation

**File:** `server/src/services/billing.ts:402-405`

Fires when `customer.subscription.updated` creates a subscription record for a previously unseen subscription with an active trial — including restored or re-created subscriptions.

---

## Low Issues

### L1: `withStripeRetry` doesn't honor `Retry-After` headers

**File:** `server/src/services/billing.ts:45-74`

Fixed exponential backoff (200ms, 400ms, then fail). A Stripe 429 with `Retry-After: 30` would exhaust retries instantly.

### L2: `STRIPE_WEBHOOK_SECRET` read at module load time

**File:** `server/src/services/billing.ts:20`

```ts
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
```

Module-level const rather than read-on-use. Consistent with other patterns in the codebase but fragile if module load order changes.

---

## Verdict

**BLOCKED.** Cannot approve for shipping until the two CRITICAL items are addressed:

1. **C1:** Add periodic sweep for trial expiry transitions
2. **C2:** Fix Trial tier Stripe price IDs or route trial signups through the correct API path

Hand off to the CTO when these are resolved.