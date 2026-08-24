# Support Case Assessment: M6 Self-Serve Trial Onboarding

**Feature**: Self-serve trial sign-up and onboarding flow — new users can register, get a company created automatically, and start a 14-day free trial without human intervention. Trial expiry transitions through a 7-day grace period (`grace_period` status) before reaching `expired`, preserving user data throughout. An onboarding wizard guides role selection (or skip) to set up the initial agent, goal, project, and task.
**Assessed by**: Support Engineer
**Date**: 2026-08-24 (updated for trial router refactor + reaper rewrite)
**Related**: M6 — Self-Serve Trial Onboarding, Trial Grace Period (added alongside M5 billing enhancements)
**Commits**: `d344d832e0`, `996136bc66`, `722b0c4cbd`, `042d68662d`, `b0d5b9c7ee`, `f4e882dc04`, `eaba9ea1c8` (trial routes refactor), `5353666316` (reaper tests)
**Branch**: `feat/clean-m5-pricing-pr`

## Feature Overview (User Perspective)

Paperclip now offers a true self-serve onboarding experience. New users who sign up via the authentication page (better-auth) are automatically registered with a company and placed on a 14-day free trial — no sales call, no credit card required, no manual provisioning.

**What users experience:**

1. **Sign up** — User creates an account via the Auth page
2. **Auto-registration** — After sign-up, the system automatically creates a company (default name: "My Company"), starts a 14-day trial, and redirects the user into the app
3. **Onboarding wizard** — The user is guided through a role selection step (CEO, CTO, Engineer, PM, Designer, etc.) or may skip onboarding entirely. Selecting a role creates an initial agent, company-level goal, an "Onboarding" project, and a first task. Skipping lands on an empty dashboard.
4. **Trial awareness** — A banner at the top of the layout tells the user how many trial days remain. A compact "Trial · Xd" badge appears in nav/header contexts
5. **Expired state** — When the trial ends, the banner switches to an "expired" state with a link to /pricing to choose a plan
6. **Choose a plan** — Users can upgrade to a paid tier at any time via /pricing (Stripe Checkout, requiring Stripe to be configured)

### Trial Tier Limits

| Resource | Included |
|----------|----------|
| Seats | 1 seat (configurable — migration seeds 5) |
| Agent runs | 100 runs |
| Storage | 1 GB |
| Features | AI trip planning, basic itinerary, 1 agent (configurable — migration seeds Paperclip platform features) |

