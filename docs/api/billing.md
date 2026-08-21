---
title: Billing
summary: Stripe-integrated subscription management — tiers, usage, invoices, and webhooks
version: v0.4.0
last_updated: 2026-08-18
---

The Billing API provides Stripe-integrated subscription management. Board users can list tiers, create/update/cancel subscriptions, report usage, sync invoices, and view a consolidated billing overview.

## Access Model

| Access Level | What they can do |
|---|---|
| **All company members** | Read endpoints: tiers, subscription, usage, invoices, overview |
| **Board users only** | All mutations: create/update/cancel/reactivate subscription, create checkout session, report usage, sync invoices |
| **Agents** | Read-only — all billing mutations return `403` for agents |

Every endpoint requires company access (`assertCompanyAccess`). Mutation endpoints additionally require a board-user context — agents are explicitly blocked with `403 Forbidden`.

## Configuration

Requires `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` environment variables. Without them, billing operations return errors.

## Endpoints

| Method | Path | Description | Access |
|---|---|---|---|
| `GET` | `/api/companies/{companyId}/billing/tiers` | List available subscription tiers | All members |
| `GET` | `/api/companies/{companyId}/billing/subscription` | View current subscription | All members |
| `POST` | `/api/companies/{companyId}/billing/subscription` | Create a new subscription (direct — admin use) | Board user only |
| `PATCH` | `/api/companies/{companyId}/billing/subscription` | Update tier or billing period | Board user only |
| `POST` | `/api/companies/{companyId}/billing/create-checkout-session` | Create Stripe Checkout Session for card collection | Board user only |
| `POST` | `/api/companies/{companyId}/billing/subscription/cancel` | Cancel subscription (at period end) | Board user only |
| `POST` | `/api/companies/{companyId}/billing/subscription/reactivate` | Reactivate a subscription scheduled for cancellation | Board user only |
| `GET` | `/api/companies/{companyId}/billing/usage` | View billing-period usage | All members |
| `POST` | `/api/companies/{companyId}/billing/usage` | Report usage (seats, runs, storage) | Board user only |
| `GET` | `/api/companies/{companyId}/billing/invoices` | List invoices | All members |
| `POST` | `/api/companies/{companyId}/billing/invoices/sync` | Sync invoices from Stripe | Board user only |
| `GET` | `/api/companies/{companyId}/billing/overview` | Consolidated billing overview (subscription + usage + invoices) | All members |
| `POST` | `/api/billing/webhook` | Stripe webhook receiver | Stripe signature verification only |

## Create or Update Subscription

```
POST /api/companies/{companyId}/billing/subscription
```

### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `tierId` | `string` (uuid) | yes | The tier to subscribe to |
| `billingPeriod` | `string` | no | `monthly` (default) or `yearly` |

### Response

`201 Created` with the subscription object.

## Create Checkout Session

```text
POST /api/companies/{companyId}/billing/create-checkout-session
```

Creates a Stripe Checkout Session (`mode: subscription`) so the customer can provide card details before the subscription is created. This is the recommended flow for new customers — it avoids `incomplete` subscriptions created by `stripe.subscriptions.create()` without a payment method.

### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `tierId` | `string` (uuid) | yes | The tier to subscribe to |
| `billingPeriod` | `string` | no | `monthly` (default) or `yearly` |
| `successUrl` | `string` (url) | no | Redirect after successful checkout. Defaults to `{PAPERCLIP_PUBLIC_URL}/boards/{companyId}` |
| `cancelUrl` | `string` (url) | no | Redirect when checkout is cancelled. Defaults to `{PAPERCLIP_PUBLIC_URL}/pricing` |

### Response

`200 OK` with the Checkout Session URL:

```json
{
  "url": "https://checkout.stripe.com/c/pay/cs_test_...",
  "sessionId": "cs_test_..."
}
```

The client should redirect the user to `url`. Stripe handles card collection, then fires the `checkout.session.completed` webhook, which creates the subscription in the database. If the user cancels checkout, they are returned to `cancelUrl` and no subscription is created.

## Update Subscription

```
PATCH /api/companies/{companyId}/billing/subscription
```

Same body as create — `tierId` (required) and `billingPeriod` (optional, defaults to `monthly`).

## Report Usage

```
POST /api/companies/{companyId}/billing/usage
```

### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `metric` | `string` | yes | One of `seats`, `agent_runs`, `storage_gb` |
| `quantity` | `integer` | yes | Non-negative quantity |

### Response

`201 Created` with the usage record. Usage resets at the start of each billing period (monthly = calendar month, yearly = calendar year).

## Stripe Webhook

```
POST /api/billing/webhook
```

This route runs **before** authentication middleware and relies on Stripe signature verification instead of bearer/auth. Requires the `stripe-signature` header and the raw request body. `STRIPE_WEBHOOK_SECRET` must match the Stripe dashboard webhook secret.

## Error Notes

- `403 Forbidden` on any mutation when the actor is not a board user (agents are always blocked).
- Billing operations fail if Stripe configuration is missing.
- See the [Billing Support Case Assessment](/support/assessments/support-case-billing-system) for troubleshooting.
