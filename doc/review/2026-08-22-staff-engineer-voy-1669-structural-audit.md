# Staff Engineer Structural Audit — VOY-1669 / VOY-1671 Billing Race Fixes

**Date:** 2026-08-22 ~08:10 UTC  
**Branch:** fix/voy-1669-toctou-billing  
**Review Type:** Pre-ship structural re-verification (batch 2 billing fixes)

## Audit Scope

Full structural review of the production diff and concurrency test suite. Previous Staff Engineer runs approved the initial fixes; this is a final structural re-verification before the branch ships.

## Production Code Verdict: ✅ APPROVED

All structural concerns are addressed with appropriate database-level mechanisms:

### 1. `createOrUpdateSubscription` TOCTOU Race (P1-2) ✅
- **`SELECT ... FOR UPDATE` inside `db.transaction()`** — row-level lock serialises concurrent requests for the same company's subscription
- **`INSERT ... ON CONFLICT DO UPDATE` on `company_id`** — atomic upsert is the belt-and-suspenders guard
- **Race loss detection** — after upsert, compares `record.stripeSubscriptionId !== stripeSubscription.id` to detect race loss; orphan Stripe sub is cancelled with non-fatal `.catch()`
- **Idempotency key** on `stripe.subscriptions.create()` — prevents duplicate Stripe subs when HTTP response is lost and retry fires
- **`withStripeRetry`** on all Stripe API calls (create, retrieve, update)
- **`publishLiveEvent` outside transaction** — correct pattern for API path; DB write is durable independently of SSE delivery

### 2. `reportUsage` Read-then-Write Race (P2) ✅
- Old `SELECT → UPDATE/INSERT` replaced with **`INSERT ... ON CONFLICT DO UPDATE`** on composite unique index `(subscription_id, metric, period_start, period_end)`
- Unique index `subscription_usage_sub_metric_period_idx` verified in schema as safety net
- Stripe `createUsageRecord()` wrapped in `withStripeRetry` with non-fatal catch

### 3. Webhook Transaction Wrapping (P2-1) ✅
- `handleInvoicePaymentFailed` and `handleSubscriptionDeleted` now wrapped in `db.transaction()`
- Consistent with `handleInvoicePaid` and `handleSubscriptionUpdated` patterns
- `publishLiveEvent` inside transaction — correct for webhooks (atomic "process or retry")
- If handler throws, transaction rolls back and Stripe retries

### 4. Stripe API Retry Coverage ✅
All 10 external Stripe API call sites wrapped with `withStripeRetry` (exponential backoff, 3 attempts, 200ms base). Named operation labels for observability.

### 5. Column Mapping Verified ✅
- `companySubscriptionsTable.stripeCustomerId` references `stripeCustomers.id` (UUID FK) — correct
- `stripe.subscriptions.create({ customer })` uses the Stripe `cus_xxx` string — correct
- The destructuring `{ id: stripeCustomerId, stripeCustomerId: stripeCustomerStr }` correctly separates both concerns

### Minor Observations (Non-blocking)
- **`FOR UPDATE` held during Stripe API calls**: Acceptable for billing — only serialises same-company requests. Connection timeout releases lock if Stripe is unresponsive.
- **Logger inside transaction**: Standard practice. Logger has no side effects.

## Test Code Audit

### File: `billing-concurrency.test.ts` (682 lines)

### Strengths ✅
- Direct DB-level tests with no Stripe mocking
- Independent test cases with proper cleanup
- Covers: ON CONFLICT DO UPDATE, ON CONFLICT DO NOTHING, FOR UPDATE serialisation, concurrent upserts, unique index safety net
- `Promise.allSettled()` for concurrent execution

### Bug Fixed During This Review 🛠️
**Two WHERE clauses used `&&` instead of `and()`** (lines 492, 585).

The `&&` operator coerces Drizzle SQL expressions to booleans (`true`), making the WHERE clause equivalent to `WHERE true`. This matched ALL subscription usage records regardless of metric/period. The assertions still passed because each test only creates one record per subscription, but the test was vacuously testing the wrong condition.

**Fix applied in this heartbeat:** Imported `and` from drizzle-orm and replaced both `&&` chains with proper `and()` calls. This is a test correctness fix only — no production impact.

## Release Blockers

Per the CTO's 08:00 UTC status document, the release is gated on accepting the `request_confirmation` interaction on VOY-1673 (id: `dd8183b5-ce12-4659-bd1f-2ecce330250b`). The CTO could not accept it due to cross-issue write protection. This interaction needs acceptance before the Release Engineer's `wake_assignee_on_accept` continuation triggers the merge-to-custom → staging → production sequence.

## Overall Verdict

**Production code: APPROVED** ✅ — structurally sound, all race conditions addressed with proper DB-level mechanisms (FOR UPDATE, ON CONFLICT, transaction atomicity, idempotency keys, retry).

**Test suite: APPROVED with fix applied** ✅ — one test correctness bug found and fixed (two `&&` → `and()` in WHERE clauses).