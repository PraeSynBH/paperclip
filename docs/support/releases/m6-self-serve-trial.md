---
title: M6 — Self-Serve Trial & Onboarding
version: m6
date: 2026-08-24
commits: 2ffd656, 1c19fca, 63dd5aa, e70118c
status: Released — deployed to production 2026-08-24 ~??:?? UTC. [Verify and update]
---

# M6 Release: Self-Serve Trial Signup & Onboarding

**Branch:** `feat/m6-self-serve-trial-onboarding` → `master`
**Release status:** [To be filled on notification]
**Applies to:** VOY-1998 (Phase 0.1) + VOY-2027 (Phase 3) + VOY-1474 follow-up (async job pattern) + PostHog analytics

---

## What Changed

This release adds self-serve trial signup, onboarding, and analytics tracking. New users can now sign up directly at voyonder.com without an invitation — they get a 14-day free trial, a guided onboarding wizard, and the full Voyonder experience.

### Self-Serve Signup (Three Methods)

Users can create a Voyonder account through three channels, each creating a company with a 14-day Stripe trial subscription:

| Method | How It Works | Requirements |
|--------|-------------|-------------|
| **Email & Password** | User provides name, email, and password. Account created with trial subscription. Verification email sent. | Valid email, strong password |
| **Google OAuth** | User authenticates via Google. Profile info auto-populated. Trial subscription created. | Google account |
| **Magic Link** | User enters email, receives a one-time login link. Trial subscription created on first click. | Valid email |

All methods create a Stripe subscription with `trial_settings.end_behavior.missing_payment_method: cancel` — the subscription auto-cancels if no payment method is added within the 14-day trial period.

### Onboarding Wizard

After signup, users are guided through an onboarding flow:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/onboarding/status` | Returns current onboarding status (not_started, in_progress, completed), selected role, and completion timestamp |
| `POST /api/onboarding/role` | Sets the user's role (e.g., "founder", "operator", "team_member"). Triggers asset pack deployment. |
| `POST /api/onboarding/skip` | Skips onboarding — lands on the default dashboard |

The onboarding status is persisted in the `voyonder_companies` table (`onboardingStatus`, `onboardingSelectedRole`, `onboardingCompletedAt` columns).

### Stripe Webhooks & Subscription Lifecycle

A dedicated webhook endpoint handles the full subscription lifecycle:

| Webhook Event | Action |
|---------------|--------|
| `checkout.session.completed` | Activates subscription, logs conversion event |
| `customer.subscription.created` | Records new subscription in local DB |
| `customer.subscription.updated` | Syncs status changes (active, past_due, canceled, incomplete) |
| `customer.subscription.deleted` | Marks subscription as canceled |
| `invoice.paid` | Records successful payment |
| `invoice.payment_failed` | Logs payment failure (triggers dunning if configured) |
| `subscription.trial_will_end` | Fires 3 days before trial expiry — can trigger reminder emails |

Webhook events are **idempotent** — duplicate events are ignored via a `voyonder_stripe_webhook_events` table that tracks processed event IDs. The webhook route is mounted before JSON body parsing and auth middleware so Stripe can deliver events without authentication.

### Trial Lifecycle

| Phase | Duration | Behavior |
|-------|----------|----------|
| Active trial | 14 days from signup | Full access to all features |
| Grace period | 7 days after trial ends | Read-only access — data preserved, no new content creation |
| Expired | After grace period | Company marked `trial_expired`. Data retained for re-activation (adding payment method restores access) |

The `expireTrials()` reaper runs periodically to transition companies through the lifecycle. `getTrialsExpiringSoon()` returns companies whose trial ends within N days for proactive outreach.

### Subscription Management (Board Users)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/billing/subscription` | Returns billing state with trial/grace period status, plan details, and current period |
| `GET /api/billing/trial-info` | Trial status with days remaining |
| `POST /api/billing/cancel` | Cancels subscription at period end |
| `POST /api/billing/reactivate` | Reinstates a canceled subscription |

### PostHog Analytics

All signup flows now emit PostHog events for funnel analysis:

**Signup Events:**
- `signup_started` — User initiated signup (includes method: email/google/magic_link)
- `signup_failed` — Signup rejected (includes reason: user_already_exists, invalid_email, etc.)
- `signup_completed` — Account + company + trial created successfully

**Billing Events:**
- `billing_checkout_completed` — Stripe checkout finished
- `billing_subscription_activated` — Trial converted or paid subscription active
- `billing_subscription_canceled` — Subscription ended
- `billing_invoice_paid` / `billing_invoice_failed` — Payment events

**User Identification:** After signup, users are identified in PostHog with their userId, email, name, companyId, and auth provider. All subsequent pageviews and events are attributed to the identified user.

### Async Job Pattern (Research & Exports)

The M6 release extends the M1/M2 async job infrastructure to the Voyonder codebase:

- **Research activity search** — Converted to background job processing (returns HTTP 202 with jobId)
- **CSV/ICS export routes** — New export endpoints use the background job pattern for non-blocking PDF and calendar file generation

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STRIPE_SECRET_KEY` | Yes | — | Stripe secret key for API calls |
| `STRIPE_WEBHOOK_SECRET` | Yes | — | Webhook signing secret for event verification |
| `STRIPE_PRICE_ID` | Yes | — | Default Stripe price ID for trial subscriptions |
| `POSTHOG_API_KEY` | No | — | PostHog API key for analytics (falls back to `POSTHOG_PERSONAL_API_KEY`) |
| `POSTHOG_HOST` | No | `https://us.posthog.com` | PostHog host URL (falls back to `NEXT_PUBLIC_POSTHOG_HOST`) |
| `PAPERCLIP_API_KEY` | Yes | — | Board-level API key for Paperclip integration |
| `PAPERCLIP_API_URL` | Yes | — | Paperclip API base URL |

### Stripe Price Configuration

Trial subscriptions use a price with:
- `trial_settings.end_behavior.missing_payment_method: cancel`
- No initial payment method required
- 14-day trial period (configurable via Stripe dashboard)

---

## Support Escalation Paths

| Issue | First Response | Escalation |
|-------|---------------|------------|
| Signup fails with "user already exists" | User tries alternate auth method or resets password | N/A — expected behavior |
| Stripe trial not created on signup | Check Stripe dashboard for the customer; verify `STRIPE_SECRET_KEY` is valid | CTO if Stripe API returns errors |
| Webhook events not processing | Check server logs for webhook signature verification failures; verify `STRIPE_WEBHOOK_SECRET` | CTO if signature verification is failing |
| Trial not expiring automatically | Verify `expireTrials()` reaper is running (scheduled job) | CTO if reaper is not scheduled |
| Onboarding wizard stuck | User navigates to `/trips` to skip; check `onboardingStatus` in DB | CTO if role selection API fails |
| PostHog events not appearing | Verify `POSTHOG_API_KEY` is set; check PostHog dashboard for incoming events | CTO if API key is invalid |

---

## Related Documentation

- [Async UX Release Notes](voy-1474-async-ux.md) — Background job framework and process visibility (M1+M2)
- [Auth Flow](../../doc/auth-flow.md) — Voyonder↔Paperclip authentication architecture
- [PostHog Dashboards Setup](../../doc/posthog-dashboards-setup.md) — PostHog dashboard configuration
- [PostHog Monitoring SOP](../posthog-error-monitoring-triage-sop.md) — Error monitoring triage

---

*Prepared by Support Engineer (88b72065) — pending release verification*
