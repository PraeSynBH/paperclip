# M6 Trial Feature — Support Case Assessment (DRAFT)

**Status:** DRAFT — awaiting production deployment
**Applies to:** M6 Trial Feature Release (VOY-1984)
**Version:** v0.3.0 (estimated)
**Last updated:** 2026-08-24

---

## Feature Overview

M6 introduces a self-serve trial experience for new Voyonder users. Users can sign up, complete a brief onboarding wizard, and start planning trips with Sage — all without entering a credit card. After the 7-day trial, they choose a subscription plan to continue.

This is a significant change from the previous flow where users signed up through a manual process.

## What the Feature Does

### 1. Self-Serve Signup (3 methods)
Users can create an account at voyonder.com/join using any of:
- **Email + magic link** — user enters email, receives a one-time login link (expires after 15 minutes), clicks to verify and sign in
- **Google OAuth** — one-click signup with Google account ( if configured in thedeployment)
- **Magic link only** — no password; each login sends a new magic link

On first signup, a company is created automatically and a trial subscription isprovisioned (7-day free, Explorer tier, no credit card required).

### 2. Onboarding Wizard
After signup, new users see an onboarding flow:
- **Role selection** — choose a travel role (e.g., Adventurer, BusinessTraveler, Family Planner, etc.)
- **Asset pack deployment** — relevant starter packs (knowledge, tools,agents) are deployed to the new company based on the selected role
- **Skip option** — users can skip onboarding and land directly on an emptydashboard

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
- The trial subscription row is updated to the paid subscription (ONCONFLICT on company_id, not stripe_subscription_id — closed a P0 bug whereNULL subscription_id prevented conversion)
- The company transitions from `trialing` to `active`

### 5. Billing Management
- Users can manage their subscription via Stripe Customer Portal atvoyonder.com/settings/billing
- View current plan, change tiers, update payment method, download invoices,cancel

### 6. Trial Expiry & Data Retention
When a trial expires:
- Company status changes from `trialing` to `expired_trial`
- A periodic sweep (`expireTrials`) handles batch expiry
- User data is **preserved** — the company can be re-activated bysubscribing
- No automatic data deletion after trial expiry

## Key Architecture Changes

- **Standalone Voyonder API** (`voyonder_api`) — a new Express service runningalongside the existing `travel_app` (Next.js frontend). The API handlesM6-specific routes: signup, onboarding, billing webhooks, PostHog events.
- **New database tables** (in `travel_db`): `voyonder_companies`,`voyonder_users`, `voyonder_stripe_webhook_events`
- **No migration runner** in the standalone deploy — schema must be appliedmanually or via SQL scripts
- **PostHog integration** — signup events, onboarding completion, andconversion events are sent to PostHog for funnel analysis
- **Stripe webhooks** — `checkout.session.completed` and`subscription.updated` handlers manage the trial→paid conversion

## Known Limitations

| # | Issue | Impact | Workaround | Status |
|---|---|---|---|---|
| 1 | No email verification for free-tier users | Users with typos in email cannot receivemagic links | None — this is a planned enhancement | Known |
| 2 | Single company per email | If signup fails mid-flow (e.g., Stripeerror after DB write), the user may havean orphan company they can't re-use | Contact support to clean up theorphan company | Known |
| 3 | No social login fallback | If Google OAuth is misconfigured, thebutton shows but fails | Use email + magic link instead | Known |
| 4 | No CAPTCHA on signup form | Potential for automated signup abuse | Rate limiting is in place but notadvertised | Known |
| 5 | PostHog events best-effort | Funnel analytics may be incomplete ifPostHog is unreachable | Core signup is not dependent onPostHog | Known |
| 6 | 7-day trial is fixed | Cannot extend trial period per-customer | Manual Stripe adjustment required | SupportEscalate |

## Troubleshooting Guide

### User cannot sign up

**Checklist:**
1. Is the user at voyonder.com/join (correct domain)?
2. Did they receive the magic link email? Check spam folder.
3. Does the magic link work? It expires after 15 minutes — request a new one.
4. Does the user already have an account? Try signing in instead.
5. Is the Voyonder API healthy? Check voyonder.com/api/health (should return200, `api: ok`).

**Known causes:**
- **API not publicly routed (M6 deploy blocker B3)** — if `voyonder_api` isnot routed via Traefik, signup POSTs fail with 502/404. This is a deploymentconfiguration issue.
- **Database schema missing (M6 deploy blocker B1)** — if`background_jobs` or voyonder_* tables don't exist, signup fails withdatabase error. This is a deployment configuration issue.
- **Healthcheck failing (M6 deploy blocker B2)** — if the container isunhealthy, the orchestrator may restart it mid-request. Check`voyonder.com/api/health`.

