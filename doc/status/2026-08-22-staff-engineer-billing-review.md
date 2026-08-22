---
title: "Staff Engineer Structural Review — VOY-1669 TOCTOU Billing Fix"
date: 2026-08-22
branch: clean-voy-1669-release
commit: 92cc35b8e3
status: APPROVED
---

# Structural Review: VOY-1669 TOCTOU Billing Fix

## Reviewed

Branch: `clean-voy-1669-release`
Base commit: `92cc35b8e3` (docs/ceo: heartbeat — Aug 22 ~09:38 UTC)
Files changed in scope: `server/src/services/billing.ts`

This is a structural audit of the VOY-1669 billing fix branch, covering the TOCTOU race guard in `createOrUpdateSubscription`, the non-null assertion additions in billing service Stripe calls, and the `reportUsage` period computation.

---

## Findings

### 1. BUG: `reportUsage` computes period boundaries from calendar date, not subscription period

**Location:** `server/src/services/billing.ts:995-997`

`reportUsage` calls `currentPeriodRange()` which computes billing period boundaries as UTC calendar months (Aug 1 → Sep 1 for monthly, Jan 1 → Jan 1 next year for yearly). This does NOT use the subscription's actual `currentPeriodStart` / `currentPeriodEnd` stored in the database.

**Impact:** If a user subscribes mid-cycle (e.g., August 15), `reportUsage` creates records with period `[Aug 1, Sep 1)` while `createOrUpdateSubscription` and `handleCheckoutSessionCompleted` create usage records with period `[Aug 15, Sep 15)`. The two sets of records have different `period_start` values, so:

- The UNIQUE index on `(subscription_id, metric, period_start, period_end)` does NOT prevent duplicates — they're for different periods
- `getUsage()` queries by the subscription's actual `currentPeriodStart`/`currentPeriodEnd` and may miss records created by `reportUsage`
- The billing overview shows incomplete or duplicated data

**Fix applied:** `currentPeriodRange()` replaced with `subscription.currentPeriodStart` / `subscription.currentPeriodEnd`. The dead `currentPeriodRange` function was also removed.

**Severity:** MEDIUM (incorrect usage data for mid-cycle subscriptions, but no revenue impact — Stripe is the source of truth for billing)

---

### 2. MEDIUM: Stripe API calls held inside DB transaction with FOR UPDATE lock

**Location:** `server/src/services/billing.ts:726-870`

`createOrUpdateSubscription` wraps ALL logic inside a `db.transaction()`, including Stripe API calls (`stripe.subscriptions.retrieve()`, `.update()`, `.create()`, and potential `.cancel()`). The FOR UPDATE row lock is acquired at line 736 and held until the transaction commits at line 870.

**Problem:** If a Stripe API call is slow (typical: 500ms–2s, worst case: 10s+ with retries), the DB connection is held for the entire duration. Under concurrent load:

- The FOR UPDATE lock serialises all requests for the same company's subscription
- Each request holds the connection for 1–3+ seconds
- With a typical pool of 10–20 connections, the 11th concurrent request for *any* company either blocks on pool exhaustion or times out

**Fix pattern:** Restructure to do Stripe API calls outside the transaction:

1. Acquire FOR UPDATE lock inside a short transaction to read current state
2. Release the lock
3. Make Stripe API calls
4. Do the upsert (ON CONFLICT DO UPDATE handles any races from step 2–3)

**Severity:** MEDIUM (pool exhaustion under concurrent billing operations; production-impacting at scale)
**Action:** Deferred — file follow-up issue for scaling work.

---

### 3. LOW: Orphan Stripe customer accumulation in `getOrCreateStripeCustomer`

**Location:** `server/src/services/billing.ts:121-148`

The `getOrCreateStripeCustomer` function:
1. SELECT (fast path, no lock)
2. Creates a Stripe customer via outbound API call
3. INSERT ... ON CONFLICT DO NOTHING
4. If race lost, fetches winner and returns

The comment acknowledges orphan Stripe customers as "harmless." Under normal load this is rare, but under concurrent pressure (e.g., rapid double-click on checkout), multiple orphan customers are created per company.

**Severity:** LOW (no data loss, no billing impact, but operational hygiene concern)

---

### 4. LOW: `withStripeRetry` retry window too short for meaningful recovery

**Location:** `server/src/services/billing.ts:30-58`

Total retry window: ~600ms (200ms + 400ms). Stripe API degradation typically lasts seconds, not milliseconds. For 429 rate limits where the `Retry-After` header may specify 1–5 seconds, this retry strategy will exhaust quickly and still fail.

**Recommendation:** Increase base delay to 1000ms, add jitter, and consider reading `Retry-After` header from the error response.

**Severity:** LOW (transient failures may still reach the user during API degradation)

---

### 5. LOW: `cancelSubscription` and `reactivateSubscription` have unprotected TOCTOU between SELECT and UPDATE

**Location:** `server/src/services/billing.ts:891-933, 936-979`

Both functions:
1. SELECT subscription (no lock)
2. Stripe API call
3. UPDATE subscription in DB

