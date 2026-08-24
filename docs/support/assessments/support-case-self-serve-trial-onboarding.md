# Support Case Assessment: M6 Self-Serve Trial Onboarding

**Feature**: Self-serve trial sign-up and onboarding flow — new users can register, get a company created automatically, and start a 14-day free trial without human intervention
**Assessed by**: Support Engineer
**Date**: 2026-08-24 (updated for must-fix patches + VOY-2117)
**Related**: M6 — Self-Serve Trial Onboarding
**Commits** (current branch hashes): `b9c4421d68`, `bfa59dca75`, `8955560a1c`, `91a2aded05`, `3f21a3d6b2`, `d37fb3db22`, `5dd66e815f`, `10fb10a2e8`, `b5bc7e4d45`, `3885b6b5f0`
**Branch**: `feat/m6-self-serve-trial-onboarding`
**PR**: #78 — OPEN, mergeable (base: master)

## Feature Overview (User Perspective)

Paperclip now offers a true self-serve onboarding experience. New users who sign up via the authentication page (better-auth) are automatically registered with a company and placed on a 14-day free trial — no sales call, no credit card required, no manual provisioning.

**What users experience:**

1. **Sign up** — User creates an account via the Auth page
2. **Auto-registration** — After sign-up, the system automatically creates a company (default name: "My Company"), starts a 14-day trial, and redirects the user into the app
3. **Trial awareness** — A banner at the top of the layout tells the user how many trial days remain. A compact "Trial · Xd" badge appears in nav/header contexts
4. **Expired state** — When the trial ends, the banner switches to an "expired" state with a link to /pricing to choose a plan
5. **Choose a plan** — Users can upgrade to a paid tier at any time via /pricing (Stripe Checkout, requiring Stripe to be configured)

### Trial Tier Limits

| Resource | Included |
|----------|----------|
| Seats | 1 seat |
| Agent runs | 100 runs |
| Storage | 1 GB |
| Features | AI trip planning, basic itinerary, 1 agent |

## What Changed

### 1. Registration Flow (`POST /api/auth/complete-registration`)

A new endpoint completes the registration flow after better-auth creates the user session:

- **Creates a company** with an optional `companyName` (defaults to "My Company")
- **Ensures owner membership** — the registering user is added as an `owner` with full grants
- **Starts a trial** — calls `billingService.startTrial()` with a configurable `trialDays` (default 14)
- **Logs activity** — a `company.created` activity entry with source `self_serve_registration`
- **Idempotent** — if the user already has a company, returns it without creating a duplicate

**Request:**
```json
POST /api/auth/complete-registration
{
  "companyName": "Acme Corp",   // optional, max 100 chars
  "trialDays": 14               // optional, min 1, max 90
}
```

**Response (201):**
```json
{
  "companyId": "uuid",
  "companyName": "Acme Corp",
  "companyPrefix": "ACME",
  "created": true
}
```

**Response when company already exists (200):**
```json
{
  "companyId": "uuid",
  "companyName": "Existing Co",
  "created": false
}
```

### 2. Trial Management API

**`POST /api/companies/:companyId/billing/start-trial`** — Start a trial for an existing company (idempotent, board-user only, uses `ON CONFLICT` for race safety)

**`GET /api/companies/:companyId/billing/trial-info`** — Get trial status

Response when trialing:
```json
{
  "trialing": true,
  "trialEnd": "2026-09-06T10:38:26.000Z",
  "daysRemaining": 13,
  "expired": false
}
```

Response when not on trial (including expired):
```json
null
```

### 3. Trial Expiry Reaper

A background interval runs every 30 minutes that:
- Queries all subscriptions with status `trialing` whose `trial_end` is in the past
- Sets their status to `past_due` — this blocks access to paid-tier features via the existing feature-gating infrastructure
- Publishes a `subscription.status.updated` live event for each expired subscription
- Also runs once on server startup

