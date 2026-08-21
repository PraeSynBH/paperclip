# Support Case Assessment: Billing System — Subscriptions, Usage, and Invoicing

> ⚠️ **Feature-flagged:** Billing is gated behind `PAPERCLIP_BILLING_ENABLED=true`. Without this flag, billing routes are not registered. See [Billing Setup](/guides/board-operator/billing-setup) for configuration.
>
> **Upstream-compatible restoration** (VOY-1611, commit `1fb17b8f18`): The billing implementation has been restored with upstream-compatible code. API contracts are unchanged from the previous fork-specific implementation. This assessment has been updated to reflect the restored code.

**Feature**: Stripe-integrated billing with subscription management, usage tracking, invoice syncing, and board-user-only mutation controls
**Assessed by**: Support Engineer
**Date**: 2026-08-18
**Related**: VOY-1364, VOY-1367, VOY-944, VOY-896, VOY-905
**Release**: v0.4.0-alpha (hotfix VOY-1367)

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
| `POST` | `/api/companies/:companyId/billing/subscription` | Board user only | Create subscription (tier + billing period — direct admin use) |
| `POST` | `/api/companies/:companyId/billing/create-checkout-session` | Board user only | Create Stripe Checkout Session for card collection before subscription |
| `PATCH` | `/api/companies/:companyId/billing/subscription` | Board user only | Update tier/billing period |
| `POST` | `/api/companies/:companyId/billing/subscription/cancel` | Board user only | Cancel subscription |
| `POST` | `/api/companies/:companyId/billing/subscription/reactivate` | Board user only | Reactivate cancelled subscription |
| `GET` | `/api/companies/:companyId/billing/usage` | Any company member | View billing-period usage |
| `POST` | `/api/companies/:companyId/billing/usage` | Board user only | Report usage (seats, agent_runs, storage_gb) |
| `GET` | `/api/companies/:companyId/billing/invoices` | Any company member | List invoices |
| `POST` | `/api/companies/:companyId/billing/invoices/sync` | Board user only | Sync invoices from Stripe |
| `GET` | `/api/companies/:companyId/billing/overview` | Any company member | Consolidated billing overview |
| `POST` | `/api/billing/webhook` | Stripe signature | Stripe webhook receiver |

### Checkout Session flow (new)

`POST /api/companies/:companyId/billing/create-checkout-session` creates a Stripe Checkout Session (`mode: subscription`) so the customer provides card details **before** the subscription is created. This is the recommended flow for new customers — it avoids `incomplete` subscriptions that result from `stripe.subscriptions.create()` without a payment method.

The response returns `{ "url": "...", "sessionId": "..." }`; the client redirects the user to `url`. Stripe handles card collection, then fires `checkout.session.completed`, which creates the subscription in the database. If the user cancels checkout, they are returned to `cancelUrl` (defaults to `{PAPERCLIP_PUBLIC_URL}/pricing`) and no subscription is created.

Supported request fields: `tierId` (required), `billingPeriod` (optional, defaults to `monthly`), `successUrl` and `cancelUrl` (optional URLs).

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

7. **"Billing webhook errors in logs"** — Check that `STRIPE_WEBHOOK_SECRET` matches the endpoint secret configured in the Stripe dashboard. The webhook endpoint is mounted at `POST /api/billing/webhook`.

8. **"I completed Stripe checkout but no subscription was created"** — The `checkout.session.completed` webhook creates the subscription. Verify the webhook endpoint (`POST /api/billing/webhook`) is configured in the Stripe dashboard and `STRIPE_WEBHOOK_SECRET` is correct. If the user cancelled checkout, no subscription is created — that's expected.

9. **"Checkout Session URL doesn't return to where I expected"** — `successUrl` and `cancelUrl` default to `{PAPERCLIP_PUBLIC_URL}/boards/{companyId}` and `{PAPERCLIP_PUBLIC_URL}/pricing` respectively. Custom URLs must be valid absolute URLs.

## Auto-Notifications

When budget thresholds are crossed (via the budgets service), the notification system automatically sends **budget_threshold** notifications to all active human members. This covers both soft (warning) and hard limit breaches, including the dollar amounts and scope details.

See the [Notification System Support Case Assessment](support-case-notification-system.md) for notification behavior details.

## Feature Gating — PAYWALL Errors (New)

