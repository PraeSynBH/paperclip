# Staff Engineer — Structural Audit: M6 Self-Serve Trial Onboarding (Final)

**Branch:** `feat/m6-self-serve-trial-onboarding` (ahead 8 behind 0 vs master)
**Audit Date:** 2026-08-24
**Reviewer:** Staff Engineer (eee825c7)
**Previous audit:** `doc/reviews/2026-08-24-staff-engineer-m6-structural-audit.md`

---

## 1. Change Summary

This branch implements self-serve trial onboarding (M6) and carries additional M5 pricing experiment infrastructure, SEO metadata, Voyonder code separation, and accessibility improvements. Since the previous audit, 3 fix commits have landed (VOY-2111, VOY-2112, VOY-2113) plus the critical trial-to-paid conversion fix (VOY-2117). Two additional structural issues were fixed during this final re-review.

---

## 2. Previously Identified Issues — Status Check

### Previously Critical/High — Must Fix

| # | Issue | Previous Status | Current Status | Verdict |
|---|-------|----------------|----------------|---------|
| 1 | Registration flow not transactional | ❌ Not fixed | **FIXED** (d37fb3db22 — transaction + pg_advisory_xact_lock + FOR UPDATE) | ✅ |
| 2 | Trial failure silently returns 201 | ❌ Not fixed | **FIXED** (d37fb3db22 — errors now propagate, no try-catch) | ✅ |
| 3 | `publishLiveEvent` failures lose remaining events | ❌ Not fixed | **FIXED** (5dd66e81 — per-row try/catch in expireTrials) | ✅ |
| 4 | Trial reaper no concurrency guard + dynamic import | ❌ Not fixed | **FIXED** (server/src/index.ts:1585-1620 — cached import + trialReaperRunning guard) | ✅ |
| 5 | Trial expiry index migration untracked | ❌ Not committed | **FIXED** (5dd66e81 — migration committed and schema aligned) | ✅ |

### Previously Medium — Should Fix

| # | Issue | Status | Verdict |
|---|-------|--------|---------|
| 6 | `trialDays` client-controlled up to 90 days | ⚠️ By design | Accept. Flag for future config. |
| 7 | Stripe customer creation outside subscription transaction | ⚠️ Pre-existing pattern | Accept. Self-healing on retry. |
| 8 | `start-trial` route could use tighter admin auth | ⚠️ Existing pattern | Accept. Not blocking. |

---

## 3. Findings Resolution Summary

### 🔴 CRITICAL: Trial-to-paid conversion fails — webhook ON CONFLICT target does not match trial row

**Files:**
- `server/src/services/billing.ts` (`handleCheckoutSessionCompleted`, `handleSubscriptionUpdated`)

**Status: FIXED** by commit `3885b6b5f0`.

Both upsert conflict targets changed from `stripe_subscription_id` to `company_id`, with `stripe_subscription_id`, `stripe_subscription_item_id`, and `trial_end` added to the DO UPDATE SET clause. The upsert now correctly matches the trial row by company_id and updates it with Stripe subscription details.

---

### 🔴 CRITICAL: `handleSubscriptionUpdated` fallback INSERT can orphan company with two conflicting subscription rows

**Status: FIXED** by the same commit (same root cause, same fix).

---

### 🟠 HIGH: `startTrial` catch block is too broad — masks non-Stripe errors

**File:** `server/src/services/billing.ts:1411-1433`

**Status: FIXED** (this audit session).

The catch block now differentiates between `STRIPE_SECRET_KEY` errors (Stripe not configured → create placeholder) and real failures (network timeouts, DB errors, Stripe API errors → rethrow). Real operational errors are no longer silently swallowed. Previously, an empty catch block caught all errors and treated them as "Stripe not configured," masking network partitions, DB failures, and expired API keys.

---

### 🟠 HIGH: Trial reaper still has no concurrency guard

**File:** `server/src/index.ts:1595-1613`