### 4. Trial Tier Seed Data

A new `Trial` subscription tier is seeded into the database:

| Field | Value |
|-------|-------|
| Name | `Trial` |
| Description | "Free 14-day trial — explore Paperclip AI agents with basic features." |
| Price | Free ($0) |
| Included seats | 1 |
| Included agent runs | 100 |
| Included storage | 1 GB |
| Features | `ai_trip_planning`, `basic_itinerary`, `1_agent` |
| Sort order | 0 (lowest) |

### 5. UI Components

**`TrialBanner`** — Full-width alert banner displayed in the layout:
- When trialing: amber-colored banner showing "You're on a free trial. X days remaining — Choose a plan when you're ready."
- When expired: red-toned banner showing "Your trial has ended. Upgrade now to continue using Paperclip."
- Both states include a link to `/pricing`
- Renders nothing when not on trial (clean null state)

**`TrialBadge`** — Compact inline badge:
- Shows "Trial · Xd" in header/nav contexts
- Only visible when actively trialing (not expired)
- Uses a `Sparkles` icon for visual indication

**Auto-polling** — Both components poll `trial-info` every 60 seconds for live status updates via `@tanstack/react-query` with `refetchInterval: 60_000`

**Layout integration** — `TrialBanner` is mounted in `Layout.tsx` after `WorktreeBanner` and `DevRestartBanner`. `TrialBadge` can be used in nav contexts.

### 6. Client-Side API Client

- `billingApi.trialInfo(companyId)` — GET request returning trial info or null
- `billingApi.startTrial(companyId, { trialDays })` — POST request for manual trial start
- `authApi.completeRegistration(data)` — POST request for registration completion
- `queryKeys.billing.trialInfo(companyId)` — React Query cache key for consistent invalidation

### 7. Auth Page Update

`Auth.tsx` now calls `completeRegistration()` automatically after successful sign-up and redirects the user to the new company's onboarding page — no manual company creation step.

## Known Limitations & Edge Cases

| Limitation | Details | Workaround |
|-----------|---------|------------|
| **Stripe not required for trial** | The trial system works without Stripe configured — it creates a local placeholder customer. However, upgrading to a paid plan requires Stripe to be configured | Configure `STRIPE_SECRET_KEY` and related env vars before going live |
| **Trial start failure is non-fatal** | If `startTrial()` fails during registration (e.g., DB error), the company is still created and the user is logged in — they just won't be on a trial | Check server logs for `"Failed to start trial (non-fatal)"` message. Support can manually start a trial via the API |
| **No email notifications** | The system does not send email reminders when a trial is about to expire or has expired | Users discover expiration when they see the banner or try to use a paid feature |
| **Single-trial enforcement** | There is no mechanism to prevent the same email from starting multiple trials across different sessions | The idempotency check (user company membership) prevents duplicates for the same user, but a different email could create a second trial |
| **Trial-to-paid conversion** | There is no automated conversion flow. Users must manually visit /pricing and subscribe via Stripe Checkout | Future feature — automated conversion on trial end |
| **Trial-to-paid conversion crash** (VOY-2117, fixed in `3885b6b5f0`) | Before the fix, subscribing via Stripe Checkout while on a trial caused a database `unique constraint` error. The trial row has `stripe_subscription_id = NULL`; the upsert targeted `stripe_subscription_id`, and SQL NULL comparison semantics caused it to miss the trial row, attempting an INSERT for a second subscription row for the same company | Fixed by changing the upsert conflict target to `company_id`. Both webhook handlers now correctly match the trial row and update it with Stripe subscription details. If a user reports this error after the fix was deployed, escalate to CTO — it indicates a regression |
| **TrialDays max 90** | The `trialDays` field is limited to 90 days by the Zod schema | For longer trials, admins can directly set up a subscription |
| **Reaper delay** | The trial expiry reaper runs every 30 minutes. Expired trials may have up to 30 minutes of grace access | This is intentional — prevents hard cutoffs. The `past_due` status blocks paid features but doesn't delete data |