**Escalation:** Engineering (Founding Engineer / CTO) for deployment issues.

### Onboarding wizard freezes or skips

**Checklist:**
1. Does the user's company have a valid trial subscription? Check via DB:`SELECT status FROM voyonder_companies WHERE id = '<companyId>'`
2. Did asset packs fail to deploy? Check server logs for errors inknowledge-starter-packs deployment.
3. Did the user's browser console show errors? Ask the user to refresh and tryagain.

**Workaround:** The onboarding can be skipped — user lands on the dashboardwith no role or starter packs. Contact support to manually deploy starterpacks.

**Escalation:** Engineering if asset pack deployment consistently fails.

### Trial not converting to paid

**Checklist:**
1. Did the user complete Stripe Checkout? Check Stripe Dashboard for thesession.
2. Check the webhook logs: did`checkout.session.completed` fire? Check`voyonder_stripe_webhook_events` table.
3. Did the upsert succeed? Check `voyonder_companies` — status should changefrom `trialing` to `active`.
4. Is the webhook endpoint reachable? Stripe needs to reach the Voyonder APIat port 3101.

**Known causes:**
- **P0 bug (fixed):** ON CONFLICT on `stripe_subscription_id` missed trialrows where subscription_id is NULL. Fix changed conflict target to`company_id`. This fix is in M6 code but verify the deployed versionincludes commit 46a0b32003.

**Workaround:** Contact support to manually update the company's subscription status.

**Escalation:** Engineering for webhook/Stripe integration issues.

### Billing portal returns 404

**Checklist:**
1. Is the Voyonder API healthy?
2. Is the Stripe Customer Portal configured in Stripe Dashboard?
3. Does the user have a valid subscription ID in `stripe_subscription_id`?

**Known cause:** The billing portal route is served by `voyonder_api` — ifTraefik routing is not configured (M6 deploy blocker B3), this endpoint isunreachable.

**Escalation:** Engineering for routing configuration.

### User reports "My company was created but I can't sign in"

**Checklist:**
1. Check if the user's email exists in `voyonder_users` table.
2. Check `voyonder_companies` for orphan rows (company with no active users).
3. Request a new magic link and try again.

**Root cause:** A signup that fails mid-flow (after company creation but beforeuser association) can leave an orphan company.

**Workaround:** Create a new account with a different email, or contactsupport to clean up the orphan company.

## Support Escalation Path

| Issue | Action | Escalate to |
|---|---|
| User can't sign up / "Something went wrong" | Verify API health (voyonder.com/api/health), check Traefik routing, check DB schema | Engineering (deployment issues) |
| Magic link not received | Check spam, verify email is correct, resend. If persistent, check email delivery service status. | Engineering (email delivery) |
| Onboarding fails | Check company subscription status, asset pack deployment logs | Engineering |
| Trial→Paid conversion fails | Verify Stripe Checkout completion, check webhook logs, verify upsert conflict target | Engineering (webhook/billing)|
| Billing portal 404 | Check Traefik routing, verify subscription ID | Engineering (routing) |
| Orphan company / duplicate signup | Manual DB cleanup of orphan `voyonder_companies` and `voyonder_users` rows | Support Engineer + Engineering |
| All other signup issues | Collect error details (browser console, network tab), verify API health | Support Engineer → Engineering |

## Release-Specific Notes

### Deploy Blockers (CTO Assessment 2026-08-24, commit 08a9cd4483)
Three blockers were identified on VPS-1 at 22:35 UTC:

1. **B1 — `background_jobs` table missing** → worker dead (42P01). Requirescreating Paperclip-derived tables in `travel_db` via SQL script.
2. **B2 — Healthcheck 404** → `/api/health` is shadowed by catch-all route.Fix:register health before `app.use(voyonderRouter)`, or use `/healthz` path.
3. **B3 — voyonder_api not routed via Traefik** → M6 endpoints unreachablepublicly. Requires adding Traefik labels for `Host(voyonder.com) &&PathPrefix(/api)` → voyonder_api:3101.

All three must be resolved before M6 is considered live.

### Version Tracking
- **Release version:** v0.3.0 (expected)
- **Deployed commit:** TBD (when release goes live)
- **Documentation version:** This document should be updated with the actualcommit hash after deployment.

## Monitoring

- **Health endpoint:** voyonder.com/api/health should return `{"status":"ok","api":"healthy","dependencies":{...}}`
- **Signup flow:** Run through the full signup → magic link → onboarding →trial → pricing → Stripe Checkout flow manually after deployment
- **Webhook delivery:** Monitor `voyonder_stripe_webhook_events` table forsuccessful webhook receipts
- **Error tracking:** Sentry (if configured) for unhandled exceptions in theVoyonder API
- **PostHog:** Verify signup events appear in PostHog dashboard