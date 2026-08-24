---
title: M6 — Self-Serve Trial Onboarding
version: m6-self-serve-trial
date: 2026-08-23
commits: d344d832e0, 996136bc66, 722b0c4cbd, 042d68662d, b0d5b9c7ee, f4e882dc04, eaba9ea1c8, 5353666316
status: BRANCH — feat/clean-m5-pricing-pr (cherry-picked from feat/m6-self-serve-trial-onboarding)
---

# M6 — Self-Serve Trial Onboarding

**Branch:** `feat/clean-m5-pricing-pr` (cherry-picked from `feat/m6-self-serve-trial-onboarding`)
**Commits:**
- `d344d832e0` — feat(m6): implement self-serve trial and onboarding flow
- `996136bc66` — feat(m6): add trial expiry reaper — 30-minute interval sweep (superseded by eaba9ea1c8)
- `722b0c4cbd` — fix(m6): resolve merge conflict in complete-registration route
- `042d68662d` — feat(m6): add trial status banner component
- `b0d5b9c7ee` — feat(m6): add trialInfo and startTrial to billing API client + query keys
- `f4e882dc04` — feat(m6): add onboarding wizard (role selection, status, skip) + migrations
- `eaba9ea1c8` — feat(trial): add self-serve trial endpoints (start, status, convert) — dedicated trial router + improved reaper
- `5353666316` — test(trial): add trial-reaper sweep tests (C1 expiry sweep)
**Date:** 2026-08-23 (updated 2026-08-24)
**Status:** Feature branch — ready for release to main
**Related:** M6 Milestone — Self-Serve Trial Onboarding

---

## Summary

Paperclip now supports self-serve trial onboarding. New users can sign up, get a company created automatically, and start a 14-day free trial — no sales call, no credit card, no manual provisioning. A trial banner keeps users informed of their remaining days, and expired trials gracefully degrade to limited access. A guided onboarding wizard helps users select their role and get started with an initial agent, goal, project, and task.

## What Changed

### New: Self-Serve Registration (`POST /api/auth/complete-registration`)

After signing up via the authentication page, users are automatically:
- Provisioned with a company (optional custom name, defaults to "My Company")
- Added as an **owner** with full grants
- Started on a **14-day free trial** (trial duration is fixed at 14 days; accepts `billingPeriod`: `"monthly"` or `"yearly"`)
- Redirected into the app — no manual company creation step

The endpoint is **idempotent**: if the user already has a company, it returns the existing one.

### New: Trial Management API (Updated)

The trial endpoints have been moved from the billing router to a dedicated trial router. The API paths and response shapes have changed.

| Endpoint | Description | Auth Required |
|----------|-------------|---------------|
| `POST /api/companies/:companyId/trial/start` | Start a 14-day trial for an existing company (idempotent). Accepts `{ billingPeriod: "monthly" \| "yearly" }`. Returns `201` on creation, `200` if a subscription already exists. | Any authenticated user with company access |
| `GET /api/companies/:companyId/trial/status` | Returns trial status — `isTrialing`, `trialEnd`, `daysRemaining`, `tierId`, `tierName`, `status` | Company-scoped access |
| `POST /api/companies/:companyId/trial/convert` | Create a Stripe Checkout Session to convert from trial to a paid subscription. Accepts `{ tierId, billingPeriod }`. Returns `{ url, sessionId }`. | Company-scoped access |

**Note:** The old paths (`/billing/trial-info`, `/billing/start-trial`) are removed. Clients should use the new `/trial/start`, `/trial/status`, and `/trial/convert` endpoints.

### New: Trial Tier

A `Trial` subscription tier has been added:

- **Price:** Free ($0)
- **Includes:** 1 seat, 100 agent runs, 1 GB storage
- **Features:** AI trip planning, basic itinerary, 1 agent
- **Duration:** 14 days (fixed — not configurable per-request)

### New: Trial Expiry Reaper (Updated)

A background job runs on startup and every **1 hour** (configurable via `intervalMs` parameter) that performs a two-phase sweep:

