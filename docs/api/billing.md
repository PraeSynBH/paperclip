# Billing API

**Version:** Current (feat/clean-m5-pricing-pr — Code Separation Phase 2)
**Updated:** 2026-08-23
**Commit:** b878783795

The Billing API manages subscription tiers, Stripe checkout, usage tracking, invoices, and pricing experiments. All billing endpoints (except the Stripe webhook) require authentication and company membership.

---

## Endpoints

### GET /api/companies/:companyId/billing/tiers

Returns available subscription tiers for a company. When the A/B pricing experiment (VOY-1685) is enabled, the response reflects the company's assigned experiment variant — variant B may show adjusted prices via tier overrides.

**Auth:** Company members

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "Starter",
    "description": "For small teams",
    "priceMonthlyCents": 2900,
    "priceYearlyCents": 29000,
    "stripePriceMonthlyId": "price_xxx",
    "stripePriceYearlyId": "price_yyy",
    "stripeProductId": "prod_xxx",
    "includedSeats": 5,
    "extraSeatPriceCents": 500,
    "includedAgentRuns": 1000,
    "extraAgentRunPriceCents": 10,
    "includedStorageGb": 10,
    "extraStorageGbPriceCents": 100,
    "features": ["unlimited_agents", "priority_support"],
    "isActive": true,
    "sortOrder": 1,
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:00:00Z"
  }
]
```

### GET /api/companies/:companyId/billing/subscription

Returns the company's current subscription, including tier details and usage consumption.

**Auth:** Company members

**Response:**
```json
{
  "id": "uuid",
  "companyId": "uuid",
  "tierId": "uuid",
  "stripeCustomerId": "cus_xxx",
  "status": "active",
  "billingPeriod": "monthly",
  "currentPeriodStart": "2026-08-01T00:00:00Z",
  "currentPeriodEnd": "2026-09-01T00:00:00Z",
  "stripeSubscriptionId": "sub_xxx",
  "stripeSubscriptionItemId": "si_xxx",
  "cancelAtPeriodEnd": false,
  "canceledAt": null,
  "trialEnd": null,
  "metadataJson": null,
  "createdAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-08-01T00:00:00Z",
  "tier": { /* SubscriptionTier object */ },
  "usage": [
    {
      "id": "uuid",
      "companyId": "uuid",
      "subscriptionId": "uuid",
      "metric": "seats",
      "usage": 3,
      "included": 5,
      "overage": 0,
      "overageCents": 0,
      "periodStart": "2026-08-01T00:00:00Z",
      "periodEnd": "2026-09-01T00:00:00Z",
      "stripeUsageRecordId": null,
      "createdAt": "2026-08-01T00:00:00Z",
      "updatedAt": "2026-08-01T00:00:00Z"
    }
  ]
}
```

Returns `null` if the company has no subscription.

**Status values:** `active`, `trialing`, `incomplete`, `past_due`, `canceled`, `unpaid`

**Usage metrics:** `seats`, `agent_runs`, `storage_gb`

### POST /api/companies/:companyId/billing/subscription

Create or update a subscription directly (admin use — does not collect card details).

**Auth:** Board only

**Body:**
```json
{
  "tierId": "uuid",
  "billingPeriod": "monthly" | "yearly"
}
```

**Response:** Full subscription object (as above)

### POST /api/companies/:companyId/billing/create-checkout-session

Creates a Stripe Checkout Session to collect payment details before subscribing. On success, redirects the user to the Stripe hosted checkout page.

**Auth:** Board only

**Body:**
```json
{
  "tierId": "uuid",
  "billingPeriod": "monthly" | "yearly",
  "successUrl": "https://example.com/pricing?success=true",
  "cancelUrl": "https://example.com/pricing"
}
```

**Response:**
```json
{
  "url": "https://checkout.stripe.com/pay/...",
  "sessionId": "cs_xxx"
}
```

The checkout session includes `pricingExperimentVariant` in Stripe metadata when the company has an assigned experiment variant.

### POST /api/companies/:companyId/billing/portal-link

Creates a Stripe billing portal session for the company. The billing portal lets the customer manage their subscription, view invoices, update payment methods, etc.

**Auth:** Board only

**Body:**
```json
{
  "returnUrl": "https://example.com/boards/{companyId}"
}
```
`returnUrl` is optional — defaults to the company board.

**Response:**
```json
{
  "url": "https://billing.stripe.com/p/session/..."
}
```

### PATCH /api/companies/:companyId/billing/subscription

Update subscription tier or billing period.

**Auth:** Board only

**Body:**
```json
{
  "tierId": "uuid",
  "billingPeriod": "monthly" | "yearly"
}
```

### POST /api/companies/:companyId/billing/subscription/cancel

Cancel the subscription at the end of the current billing period.

**Auth:** Board only

**Response:** Updated subscription object with `cancelAtPeriodEnd: true`

### POST /api/companies/:companyId/billing/subscription/reactivate

Reactivate a subscription that was scheduled for cancellation.

**Auth:** Board only

**Response:** Updated subscription object with `cancelAtPeriodEnd: false`

### GET /api/companies/:companyId/billing/usage

Get current billing period usage data.

**Auth:** Company members

**Response:** Array of `SubscriptionUsageRow` objects (same shape as in subscription response).

### POST /api/companies/:companyId/billing/usage

Report usage for a given metric.

**Auth:** Board only

**Body:**
```json
{
  "metric": "seats" | "agent_runs" | "storage_gb",
  "quantity": 1
}
```

### GET /api/companies/:companyId/billing/invoices

List subscription invoices.

**Auth:** Company members

**Response:**
```json
[
  {
    "id": "uuid",
    "companyId": "uuid",
    "subscriptionId": "uuid",
    "stripeInvoiceId": "in_xxx",
    "invoiceNumber": "INV-0001",
    "status": "paid",
    "amountCents": 2900,
    "amountPaidCents": 2900,
    "amountRemainingCents": 0,
    "currency": "usd",
    "invoicePdfUrl": "https://...",
    "hostedInvoiceUrl": "https://...",
    "periodStart": "2026-08-01T00:00:00Z",
    "periodEnd": "2026-09-01T00:00:00Z",
    "createdAt": "2026-08-01T00:00:00Z",
    "updatedAt": "2026-08-01T00:00:00Z"
  }
]
```

### POST /api/companies/:companyId/billing/invoices/sync

Sync invoices from Stripe.

**Auth:** Board only

**Response:** Array of synced invoice objects.

### GET /api/companies/:companyId/billing/overview

Get billing overview including subscription, usage, invoices, and total spent.

**Auth:** Company members

**Response:**
```json
{
  "companyId": "uuid",
  "subscription": { /* CompanySubscription or null */ },
  "invoices": [ /* SubscriptionInvoice[] */ ],
  "usage": [ /* SubscriptionUsageRow[] */ ],
  "totalSpentCents": 2900
}
```

### GET /api/companies/:companyId/billing/experiment-variant

Get the A/B pricing experiment variant assigned to this company.

**Auth:** Company members

**Response:**
```json
{
  "variant": "A",
  "enabled": false
}
```

- `variant` — Assigned experiment variant: `"A"` (control) or `"B"` (treatment)
- `enabled` — Whether the experiment is currently active (configured via `PRICING_EXPERIMENT_CONFIG`)

When `enabled: false`, all companies see control pricing regardless of variant assignment.

### GET /api/companies/:companyId/billing/experiment-results

Get experiment results summary (board-only). Returns per-variant enrollment counts.

**Auth:** Board only

**Response:**
```json
{
  "enabled": true,
  "totalAssigned": 42,
  "variantA": { "count": 20 },
  "variantB": { "count": 22 }
}
```

---

## Pricing Page UX Mapping

The following features on the pricing page consume these API endpoints:

| UI Feature | API Endpoint(s) | Notes |
|---|---|---|
| Billing period toggle | No API call (client-side state) | Toggles between `priceMonthlyCents` and `priceYearlyCents` from tier data |
| Tier cards | `GET /billing/tiers` | Prices reflect experiment variant overrides |
| Current subscription card | `GET /billing/subscription` | Shows usage bars when `usage` array is populated |
| Usage progress bars | `GET /billing/subscription` → `usage` array | Bar fill: `min(100%, usage/included * 100)` |
| Checkout flow | `POST /billing/create-checkout-session` | Fires `checkout_started` GA4 event client-side |
| Cancel subscription | `POST /billing/subscription/cancel` | Fires `subscription_cancellation_started` GA4 event client-side |
| Reactivate subscription | `POST /billing/subscription/reactivate` | Rescinds scheduled cancellation |
| Experiment variant badge | `GET /billing/experiment-variant` | Determines render mode (variant B vs A) |
| Experiment variant indicator (subtle) | `GET /billing/experiment-variant` | Shows `variant` and tier count at page bottom |
| CTA clicks | `POST /billing/create-checkout-session` | Fires `cta_clicked` GA4 event client-side |
| Invoice history | `GET /billing/invoices` | Not currently displayed on pricing page |

---

## GA4 Event Reference (Client-Side)

The pricing page fires these GA4 events via a `ga4()` helper that wraps `globalThis.gtag()`:

| Event | Trigger | Parameters |
|---|---|---|
| `checkout_started` | User clicks a CTA button | `tier_id`, `billing_period`, `experiment_variant`, `company_id` |
| `billing_period_toggle` | User toggles monthly/yearly | `period` |
| `subscription_cancellation_started` | User confirms cancellation | `company_id` |
| `cta_clicked` | User clicks any CTA button | `tier_id`, `tier_name`, `billing_period`, `experiment_variant`, `company_id` |

All events are best-effort (failures silently caught). The global `gtag` function must be loaded separately.

---

## Stripe Webhook

**Endpoint:** `POST /api/billing/webhook`

**Auth:** Stripe signature verification (no bearer token)

Handles Stripe events for subscription lifecycle:
- `invoice.paid` — Record invoice and mark paid
- `invoice.payment_failed` — Mark subscription as `past_due`
- `customer.subscription.updated` — Sync subscription status/period changes
- `customer.subscription.deleted` — Mark subscription as `canceled`
- `customer.subscription.created` — Create subscription record (fallback)
- `checkout.session.completed` — Create subscription from checkout
- `customer.subscription.trial_will_end` — Log trial impending expiry (sent 3 days before)
- `customer.subscription.updated` (post-trial) — Enters 7-day grace period (`grace_period` status) if no payment method, then `expired` after grace period elapses

The webhook uses the `STRIPE_WEBHOOK_SECRET` environment variable for signature verification and requires the raw request body.

---

## Error Codes

| HTTP Status | Error | Description |
|---|---|---|
| 400 | `bad_request` | Missing required fields, invalid IDs, or validation errors |
| 403 | `forbidden` | Insufficient permissions (not a board member for privileged actions) |
| 404 | `not_found` | Company, tier, or subscription not found |
| 402 | `paywall` | Feature requires a subscription (from `requireFeature` gate) |
| 422 | `unprocessable` | Business logic failure (e.g., canceling already-canceled subscription) |

---

## Configuration Reference

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | Yes | — | Stripe API secret key |
| `STRIPE_WEBHOOK_SECRET` | Yes (webhook) | `""` | Stripe webhook signing secret |
| `PRICING_EXPERIMENT_CONFIG` | No | `null` | JSON experiment config (see [M5 Release](../documentation/releases/m5-ab-pricing-experiment.md)) |
| `GA4_MEASUREMENT_ID` | No | `""` | GA4 measurement ID |
| `GA4_API_SECRET` | No | `""` | GA4 Measurement Protocol API secret |
| `GA4_ENABLED` | No | `false` | Enable GA4 server-side events |
| `GA4_DEBUG` | No | `false` | Use GA4 debug endpoint |

---

*Paperclip Platform — Billing API v1 (Code Separation Phase 2)*