**Status: FIXED** (pre-existing fix verified). The dynamic import is cached via `billingServiceCache`, and a `trialReaperRunning` boolean prevents overlapping runs. The startup sweep and interval both use the same `runTrialReaper()` function with consistent error handling.

---

### 🟡 MEDIUM: Partial index column mismatch between committed migration and Drizzle schema

**Files:**
- `packages/db/src/migrations/0231_trial_expiry_index.sql`
- `packages/db/src/schema/company_subscriptions.ts`

**Status: FIXED.** Both files now consistently use `(trial_end)` as the indexed column. The Drizzle schema defines the index on `table.trialEnd` with a WHERE clause filtering `status = 'trialing'`, matching the committed SQL.

---

### 🟡 MEDIUM: `emitMany` uses `Promise.all` — no batching, no ordering

**File:** `server/src/services/voyonder-bridge.ts:49-62`

**Status: ACCEPTED.** No production callers of `emitMany` exist — it's only exercised in tests. If future callers need ordering, serial execution can be added at that point. The interface contract matches the implementation.

---

### 🟡 MEDIUM: `handleCheckoutSessionCompleted` selects Stripe customer by `stripe_customer_id` (Stripe-side ID), not local PK

**File:** `server/src/services/billing.ts:476-510`

**Status: FIXED** (this audit session).

The customer lookup now falls back to `company_id` when the `stripe_customer_id` lookup fails. This handles the case where the trial placeholder customer (created when Stripe was not configured) has a synthetic `stripe_customer_id` like `trial-local-{companyId}`. When the fallback succeeds, the placeholder's `stripe_customer_id` is updated to the real Stripe customer ID so future lookups resolve directly.

---

### 🟢 INFO: `trialDays` default constant duplicated

**Files:**
- `packages/shared/src/validators/billing.ts`
- `server/src/routes/auth.ts:167`
- `server/src/services/billing.ts:1359`

**Status: ACCEPTED.** Minor duplication — not blocking. All defaults are consistent (14 days).

---

## 4. Summary of Current Findings

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | Trial reaper concurrency guard + dynamic import | 🟠 HIGH | ✅ FIXED |
| 2 | Trial-to-paid conversion ON CONFLICT bug | 🔴 CRITICAL | ✅ FIXED (3885b6b5f0) |
| 3 | `handleSubscriptionUpdated` orphan race (same root cause) | 🔴 CRITICAL | ✅ FIXED (3885b6b5f0) |
| 4 | `startTrial` overly broad catch block | 🟠 HIGH | ✅ FIXED (this audit) |
| 5 | Index column mismatch | 🟡 MEDIUM | ✅ FIXED |
| 6 | `emitMany` ordering | 🟡 MEDIUM | ✅ ACCEPTED |
| 7 | Customer lookup by Stripe ID in webhook handler | 🟡 MEDIUM | ✅ FIXED (this audit) |
| 8 | `trialDays` default duplication | 🟢 INFO | ✅ ACCEPTED |

---

## 5. Verification

All billing-related test suites pass:

| Test Suite | Tests | Result |
|------------|-------|--------|
| `billing-e2e-verify.test.ts` | 18 | ✅ All pass |
| `billing-concurrency.test.ts` | 7 | ✅ All pass |
| `billing-experiment-integration.test.ts` | 14 | ✅ All pass |
| `voyonder-bridge.test.ts` | 27 | ✅ All pass |

The typecheck on the server package passes (exit code 0).

---

## 6. Approval

**APPROVED** for CTO sign-off.

All critical, high, and medium-severity findings have been resolved:

- The trial-to-paid conversion ON CONFLICT bug is fixed (commit `3885b6b5f0`)
- The overly broad catch block in `startTrial` now differentiates between expected and unexpected errors
- The webhook handler now falls back to company_id lookup for trial placeholder customers
- The reaper has proper concurrency guards
- The index column mismatch is resolved
- All billing tests pass

Route to **CTO** for final sign-off before shipping.
