# Support Case Assessment: Billing System — Subscriptions, Usage, and Invoicing

**Feature**: Stripe-integrated billing with subscription management, usage tracking, invoice syncing, and board-user-only mutation controls
**Assessed by**: Support Engineer
**Date**: 2026-08-18
**Related**: VOY-1364, VOY-1367, VOY-944, VOY-896, VOY-905, VOY-1669, VOY-1671, VOY-1687
**Release**: v0.4.0-alpha (hotfix VOY-1367) + VOY-1669 batch 2 fixes (pending release)

## Feature Overview (User Perspective)

The Billing System provides Stripe-integrated subscription management for Voyonder companies. Board users (human operators with board access) can manage subscription tiers, view usage, and sync invoices.

**What users can do:**

- **View available subscription tiers** — See a list of available plans with pricing and features
- **Manage subscriptions** — Create a new subscription (choosing tier and monthly/yearly billing), update the tier or billing period, cancel, and reactivate
- **Track usage** — View current billing-period usage metrics (seats, agent runs, storage)
- **Report usage** — Board users can report usage for metered billing (seats, agent_runs, storage_gb)
- **View and sync invoices** — See Stripe invoice history and trigger a sync from Stripe to update the local invoice records
- **View billing overview** — A consolidated view of current subscription, usage, and recent invoices

**Security boundary (VOY-1364 B1 fix):**
- **Read routes** (viewing tiers, subscription, usage, invoices, overview) are accessible to agents — no charges can be created from read-only access
- **Mutation routes** (creating/updating/canceling/reactivating subscriptions, reporting usage, syncing invoices) require a **board user** — agents are explicitly blocked with 403
- Stripe **webhooks** use signature verification instead of bearer auth

## What Changed

### New billing endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/companies/:companyId/billing/tiers` | Any company member | List subscription tiers |
| `GET` | `/api/companies/:companyId/billing/subscription` | Any company member | Get current subscription |
| `POST` | `/api/companies/:companyId/billing/subscription` | Board user only | Create subscription (tier + billing period) |
| `PATCH` | `/api/companies/:companyId/billing/subscription` | Board user only | Update tier/billing period |
| `POST` | `/api/companies/:companyId/billing/subscription/cancel` | Board user only | Cancel subscription |
| `POST` | `/api/companies/:companyId/billing/subscription/reactivate` | Board user only | Reactivate cancelled subscription |
| `GET` | `/api/companies/:companyId/billing/usage` | Any company member | View billing-period usage |
| `POST` | `/api/companies/:companyId/billing/usage` | Board user only | Report usage (seats, agent_runs, storage_gb) |
| `GET` | `/api/companies/:companyId/billing/invoices` | Any company member | List invoices |
| `POST` | `/api/companies/:companyId/billing/invoices/sync` | Board user only | Sync invoices from Stripe |
| `GET` | `/api/companies/:companyId/billing/overview` | Any company member | Consolidated billing overview |
| `POST` | `/api/companies/:companyId/billing/webhook` | Stripe signature | Stripe webhook receiver |

### Billing periods

Subscriptions support two billing periods:
- **`monthly`** — Calendar-month periods (1st to 1st)
- **`yearly`** — Calendar-year periods (Jan 1 to Jan 1)

### Usage metrics

| Metric | Description |
|--------|-------------|
| `seats` | Number of active user seats |
| `agent_runs` | Count of agent execution runs |
| `storage_gb` | Storage consumption in gigabytes |

### New schema tables

| Table | Purpose |
|-------|---------|
| `subscription_tiers` | Available plans (name, price, billing period, features) |
| `stripe_customers` | Company-to-Stripe-customer mapping |
| `company_subscriptions` | Active subscriptions per company |
| `subscription_invoices` | Invoice records synced from Stripe |
| `subscription_usage` | Metered usage records per billing period |

### Environment configuration

| Variable | Required? | Description |
|----------|-----------|-------------|
| `STRIPE_SECRET_KEY` | Required for billing operations | Stripe API secret key |
| `STRIPE_WEBHOOK_SECRET` | Required for webhook verification | Stripe webhook signing secret |

If `STRIPE_SECRET_KEY` is not set, billing operations return an error — all endpoints remain available but will fail. Webhook routes mount regardless.

## Potential User Confusion Points

1. **"I can't create/cancel a subscription — I keep getting a 403"** — Subscription mutations require a **board user** context (a human with board access). Agents cannot create or modify subscriptions. Ensure the API key or session belongs to a board user.

2. **"I created a subscription but nothing happened on Stripe"** — Check `STRIPE_SECRET_KEY` is set in the server environment. If it's missing, billing operations fail with a clear error. Also verify the selected `tierId` is a valid UUID from the tiers list.

3. **"My invoices are missing or out of date"** — Invoices are synced from Stripe. Use `POST /billing/invoices/sync` to trigger a manual sync. Invoices appear only after they are finalized in Stripe.

4. **"Usage data shows zero"** — Usage is tracked per billing period. Usage from previous periods does not carry over. Usage can be reported manually via `POST /billing/usage` (board user only).

5. **"What's the difference between cancel and the subscription just expiring?"** — Cancellation immediately marks the subscription as cancelled. Reactivation (`POST /billing/subscription/reactivate`) can restore a cancelled subscription.

6. **"I changed my plan but the price looks wrong"** — Verify the tier's `billingPeriod` matches expectations. Tiers may have different prices for monthly vs yearly billing. Use `GET /billing/tiers` to see current pricing.

7. **"Billing webhook errors in logs"** — Check that `STRIPE_WEBHOOK_SECRET` matches the endpoint secret configured in the Stripe dashboard. The webhook endpoint is mounted at `POST /api/companies/:companyId/billing/webhook`.

