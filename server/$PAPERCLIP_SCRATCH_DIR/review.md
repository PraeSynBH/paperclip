# Structural Audit: VOY-1987 Webhook Race Fix

## Branch: feat/clean-m5-pricing-pr
## Review scope: handleSubscriptionUpdated race condition fix + billing system

---

## CRITICAL: Missing usage record creation in `handleSubscriptionUpdated` fallback path

**File:** `server/src/services/billing.ts:203-258`

The else branch handles the race where `customer.subscription.updated` (or `customer.subscription.created`) fires before `checkout.session.completed`. It creates the subscription record via `INSERT ... ON CONFLICT DO UPDATE` (line 230), but **never creates the three usage records** (seats, agent_runs, storage_gb) that every subscription needs.

**Race scenario that hits this:**
1. Stripe fires `customer.subscription.updated` → `handleSubscriptionUpdated` else branch creates subscription record (no usage records)
2. Stripe fires `checkout.session.completed` → `handleCheckoutSessionCompleted` checks for existing subscription (line 305-308) → skips because "already exists"
3. **Result:** Subscription exists in `company_subscriptions` but has zero rows in `subscription_usage`

Downstream impact:
- `getSubscription` (line 394-403) returns `usage: []`
- `getBillingOverview` returns `usage: []`
- `reportUsage` will create usage records on first report (line 831-846), but they won't exist until someone explicitly reports usage
- Any code that assumes usage records are pre-seeded will silently get empty data

**Fix required:** After the `INSERT ... ON CONFLICT` in the else branch, fetch the tier via `getTier(tierId)` and create the three usage records (seats, agent_runs, storage_gb) with `usage: 0`, matching the pattern in `handleCheckoutSessionCompleted` (lines 353-371) and `createOrUpdateSubscription` (lines 681-698).

---

## CRITICAL: Raw SQL INSERT doesn't RETURNING — cannot get subscription ID

**File:** `server/src/services/billing.ts:230-252`

The `INSERT ... ON CONFLICT DO UPDATE` statement has no `RETURNING` clause. After the raw SQL executes, the local subscription record's `id` is unknown. This ID is required as a foreign key in `subscription_usage` records.

**Fix required:** Either:
- Add `RETURNING *` to the raw SQL and extract the result
- Or perform a follow-up `SELECT` after the INSERT to get the subscription record

---

## CRITICAL: Date serialization regression in raw SQL queries

**File:** `server/src/services/billing.ts:128-139` (handleInvoicePaid) and `server/src/services/billing.ts:239-243` (handleSubscriptionUpdated)

The branch changed `.toISOString()` on Date objects to raw Date objects in four places inside raw `sql` tagged template queries:

```diff
- ${invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null},
+ ${invoice.period_start ? new Date(invoice.period_start * 1000) : null},
```

The `postgres` library used by `tx.execute(sql`...`)` cannot serialize `Date` objects — it expects `string` or `Buffer`. This causes a runtime crash in `handleInvoicePaid`:

```
TypeError: The "string" argument must be of type string or an instance of Buffer or ArrayBuffer. Received an instance of Date
```

**Test evidence:** The billing E2E test "handleInvoicePaid upserts invoice records idempotently" **passes on main** but **fails on this branch** (13/13 on main, 12/13 on branch, with this exact error).

**Fix required:** Revert to `.toISOString()` for all Date parameters in raw `sql` tagged template queries. The Drizzle ORM's `insert().values()` handles Date objects natively, but `postgres`'s raw SQL parameters do not.

---

## HIGH: Stripe API retry wrapper removed

**File:** `server/src/services/billing.ts` (whole file)

The branch removed the `withStripeRetry` function (which was ~40 lines of exponential-backoff retry logic for Stripe API calls). This function was used in:
- `getOrCreateStripeCustomer` — `stripe.customers.create()`
- The `createOrUpdateSubscription` path (via Stripe API calls)

Without this retry wrapper, transient Stripe failures (5xx, 429, connection errors) that were previously retried up to 3 times with exponential backoff will now fail immediately, returning 500 errors to the caller.

**Recommendation:** Restore the `withStripeRetry` wrapper. Stripe's own API can return transient errors, and the billing flow is user-facing enough that a retry-before-fail approach is warranted.

---

## MODERATE: No usage record healing in `handleCheckoutSessionCompleted`

**File:** `server/src/services/billing.ts:305-308`

When `checkout.session.completed` finds an existing subscription (line 305-308), it skips entirely. It should also check whether `subscription_usage` records exist for the subscription, and create them if missing. This provides defense in depth against the race condition.

---

## MODERATE: No concurrency test for the race scenario

**File:** `server/src/__tests__/billing-e2e.test.ts`

The billing E2E test has no test case that reproduces the race condition (calling `handleSubscriptionUpdated` before `handleCheckoutSessionCompleted`). Such a test should verify:
1. The subscription record is created idempotently (no duplicate key error)
2. All three usage records are created
3. `handleCheckoutSessionCompleted` skips gracefully when subscription already exists

---

## LOW: `publishLiveEvent` removed from `handleInvoicePaymentFailed`

**File:** `server/src/services/billing.ts:161-173`

The main branch published a live event (`subscription.status.updated`) when a subscription payment failed. The branch removed this. If there are WebSocket-connected UI clients that react to subscription status changes, they won't be notified of payment failures.

---

## Summary

| Severity | Issue | Location |
|----------|-------|----------|
| CRITICAL | Missing usage record creation in else branch | billing.ts:203-258 |
| CRITICAL | Raw SQL INSERT doesn't RETURNING | billing.ts:230-252 |
| CRITICAL | Date serialization regression (breaks handleInvoicePaid) | billing.ts:128-139, 239-243 |
| HIGH | Stripe API retry wrapper removed | billing.ts (whole file) |
| MODERATE | No usage record healing in handleCheckoutSessionCompleted | billing.ts:305-308 |
| MODERATE | No concurrency test for race scenario | billing-e2e.test.ts |
| LOW | publishLiveEvent removed from handleInvoicePaymentFailed | billing.ts:161-173 |

**Verdict: DO NOT SHIP.** The three CRITICAL issues must be fixed before this branch can land. The Date serialization regression alone will cause a production crash the first time an invoice is paid for a subscription created via the fallback path.