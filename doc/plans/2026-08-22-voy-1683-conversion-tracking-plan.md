# VOY-1683: Conversion Tracking — Pricing/Subscribe Flow

**Status:** Locked — ready for implementation  
**Owner:** Founding Engineer  
**Effort:** Small  
**Depends on:** `POSTHOG_API_KEY` + `POSTHOG_HOST` env vars from founder

---

## Problem

The pricing/subscribe funnel has zero analytics visibility. We cannot answer:

- How many users view the pricing page?
- What tier do they click to subscribe?

When Stripe Checkout sessions are created, completed, and activated, those events are invisible to PostHog.

## Solution

Add `captureMetric()` calls at five key points in the pricing/subscribe funnel, using the existing `posthog-node` dependency (already in `server/package.json`) and a recreated PostHog service.

## Architecture

### Data Flow

```
User browser                 Server                         PostHog
    │                          │                               │
    │  GET /billing/tiers ─────┤                               │
    │                          ├── captureMetric("pricing.page_view") ──►│ Event 1
    │                          │                               │
    │  POST /create-checkout ──┤                               │
    │                          ├── captureMetric("pricing.subscribe_click") ──►│ Event 2
    │                          ├── captureMetric("pricing.checkout_started") ──►│ Event 3
    │←─ Stripe Checkout URL ───┤                               │
    │                          │                               │
    │      Stripe Checkout                                     │
    │          │                                               │
    │      Webhook ──── POST /billing/webhook ──► server       │
    │                          │                               │
    │                          ├── captureMetric("pricing.subscription_completed") ──►│ Event 4
    │                          │                               │
    │  invoice.paid webhook ───┤                               │
    │                          ├── captureMetric("pricing.subscription_activated") ──►│ Event 5
```

### Component Changes

| Component | Change | File |
|---|---|---|
| **PostHog service** | Recreate `posthog.ts` (was fork-only, removed in code separation). Exports `captureMetric()`, `captureErrorEvent()`, `initPostHog()`, `flush()`, `shutdownPostHog()` | `server/src/services/posthog.ts` (NEW) |
| **Billing service** | Add 5 `captureMetric()` calls at trigger points | `server/src/services/billing.ts` |

## Event Specifications

### Event 1: `pricing.page_view`

| Property | Description |
|---|---|
| `companyId` | Company viewing the page |
| `tierIds` | Array of available tier IDs rendered |
| `tierNames` | Array of tier names rendered |
| `hasExistingSubscription` | Boolean — whether the company already subscribes |

**Trigger:** `GET /api/companies/:companyId/billing/tiers` handler after fetching tiers.  
**Implementation:** In `listTiers()`, after `db.select().from(subscriptionTiersTable)` returns, fire:
```
captureMetric("pricing.page_view", companyId, { tierIds, tierNames, hasExistingSubscription })
```

### Event 2: `pricing.subscribe_click`

| Property | Description |
|---|---|
| `companyId` | Company clicking subscribe |
| `tierId` | ID of the selected tier |
| `tierName` | Name of the selected tier |
| `billingPeriod` | "monthly" or "yearly" |
| `priceCents` | Price in cents of selected tier+period |

**Trigger:** `createCheckoutSession()` in billing service, before creating Stripe session (or after — either works).  
**Implementation:** At the top of `createCheckoutSession()`:
```
captureMetric("pricing.subscribe_click", companyId, { tierId, tierName, billingPeriod, priceCents })
```
Reason: the click always leads to checkout creation; firing at the start means we measure intent, not Stripe API success.

### Event 3: `pricing.checkout_started`

| Property | Description |
|---|---|
| `companyId` | Company starting checkout |
| `tierId` | Selected tier |
| `billingPeriod` | "monthly" or "yearly" |
| `sessionId` | Stripe Checkout Session ID |

**Trigger:** `createCheckoutSession()` after Stripe API call succeeds, before returning response.  
**Implementation:** After `stripe.checkout.sessions.create()` succeeds:
```
captureMetric("pricing.checkout_started", companyId, { tierId, billingPeriod, sessionId: session.id })
```

### Event 4: `pricing.subscription_completed`

| Property | Description |
|---|---|
| `companyId` | Company completing subscription |
| `tierId` | Selected tier |
| `billingPeriod` | "monthly" or "yearly" |
| `stripeSubscriptionId` | Stripe subscription ID |
| `status` | Initial subscription status from Stripe |
| `trialEnd` | Trial end date (if applicable) |

**Trigger:** `handleCheckoutSessionCompleted()` in billing service, after the upsert succeeds (subscription row created).  
**Implementation:** After `tx.execute(INSERT...ON CONFLICT DO UPDATE)`:
```
captureMetric("pricing.subscription_completed", companyId, { tierId, billingPeriod, stripeSubscriptionId, status, trialEnd })
```

