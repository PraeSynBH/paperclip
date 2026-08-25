---
|title: M6 — Self-Serve Trial & Onboarding
|version: m6
|date: 2026-08-25
|commits: 75c884f66d (feat/m6), 46a0b32003 (billing fix), 74753fe83b (CI fix), 8fb4d72b8f (certresolver fix), 27b6a2b29d (routing fix), b63c4f9f26 (verified healthy)
||status: Published — Live in production. Deployed 2026-08-25 ~01:15 UTC. All deploy blockers resolved per CTO 00:55 UTC verification. All production services healthy. Auth migration (VOY-2171) NOT YET DEPLOYED — CTO sign-off received, Release Engineer deploying.
---

# M6 Release: Self-Serve Trial Signup & Onboarding

**Branches:** `feat/m6-self-serve-trial-onboarding` → `master`
**Release status:** Published — M6 is live in production. Deployment completed 2026-08-25 ~01:15 UTC.
**Applies to:** M6 Trial Feature Release (VOY-1984) — self-serve trial signup, onboarding wizard, Stripe billing, PostHog analytics, async job pattern for research & exports

---

## What Changed

This release adds self-serve trial signup, onboarding, and analytics tracking to Voyonder. New users can now sign up directly at voyonder.com without an invitation — they get a **7-day free trial**, a guided onboarding wizard, and the full Voyonder experience. No credit card required.

### Self-Serve Signup (Two Methods)

Users can create a Voyonder account through two channels, each creating a company with a 7-day Stripe trial subscription:

| Method | How It Works | Requirements |
|--------|-------------|-------------|
| **Email + Magic Link** | User enters email, receives a one-time login link (expires after 15 minutes), clicks to verify and sign in | Valid email |
| **Google OAuth** | User authenticates via Google. Profile info auto-populated. Trial subscription created. | Google account (if configured in the deployment) |

All methods create a Stripe subscription with `trial_settings.end_behavior.missing_payment_method: cancel` — the subscription auto-cancels if no payment method is added within the 7-day trial period.

### Onboarding Wizard

