|---
title: Billing Bug Fixes — Body Parsing & Portal Link Resilience
version: voy-2217-voy-2218
date: 2026-08-25
commits: 2091dfba32, 46a0b32003
status: RELEASED — merged to master and deployed to production
---

# Billing Bug Fixes — Body Parsing & Portal Link Resilience

**Release:** VOY-2217 (body parsing), VOY-2218 (portal link 500)
**Commits:** `2091dfba32` (portal link), `46a0b32003` (trial-to-paid ON CONFLICT)
**Date:** 2026-08-25
**Status:** ✅ RELEASED — merged to master and deployed to production
**Related issues:** VOY-2217, VOY-2218, VOY-2227, VOY-2228, VOY-2229

---

## Summary

Two billing bugs that could cause server errors under specific conditions are now fixed:

1. **Body parsing fix** — Stripe webhook signature verification was failing because the `express.raw()` middleware wasn't properly structured for the billing routes. The webhook sub-router now correctly uses a local `express.raw()` parser that preserves the raw request body before the global `express.json()` parser runs, ensuring Stripe's signature verification always has access to the unparsed payload.

2. **Portal link fix** — Trial-only customers (who have no active Stripe subscription and no `stripeCustomerId`) were hitting a 500 error when requesting the billing portal link. The `createPortalLink` endpoint now handles three states gracefully:
   - **Active Stripe subscription** → Returns a Stripe Customer Portal session URL as before
   - **Trial-only customer (no Stripe customer ID)** → Returns the dashboard billing settings URL instead of trying to create a Stripe portal session
   - **Stripe not configured** → Returns a mock/fallback URL pointing to the billing settings page

Both fixes are server-side. No API contract changes, no UI changes, no new configuration required.

---

## Changes

### 1. Body Parsing Middleware Restructure (VOY-2217)

**The problem:** The Stripe webhook endpoint (`POST /api/billing/webhook`) requires the raw request body for signature verification. However, the global `express.json()` middleware was running before the webhook handler could access the raw body, causing `stripe.webhooks.constructEvent()` to fail signature verification because the parsed JSON body is not identical to the original raw payload.

**The fix:** The webhook route is now mounted as a separate sub-router with its own `express.raw({ type: "application/json" })` middleware, placed **before** the global `express.json()` parser in the middleware chain. The raw body is attached to `req.rawBody` so the webhook handler can pass it directly to Stripe's verification function.

**What this means for support:**
- Invisible to customers — the webhook endpoint behaves identically when working correctly
- Fixes a regression where Stripe webhook events (subscription updates, invoice payments, trial conversions) could be silently rejected due to signature verification failure
- If a customer reports that their subscription status is not updating after checkout, or that trial-to-paid conversion didn't happen, this fix ensures the webhook events are processed correctly going forward

### 2. Portal Link Three-State Handling (VOY-2218)

**The problem:** `GET /api/billing/portal-link` called `stripe.billingPortal.sessions.create()` with the company's `stripeCustomerId`. For trial-only customers who signed up without entering a credit card, `stripeCustomerId` could be `null` (the Stripe customer hadn't been created yet). Passing `null` to the Stripe API caused a 500 error.

**The fix:** The `createPortalLink` function now checks for `stripeCustomerId` before calling Stripe:
- If `stripeCustomerId` exists AND Stripe is configured → create a real Stripe portal session and return its URL
- If `stripeCustomerId` is null or Stripe is not configured → return the dashboard billing settings page URL as a graceful fallback

**What this means for support:**
- Trial-only customers who click "Billing" or "Manage Subscription" will no longer see a 500 error page
- Instead, they'll be redirected to the billing settings page where they can see their trial status and upgrade options
- Customers with active subscriptions see the Stripe Customer Portal as before — no change for them
- No customer action needed

### 3. Trial-to-Paid ON CONFLICT Fix (VOY-2117 followup)

**The problem:** When a trial user completed Stripe Checkout (converting from trial to paid), the upsert query used `stripe_subscription_id` as the `ON CONFLICT` target. But trial rows have `stripe_subscription_id = NULL`, and SQL's `NULL = NULL` comparison semantics prevent the conflict match — so the upsert always inserted a new row instead of updating the existing trial row, causing a unique constraint violation crash.

**The fix:** The `ON CONFLICT` target was changed from `stripe_subscription_id` to `company_id`, which is always set and can properly match the existing trial row.

**What this means for support:**
- Trial users who attempt to upgrade via Stripe Checkout will no longer encounter a 500 error
- The subscription status correctly updates the existing company record instead of crashing
- If a customer previously reported that their trial-to-paid upgrade failed with an error, this was the root cause — it should work correctly now

---

## Configuration

No new configuration options. Existing `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `VOYONDER_DASHBOARD_URL` remain unchanged.

---

## Verification

- [x] Webhook `express.raw()` middleware mounted before global `express.json()` — raw body preserved
- [x] `POST /api/billing/webhook` — signature verification passes with raw body
- [x] `GET /api/billing/portal-link` — returns Stripe portal URL for customers with active subscription
- [x] `GET /api/billing/portal-link` — returns dashboard URL for trial-only customers (no Stripe customer)
- [x] `GET /api/billing/portal-link` — returns dashboard URL when Stripe is not configured
- [x] Trial-to-paid `ON CONFLICT` uses `company_id` instead of `stripe_subscription_id`
- [x] Code reviewed by Staff Engineer (VOY-2227): APPROVED
- [x] CTO sign-off (VOY-2249): APPROVED — ship independently
- [x] Deployed to production and verified healthy

---

## Known Issues

- Trial-only customers redirected to the billing settings page will not see a Stripe portal — they remain on the dashboard. If they attempt to manage a subscription that doesn't exist yet, the page should guide them to upgrade. This is the intended UX for trial users.

## Support Escalation Path

| Issue | Severity | Action |
|-------|----------|--------|
| Customer reports 500 error on billing portal link | High (regression) | Verify the fix is deployed (check server commit matches `2091dfba32` or later). If the error persists, check if `stripeCustomerId` is populated for the company and escalate to CTO. |
| Customer reports webhook events not processing (subscription status not updating) | Medium | Verify Stripe webhook configuration in Stripe dashboard. Confirm webhook signing secret is set. If the fix is deployed and webhooks still fail, escalate to CTO. |
| Trial-to-paid conversion fails with error | High (regression) | Verify `ON CONFLICT` fix is deployed. Check server logs for constraint violations. Escalate to CTO if the error persists. |
