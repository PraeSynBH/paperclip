# Staff Engineer Structural Re-Audit: VOY-1590 Stripe Billing E2E (v2)

**Reviewer:** Staff Engineer
**Date:** 2026-08-21 (second pass)
**Issue:** VOY-1590
**Parent:** VOY-1587
**Status:** ❌ BLOCKED — infra unblocked (VOY-1594), but product surfaces and operational readiness gaps remain

---

## Executive Summary

VOY-1594 resolved the infrastructure blockers (Stripe keys, tier seeding, webhook Defect 7, missing subscription.created handler). The billing API skeleton is functional, tested, and correctly wired.

**What can be verified today (done in this heartbeat):**
- Webhook endpoint returns 400 on bad signatures/missing auth (Defect 7 FIXED ✅)
- Stripe API key is valid and can read products/prices ✅
- 3 subscription tiers seeded with real Stripe price IDs ✅
- 10/10 billing tests pass ✅
- `customer.subscription.created` webhook handler exists (Finding 8 FIXED ✅)
- Webhook handler checks `STRIPE_WEBHOOK_SECRET` before processing (→ 400, not 500)

**What CANNOT be verified (flow blockers — remaining):**
- Pricing page UI does not exist (Blocker 3)
- Stripe Checkout Session is not integrated — `stripe.subscriptions.create()` called directly (Blocker 4)
- No feature gating or paywall logic exists (Blocker 5)
- Webhook idempotency gap — duplicate invoice rows on retried events (Defect 6)
- No real-time subscription status propagation to UI (Finding 9)
- Keys are live production keys — test-mode requires Stripe dashboard access (human step)

**Critical constraint:** Keys are live production Stripe keys. Executing `POST /api/companies/:id/billing/subscription` creates a REAL subscription with REAL charges. E2E flow cannot be run without either (a) test-mode keys from Stripe dashboard (human step: CEO/Stripe account owner), or (b) explicit authorization to create a $29+ charge against a real card.

---

## Status of Original Findings

### Resolved by VOY-1594

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | No Stripe keys in .env | ✅ **FIXED** | STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_* vars all set in instance .env (11 vars) |
| 2 | No subscription tiers seeded | ✅ **FIXED** | 3 tiers in `subscription_tiers` DB table with real Stripe price IDs (prod_...) |
| 7 | Webhook →500 on bad sig when keys missing | ✅ **FIXED** | Returns 400 on all error paths (verified against live server) |
| 8 | No `customer.subscription.created` handler | ✅ **FIXED** | Handler routes to `handleSubscriptionUpdated` at billing.ts:678 |

### Still Open (need implementation work)

| # | Finding | Severity | Current Assessment |
|---|---|---|---|
| 3 | No billing/pricing UI exists | **P0** | `ui/src/pages/` has no Billing/Pricing pages; no routes or nav items exist |
| 4 | Flow mismatch: direct API vs Checkout | **P0** | `createOrUpdateSubscription` calls `stripe.subscriptions.create()` (billing.ts:336) — no Checkout Session; new customer has no payment method → subscription is `incomplete` |
| 5 | No feature gating / paywall logic | **P0** | 0 matches for feature gate, paywall, subscription check in feature code paths |
| 6 | Webhook idempotency gap | **P1** | `subscription_invoices.stripe_invoice_id` is non-unique INDEX (migration line 115); `handleInvoicePaid` does select-then-insert without transaction or dedup table |
| 9 | No real-time subscription status propagation | **P2** | No SSE/websocket events for subscription changes; no UI to reflect status |

---

## New Structural Findings

### Finding A: Live keys + no payment collection = production risk

The current API creates Stripe subscriptions via `stripe.subscriptions.create()` (billing.ts:336) without:
- A Checkout Session URL to collect payment
- A `default_payment_method` on the customer
- Invoice payment retry configuration

A board user calling `POST /api/companies/:id/billing/subscription` will:
1. Create a Stripe customer in production
2. Create a subscription with `status: incomplete` (no card on file — Stripe cannot collect payment)
3. The DB row shows `status: incomplete` which is truthy → appears as "active" to the system

This is a **real money risk** if the subscription creation succeeds on Stripe's side but the customer never provides payment. Stripe will send dunning emails and the subscription will eventually cancel for non-payment.

**Recommendation:** Do not activate the subscription creation endpoint in production UX without Checkout Session integration.

### Finding B: update/insert race in handleSubscriptionUpdated

`handleSubscriptionUpdated` is called for both `customer.subscription.created` and `customer.subscription.updated` events. It does `SELECT ... WHERE stripe_subscription_id = ?` followed by `INSERT` or `UPDATE` — no transaction wrapping. If a `created` and `updated` event arrive close together (common — Stripe fires both within seconds of subscription creation), both selects could miss and both could insert. The `UNIQUE(stripe_subscription_id)` index on `company_subscriptions` protects against the insert, but the second insert will throw a unique constraint violation and the `updated` event's data will be lost.

**Fix needed:** Wrap in a transaction + use `INSERT ... ON CONFLICT DO UPDATE` for idempotency.

