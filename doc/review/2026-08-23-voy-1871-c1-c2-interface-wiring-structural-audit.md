# Structural Audit: VOY-1871 C1+C2 Interface Wiring

**Branch:** `feat/clean-m5-pricing-pr` (against `main` at 2391c22f53)
**Date:** 2026-08-23
**Reviewer:** Staff Engineer
**Scope:** 1949 files changed, 35,411 insertions, 99,203 deletions

---

## Overview

This branch carries Code Separation Phase 2 (connect Voyonder to published `@paperclipai/*` packages) plus the M5 pricing experiment and billing overhaul. The prior Staff Engineer review cycle caught 9 issues in the billing code (fixed in commit 1a00d7fe75). This audit confirms those fixes and identifies remaining structural concerns.

---

## C1: API Integration — Import Path Verification

**Verdict: PASS** ✅

- All server imports from `@paperclipai/db` and `@paperclipai/shared` use package-name paths — no remaining relative imports across the package boundary.
- `pnpm-workspace.yaml` correctly removes `ui` from workspace membership (Voyonder separation).
- `ui/package.json` retains `workspace:*` references; the `prepack` hook rewrites them for publishing — correct for monorepo development.
- New validators (`createPortalSessionSchema`, `startTrialSchema`, `convertTrialSchema`, `selectOnboardingRoleSchema`) are properly exported from `@paperclipai/shared`.
- Schema additions to `companies` table (`pricingExperimentVariant`, `onboardingStatus`, etc.) are properly reflected in both Drizzle schema and migration SQL.

## C2: UI Rendering — Component Boundary Verification

**Verdict: PASS** ✅

- Sentry instrumentation (`@sentry/react`, `@sentry/vite-plugin`) initialized correctly in `main.tsx` and `vite.config.ts`.
- Pricing page (`Pricing.tsx`, `Pricing.test.tsx`) compiles against the published `@paperclipai/shared` types — no new type errors.
- Motion library (`motion`) added to dependencies is used in pricing page animations.
- No broken imports or dangling references detected.

## Billing Critical Paths

### Prior Issues (9) — Verified Fixed ✅

1. `getOrCreateStripeCustomer` ON CONFLICT DO NOTHING with fallback SELECT
2. `handleCheckoutSessionCompleted` wrapped in `db.transaction`
3. `syncInvoicesFromStripe` uses `INSERT ... ON CONFLICT DO UPDATE`
4. Stripe retry — `withStripeRetry` exponential backoff restored
5. `publishLiveEvent` restored in all handlers
6. Transaction scope expanded for checkout session handler
7. `applyTierOverrides` validation warning
8. Usage metrics created in subscription-updated fallback path
9. E2E billing tests covering portal, trial, and webhook race conditions

---

## New Structural Issues

### ISSUE 1 [CRITICAL] — `getOrAssignVariant` TOCTOU race

**File:** `server/src/services/pricing-experiment.ts:138-172`

The read→compute→write sequence is not atomic:

```ts
// Read (no lock)
const company = await db.select(...).where(eq(companiesTable.id, companyId));
if (company?.variant === "A" || company?.variant === "B") return company.variant;
// Compute & write
const variant = assignVariant(companyId, cfg);
await db.update(companiesTable).set({ pricingExperimentVariant: variant, ... });
```

The assignment is deterministic given the same config salt, so concurrent calls compute the same variant. However, if the experiment config changes (e.g., `config.salt` is rotated) while traffic is live, two concurrent calls could read different configs, compute different variants, and race on the UPDATE.

**Fix:** Use `INSERT INTO companies (id, pricing_experiment_variant, pricing_experiment_enrolled_at) VALUES (...) ON CONFLICT (id) DO NOTHING RETURNING ...` with a fallback SELECT — same pattern used by `getOrCreateStripeCustomer`. This makes the assignment atomic.

### ISSUE 2 [HIGH] — Upsert conflict target change weakens defensive invariant

**File:** `server/src/services/billing.ts`

Both `handleSubscriptionUpdated` and `handleCheckoutSessionCompleted` changed the ON CONFLICT target from `("stripe_subscription_id")` to `("company_id")`. This is necessary for trial→paid conversion (trial rows have NULL `stripe_subscription_id`). But `company_subscriptions` has a UNIQUE constraint on `company_id`, so a second subscription creation for the same company silently overwrites the first.

**Fix:** After the upsert, verify that `stripe_subscription_id` matches the expected value. If not, log an error before responding 200 to Stripe. The test at `billing-e2e.test.ts:322` verifies dedup but not the overwrite scenario.

### ISSUE 3 [MEDIUM] — Dead non-null assertions on `stripeSubscriptionId`

**File:** `server/src/services/billing.ts` — `cancelSubscription`, `reactivateSubscription`, `syncInvoicesFromStripe`

All three already guard with `if (!subscription.stripeSubscriptionId) throw unprocessable(...)` but then use `subscription.stripeSubscriptionId!` and `as string` casts. This is dead decoration — remove the assertions so the guard is clearly the single source of truth.

### ISSUE 4 [MEDIUM] — `handleSubscriptionUpdated` lacks missing-companyId guard

**File:** `server/src/services/billing.ts` — `handleSubscriptionUpdated`

The handler reads `const companyId = stripeSub.metadata?.paperclipCompanyId` without a guard. If null (subscription created outside Paperclip), the handler throws an opaque error. Other handlers (`handleSubscriptionDeleted`, `handleTrialWillEnd`) have `if (!companyId) { logger.warn(...); return; }` guards. Add one here.

### ISSUE 5 [LOW] — Missing trailing newline in migration SQL

**File:** `packages/db/src/migrations/0231_onboarding_status_columns.sql`

The file ends without a trailing newline. Add one for POSIX compatibility.

---

## Observations

- `GA4 analytics` uses fire-and-forget (`void ... .catch(() => {})`) — appropriate for analytics, no concern.
- Pricing experiment variant assignment is deterministic (SHA-256) — correct for A/B testing.
- Stripe retry base delay increased from 200ms to 1000ms + jitter — reasonable for rate-limit avoidance.
- The `0232_trial_tier_seed.sql` migration uses `ON CONFLICT (name) DO NOTHING` — correct for idempotent seeding.

---

## Summary

| Category | Verdict |
|----------|---------|
| C1 Import Wiring | PASS |
| C2 UI Rendering | PASS |
| Billing Correctness | FIX Issues 1-2 before shipping |
| Code Hygiene | FIX Issues 3-5 before shipping |

**Handoff:** Approved for CTO sign-off pending resolution of Issues 1-5.