After signup, new users see an onboarding flow:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/onboarding/status` | Returns current onboarding status (not_started, in_progress, completed), selected role, and completion timestamp |
| `POST /api/onboarding/role` | Sets the user's role and triggers asset pack deployment |
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
| `invoice.payment_failed` | Logs payment failure |
| `subscription.trial_will_end` | Fires 3 days before trial expiry — triggers reminder emails |

Webhook events are **idempotent** — duplicate events are ignored via a `voyonder_stripe_webhook_events` table that tracks processed event IDs.

Conversion uses `ON CONFLICT on company_id` (not `stripe_subscription_id`) — closes a P0 bug where NULL subscription_id prevented trial→paid conversion.

### Trial Lifecycle

| Phase | Duration | Behavior |
|-------|----------|----------|
| Active trial | 7 days from signup | Full access to all features |
| Grace period | Short period after trial ends | Data preserved — subscribe to re-activate |
| Expired | After grace period | Company marked `trial_expired`. Data retained for re-activation. |

### Subscription Management

| Endpoint | Purpose |
|----------|---------|
| `GET /api/billing/subscription` | Returns billing state with trial/grace period status, plan details, and current period |
| `GET /api/billing/trial-info` | Trial status with days remaining |
| `POST /api/billing/cancel` | Cancels subscription at period end |
| `POST /api/billing/reactivate` | Reinstates a canceled subscription |

### PostHog Analytics

All signup flows now emit PostHog events for funnel analysis:

**Signup Events:**
- `signup_started` — User initiated signup (includes method: email/google)
- `signup_failed` — Signup rejected (includes reason: user_already_exists, invalid_email, etc.)
- `signup_completed` — Account + company + trial created successfully

**Billing Events:**
- `billing_checkout_completed` — Stripe checkout finished
- `billing_subscription_activated` — Trial converted or paid subscription active
- `billing_subscription_canceled` — Subscription ended
- `billing_invoice_paid` / `billing_invoice_failed` — Payment events

### Async Job Pattern (Research & Exports)

The M6 release extends the M1/M2 async job infrastructure to the Voyonder codebase:

- **Research activity search** — Converted to background job processing (returns HTTP 202 with jobId)
- **CSV/ICS export routes** — New export endpoints use the background job pattern for non-blocking PDF and calendar file generation

### Auth System Migration (VOY-2171) — ⚠️ NOT YET DEPLOYED TO PRODUCTION

**Status:** Pipeline complete — CTO sign-off received (commit `4134b0038e`). Routing to Release Engineer for production deployment.

The auth migration code (commit `99b3917519`) is on the `fix/m-series-tech-debt` branch. When deployed, background jobs, research, and export API routes will use `assertVoyonderAuth` (Voyonder JWT auth) instead of Paperclip's `assertAuthenticated`/`assertCompanyAccess`. The `Authorization` header must carry a Voyonder HS256 JWT with `sub` (userId) and `company_id` claims. Requires `BETTER_AUTH_SECRET` or `PAPERCLIP_AGENT_JWT_SECRET` environment variable.

**Fixes applied before sign-off:**
1. **VOY-2200** (commit `535f75fa15`) — Structural fixes: companyId authorization boundary check + JWT expiration enforcement. Staff Engineer approved.
2. **VOY-2201 / P1 blockers** (commit `6dff29f449`) — Cross-system secret fallback (tries both `BETTER_AUTH_SECRET` and `PAPERCLIP_AGENT_JWT_SECRET`) + SSE listener leak fix (30s heartbeat + 300s connection lifetime cap).

**Verification:** All 13 auth tests pass. All 15 agent-auth-jwt tests pass.

---

## Deployment History

### Deploy Fixes (2026-08-25 ~00:55 UTC) — ALL RESOLVED

Three blockers were identified during the initial M6 deploy attempt and resolved:

1. **B1 — `background_jobs` table missing** → Worker dead (42P01). Fixed by creating Paperclip-derived tables in `travel_db`. ✅ DEPLOYED
2. **B2 — Healthcheck 404** → `/api/health` shadowed by catch-all route. Fixed by registering health route before `app.use(voyonderRouter)`. ✅ DEPLOYED
3. **B3 — Traefik certresolver** → `voyonder_api` not publicly routed with correct TLS. Fixed by adding Traefik labels with `mytlschallenge` certresolver and splitting frontend/API routers. ✅ DEPLOYED

### Current Service Health (verified ~00:55 UTC — confirmed healthy at ~01:35 UTC)

| Service | Status |
|---|---|
| voyonder.com | HTTP 200 ✅ |
| voyonder.com/api/health | HTTP 200 ✅ |
| travel.praesyn.com | HTTP 200 ✅ |
| travel.praesyn.com/api/health | HTTP 200 ✅ |

|---

## Known Issues

### Auth Routing Mismatches (VOY-2192 / M6.1)

QA verification (VOY-1985) found that all signup flows are non-functional in production due to path/method mismatches between the Next.js frontend and the Voyonder API. The frontend renders correctly and the API is healthy, but auth requests are routed to the wrong handler:

| Issue | Frontend Calls | Backend Has | Status |
|-------|---------------|-------------|--------|
| Google OAuth | `GET /api/auth/google` + `GET /api/auth/google/callback` | `POST /api/auth/signup/google` (different path & method) | ❌ Broken — tracked in VOY-2192 |
| Magic link send | `POST /api/auth/magic-link/send` | `POST /api/auth/signup/magic-link` (different path) | ❌ Broken — tracked in VOY-2192 |
| Magic link verify | `POST /api/auth/magic-link/verify` with JSON body | `GET /api/auth/magic-link/verify?token=` (302 redirect, also returns 500) | ❌ Broken — tracked in VOY-2192 |

**Root cause:** Traefik routes `PathPrefix(/api/auth)` to the Voyonder API, intercepting auth requests before the Next.js frontend's own API routes can handle them.

**Fix tracked in:** VOY-2192 (M6.1), assigned to Founding Engineer, critical priority.

**Workaround:** No user-facing workaround. Users see the signup page and pricing page, but signup submissions fail. Monitor VOY-2192 for deployment of fixes.

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STRIPE_SECRET_KEY` | Yes | — | Stripe secret key for API calls |
| `STRIPE_WEBHOOK_SECRET` | Yes | — | Webhook signing secret for event verification |
| `STRIPE_PRICE_ID` | Yes | — | Default Stripe price ID for trial subscriptions |
| `POSTHOG_API_KEY` | No | — | PostHog API key for analytics |
| `POSTHOG_HOST` | No | `https://us.posthog.com` | PostHog host URL |
| `PAPERCLIP_API_KEY` | Yes | — | Board-level API key for Paperclip integration |
| `PAPERCLIP_API_URL` | Yes | — | Paperclip API base URL |
| `BETTER_AUTH_SECRET` | Yes* | — | Used for JWT signing (*or `PAPERCLIP_AGENT_JWT_SECRET`) |

---

## Related Documentation

- [Async UX Release Notes](voy-1474-async-ux.md) — Background job framework and process visibility (M1+M2)
- [Support Case Assessment](../../../docs/support/assessments/support-case-m6-self-serve-trial.md) — Full troubleshooting guide and escalation paths
- [Google OAuth Support Assessment](../../../docs/support/assessments/support-case-google-oauth.md) — Google OAuth configuration and troubleshooting

---

*Maintained by: Support Engineer (88b72065). Updated 2026-08-25 to reflect CTO sign-off and Release Engineer deploy status for auth migration (VOY-2171). Fixed broken links to support assessments.*
