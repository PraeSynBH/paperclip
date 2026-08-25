# M6 Trial Feature — Support Case Assessment

**Status:** PUBLISHED — M6 is live in production
**Applies to:** M6 Trial Feature Release (VOY-1984)
**Version:** v0.3.0 (estimated)
**Last updated:** 2026-08-25 ~01:00 UTC
**Deployed commit:** TBD (confirm with Release Engineer)

---

## Feature Overview

M6 introduces a self-serve trial experience for new Voyonder users. Users can sign up, complete a brief onboarding wizard, and start planning trips with Sage — all without entering a credit card. After the 7-day trial, they choose a subscription plan to continue.

This is a significant change from the previous flow where users signed up through a manual process.

## What the Feature Does

### 1. Self-Serve Signup (3 methods)
Users can create an account at voyonder.com/join using any of:
- **Email + magic link** — user enters email, receives a one-time login link (expires after 15 minutes), clicks to verify and sign in
- **Google OAuth** — one-click signup with Google account (if configured in the deployment)
- **Magic link only** — no password; each login sends a new magic link

On first signup, a company is created automatically and a trial subscription is provisioned (7-day free, Explorer tier, no credit card required).

### 2. Onboarding Wizard
After signup, new users see an onboarding flow:
- **Role selection** — choose a travel role (e.g., Adventurer, Business Traveler, Family Planner, etc.)
- **Asset pack deployment** — relevant starter packs (knowledge, tools, agents) are deployed to the new company based on the selected role
- **Skip option** — users can skip onboarding and land directly on an empty dashboard

### 3. Free Trial
- **Duration:** 7 days from signup
- **Tier:** Explorer (full feature set during trial)
- **No credit card required** to start
- **Trial reminders** — users receive email reminders before trial expiry
- **Grace period** — a short grace period after trial expiry preserves user data

### 4. Trial → Paid Conversion
When the trial ends (or user proactively subscribes):
- User visits Pricing page (voyonder.com/pricing) to choose a plan
- Stripe Checkout handles the subscription
- The trial subscription row is updated to the paid subscription (ON CONFLICT on company_id, not stripe_subscription_id — closed a P0 bug where NULL subscription_id prevented conversion)
- The company transitions from `trialing` to `active`

### 5. Billing Management
- Users can manage their subscription via Stripe Customer Portal at voyonder.com/settings/billing
- View current plan, change tiers, update payment method, download invoices, cancel

### 6. Trial Expiry & Data Retention
When a trial expires:
- Company status changes from `trialing` to `expired_trial`
- A periodic sweep (`expireTrials`) handles batch expiry
- User data is **preserved** — the company can be re-activated by subscribing
- No automatic data deletion after trial expiry

### Key Architecture Changes

- **Standalone Voyonder API** (`voyonder_api`) — a new Express service running alongside the existing `travel_app` (Next.js frontend). The API handles M6-specific routes: signup, onboarding, billing webhooks, PostHog events.
- **New database tables** (in `travel_db`): `voyonder_companies`, `voyonder_users`, `voyonder_stripe_webhook_events`
- **No migration runner** in the standalone deploy — schema must be applied manually or via SQL scripts
- **PostHog integration** — signup events, onboarding completion, and conversion events are sent to PostHog for funnel analysis
- **Stripe webhooks** — `checkout.session.completed` and `subscription.updated` handlers manage the trial→paid conversion
- **Voyonder JWT auth (VOY-2171)** — the background-jobs, exports, and research API routes use `assertVoyonderAuth` instead of Paperclip's `assertAuthenticated`/`assertCompanyAccess`. The `Authorization` header must carry a Voyonder HS256 JWT (`Bearer <token>`) with `sub` (userId) and `company_id` claims. `companyId` is extracted from JWT claims, not the URL path. Requires `BETTER_AUTH_SECRET` or `PAPERCLIP_AGENT_JWT_SECRET` environment variable. **Support note:** If an API client receives 401 Unauthorized from these routes, the JWT is missing, expired, or carries invalid claims.

## Known Limitations

