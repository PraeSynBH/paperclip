# Support Case Assessment: Stripe Billing Robustness Fixes (v0.2.13)

**Feature**: Stripe billing integration hardening — deleted customer detection, safe status mapping, auto-downgrade, stale-ref repair, trialing sync, webhook body parsing fix, portal link resilience, trial-to-paid upsert fix
**Assessed by**: Support Engineer
**Date**: 2026-08-25 (updated)
**Related**: VOY-944, VOY-896, VOY-905, VOY-1218, VOY-1227, VOY-2217, VOY-2218, VOY-2117
**Release**: v0.2.13 / Voyonder billing bug fixes

## Feature Overview (User Perspective)

Voyonder uses Stripe to manage subscriptions and billing. This release applies five targeted fixes that make billing more reliable behind the scenes:

1. **Deleted customers are detected** — Stripe customer references that point to deleted Stripe records are now correctly identified
2. **Subscription status is mapped safely** — Unexpected Stripe status values won't cause errors
3. **Cancellation always downgrades to Free** — No more stuck paid tiers after cancellation, even if webhooks fail
4. **Stale customer refs self-repair** — If a Stripe customer ID in the database is stale, it gets fixed automatically on billing visits
5. **Trialing subscriptions sync correctly** — Trial users are correctly classified and not mixed up with expired subscriptions

For users, the visible changes are minimal: billing works the same, but cancellation is more reliable and certain edge-case errors that could appear on the billing page are eliminated.

## Potential User Confusion Points

1. **"I cancelled but my plan still says Paid"** — For existing users who cancelled before this fix, their next login will downgrade them. If a user says they cancelled but still have paid features, ask them to log out and log back in.

2. **"I was downgraded to Free but I didn't cancel"** — This could mean their subscription expired or was cancelled on Stripe's side. Verify the subscription status in Stripe dashboard.

3. **"I'm on a trial but I was downgraded"** — The trialing sync fix (VOY-905) ensures trial users keep trial status. If a trial user was wrongly downgraded despite this fix being deployed, it's a bug — escalate to CTO.

4. **"My billing page is showing an error"** — The safe status mapping fix eliminates one class of billing page crashes. If the error persists, it's a different root cause.

5. **"I can't update my payment method"** — The stale-customer auto-repair runs on checkout/billing portal visits. If the user has a stale Stripe reference, the fix should self-heal on the next visit. If it doesn't, escalate.

## FAQ

**Q: I cancelled my subscription. When will I be downgraded to Free?**
A: On your next login. Log out and log back in, and the system will detect your cancelled subscription and downgrade accordingly.

**Q: I cancelled weeks ago but I'm still on a paid plan. Why?**
A: Your cancellation happened before this fix was deployed, and the automated downgrade webhook was lost. Log out and log back in — the fix will apply on your next login.

**Q: Will I be charged for my next billing cycle if I cancelled?**
A: No. Your Stripe subscription is cancelled. The issue was that your in-app tier (the features you could access) didn't match your cancelled status. With this fix, the tier will be corrected on your next login.

**Q: Can I still use paid features while I'm on a trial?**
A: Yes. Trial users retain access to paid features during their trial period. The fix ensures trial status is correctly maintained.

**Q: What if my billing page crashes?**
A: The safe status mapping fix eliminates crashes caused by unexpected Stripe status values. If you still see a crash, it's a different issue — contact support.

## Troubleshooting

### User reports "I cancelled but my tier still shows Paid"

1. Verify in Stripe dashboard that the subscription is cancelled/ended
2. Confirm the v0.2.13 deployment was successful
3. Ask the user to log out and log back in
4. Verify their tier has changed to Free in the admin panel
5. If the tier did not change after logout/login, escalate to CTO

### User reports "I was downgraded but I didn't cancel"

1. Check Stripe dashboard for their subscription status
2. If the subscription is `active` or `trialing`, the user should have those tiers — escalate to CTO (possible regression)
3. If the subscription is `expired`, `incomplete`, `past_due`, `canceled`, or `incomplete_expired`, the downgrade is correct — explain to user
4. Offer to help the user resubscribe if they want to continue paid access

### User reports billing page error

1. Check if the error persists after a hard refresh (Cmd+Shift+R)
2. Check browser console for any JavaScript errors
3. If the error is a generic "Something went wrong" — the safe status mapping fix should have addressed Stripe-specific cases
4. If the error persists and is related to Stripe, escalate to CTO with the error details

### User can't access billing portal or checkout

