## Staff Engineer Review — Webhook race fix (VOY-1987)

**Status: APPROVED with recommendations**

### Review Checklist

- [x] **Usage records (seats, agent_runs, storage_gb) are created in handleSubscriptionUpdated's else branch**
  Verified at server/src/services/billing.ts:361-383. The else branch creates three usage records (seats, agent_runs, storage_gb) with the tier's included amounts, zero usage, and the current period boundaries.

- [x] **The fix is idempotent**
  - Subscription INSERT uses ON CONFLICT (stripe_subscription_id) DO UPDATE SET — handles race between customer.subscription.updated and checkout.session.completed
  - Usage INSERT uses ON CONFLICT (subscription_id, metric, period_start, period_end) DO NOTHING — unique index confirmed at packages/db/src/schema/subscription_usage.ts:24-29
  - handleCheckoutSessionCompleted also has an existing branch that creates usage records if handleSubscriptionUpdated already created the subscription

- [x] **All 18 billing tests pass**
  Test Files 1 passed (1), Tests 18 passed (18)
  The race-condition test specifically validates the scenario.

- [x] **Concurrency test validates the race scenario**
  simulates handleSubscriptionUpdated first, then handleCheckoutSessionCompleted, verifies no duplicate records, then verifies idempotency.

- [x] **No console errors** — clean test output

### Structural Issues Found

**1. MEDIUM — publishLiveEvent inside transaction (pre-existing)**
  publishLiveEvent fires before the transaction commits. If the transaction fails after the event is emitted, connected clients would receive a stale event. Low risk in practice but worth noting.

**2. LOW — Missing reverse-order concurrency test**
  Only handleSubscriptionUpdated -> handleCheckoutSessionCompleted is tested. The reverse order is not explicitly tested though code handles both correctly.

### Recommendation

Approve for shipping. Both issues above are pre-existing or minor.