> **Note:** The limits above reflect the intended Voyonder trial experience. The actual database seed (migration 0232) uses different values (5 seats, platform features). These should be aligned before production deployment. See the [Trial Tier Seed Data](#4-trial-tier-seed-data) section for details.

## What Changed

### 1. Registration Flow (`POST /api/auth/complete-registration`)

A new endpoint completes the registration flow after better-auth creates the user session:

- **Creates a company** with an optional `companyName` (defaults to "My Company")
- **Ensures owner membership** — the registering user is added as an `owner` with full grants
- **Starts a trial** — calls `billingService.startTrial()` with a 14-day trial (fixed duration). Accepts `billingPeriod`: `"monthly"` or `"yearly"` to set the billing cadence for eventual conversion.
- **Logs activity** — a `company.created` activity entry with source `self_serve_registration`
- **Idempotent** — if the user already has a company, returns it without creating a duplicate

**Request:**
```json
POST /api/auth/complete-registration
{
  "companyName": "Acme Corp"   // optional, max 100 chars
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

**`POST /api/companies/:companyId/trial/start`** — Start a 14-day trial for an existing company (idempotent, any authenticated user with company access, uses `ON CONFLICT` for race safety). Accepts `{ billingPeriod: "monthly" | "yearly" }`. Returns `201` on creation, `200` if a subscription already exists.

**`GET /api/companies/:companyId/trial/status`** — Get trial status

Response when trialing:
```json
{
  "isTrialing": true,
  "trialEnd": "2026-09-06T10:38:26.000Z",
  "daysRemaining": 13,
  "tierId": "uuid",
  "tierName": "Trial",
  "status": "trialing"
}
```

Response when not on trial (including expired):
```json
{
  "isTrialing": false,
  "trialEnd": null,
  "daysRemaining": null,
  "tierId": null,
  "tierName": null,
  "status": "expired"
}
```

**`POST /api/companies/:companyId/trial/convert`** — Create a Stripe Checkout Session to convert from trial to a paid subscription. Accepts `{ tierId, billingPeriod, successUrl?, cancelUrl? }`. Returns `{ url, sessionId }`.

> **Note:** The old endpoint paths (`/billing/start-trial`, `/billing/trial-info`) have been removed. Update any scripts or API clients to use the new `/trial/*` paths.

### 3. Trial Expiry Reaper & Grace Period

A background interval runs every **1 hour** (default; configurable via `intervalMs` parameter) that performs a **two-phase sweep**:

**Phase 1 — Expired trials → grace period:**
- Queries all subscriptions with status `trialing` whose `trialEnd` is in the past
- Sets their status to `grace_period` — this starts a 7-day grace window during which data remains accessible
- Records `currentPeriodEnd` as `trialEnd + 7 days`
- Publishes a `subscription.status.updated` live event for each transition
- Logs: `"Trial reaper: trial expired — entered grace period"`

**Phase 2 — Expired grace period → expired:**
- Queries all subscriptions in `grace_period` whose `currentPeriodEnd` is in the past
- Sets their status to `expired`, records `canceledAt`
- Publishes a `subscription.status.updated` live event for each transition
- Logs: `"Trial reaper: grace period elapsed — subscription marked as expired"`

The reaper also runs once on server startup (non-blocking, fire-and-forget). It is managed by `startTrialReaperScheduler()` which returns a disposer function for graceful shutdown.

**Grace period integration:** When Stripe reports the subscription as `incomplete` or `past_due` after trial expiry, the `handlePostTrialStatus` function (called from the `customer.subscription.updated` webhook handler) transitions the subscription to a **7-day grace period** (`grace_period` status) instead of immediately blocking access. This preserves user data during the grace window. After 7 days, the subscription transitions to `expired` (data preserved, paid features fully blocked). See [Trial Grace Period](support-case-billing-system.md#trial-grace-period) in the Billing System assessment for details.

**Note:** The reaper and `handlePostTrialStatus` operate independently. Both transition to `grace_period` — the reaper as a safety net on its sweep interval, and the webhook handler when Stripe notifies of expiry. If both fire, the last write wins. Both transitions are idempotent and preserve data access.

### 4. Trial Tier Seed Data

A new `Trial` subscription tier is seeded into the database (migration 0232):

| Field | Value |
|-------|-------|
| Name | `Trial` |
| Description | "14-day free trial with full access to all features" |
| Price | Free ($0) |
| Included seats | 5 (configurable) |
| Included agent runs | 100 |
| Included storage | 1 GB |
| Features | `custom_plugins`, `advanced_agents`, `audit_logs`, `api_access` |
| Sort order | 0 (lowest) |

> **Note:** The migration seeds 5 seats and Paperclip platform-level features. The Voyonder trial experience (described in the Feature Overview table above) may use different limits depending on deployment configuration. If the Voyonder trial requires 1 seat and Voyonder-specific features (AI trip planning, basic itinerary, 1 agent), the migration seed data should be updated before deployment. See [Migration 0232](../../packages/db/src/migrations/0232_trial_tier_seed.sql) for the current seed values.

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

- `billingApi.trialInfo(companyId)` — GET request returning trial status or null (endpoint: `GET /api/companies/:companyId/trial/status`)
- `billingApi.startTrial(companyId, { billingPeriod })` — POST request for manual trial start (endpoint: `POST /api/companies/:companyId/trial/start`)
- `billingApi.convertTrial(companyId, { tierId, billingPeriod, successUrl?, cancelUrl? })` — POST request for trial-to-paid conversion (endpoint: `POST /api/companies/:companyId/trial/convert`)
- `authApi.completeRegistration(data)` — POST request for registration completion
- `queryKeys.billing.trialInfo(companyId)` — React Query cache key for consistent invalidation

### 7. Auth Page Update

`Auth.tsx` now calls `completeRegistration()` automatically after successful sign-up and redirects the user to the new company's onboarding page — no manual company creation step.

### 8. Onboarding Wizard (Phase 2)

Three new endpoints implement the guided onboarding wizard that appears after registration:

| Endpoint | Method | Description | Auth |
|----------|--------|-------------|------|
| `/api/companies/:companyId/onboarding/status` | GET | Returns current onboarding state | Company access |
| `/api/companies/:companyId/onboarding/role` | POST | Select a role — creates agent, goal, project, first task | Company access |
| `/api/companies/:companyId/onboarding/skip` | POST | Skip onboarding — land on empty dashboard | Company access |

#### GET /api/companies/:companyId/onboarding/status

Returns the current onboarding state for a company.

**Response (200):**
```json
{
  "status": "pending",
  "selectedRole": null,
  "completedAt": null,
  "canSelectRole": true
}
```

**Possible status values:**
- `pending` — Onboarding not yet started. User can select a role or skip.
- `completed` — Role was selected. Onboarding is done.
- `skipped` — User chose to skip onboarding.

**`canSelectRole`** is `true` only when `status` is `pending`.

#### POST /api/companies/:companyId/onboarding/role

Select a role for the company. Creates the following in a single transaction:

1. **Company-level goal** — Title matches the role label (e.g., "CTO")
2. **"Onboarding" project** — Linked to the goal, status `in_progress`
3. **Agent** — Created with the role's label as name, `general` role (or `ceo` for CEO role), `claude_local` adapter
4. **First task** — "Get started with {RoleLabel}", assigned to the new agent, status `todo`
5. **Company status update** — `onboarding_status` set to `completed`, `onboarding_selected_role` set, `onboarding_completed_at` timestamped

The entire operation is wrapped in a transaction with a `SELECT ... FOR UPDATE` row lock on the company row to prevent TOCTOU races between concurrent `selectRole`/`skip` calls.

**Request:**
```json
{
  "role": "cto"
}
```

**Valid roles:** `ceo`, `cto`, `engineer`, `pm`, `designer`, `product`, `founder`, `operator`, `marketing`, `support`, `sales`, `hr`, `finance`, `legal`, `operations` (from the `AGENT_ROLES` constant)

**Response (200):**
```json
{
  "companyId": "uuid",
  "role": "cto",
  "applied": true,
  "agentId": "uuid",
  "projectId": "uuid",
  "goalId": "uuid",
  "issueId": "uuid"
}
```

**Errors:**
- `400` — Company not found or invalid role
- `409` — Onboarding already completed or skipped (includes `currentStatus` field)

**Idempotency:** The first task is created with an `idempotencyKey` (`onboarding-role:{companyId}:{role}`), preventing duplicate tasks on retry. If the role selection is called again, the 409 conflict prevents re-execution.

#### POST /api/companies/:companyId/onboarding/skip

Skip onboarding and land on the empty dashboard. Only allowed when status is `pending`.

**Response (200):**
```json
{
  "companyId": "uuid",
  "skipped": true
}
```

**Errors:**
- `400` — Company not found
- `409` — Onboarding already completed or skipped

#### DB Schema Changes (Migration 0231)

```sql
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "onboarding_status" text NOT NULL DEFAULT 'pending';
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "onboarding_selected_role" text;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "onboarding_completed_at" timestamp with time zone;
```

#### Activity Logging

Both role selection and skip operations create activity log entries:
- `company.onboarding_role_selected` — includes role, agentId, projectId, goalId, issueId in details
- `company.onboarding_skipped` — empty details

#### UI Integration

The onboarding wizard is presented to the user immediately after registration (before the main dashboard). The UI polls `GET /api/companies/:companyId/onboarding/status` to determine whether to show the role selection screen or the main dashboard. After role selection or skip, the status changes to `completed` or `skipped` and the main dashboard is displayed.

## Known Limitations & Edge Cases

| Limitation | Details | Workaround |
|-----------|---------|------------|
| **Stripe not required for trial** | The trial system works without Stripe configured — it creates a local placeholder customer. However, upgrading to a paid plan requires Stripe to be configured | Configure `STRIPE_SECRET_KEY` and related env vars before going live |
| **Trial start failure is non-fatal** | If `startTrial()` fails during registration (e.g., DB error), the company is still created and the user is logged in — they just won't be on a trial | Check server logs for `"Failed to start trial (non-fatal)"` message. Support can manually start a trial via the API |
|| **No email notifications** | The system does not send email reminders when a trial is about to expire or has expired | Users discover expiration when they see the banner or try to use a paid feature |
|| **Single-trial enforcement** | There is no mechanism to prevent the same email from starting multiple trials across different sessions | The idempotency check (user company membership) prevents duplicates for the same user, but a different email could create a second trial |
|| **Trial-to-paid conversion** | Users must manually visit /pricing and subscribe via Stripe Checkout, or use `POST /api/trial/convert` | Future feature — automated conversion on trial end |
|| **Stripe not configured on trial convert** | The `POST /api/companies/:companyId/trial/convert` endpoint requires Stripe to be configured. If Stripe is not set up, it returns a `500` | Configure `STRIPE_SECRET_KEY` and related env vars before going live |
|| **Reaper delay** | The trial expiry reaper runs every 1 hour (default). Expired trials may have up to 1 hour of continued grace access after expiry | This is intentional — prevents hard cutoffs. The `grace_period` status preserves data access |
|| **Reaper vs. webhook race** | The reaper (sets `grace_period` on sweep) and `handlePostTrialStatus` (sets `grace_period` via Stripe webhook) may race. Both produce the same result | Both transitions are idempotent. The last write wins. Data is preserved in both paths |
|| **Onboarding already completed/skipped** | Once onboarding is completed (role selected) or skipped, the user cannot change their choice | No workaround — the company's onboarding status is final. If a role needs changing, create a new agent manually via the Agents API |
|| **Onboarding role selection not retryable** | If role selection fails mid-transaction (e.g., agent creation), the entire transaction rolls back and the user can retry | The FOR UPDATE lock prevents partial state. The user sees an error and can select a role again |
|| **Claude Local adapter default** | The onboarding wizard creates agents with `claude_local` adapter by default. If this adapter is unavailable, role selection fails | Ensure `claude_local` adapter is available, or update the onboarding service to use a different default adapter |

## Troubleshooting

### Symptom: User registers but doesn't get a trial

1. Check server logs for `"Failed to start trial (non-fatal)"` — this indicates the trial creation failed but company was still created
2. Verify the `Trial` tier exists: `SELECT * FROM subscription_tiers WHERE name = 'Trial';`
3. Manually start a trial: `POST /api/companies/:companyId/trial/start`
4. Check if the trial was already started but the UI wasn't updated (refresh the page)

### Symptom: Trial banner not showing

1. Verify the user's company has a subscription with status `trialing`:
   ```sql
   SELECT * FROM company_subscriptions WHERE company_id = '<companyId>';
   ```
2. Check that `trialEnd` is set and in the future
3. Verify the UI is using the correct company context (`useCompany()`)
4. Check browser console for React Query errors on the `trialInfo` endpoint

### Symptom: User's trial says expired but they should still have time

1. Check the `trialEnd` value in `company_subscriptions` — it may have been set incorrectly
2. The reaper's 1-hour interval may have run early. Wait for the next sweep or check `status` in the DB
3. If the subscription is in `grace_period`, the user still has data access. The `expired` status only activates after the grace period fully elapses
4. Manually adjust: `UPDATE company_subscriptions SET status = 'trialing' WHERE company_id = '<companyId>';` (be aware this bypasses the grace period mechanism)

### Symptom: User can access paid features after trial expires

- The `grace_period` status preserves data access during the 7-day grace window. This is by design.
- If the subscription has been in `grace_period` for more than 7 days, check:
  1. The reaper ran: check server logs for `"Trial reaper: grace period elapsed — subscription marked as expired"` or `"Trial reaper: trial expired — entered grace period"`
  2. `currentPeriodEnd` in the subscriptions table indicates when the grace period should have ended
  3. The user may be within the 1-hour reaper window

### Symptom: Onboarding wizard doesn't appear after registration

1. Verify the company's onboarding status: `SELECT onboarding_status FROM companies WHERE id = '<companyId>';`
2. If status is `pending`, the wizard should appear. Check the UI is polling `GET /api/companies/:companyId/onboarding/status`
3. If status is `completed` or `skipped`, the user already finished onboarding and the wizard won't show
4. Check browser console for errors on the onboarding status endpoint

### Symptom: Role selection returns 409 Conflict

1. The company's onboarding is already completed or skipped — check `SELECT onboarding_status FROM companies WHERE id = '<companyId>';`
2. If the user wants a different role, they need to manually create a new agent via the Agents API
3. No way to "re-do" onboarding — this is by design

### Symptom: Role selection fails with 400

1. Verify the role value is valid — check the `AGENT_ROLES` constant for accepted values
2. The company must exist and be accessible
3. Check server logs for transaction errors (agent creation, goal creation, etc.)

## Support Escalation Path

| Issue | Escalate To | Contact |
|-------|-------------|---------|
| Trial not starting on registration | Engineering | Slack #eng-billing |
| Stripe integration needed for upgrade | Engineering/DevOps | Slack #eng-infra |
| Extending trial days (above 90) | Board operator / Admin | Direct DB update |
| Bulk trial provisioning | COO / Sales | #sales channel |
| Onboarding role selection failing | Engineering | Slack #eng-onboarding |
| Onboarding stuck at pending | Engineering | Slack #eng-onboarding |

## Verification Checklist

- [ ] New sign-up creates company + trial subscription
- [ ] Trial banner shows correct days remaining
- [ ] TrialBadge renders in nav context
- [ ] Banner shows expired state after trial end
- [ ] Reaper transitions expired trials to `grace_period` within 1 hour
- [ ] Reaper transitions expired grace periods to `expired` (second sweep)
- [ ] Trial tier limits (1 seat, 100 runs, 1 GB) are enforced
- [ ] Idempotency — same user cannot create multiple companies
- [ ] Existing company's `startTrial` returns existing subscription (idempotent)
- [ ] Trial/convert creates a Stripe Checkout session
- [ ] No trial banner when subscription is not `trialing`
- [ ] Pricing page is accessible from trial banner links
- [ ] GET /onboarding/status returns `pending` for a new company
- [ ] POST /onboarding/role creates agent, goal, project, task
- [ ] POST /onboarding/role returns 409 after completion
- [ ] POST /onboarding/skip marks company as `skipped`
- [ ] POST /onboarding/skip returns 409 after role selection
- [ ] Activity log entries created for role selection and skip
- [ ] Onboarding status persists across page refreshes
- [ ] Reaper logs correct messages (`"Trial reaper: trial expired — entered grace period"`, `"Trial reaper: grace period elapsed — subscription marked as expired"`)