## Troubleshooting

### Symptom: User registers but doesn't get a trial

1. Check server logs for `"Failed to start trial (non-fatal)"` — this indicates the trial creation failed but company was still created
2. Verify the `Trial` tier exists: `SELECT * FROM subscription_tiers WHERE name = 'Trial';`
3. Manually start a trial: `POST /api/companies/:companyId/billing/start-trial`
4. Check if the trial was already started but the UI wasn't updated (refresh the page)

### Symptom: Trial-to-paid conversion fails with unique constraint error (VOY-2117)

**Note:** This is fixed in commit `3885b6b5f0`. If a user reports this error after the fix was deployed, it indicates a regression.

Before the fix, subscribing via Stripe Checkout while on a trial would crash with a database unique constraint error. The root cause: the trial row has `stripe_subscription_id = NULL`, and the upsert used `ON CONFLICT (stripe_subscription_id)`. SQL NULL comparison semantics mean `NULL = 'sub_abc'` evaluates to NULL (not TRUE), so the conflict didn't match the trial row, and the INSERT attempted to create a second subscription for the same company.

**If a user reports this error:**

1. Verify the fix commit `3885b6b5f0` is deployed on the server
2. Check the server logs for PostgreSQL unique constraint violations on `company_subscriptions.company_id`
3. If the fix is deployed and the error persists, escalate to CTO — it indicates a regression
4. Temporarily resolve by updating the existing trial row directly:
   ```sql
   UPDATE company_subscriptions
   SET stripe_subscription_id = 'sub_<id>',
       status = 'active',
       tier_id = '<new-tier-uuid>',
       updated_at = NOW()
   WHERE company_id = '<companyId>' AND stripe_subscription_id IS NULL;
   ```

### Symptom: Trial banner not showing

1. Verify the user's company has a subscription with status `trialing`:
   ```sql
   SELECT * FROM company_subscriptions WHERE company_id = '<companyId>';
   ```
2. Check that `trialEnd` is set and in the future
3. Verify the UI is using the correct company context (`useCompany()`)
4. Check browser console for React Query errors on the `trialInfo` endpoint

### Symptom: User's trial says expired but they should still have time

1. Check the `trial_end` value in `company_subscriptions` — it may have been set incorrectly
2. The reaper's 30-minute interval may have run early if the trial was created with a short `trialDays`
3. Manually update: `UPDATE company_subscriptions SET status = 'trialing' WHERE company_id = '<companyId>';`

### Symptom: User can access paid features after trial expires

- The `past_due` status blocks paid features via feature gating. If a user still has access, verify:
  1. The reaper ran: check server logs for `"Trial reaper expired subscriptions"`
  2. The `past_due` status is properly integrated with feature gating
  3. The user may be within the 30-minute reaper window

## Support Escalation Path

| Issue | Escalate To | Contact |
|-------|-------------|---------|
| Trial not starting on registration | Engineering | Slack #eng-billing |
| Stripe integration needed for upgrade | Engineering/DevOps | Slack #eng-infra |
| Extending trial days (above 90) | Board operator / Admin | Direct DB update |
| Bulk trial provisioning | COO / Sales | #sales channel |

## Verification Checklist

- [ ] New sign-up creates company + trial subscription
- [ ] Trial banner shows correct days remaining
- [ ] TrialBadge renders in nav context
- [ ] Banner shows expired state after trial end
- [ ] Reaper transitions expired trials to `past_due` within 30 minutes
- [ ] Trial tier limits (1 seat, 100 runs, 1 GB) are enforced
- [ ] Idempotency — same user cannot create multiple companies
- [ ] Existing company's `startTrial` returns existing subscription (idempotent)
- [ ] No trial banner when subscription is not `trialing`
- [ ] Pricing page is accessible from trial banner links
