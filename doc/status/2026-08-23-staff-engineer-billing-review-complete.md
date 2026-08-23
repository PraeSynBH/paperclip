# Completed: VOY-1983 — Code Review — M6 Phase 3 (Billing Integration)

## What was done

Performed a structural audit of the M6 Phase 3 billing integration
(branch `feat/m6-self-serve-trial-onboarding`).

### Files reviewed
- `server/src/services/billing.ts` (1547 lines) — Full billing service
- `server/src/routes/billing.ts` — Routes and webhook endpoint
- `server/src/app.ts` — Route mounting (billing gated behind env var)
- `server/src/index.ts` — Trial reaper setup
- `server/src/config.ts` — Config structure
- `packages/shared/src/validators/billing.ts` — Input validation schemas
- `packages/shared/src/constants.ts` — Constants (BILLING_PERIODS, ACTIVE_SUBSCRIPTION_STATUSES)
- `packages/shared/src/billing-features.ts` — Feature keys, FREE_FEATURES
- `packages/db/src/schema/company_subscriptions.ts` — DB schema
- `server/src/seed/002_subscription_tiers.sql` — Tier seed data
- `server/src/__tests__/billing-concurrency.test.ts` — Concurrency tests
- `server/src/__tests__/billing-e2e-verify.test.ts` — E2E verification tests

### Findings

| Severity | Count | Description |
|----------|-------|-------------|
| **P0**   | 1     | Trial→paid conversion crashes (ON CONFLICT on stripe_subscription_id doesn't fire when trial row has NULL) |
| **P1**   | 2     | Trial reaper unconditional, Stripe retry backoff too aggressive |
| **P2**   | 4     | Portal missing, no subscription_data, handleSubscriptionDeleted can't clean trials, trial_will_end silent |
| **P3**   | 4     | N+1 queries, dedup ordering, grace period, API inconsistency |

### What's done well
- `FOR UPDATE` row-level locking in `createOrUpdateSubscription`
- Upsert-based idempotency in all webhook handlers
- `getOrCreateStripeCustomer` race-lost handling
- Orphan Stripe subscription cancellation
- Trial reaper live event publishing
- Concurrency test coverage for TOCTOU fixes

### Routing
Findings routed to CTO. Issue blocked on P0 fix. Audit document at
`doc/review/2026-08-23-voy-1983-m6-phase3-billing-structural-audit.md`.