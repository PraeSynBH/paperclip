# Support Case Assessment: M6 Self-Serve Trial Onboarding (VOY-1839)

**Date:** 2026-08-24 ~13:35 UTC
**Feature version:** feat/m6-self-serve-trial-onboarding (a9c5cef+ — includes uncommitted must-fix patches)
**Support Engineer:** 88b72065
**Release tracking:** VOY-1984 (blocked on GitHub billing)

---

## Feature Summary

The self-serve trial onboarding flow allows new users who sign up via better-auth to automatically create a company and start a 14-day free trial — no credit card required, no manual provisioning. The flow:

1. User signs up at `POST /api/auth/sign-up/email` → user+session created, no company
2. UI detects session exists + 0 companies → calls `POST /api/auth/complete-registration`
3. Server creates company + membership + trial subscription atomically
4. User lands on onboarding wizard, then dashboard

### New API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/complete-registration` | Create company + start trial (called after sign-up) |
| GET | `/api/companies/:companyId/billing/trial-info` | Return trial status + days remaining |
| POST | `/api/companies/:companyId/billing/start-trial` | Start trial for existing company (idempotent) |

### Support-Relevant Behavior

- **Idempotent registration:** If a user already has a company membership, `complete-registration` returns `{created: false, companyId}` — no duplicate created.
- **Transactional integrity:** Company creation, membership, and trial start are wrapped in a DB transaction. If any step fails, nothing is persisted.
- **Concurrency safe:** Uses `pg_advisory_xact_lock` + `SELECT FOR UPDATE` to prevent duplicate companies from simultaneous requests.
- **14-day trial by default:** The `trialDays` field in the request body can override (but the UI does not expose this).
- **Trial tier must exist in DB:** The `startTrial` function looks up a tier named `"Trial"` in the `subscription_tiers` table. If it's missing, the request returns a 404 error with a message to seed the database.
- **Reaper (daily):** `expireTrials()` in billing.ts runs as a scheduled job. It finds trialing subscriptions past their `trialEnd` date and sets status to `past_due` — blocking paid features.
- **Stripe integration optional:** If Stripe keys are not configured, `startTrial` creates a local-only trial with a placeholder Stripe customer. No Stripe API calls are made.

---

## Known Limitations & Edge Cases

### 1. Trial reaper uses batch update + in-memory publishLiveEvent loop
The `expireTrials` function does a single `UPDATE ... RETURNING` query for all expired trials, then fires `publishLiveEvent` for each in a for loop. If the server restarts between the UPDATE and the last event, some companies will have their DB status set to `past_due` but no live event will be published for them. The UI polls subscription status, so the stale event is cosmetic — the correct status is already in the DB.

**Impact:** Low. The live event is a real-time notification; the DB is the source of truth.

### 2. "Trial" tier name is hardcoded
The `startTrial` function defaults to looking for a tier named `"Trial"` (case-sensitive). If this tier does not exist in the `subscription_tiers` table, the entire registration fails. The seed SQL must insert this tier.

**Support script** — verify the Trial tier exists:
```sql
SELECT id, name, is_active, included_seats, included_agent_runs, included_storage_gb
FROM subscription_tiers
WHERE name = 'Trial';
```
Expected: one row returned. If zero rows: run the seed migration or insert manually.

### 3. No email notification on trial expiry
When a trial expires (status → `past_due`), there is no email sent to the user. The user only discovers their trial ended when they try to use a paid feature and get blocked. This is a known gap; PostHog instrumentation is planned for conversion tracking but no user-facing expiry email exists.

**Support guidance:** When a user reports "I can't use features" and they were on a trial, check subscription status at `GET /api/companies/:companyId/billing/trial-info`. If `expired: true`, guide them to the pricing page to upgrade.

### 4. Feature gating checks are not fully implemented in all routes
Some paid-feature routes may not check subscription status before allowing access. The `checkFeatureAccess` function exists but coverage is incremental. If a user on an expired trial can still access a paid feature, it's a code gap, not a bug.

**Support guidance:** Report routes that bypass gating as feature requests / bugs to engineering.

