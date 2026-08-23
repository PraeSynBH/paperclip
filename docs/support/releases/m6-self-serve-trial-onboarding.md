---
title: M6 — Self-Serve Trial Onboarding
version: m6-self-serve-trial
date: 2026-08-23
commits: d344d832e0, 996136bc66, 722b0c4cbd, 042d68662d, b0d5b9c7ee, f4e882dc04
status: BRANCH — feat/clean-m5-pricing-pr (cherry-picked from feat/m6-self-serve-trial-onboarding)
---

# M6 — Self-Serve Trial Onboarding

**Branch:** `feat/clean-m5-pricing-pr` (cherry-picked from `feat/m6-self-serve-trial-onboarding`)
**Commits:**
- `d344d832e0` — feat(m6): implement self-serve trial and onboarding flow
- `996136bc66` — feat(m6): add trial expiry reaper — 30-minute interval sweep
- `722b0c4cbd` — fix(m6): resolve merge conflict in complete-registration route
- `042d68662d` — feat(m6): add trial status banner component
- `b0d5b9c7ee` — feat(m6): add trialInfo and startTrial to billing API client + query keys
- `f4e882dc04` — feat(m6): add onboarding wizard (role selection, status, skip) + migrations
**Date:** 2026-08-23
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

## Rollback

To disable self-serve trial onboarding:

1. Remove or revert the `completeRegistration` call in `Auth.tsx`
2. The trial API endpoints can be removed by reverting the billing route additions
3. Trial subscriptions can be managed manually via SQL

## Known Issues

- No email notification on trial expiry (future improvement)
- No automated trial-to-paid conversion flow (future improvement)
- No multi-email trial enforcement (users could sign up with different emails for multiple trials)