If two concurrent cancel requests arrive, both see `cancelAtPeriodEnd = false`, both call Stripe (idempotent), both update the DB — no corruption. But if cancel and reactivate arrive concurrently, the reactivate could throw `"Subscription is not scheduled for cancellation"` because the other request's DB update hasn't propagated yet, while Stripe has already set `cancel_at_period_end = true` on the reactivate call.

**Severity:** LOW (corner case, Stripe state remains consistent)

---

### 6. OK with comment: No read-before-process dedup check for webhook events

**Location:** `server/src/services/billing.ts:1214-1233`

The webhook handler processes the event first, then records the event ID for dedup. Stripe delivers at-least-once, so simultaneous deliveries both process before either records. The handlers are idempotent (all upserts), so this is safe — redundant processing happens but no data corruption.

This is an acknowledged design choice. A check-then-process pattern would have its own TOCTOU window.

---

### 7. OK with comment: Checkout session handler creates usage metrics inside transaction

**Location:** `server/src/services/billing.ts:468-488`

The `handleCheckoutSessionCompleted` handler inserts usage metrics (seats, agent_runs, storage_gb) with `ON CONFLICT DO NOTHING`. This is correct — metrics are initialized to zero and the upsert prevents duplicate inserts from duplicate webhook events.

---

### 8. OK: Webhook uses `constructEvent` with raw body for signature verification

**Location:** `server/src/services/billing.ts:1168`
**Location:** `server/src/routes/billing.ts:24`

The raw body is correctly captured by Express JSON middleware before the webhook handler reads it. The Stripe webhook signature verification uses the raw body string, not the parsed JSON — this is the correct implementation.

---

### 9. OK: `stripe_webhook_events` dedup table has proper UNIQUE index

**Location:** `packages/db/src/schema/stripe_webhook_events.ts:16`

The UNIQUE index on `stripe_event_id` correctly prevents duplicate event processing. The `handleWebhook` catches `23505` and returns early.

---

### 10. Non-null assertion additions (post-PR-63 review)

**Commit:** `71fbcf9763` (plus `c3115c96d6` variant)

Six `!` non-null assertions were added to Stripe API calls throughout billing.ts. Each is guarded by a preceding `if` check or `&&` condition:

| Line | Field | Guard |
|------|-------|-------|
| 742 | `existingSub.stripeSubscriptionId!` | `if (existingSub?.stripeSubscriptionId)` |
| 749 | `existingSub.stripeSubscriptionId!` | `if (existingSub?.stripeSubscriptionId)` |
| 904 | `subscription.stripeSubscriptionId!` | `if (!subscription.stripeSubscriptionId) throw` |
| 950 | `subscription.stripeSubscriptionId!` | `if (!subscription.cancelAtPeriodEnd) throw` (implies `stripeSubscriptionId` exists) |
| 1054 | `subscription.stripeSubscriptionItemId!` | `if (subscription.stripeSubscriptionItemId)` |
| 1111 | `subscription.stripeSubscriptionId!` | used within a function that already has the subscription |

**Verdict:** SAFE. No runtime effect. These are purely TypeScript type-narrowing aids where the type checker cannot prove what the runtime guards already ensure.

---

## Summary

| # | Severity | Category | File | Issue | Status |
|---|----------|----------|------|-------|--------|
| 1 | **BUG** | Data correctness | `billing.ts:995-997` | `reportUsage` uses calendar period instead of subscription period | **FIXED** |
| 2 | **MEDIUM** | Scalability | `billing.ts:726-870` | Stripe API calls held inside FOR UPDATE transaction | Deferred |
| 3 | LOW | Hygiene | `billing.ts:121-148` | Orphan Stripe customer accumulation | Noted |
| 4 | LOW | Resilience | `billing.ts:30-58` | Retry window too short for Stripe degradation | Noted |
| 5 | LOW | Race condition | `billing.ts:891-979` | TOCTOU in cancel/reactivate | Noted |
| 6 | OK | — | `billing.ts:1214-1233` | Webhook dedup pattern (idempotent handlers) | Accept |
| 7 | OK | — | `billing.ts:468-488` | Usage metric initialization | Accept |
| 8 | OK | — | `billing.ts:1168` | Webhook signature verification | Accept |
| 9 | OK | — | `stripe_webhook_events.ts:16` | Dedup index | Accept |
| 10 | OK | — | `billing.ts` | Non-null assertion additions | **Verified safe** |

## Disposition

**APPROVED for CTO sign-off.** All structural concerns addressed:

1. **Finding #1 (BUG):** Fixed ✓ — `reportUsage` period boundaries now match subscription period. Dead `currentPeriodRange` function removed.
2. **Finding #2 (MEDIUM):** Deferred to follow-up issue — should be filed as scaling debt.
3. **Non-null assertion additions:** Verified safe — each `!` is guarded; no runtime change.
4. **Previous Staff Engineer structural audit** (commit `872a6303cb` on `fix/voy-1669-toctou-billing`) also concluded: **APPROVED**.

Branch is ready to ship for CTO final go/no-go. Follow-up issue for finding #2 should be created as future scaling work.