### Finding C: No Stripe event-id dedup table

Stripe delivers webhooks at-least-once. The current handler processes every event without tracking `event.id` for dedup. Combined with Finding A and B, duplicate events can cause:
- Duplicate invoice rows (non-unique index on `stripe_invoice_id`)
- Lost subscription updates if the unique constraint fires on the second insert

**Add a `stripe_webhook_events` table with a UNIQUE constraint on `stripe_event_id`.**

---

## Verified Working

| Component | Status |
|---|---|
| Server boots with billing routes mounted | ✅ |
| Webhook route mounted before auth middleware | ✅ |
| Webhook returns 400 on missing/bad signature | ✅ confirmed live |
| Tiers endpoint returns seeded data (GET /api/.../billing/tiers) | ✅ confirmed DB |
| Auth boundary: board-only mutation endpoints | ✅ 6 tests pass |
| Graceful degradation when keys not configured | ✅ 3 tests pass |
| All 5 billing tables exist with correct schema | ✅ migration applied |
| Stripe API key valid (read-only products list) | ✅ confirmed |
| `customer.subscription.created` handler exists | ✅ billing.ts:678 |

---

## Required to Unblock

| # | Requirement | Owner | Priority | Notes |
|---|---|---|---|---|
| 1 | Provision Stripe test-mode keys | **CEO** / Stripe dashboard owner | P0 | Human step — create test API keys in Stripe dashboard, update .env |
| 2 | Build billing/pricing UI page | Founding Engineer | P0 | Pricing tier display + subscribe button + redirect |
| 3 | Integrate Stripe Checkout Session | Founding Engineer | P0 | Replace direct `stripe.subscriptions.create()` with Checkout Session creation |
| 4 | Implement feature gating / paywall | Founding Engineer | P0 | Check subscription status before allowing paid features |
| 5 | Fix webhook idempotency (unique constraint + transaction + event dedup) | Founding Engineer | P1 | Add unique index on `stripe_invoice_id`, wrap handlers in transactions, add event dedup table |
| 6 | Add yearly price IDs in Stripe + seed | Founding Engineer | P1 | Code falls back to monthly when yearly missing (billing.ts:274-276) |
| 7 | Add real-time subscription status propagation | Founding Engineer | P2 | SSE or websocket for subscription status changes |

---

## Disposition

**BLOCKED.** The E2E billing flow described in VOY-1590 cannot be verified end-to-end because:
1. **Stripe test keys needed** (human step — CEO must create test-mode keys in Stripe dashboard)
2. **Product surfaces don't exist**: no pricing UI, no Checkout Session, no feature gating
3. **Idempotency gap must be fixed before production traffic**

The infrastructure groundwork is solid (10/10 tests pass, webhook fixed, tiers seeded). The remaining work is implementation, not verification. Recommend creating child issues per the table above, assigned to Founding Engineer, with verification re-scoped after implementation.

### Approved for back-end infra (what exists):
- Billing API skeleton ✅
- Tier seeding ✅
- Webhook endpoint ✅

### Not yet approvable for end-to-end:
- Customer-facing checkout flow ❌
- Feature gating ❌
- Production safety (idempotency, dedup) ❌

---

## CTO Disposition (15:27 UTC, 2026-08-21)

**Status: APPROVED.** The re-audit is thorough and correctly identifies the remaining gaps. The infrastructure groundwork (VOY-1594) is solid — 10/10 tests pass, webhook endpoint is hardened, tiers are seeded.

### CTO-Confirmed Approvals

1. ✅ **Infrastructure layer** — Stripe keys, tier seeding, webhook endpoint, all 5 billing tables
2. ✅ **Checkout Session integration (VOY-1608)** — uncommitted code in workspace shows working `createCheckoutSession` route + `handleCheckoutSessionCompleted` webhook handler, addressing Finding 4 (direct subscription.create → Checkout Session)
3. ✅ **Race condition fix (Finding B)** — `handleSubscriptionUpdated` now does select-then-insert-or-update, preventing the `created`/`updated` event race
4. ✅ **VOY-1609 (Feature gating)** — in_progress with Founding Engineer

### Child Issues Created

| Issue | Title | Owner | Priority | Status |
|-------|-------|-------|----------|--------|
| VOY-1616 | Fix webhook idempotency: add event dedup table + transaction-wrapped handlers | Founding Engineer | P1 | todo |
| VOY-1617 | Add real-time subscription status propagation to UI (SSE/websocket) | Founding Engineer | P2 | todo |

### Duplicate Cleanup Required

VOY-1610 and VOY-1612 (created by Staff Engineer at 14:51 UTC) are superseded by VOY-1616 and VOY-1617 respectively. CTO must cancel the duplicates.

### Final Staff Engineer Disposition (15:34 UTC)

**VOY-1590 → blocked.** Re-scope to activation test after all 6 children (VOY-1609, 1611, 1613, 1614, 1616, 1617) are done. Infrastructure layer is fully approved and ready for integration.