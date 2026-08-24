---
title: M6 — Self-Serve Trial Onboarding
|version: m6-self-serve-trial
|date: 2026-08-23 (updated 2026-08-23 ~23:30 UTC)
|commits: b9c4421d68, bfa59dca75, 8955560a1c, 91a2aded05, 3f21a3d6b2
|status: PR #78 — OPEN, MERGEABLE (base: master)
---

# M6 — Self-Serve Trial Onboarding

**Branch:** `feat/m6-self-serve-trial-onboarding`
**Commits (current branch hashes):**
- `b9c4421d68` — feat(m6): implement self-serve trial and onboarding flow
- `bfa59dca75` — feat(m6): add trial expiry reaper — 30-minute interval sweep
- `8955560a1c` — fix(m6): resolve merge conflict in complete-registration route
- `91a2aded05` — feat(m6): add trial status banner component
- `3f21a3d6b2` — feat(m6): add trialInfo and startTrial to billing API client + query keys
- `3885b6b5f0` — fix(billing): change ON CONFLICT target from stripe_subscription_id to company_id for trial-to-paid conversion (VOY-2117)
**Date:** 2026-08-24 (updated for VOY-2117 fix)
**Status:** PR #78 open (base: master) — mergeable, no conflicts
**Related:** M6 Milestone — Self-Serve Trial Onboarding

---

## Summary

Paperclip now supports self-serve trial onboarding. New users can sign up, get a company created automatically, and start a 14-day free trial — no sales call, no credit card, no manual provisioning. A trial banner keeps users informed of their remaining days, and expired trials gracefully degrade to limited access.

## What Changed

### New: Self-Serve Registration (`POST /api/auth/complete-registration`)

After signing up via the authentication page, users are automatically:
- Provisioned with a company (optional custom name, defaults to "My Company")
- Added as an **owner** with full grants
- Started on a **14-day free trial** (configurable, max 90 days)
- Redirected into the app — no manual company creation step

The endpoint is **idempotent**: if the user already has a company, it returns the existing one.

### New: Trial Management API

| Endpoint | Description | Auth Required |
|----------|-------------|---------------|
| `GET /api/companies/:companyId/billing/trial-info` | Returns trial status — `trialing`, `daysRemaining`, `expired`, `trialEnd` | Company-scoped access |
| `POST /api/companies/:companyId/billing/start-trial` | Manually start a trial for an existing company (idempotent) | Board user |

### New: Trial Tier

A `Trial` subscription tier has been added:

- **Price:** Free ($0)
- **Includes:** 1 seat, 100 agent runs, 1 GB storage
- **Features:** AI trip planning, basic itinerary, 1 agent
- **Duration:** 14 days (configurable)

### New: Trial Expiry Reaper

A background job runs every **30 minutes** (and once on startup) that:
- Finds expired `trialing` subscriptions
- Sets their status to `past_due`, blocking paid-tier features
- Publishes live events so the UI updates in real time

### New: UI Trial Indicators

- **Trial Banner** — Full-width alert banner in the layout showing days remaining or expired state, with a link to the pricing page
- **Trial Badge** — Compact inline badge for headers/nav ("Trial · Xd")
- **Auto-refresh** — Both components poll `trial-info` every 60 seconds for live status updates

### New: API Client & Query Keys

- `billingApi.trialInfo()` and `billingApi.startTrial()` added to the billing API client
- `authApi.completeRegistration()` for the registration flow
- `queryKeys.billing.trialInfo` for consistent React Query cache management

## Migration Notes

- **Database:** The `Trial` tier is seeded via `002_subscription_tiers.sql` — it's idempotent (`WHERE NOT EXISTS`), safe to run on existing databases
- **No destructive changes:** Existing subscriptions and companies are unaffected
- **Configuration:** Stripe setup is optional for trials but required for upgrade to paid plans

## Rollback

To disable self-serve trial onboarding:

1. Remove or revert the `completeRegistration` call in `Auth.tsx`
2. The trial API endpoints can be removed by reverting the billing route additions
3. Trial subscriptions can be managed manually via SQL

## Known Issues

- No email notification on trial expiry (future improvement)
- No automated trial-to-paid conversion flow (future improvement)
- No multi-email trial enforcement (users could sign up with different emails for multiple trials)

## Fixes

- **VOY-2117: Trial-to-paid conversion crash** (commit `3885b6b5f0`) — Subscribing via Stripe Checkout while on a trial no longer crashes with a unique constraint violation. The upsert conflict target was changed from `stripe_subscription_id` to `company_id` because the trial row has `stripe_subscription_id = NULL`, and SQL NULL comparison semantics prevented the conflict match. Both `handleCheckoutSessionCompleted` and `handleSubscriptionUpdated` now correctly match the trial row and update it with Stripe subscription details.