| # | Issue | Impact | Workaround | Status |
|---|---|---|---|---|
| 1 | No email verification for free-tier users | Users with typos in email cannot receive magic links | None — this is a planned enhancement | Known |
| 2 | Single company per email | If signup fails mid-flow (e.g., Stripe error after DB write), the user may have an orphan company they can't re-use | Contact support to clean up the orphan company | Known |
| 3 | No social login fallback | If Google OAuth is misconfigured, the button shows but fails | Use email + magic link instead | Known |
| 4 | No CAPTCHA on signup form | Potential for automated signup abuse | Rate limiting is in place but not advertised | Known |
| 5 | PostHog events best-effort | Funnel analytics may be incomplete if PostHog is unreachable | Core signup is not dependent on PostHog | Known |
| 6 | 7-day trial is fixed | Cannot extend trial period per-customer | Manual Stripe adjustment required | Support Escalate |

## Troubleshooting Guide

### User reports "voyonder.com/ returns 404" or "site is down"

**Checklist:**
1. Is the `travel_app` container running? Check `docker ps` on VPS-1.
2. Does `voyonder.com/` load? Check from a browser or `curl -I https://voyonder.com/`.
3. Is `voyonder.com/api/health` returning 200?

**Known cause:** The frontend was temporarily down during the M6 deployment on 2026-08-24 ~23:57 UTC due to a container kill and missing Traefik labels. This was resolved by the CTO at ~00:55 UTC — both the frontend and API routing have been restored.

**If still failing:** Check the CTO's latest heartbeat for current service health.

**Escalation:** Engineering (Release Engineer / CTO) — this is a deployment configuration issue.

### User cannot sign up

**Checklist:**
1. Is the user at voyonder.com/join (correct domain)?
2. Did they receive the magic link email? Check spam folder.
3. Does the magic link work? It expires after 15 minutes — request a new one.
4. Does the user already have an account? Try signing in instead.
5. Is the Voyonder API healthy? Check voyonder.com/api/health (should return 200, `api: ok`).

**Known causes:**
- **API not publicly routed** — if `voyonder_api` is not routed via Traefik, signup POSTs fail with 502/404. This was resolved in the deployment fixes at 00:55 UTC.
- **Database schema missing** — if `background_jobs` or voyonder_* tables don't exist, signup fails with database error. This was resolved in the deployment fixes.
- **Healthcheck failing** — if the container is unhealthy, the orchestrator may restart it mid-request. Check `voyonder.com/api/health`.

**Escalation:** Engineering (Founding Engineer / CTO) for deployment issues.

### Onboarding wizard freezes or skips

**Checklist:**
1. Does the user's company have a valid trial subscription? Check via DB: `SELECT status FROM voyonder_companies WHERE id = '<companyId>'`
2. Did asset packs fail to deploy? Check server logs for errors in knowledge-starter-packs deployment.
3. Did the user's browser console show errors? Ask the user to refresh and try again.

**Workaround:** The onboarding can be skipped — user lands on the dashboard with no role or starter packs. Contact support to manually deploy starter packs.

**Escalation:** Engineering if asset pack deployment consistently fails.

### Trial not converting to paid

**Checklist:**
1. Did the user complete Stripe Checkout? Check Stripe Dashboard for the session.
2. Check the webhook logs: did `checkout.session.completed` fire? Check `voyonder_stripe_webhook_events` table.
3. Did the upsert succeed? Check `voyonder_companies` — status should change from `trialing` to `active`.
4. Is the webhook endpoint reachable? Stripe needs to reach the Voyonder API at port 3101.

**Known causes:**
- **P0 bug (fixed):** ON CONFLICT on `stripe_subscription_id` missed trial rows where subscription_id is NULL. Fix changed conflict target to `company_id`. This fix is in M6 code — verify the deployed version includes commit 46a0b32003.

**Workaround:** Contact support to manually update the company's subscription status.

**Escalation:** Engineering for webhook/Stripe integration issues.

### Billing portal returns 404

**Checklist:**
1. Is the Voyonder API healthy?
2. Is the Stripe Customer Portal configured in Stripe Dashboard?
3. Does the user have a valid subscription ID in `stripe_subscription_id`?