### Event 5: `pricing.subscription_activated`

| Property | Description |
|---|---|
| `companyId` | Company with activated subscription |
| `stripeSubscriptionId` | Stripe subscription ID |
| `invoiceAmountCents` | Amount paid |
| `periodStart` | Current period start |
| `periodEnd` | Current period end |

**Trigger:** `handleInvoicePaid()` in billing service, after the invoice upsert succeeds.  
**Implementation:** After `tx.execute(INSERT...ON CONFLICT DO UPDATE)` for the invoice:
```
captureMetric("pricing.subscription_activated", companyId, { stripeSubscriptionId, invoiceAmountCents, periodStart, periodEnd })
```

## Edge Cases & Failure Modes

| Scenario | Behavior |
|---|---|
| **PostHog env vars not set** | `captureMetric()` is a no-op (returns immediately). Server boots cleanly. Graceful degradation. |
| **PostHog API call fails** | `captureMetric()` is fire-and-forget — `posthog-node` queues events in memory and flushes async. Failure is logged but never blocks the response. |
| **Stripe webhook at-least-once delivery** | `handleCheckoutSessionCompleted` and `handleInvoicePaid` may fire multiple times. PostHog events are idempotent by `distinctId` + event name duplicate handling; extra events are harmless in PostHog dashboards (same data each time). |
| **Race: checkout.session.completed vs subscription.updated** | Both fire almost simultaneously. Events 4 and 5 may arrive in any order relative to webhook events; PostHog handles unordered events gracefully. |
| **User navigates away before Stripe redirect** | Events 1-3 still fire (they're server-side, before redirect). Events 4-5 fire on webhook, independent of user session. |
| **Subscription completion without invoice** | Trial subscriptions complete without immediate payment. Event 4 fires, Event 5 fires on first `invoice.paid` (which may be days later). |
| **PII exposure** | All event properties contain only internal IDs (companyId, tierId, sessionId) — no user names, emails, or raw user input. No `redactSensitiveText()` needed for conversion events. |
| **Existing subscription company views pricing** | Event 1 includes `hasExistingSubscription: true`. They can't click Subscribe (button shows "Current Plan"), so Event 2 won't fire. |

## Test Coverage

| Test | Scope | Location |
|---|---|---|
| PostHog service init | `initPostHog()` with/without env vars | `server/src/services/posthog.test.ts` (NEW) |
| `captureMetric` no-op without config | Verify no throw when env vars absent | posthog.test.ts |
| `captureErrorEvent` no-op without config | Verify no throw when env vars absent | posthog.test.ts |
| Billing event fires on page view | Mock `captureMetric` and verify it's called in `listTiers` | billing-e2e.test.ts (extend) |
| Billing event fires on subscribe click | Mock `captureMetric` and verify in `createCheckoutSession` | billing-e2e.test.ts (extend) |
| Billing event fires on checkout completed | Mock `captureMetric` and verify in `handleCheckoutSessionCompleted` | billing-e2e.test.ts (extend) |
| Billing event fires on invoice paid | Mock `captureMetric` and verify in `handleInvoicePaid` | billing-e2e.test.ts (extend) |
| No blocking on PostHog failure | Verify response is sent even if `captureMetric` throws | posthog.test.ts |

## Implementation Order

1. **Recreate `server/src/services/posthog.ts`** — copy from git history (commit 1dfe01c6be — `feat(VOY-1420): PostHog business events + P2 fixes`), adapt imports to current codebase
2. **Add `captureMetric` calls in `server/src/services/billing.ts`** — 5 call sites
3. **Write unit tests for posthog.ts** — init, captureMetric, captureErrorEvent, shutdown
4. **Extend billing-e2e tests** — verify events fire at each trigger point

## Dependencies

| Dependency | Status |
|---|---|
| `server/package.json` → `posthog-node: ^5.0.0` | Already present |
| `POSTHOG_API_KEY` env var | Blocked on founder (Ben) |
| `POSTHOG_HOST` env var | Blocked on founder (Ben) |
| `server/src/services/posthog.ts` | Needs recreation (removed in code separation 009da5082d) |

## Child Issues

- VOY-1683.1 — Implementation: Recreate `posthog.ts` service + add 5 `captureMetric()` calls in billing.ts (Founding Engineer)
- VOY-1683.2 — Code review: Review implementation (Staff Engineer)
- VOY-1683.3 — Release: Ship to production (Release Engineer)
- VOY-1683.4 — QA: Verify events fire in PostHog dashboard (QA Engineer)

---

*End of plan.*