The billing restoration (VOY-1611, commit `1fb17b8f18`) adds a **feature gating** system. Certain routes now check whether the company's subscription tier includes the required feature before allowing the operation. If the feature is not included, the endpoint returns `403` with `code: "PAYWALL"`.

### Gated Features

| Feature Key | Routes Gated | Trigger |
|---|---|---|
| `api_access` | `POST /api/companies/:id/access/keys` — board-level API key creation | Any API key creation attempt |
| `advanced_agents` | `POST /api/companies/:id/agents` — agent creation | Agent creation via API or UI |
| `unlimited_seats` | `POST /api/companies/:id/invites` — member invites | Inviting when seat count exceeds tier's `includedSeats` |
| `custom_plugins` | Marketplace plugin installation | Plugin installation attempt |

### Support Scenarios

| Scenario | What the user sees | Root Cause | Resolution |
|---|---|---|---|
| "I get a PAYWALL error when creating an API key" | `403 { code: "PAYWALL", message: "Your current plan does not include API access" }` | The company's subscription tier does not include the `api_access` feature | Upgrade to a tier that includes API access |
| "I can't invite new team members" | `403 { code: "PAYWALL", message: "Your current plan is limited to N active members" }` | Company has reached its included seat count; `unlimited_seats` feature not in tier | Upgrade to a tier with more seats or unlimited_seats |
| "I can't create an agent" | `403 { code: "PAYWALL" }` | The company's subscription tier does not include `advanced_agents` | Upgrade to a tier that includes advanced agents |
| "I can't install a plugin from the marketplace" | `403 { code: "PAYWALL" }` | The company's subscription tier does not include `custom_plugins` | Upgrade to a tier with plugin support |

### Frontend Behavior

The pricing page (`/pricing`) detects `code: "PAYWALL"` in error responses and can display upgrade prompts. The `paywall()` error function in `server/src/errors.ts` optionally accepts `featureKey`, `tierName`, and `requiredPlan` in the details object for richer upgrade messaging.

### Detection

Support can verify feature gate status by checking the company's subscription tier:

```sql
SELECT ct.name, ct.features, cs.status
FROM company_subscriptions cs
JOIN subscription_tiers ct ON ct.id = cs.tier_id
WHERE cs.company_id = '<company-id>';
```

The `features` column is a JSONB array of feature keys. If the required feature key is missing, the gate fires.

## Known Limitations (Restored Code)

1. **P1: Webhook idempotency** — ✅ **FIXED** (committed `1fb17b8f18`). Migration 0228 adds `stripe_webhook_events` dedup table with `UNIQUE(stripe_event_id)`. Webhook handler inserts event ID before processing; 23505 duplicate violation → silently skip. UNIQUE indexes on `stripe_invoice_id` and `stripe_customers.company_id` also applied.
2. **P1: Race in handleSubscriptionUpdated / handleCheckoutSessionCompleted** — ✅ **FIXED** (committed `1fb17b8f18`). Uses `INSERT ... ON CONFLICT (stripe_subscription_id) DO UPDATE SET` — concurrent Stripe events are idempotent.
3. **P2: Zero test coverage** on webhook handlers, checkout flow, cancel/reactivate, invoice sync.
4. **P2: No real-time subscription status propagation** (SSE/websocket). ⚠️ **IMPLEMENTED in working tree** (uncommitted) — `publishLiveEvent` calls wired to all 8 subscription state transitions; UI handler invalidates subscription caches. Will be resolved when the working tree is committed.
5. **No subscription tier seed data** in committed code — tiers must be seeded manually or via a bootstrap script.
6. **Feature-flagged** — All billing routes are gated behind `PAPERCLIP_BILLING_ENABLED=true` (disabled by default).

## Support Escalation Path

| Issue | Severity | Action |
|---|---|---|
| Subscription create fails with Stripe API error | Critical | Check Stripe dashboard for account status; verify `STRIPE_SECRET_KEY` is valid and has correct permissions |
| Checkout session creation fails | Critical | Verify `STRIPE_SECRET_KEY` is set and has `checkout.session.create` permission. Check that the requested `tierId` exists |
| `checkout.session.completed` webhook not processed | High | Check webhook signing secret; verify Stripe dashboard webhook endpoint URL is `POST /api/billing/webhook`; check raw body availability on the request |
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