1. Clear browser cache and cookies
2. Try incognito/private browsing mode
3. The stale-customer auto-repair runs on billing visits — the fix may resolve on the next attempt
4. If the issue persists after multiple attempts, escalate to CTO

## Error States

| Error | User sees | Root cause | Recovery |
|---|---|---|---|
| Cancelled user still on paid tier | User cancelled but still has paid features | Stripe webhook was lost before v0.2.13 | Log out and log back in — downgrade-to-free runs on login |
| Billing page "Internal Server Error" | Generic error on /settings/billing | Unexpected Stripe subscription status value | Fixed in v0.2.13 — safe status mapping; hard refresh; if persists, escalate |
| Trial user downgraded to Free | User on trial sees Free tier | syncTierFromStripe incorrectly handled expired subs alongside trials | Fixed in v0.2.13 — trialing filter; log out and log back in |
| Checkout fails silently | "Something went wrong" on checkout | Stale Stripe customer reference | Fixed in v0.2.13 — auto-repair on checkout/billing visit; retry |

## Related Documentation

- `/documentation/releases` — v0.2.13 release notes
- `/documentation` — Main help center
- `/settings/billing` — Billing page (on voyonder.com)
- [KB: Billing Downgrade-to-Free on Cancellation](../kb/billing-cancellation-downgrade.md)
- [Stripe Dashboard](https://dashboard.stripe.com) — Verify subscription status

## Escalation Path

| Issue | Severity | Escalate to | Notes |
|---|---|---|---|
| Cancelled user NOT downgraded after logout/login | High | CTO | Fix may not be properly deployed; check server version |
| User wrongly downgraded despite active subscription | High | CTO | Possible regression in syncTierFromStripe |
| Billing page crash persists after hard refresh | Medium | Staff Engineer | Likely unrelated to this fix — investigate root cause |
| Stale customer reference not healing on checkout | Medium | CTO | Auto-repair may have a gap — provide Stripe customer ID |
| Trial user wrongly assigned Free tier | High | CTO | Regression in trialing subscription logic (VOY-905) |

## Recent Fixes (August 25, 2026)

### Portal Link 500 Error (VOY-2218)

**Symptom:** Trial-only customers see a 500 error when clicking "Billing" or "Manage Subscription."

**Root cause:** `GET /api/billing/portal-link` called `stripe.billingPortal.sessions.create()` with a `null` `stripeCustomerId` for trial users who haven't entered a credit card.

**Fix:** The endpoint now checks for `stripeCustomerId` before calling Stripe. Trial-only users are redirected to the dashboard billing settings page instead of hitting Stripe's portal API.

**Troubleshooting:**
1. Verify the company's `stripeCustomerId` in the database (it may be legitimately null for trial-only users)
2. If `stripeCustomerId` is set but the portal still 500s, check Stripe dashboard for customer validity
3. If the fix is deployed and a customer with an active Stripe subscription still gets redirected to the dashboard (not the Stripe portal), escalate to CTO

### Webhook Body Parsing Fix (VOY-2217)

**Symptom:** Stripe webhook events (subscription updates, invoice payments) are not being processed. Subscription status doesn't update after checkout.

**Root cause:** The `express.raw()` middleware was not properly structured — the global `express.json()` parser was running before the webhook handler could access the raw body for signature verification.

**Fix:** The webhook route now uses a local `express.raw()` parser mounted before the global JSON parser. The raw body is attached to `req.rawBody`.

**Troubleshooting:**
1. Check Stripe dashboard → Developers → Webhooks for recent delivery attempts
2. If webhooks show "HTTP 400" or "Signature verification failed," verify `STRIPE_WEBHOOK_SECRET` is set correctly
3. Confirm the webhook endpoint URL is `https://voyonder.com/api/billing/webhook`

### Trial-to-Paid Conversion Crash (VOY-2117)

**Symptom:** Trial user completes Stripe Checkout but gets an error instead of converting to paid.

**Root cause:** The upsert `ON CONFLICT` target was `stripe_subscription_id`, but trial rows have `stripe_subscription_id = NULL`, so the conflict match never fired — causing a unique constraint violation.

**Fix:** Changed `ON CONFLICT` target to `company_id`.

**Troubleshooting:**
1. Check server logs for unique constraint violations on the `companies` table
2. Verify the company has a single row — if duplicate rows exist from before the fix, manual DB cleanup may be needed
3. If the customer was charged but their subscription didn't activate, check Stripe dashboard for the subscription and manually update the company record via the admin panel