---
title: "Staff Engineer Structural Review — VOY-1645 TOCTOU Race Fix"
date: 2026-08-22
branch: fix/migration-journal-test
commit: be72a309ce
status: APPROVED
---

# Structural Review: VOY-1645 TOCTOU Race Fix

**Branch:** `fix/migration-journal-test`
**Commit:** `be72a309ce`
**Files:** `server/src/services/billing.ts` (+63/-24)

## What it does

Extracts usage metric seeding into a shared `seedSubscriptionUsageRows` helper and calls it from both `handleSubscriptionUpdated` (fallback/create path) and `handleCheckoutSessionCompleted`. This ensures that regardless of which webhook handler wins the TOCTOU race, usage metrics are always seeded.

## Structural Analysis

### Finding #1 — ✅ Subquery pattern is safe
The helper uses `(SELECT id FROM company_subscriptions WHERE stripe_subscription_id = $x)` inside the VALUES clause. This resolves inside the same transaction that performs the upsert. In READ COMMITTED isolation, the subquery always finds the row — either from this transaction's INSERT/ON CONFLICT or from the other handler's committed transaction. The upsert acts as a synchronization point.

### Finding #2 — ✅ Idempotent via ON CONFLICT DO NOTHING
Duplicate calls from either handler or from Stripe's at-least-once delivery are no-ops. No data corruption possible.

### Finding #3 — ✅ DRY extraction preserves existing behavior
The `handleCheckoutSessionCompleted` path is a pure refactor — the same INSERT logic moved to a helper. No behavior change.

### Finding #4 — ✅ Update path skips seeding correctly
When `handleSubscriptionUpdated` runs and the subscription already exists (the `if (existing)` path), it skips seeding. This is correct because usage was seeded when the subscription was first created.

### Finding #5 — ⚠️ Early return on missing tierId doesn't seed usage
If `handleSubscriptionUpdated`'s create path can't find a `paperclipTierId` in metadata, it returns early without seeding usage. This is existing behavior (not new), and it's a data configuration issue, not a race condition concern. If this path is reached and `handleCheckoutSessionCompleted` also doesn't fire, usage metrics would be missing. Not a regression.

### Finding #6 — ⚠️ No concurrency test for the inter-handler race
The existing `billing-concurrency.test.ts` covers `createOrUpdateSubscription` and `reportUsage` races but not the `handleSubscriptionUpdated` ↔ `handleCheckoutSessionCompleted` race. The QA verification (VOY-1652) describes manual test scenarios. Consider adding a concurrency test that simulates near-simultaneous webhook delivery.

### Finding #7 — ℹ️ N+3 insert pattern (not a concern)
`seedSubscriptionUsageRows` issues 3 separate INSERT statements (one per metric) instead of a batched insert. With exactly 3 metrics this is acceptable.

## Disposition

**APPROVED** — No structural defects found. The fix is correct and safe.

The key invariant is: after either handler runs (or both), usage metrics exist for the subscription. The shared helper with ON CONFLICT DO NOTHING guarantees this regardless of execution order. All existing behavior paths are preserved.

## Recommendation for QA (VOY-1652)

Focus verification on:
1. `customer.subscription.created` fires before `checkout.session.completed` → usage rows exist
2. `checkout.session.completed` fires before `customer.subscription.created` → usage rows exist
3. Both fire simultaneously → no duplicate usage rows
4. Re-subscribe (cancel → re-subscribe) → no unique constraint violation on `company_id`
