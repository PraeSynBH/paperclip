# Release: M6 Self-Serve Trial & Onboarding — Voyonder

**Date:** 2026-08-24 (target)
**Status:** Draft — pending GitHub Actions billing resolution

## Summary

M6 ships self-serve trial onboarding for Voyonder: users sign up, create a company, and start a free trial without any manual intervention. This is the first fully automated user journey — from signup to product usage — completing the signup→trial→dashboard flow.

## What Changed

### Self-Serve Trial Signup (Phase 1)

- **New user registration flow** — `POST /complete-registration` creates a company, assigns membership, starts a trial subscription, and logs the activity in a single request. No more manual provisioning.
- **Trial subscription management** — `startTrial()` creates a trialing subscription with a configurable trial period (default: 14 days). Trials are tracked via `company_subscriptions` with `status='trialing'` and a `trial_end` timestamp.
- **Trial status visibility** — `GET /billing/trial-info` returns trial state (active, expired, none) and remaining days for any company member. The UI can surface trial status, expiration warnings, and upgrade CTAs.

### Onboarding Flow (Phase 2)

- **Registration endpoint** — The complete-registration route creates a company, assigns the user as owner, starts the trial, and logs the activity. All steps are wrapped in a database transaction — if any step fails, the entire registration rolls back.
- **Duplicate registration protection** — Concurrent registration requests from the same user are prevented via advisory lock (`pg_advisory_xact_lock`). Only one company is created per user.
- **Idempotent trial start** — `startTrial()` uses `INSERT ... ON CONFLICT` to handle race conditions safely. If a subscription already exists, the existing one is returned.
- **Comprehensive validation** — Request body validated via Zod schema. `trialDays` clamped to 1-90 range.

### Billing Integration: Trial → Paid Conversion (Phase 3)

- **Trial expiry reaper** — A 30-minute interval sweeps expired trials and transitions them to `past_due`. Also runs on server startup. Protected by a composite index on `(status, trial_end)` for efficient querying.
- **Grace period handling** — When a trial expires, the subscription moves to `past_due` (not immediately canceled). The user can still access the product during the grace period.
- **Grace period expiry handling** — `handleSubscriptionDeleted` routes trial expirations through the grace period properly (F1 fix).
- **ON CONFLICT protection** — `startTrial` INSERT uses `ON CONFLICT` to prevent duplicate subscription records (F2 fix).

### Reliability Improvements

- **Periodic trial expiry sweep (C1)** — A background job runs every 30 minutes to find and expire overdue trials. Also runs at server startup so expired trials are caught immediately after restart.
- **Stripe price IDs for trial tier (C2)** — Trial tier is properly configured with Stripe price IDs so checkout bypass works for trials.
- **Live event resilience** — `publishLiveEvent` failures during trial expiry are handled per-event — one failure does not abort remaining event dispatch.
- **Import reliability** — The trial reaper uses static imports instead of dynamic `import()`, with error-level logging on startup failure.

## Key Decisions

- **Advisory lock for registration** — `pg_advisory_xact_lock()` prevents concurrent registration from the same user, which is simpler and more reliable than unique constraint patterns.
- **Trial days: 14 default** — New users get 14 days to evaluate the product. Configurable per-request via `trialDays` field (1-90, validated).
- **Past_due on expiry** — Expired trials transition to `past_due` rather than immediate cancellation, giving users a grace period before losing access.
- **UI-only AlertDialog replacement** — The cancel subscription dialog (VOY-1990) was replaced with a styled AlertDialog (cherry-picked from this branch during M6 review). Not a user-facing behavior change — the cancel flow works identically.

## Review Status

- [x] Implementation (Phases 1-3)
- [x] Code Review (VOY-1981, VOY-1982, VOY-1983)
- [x] Staff Engineer Review — CONDITIONAL APPROVAL
- [x] All must-fix items resolved (C1, C2, F1, F2)
- [x] CTO Sign-off
- [ ] CI/CD Pipeline (blocked on GitHub Actions billing)
- [ ] Stage deployment smoke test
- [ ] Production deployment
- [ ] Post-deploy health verification

## Commits

Key commits on `feat/m6-self-serve-trial-onboarding`:

- `startTrial` + trial expiry reaper implementation
- Registration endpoint (`POST /complete-registration`)
- Trial info endpoint (`GET /billing/trial-info`)
- Advisory lock for concurrent registration protection
- Composite index on `(status, trial_end)` for reaper
- C1: Periodic trial expiry sweep
- C2: Stripe price IDs for trial tier
- F1: Grace period routing in handleSubscriptionDeleted
- F2: ON CONFLICT protection in startTrial
- UI: AlertDialog for cancel subscription (cherry-picked to dedicated branch)
- Staff Engineer review fixes (transactional registration, race condition, index, live event resilience)

## Rollout Plan

1. Merge `feat/m6-self-serve-trial-onboarding` to master
2. Deploy to staging, smoke test registration + trial flow
3. Deploy to production, verify health
4. Monitor trial creation and expiry sweep for first 24 hours
5. Notify Support Engineer that M6 is live (docs update)

## Verification

- [ ] New user can register → company created → trial subscription started
- [ ] Trial appears in billing overview with remaining days
- [ ] Trial expiry sweep transitions expired trials to past_due
- [ ] Concurrent registration creates exactly one company
- [ ] Duplicate subscription not created on retry
- [ ] Grace period works correctly
- [ ] Cancel subscription dialog opens AlertDialog (not browser confirm)
