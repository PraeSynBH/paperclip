# Founding Engineer Heartbeat — 2026-08-23 ~14:20 UTC

## M6 Self-Serve Trial and Onboarding Flow — VOY-1781

### Status
**PR #78 Created** — awaiting Staff Engineer code review

Branch: `feat/m6-self-serve-trial-onboarding` — merged with latest master (Code Separation Phase 2)
PR: https://github.com/PraeSynBH/paperclip/pull/78

### Implementation Summary

| Component | Files | Status |
|-----------|-------|--------|
| Server: complete-registration route | `server/src/routes/auth.ts` | ✅ |
| Server: billing routes (trial-info, start-trial) | `server/src/routes/billing.ts` | ✅ |
| Service: startTrial, getTrialInfo, expireTrials | `server/src/services/billing.ts` | ✅ |
| Trial reaper (30-min interval + startup sweep) | `server/src/index.ts` | ✅ |
| Seed: Trial subscription tier | `server/src/seed/002_subscription_tiers.sql` | ✅ |
| UI: Post-sign-up auto-registration + redirect | `ui/src/pages/Auth.tsx` | ✅ |
| UI: TrialBanner + TrialBadge components | `ui/src/components/TrialBanner.tsx` | ✅ |
| UI: API client methods | `ui/src/api/billing.ts`, `ui/src/api/auth.ts` | ✅ |
| Shared: completeRegistrationSchema | `packages/shared/src/validators/billing.ts` | ✅ |
| Plan document | `doc/plans/2026-08-23-VOY-1839-self-serve-trial-onboarding-plan.md` | ✅ |

### Coverage vs Plan
All 7 implementation steps from the plan are complete:
1. ✅ Trial tier seed SQL
2. ✅ `startTrial` method — creates Stripe customer (or local placeholder), inserts trialing subscription
3. ✅ `POST /api/auth/complete-registration` — idempotent company+trial creation
4. ✅ `GET /companies/:companyId/billing/trial-info` — returns daysRemaining, expired status
5. ✅ Trial reaper — 30-minute interval, also runs on startup
6. ✅ UI: post-sign-up flow redirects to onboarding
7. ✅ UI: TrialBanner component + TrialBadge inline badge

### Board Activity

| Issue | Status | Notes |
|-------|--------|-------|
| VOY-1781 (M6) | 🟡 in_review | PR #78 created, awaiting Staff Engineer |
| VOY-1834 (Code Separation P2) | 🟢 in_progress | Shipped to master, RE reassigned |
| VOY-1719 (PostHog) | 🔴 blocked | Still waiting on founder credentials |