## Auto-Notifications

When budget thresholds are crossed (via the budgets service), the notification system automatically sends **budget_threshold** notifications to all active human members. This covers both soft (warning) and hard limit breaches, including the dollar amounts and scope details.

See the [Notification System Support Case Assessment](support-case-notification-system.md) for notification behavior details.

## Known Limitations & Risk Register

### Batch 1 (v0.4.0 / VOY-1367)

1. **P1: Webhook idempotency** — ✅ **FIXED** (committed `1fb17b8f18`). Migration 0228 adds `stripe_webhook_events` dedup table with `UNIQUE(stripe_event_id)`. Webhook handler inserts event ID before processing; 23505 duplicate violation → silently skip. UNIQUE indexes on `stripe_invoice_id` and `stripe_customers.company_id` also applied.

2. **P1: Race in handleSubscriptionUpdated / handleCheckoutSessionCompleted** — ✅ **FIXED** (committed `1fb17b8f18`). Uses `INSERT ... ON CONFLICT (stripe_subscription_id) DO UPDATE SET` — concurrent Stripe events are idempotent.

3. ✅ **P1-2: TOCTOU in createOrUpdateSubscription** — **FIXED** (committed `b840497fab`, VOY-1669). The SELECT-then-INSERT race window in `createOrUpdateSubscription` is eliminated. The INSERT now uses `ON CONFLICT (company_id) DO NOTHING`; if the race is lost, the orphan Stripe subscription is cancelled and the winner's record is returned. The UPDATE path now uses `companyId` for the WHERE clause instead of a potentially stale `existingSub.id`. Both Stripe create and update paths are wrapped in `withStripeRetry` for resilience against transient Stripe API failures.

4. ✅ **P2: reportUsage read-then-write race** — **FIXED** (committed `b840497fab`, VOY-1669). The `reportUsage` endpoint no longer does a separate SELECT-then-INSERT/UPDATE. It uses `INSERT ... ON CONFLICT DO UPDATE` (upsert) on the unique constraint `(subscription_id, metric, period_start, period_end)`, making concurrent usage reports safe. The `stripe.subscriptionItems.createUsageRecord()` call is now wrapped in `withStripeRetry`.

5. ✅ **P2: No real-time subscription status propagation** — **RESOLVED** (committed `b8732268f2`). All 8 subscription state transitions now emit `subscription.status.updated` live events via `publishLiveEvent`. The UI handler in `LiveUpdatesProvider` invalidates subscription and overview caches on receipt, so the UI updates immediately without manual refresh.

6. **P2: Zero test coverage** on webhook handlers, checkout flow, cancel/reactivate, invoice sync. 🟡 **Partially addressed** by concurrent billing concurrency test suite (commit `e5a8217f8e`, 7 tests covering FOR UPDATE serialisation, ON CONFLICT upsert, ON CONFLICT DO NOTHING, 5-concurrent usage upserts, unique constraint safety net). Webhook/checkout/invoice-sync handlers still lack dedicated tests.

### Batch 2 (VOY-1669 / VOY-1673 — pending release)

7. **P2-1: Transaction wrapping for webhook handlers** — ✅ **FIXED** (committed `151f0a2066`, VOY-1669). `handleInvoicePaymentFailed` and `handleSubscriptionDeleted` are now wrapped in `db.transaction()`. The UPDATE + live-event publish are now atomic. This matches the pattern already used by `handleInvoicePaid` and `handleSubscriptionUpdated`.

8. ✅ **VOY-1687: Idempotency key on stripe.subscriptions.create()** — **FIXED** (committed `cd74f15ca8`). The `stripe.subscriptions.create()` call in `createOrUpdateSubscription` now passes an idempotency key (`createOrUpdateSubscription:create:{companyId}:{tierId}`). This prevents orphan subscriptions when the Stripe API call succeeds but the HTTP response is lost and `withStripeRetry` retries.

9. **No subscription tier seed data** in committed code — tiers must be seeded manually or via a bootstrap script.

10. **Feature-flagged** — All billing routes are gated behind `PAPERCLIP_BILLING_ENABLED=true` (disabled by default).

## Support Escalation Path

| Issue | Severity | Action |
|---|---|---|
| Subscription create/update fails with Stripe API error | Critical | Check Stripe dashboard for account status; verify `STRIPE_SECRET_KEY` is valid and has correct permissions |
| Billing webhook not processing events | High | Verify webhook signing secret; check Stripe dashboard for failed webhook deliveries |
| Invoice sync fails or returns empty | High | Check Stripe dashboard for invoice existence; verify the Stripe customer is correctly linked |
| Agent receives 403 on billing mutations | Low | Expected behavior — agents cannot mutate billing. Educate user that a board user must perform billing actions |
| "Missing raw body for webhook verification" | High | Webhook endpoint expects `rawBody` to be available on the request object. Ensure the Express raw body parser is configured before the webhook route |
| Usage reporting discrepancy | Medium | Verify the billing period alignment and metric name. Usage is reset at the start of each billing period |

## Related Documentation

- [Notification System Support Case Assessment](support-case-notification-system.md)
- [Stripe Billing Robustness Fixes Support Case Assessment](support-case-stripe-billing-fixes.md)
- [Stripe Tier Sync Hardening Support Case Assessment](support-case-stripe-tier-sync.md)
- [v0.4.0-alpha Release Notes](../releases/v0.4.0-alpha-deep-planning.md)
- [VOY-1669 TOCTOU Billing Fix Release Notes](../releases/voy-1669-toctou-billing-fix.md)