**Phase 1 — Expired trials → grace period:**
- Finds subscriptions with status `trialing` whose `trialEnd` is in the past
- Sets their status to `grace_period` (extends data access for 7 days)
- Publishes `subscription.status.updated` live event with status `grace_period`

**Phase 2 — Expired grace period → expired:**
- Finds subscriptions in `grace_period` whose `currentPeriodEnd` is in the past
- Sets their status to `expired`, records `canceledAt`
- Publishes `subscription.status.updated` live event with status `expired`

The reaper is a **safety net** supplementing Stripe's webhook-triggered `handlePostTrialStatus` logic. If Stripe fails to deliver a webhook, or the webhook handler fails mid-transaction, the reaper catches the transition on its next sweep.

### New: UI Trial Indicators

- **Trial Banner** — Full-width alert banner in the layout showing days remaining or expired state, with a link to the pricing page
- **Trial Badge** — Compact inline badge for headers/nav ("Trial · Xd")
- **Auto-refresh** — Both components poll `trial/status` every 60 seconds for live status updates

### New: API Client & Query Keys

- `billingApi.trialInfo()` and `billingApi.startTrial()` — (update pending to match new `/trial/*` paths)
- `authApi.completeRegistration()` for the registration flow
- `queryKeys.billing.trialInfo` for consistent React Query cache management

### New: Onboarding Wizard (Role Selection)

Three new endpoints guide users through company setup:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/companies/:companyId/onboarding/status` | GET | Returns current onboarding state (`pending`, `completed`, `skipped`) |
| `/api/companies/:companyId/onboarding/role` | POST | Select a role — creates an agent, company-level goal, onboarding project, and first task |
| `/api/companies/:companyId/onboarding/skip` | POST | Skip onboarding and land on the empty dashboard |

The wizard is presented immediately after registration. Role selection is idempotent (TOCTOU-safe with `FOR UPDATE` locking) and creates:
- An **agent** with the selected role's label
- A **company-level goal** matching the role title
- An **"Onboarding" project** linked to the goal
- A **first task** ("Get started with {RoleLabel}") assigned to the new agent

Once completed or skipped, the choice is final (409 Conflict on reattempt).

### New: DB Schema Changes

- Migration **0231** — adds `onboarding_status`, `onboarding_selected_role`, and `onboarding_completed_at` columns to the `companies` table
- Migration **0232** — seeds the `Trial` subscription tier (free, configurable limits)

### New: Activity Logging

- `company.onboarding_role_selected` — logged when a role is chosen
- `company.onboarding_skipped` — logged when onboarding is skipped

## Migration Notes

- **Database Migrations:** Two new migrations are included:
  - **0231** — adds onboarding status columns to `companies` table (idempotent, `ADD COLUMN IF NOT EXISTS`)
  - **0232** — seeds the `Trial` subscription tier (idempotent, `ON CONFLICT (name) DO NOTHING`)
- **No destructive changes:** Existing subscriptions and companies are unaffected
- **Configuration:** Stripe setup is optional for trials but required for upgrade to paid plans
- **Trial reaper:** Starts automatically on server boot. Default 1-hour interval can be configured by passing `intervalMs` to `startTrialReaperScheduler()`

## Rollback

To disable self-serve trial onboarding:

1. Remove or revert the `completeRegistration` call in `Auth.tsx`
2. The trial API endpoints can be removed by reverting the trial route additions in `app.ts` and removing `server/src/routes/trial.ts`
3. Disable the trial reaper by removing the `trialReaperDisposer` call in `app.ts`
4. Trial subscriptions can be managed manually via SQL

## Known Issues

- No email notification on trial expiry (future improvement)
- No automated trial-to-paid conversion flow (future improvement)
- No multi-email trial enforcement (users could sign up with different emails for multiple trials)
- Reaper and Stripe webhook `handlePostTrialStatus` may race: the reaper transitions to `grace_period` on sweep, while the webhook handler also sets `grace_period`. Last write wins — both transitions are idempotent and preserve data access