**Known cause:** The billing portal route is served by `voyonder_api`. This was resolved in the deployment fixes — the API routing is now configured correctly.

**Escalation:** Engineering for routing configuration.

### User reports "My company was created but I can't sign in"

**Checklist:**
1. Check if the user's email exists in `voyonder_users` table.
2. Check `voyonder_companies` for orphan rows (company with no active users).
3. Request a new magic link and try again.

**Root cause:** A signup that fails mid-flow (after company creation but before user association) can leave an orphan company.

**Workaround:** Create a new account with a different email, or contact support to clean up the orphan company.

## Support Escalation Path

| Issue | Action | Escalate to |
|---|---|---|
| User can't sign up / "Something went wrong" | Verify API health (voyonder.com/api/health), check Traefik routing, check DB schema | Engineering (deployment issues) |
| Magic link not received | Check spam, verify email is correct, resend. If persistent, check email delivery service status. | Engineering (email delivery) |
| Onboarding fails | Check company subscription status, asset pack deployment logs | Engineering |
| Trial→Paid conversion fails | Verify Stripe Checkout completion, check webhook logs, verify upsert conflict target | Engineering (webhook/billing) |
| Billing portal 404 | Check Traefik routing, verify subscription ID | Engineering (routing) |
| Orphan company / duplicate signup | Manual DB cleanup of orphan `voyonder_companies` and `voyonder_users` rows | Support Engineer + Engineering |
| All other signup issues | Collect error details (browser console, network tab), verify API health | Support Engineer → Engineering |

## Deployment History

### Deploy Fixes (2026-08-25 ~00:55 UTC) — ALL RESOLVED

Three blockers were identified during the initial M6 deploy attempt and resolved:

1. **B1 — `background_jobs` table missing** → Worker dead (42P01). Fixed by creating Paperclip-derived tables in `travel_db` via SQL script. ✅ DEPLOYED
2. **B2 — Healthcheck 404** → `/api/health` shadowed by catch-all route. Fixed by registering health route before `app.use(voyonderRouter)`. ✅ DEPLOYED
3. **B3 — Traefik routing** → `voyonder_api` not publicly routed. Fixed by adding Traefik labels with correct certresolver and splitting frontend/API routers. ✅ DEPLOYED

### Frontend Restored
The `travel_app` container was killed during the initial deploy. Restarted and correctly routed via Traefik. ✅

### Current Service Health (verified ~00:55 UTC)
| Service | Status |
|---|---|
| voyonder.com | HTTP 200 ✅ |
| voyonder.com/api/health | HTTP 200 ✅ |
| travel.praesyn.com | HTTP 200 ✅ |
| travel.praesyn.com/api/health | HTTP 200 ✅ |

### Known Remaining Issues
- **LE cert renewal:** The pre-existing Let's Encrypt certificate (issued Jul 27, expires Oct 25) is still in use. When it expires, TLS renewal will fail unless the certresolver configuration is corrected to `mytlschallenge` (the committed fix is correct, but verify the deployed config matches commit 8fb4d72).
- **Intermittent frontend container kill:** The `travel_app` container was killed at 00:51 UTC for unknown reasons. Root cause needs investigation — may be a deploy script race condition or manual intervention.

## Version Tracking
- **Release version:** v0.3.0 (expected)
- **Deployed commit:** TBD (when confirmed by Release Engineer)
- **Documentation version:** This document tracks the deployed state. Update with actual commit hash after confirmation.

## Monitoring

- **Health endpoint:** voyonder.com/api/health should return `{"status":"ok","api":"healthy","dependencies":{...}}`
- **Signup flow:** Run through the full signup → magic link → onboarding → trial → pricing → Stripe Checkout flow manually after deployment
- **Webhook delivery:** Monitor `voyonder_stripe_webhook_events` table for successful webhook receipts
- **Error tracking:** Sentry (if configured) for unhandled exceptions in the Voyonder API
- **PostHog:** Verify signup events appear in PostHog dashboard