### 5. Reaper is not wired into any scheduler
The `expireTrials` method exists but is **not yet wired into a cron job, setTimeout loop, or server startup hook**. Until it is scheduled, expired trials will never transition to `past_due` automatically. This means a user's trial can remain active indefinitely after the 14-day window.

**Deployment prerequisite:** Someone must wire the reaper into the server startup or a cron schedule before the M6 release is production-ready.

### 6. No "Trial Banner" UI component committed
The plan (VOY-1839) mentions a `TrialBanner` component for showing remaining trial days. This has not been built. The UI currently has no way to display trial status to the user beyond API responses.

### 7. Concurrent registration uses DB advisory locks — requires PostgreSQL
The `pg_advisory_xact_lock` function is PostgreSQL-specific. This code will not work on SQLite or other databases. The application already targets PostgreSQL, so this is not a practical limitation but is relevant if the database backend ever changes.

---

## Troubleshooting Guide

### Problem: Registration fails with 500/503
- Check server logs for error detail
- Common causes:
  - Database connection issues (transaction fails)
  - Missing "Trial" tier in `subscription_tiers` (returns 404)
  - PostHog credentials (not blocking, but the feature continues without them)
- Always idempotent: retrying the request is safe

### Problem: User signed up but has no company
- Check if `POST /api/auth/complete-registration` was called
- Check if it succeeded (201) or returned an error
- If the route returned 201 but user has no company: check subscription_tiers for the "Trial" tier
- Manual workaround: call `POST /api/companies/:companyId/billing/start-trial` with a manually created company

### Problem: Trial does not expire
- Check if the reaper is running (see Known Limitation #5)
- If the reaper is not wired: run manually via the server console or a script
- Manual SQL to expire a specific company's trial:
  ```sql
  UPDATE company_subscriptions
  SET status = 'past_due', updated_at = NOW()
  WHERE company_id = '<id>' AND status = 'trialing';
  ```

### Problem: User sees duplicate companies
- This should not happen (M6-2 prevents it with advisory locks + FOR UPDATE)
- If duplicate companies exist in the database, it means the code ran before the concurrent-registration fix was deployed
- Resolution: delete the duplicate company rows and keep the one with the active trial

### Problem: Stripe-related errors during trial
- `startTrial` catches Stripe errors silently and creates a local-only trial
- If a user later tries to upgrade via Stripe Checkout and fails, check Stripe keys are configured
- Error: "Tier 'Trial' not found — seed the database" → run the tier seed migration

---

## Escalation Paths

| Issue | Escalate To |
|-------|-------------|
| Missing "Trial" tier in database | Engineering (seed migration) |
| Reaper not running / not wired | Engineering (deploy fix) |
| Concurrent registration bug (duplicate companies) | Engineering (P0 — data integrity) |
| Feature gating gaps (paid features accessible without subscription) | Engineering (feature request) |
| Stripe billing issues during conversion | Engineering (Stripe configuration) |
| "My trial ended but I wasn't notified" | Product (known gap — no notification system) |

---

## Verification Checklist (for support testing after deployment)

- [ ] New sign-up → user lands on onboarding wizard → company created with trial
- [ ] Existing user signs up → returns existing company, no duplicate
- [ ] Trial tier missing → returns clear error message (not a raw 500)
- [ ] `GET /trial-info` returns correct days remaining and expired=false
- [ ] Trial expiry → status transitions to `past_due` → paid features blocked
- [ ] Concurrent registration (two simultaneous clicks) → one company created
- [ ] Reaper can be triggered manually without restart
- [ ] User can upgrade from trial via Stripe Checkout (if Stripe configured)

---

## Related Documents

- Feature plan: `doc/plans/2026-08-23-VOY-1839-self-serve-trial-onboarding-plan.md`
- Must-fix QA: `doc/qa/2026-08-24-qa-assessment-voy-2115.md`
- Release tracking: VOY-1984
- Build verification (Pricing/Billing): `doc/review/2026-08-21-voy-1590-stripe-billing-e2e-verification.md`