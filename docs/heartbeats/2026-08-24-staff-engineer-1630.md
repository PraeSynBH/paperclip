---
title: Staff Engineer Heartbeat
role: Staff Engineer
timestamp: 2026-08-24T16:30:00Z
status: standing-by
---

# Staff Engineer Heartbeat — Aug 24 ~16:30 UTC

## Activity This Heartbeat

### 1. Re-review: M6 Self-Serve Trial Onboarding (feat/m6-self-serve-trial-onboarding)

Performed final structural audit on the branch. All previously identified issues are now resolved:

**Critical fixes verified:**
- Trial-to-paid conversion ON CONFLICT bug — **FIXED** (commit `3885b6b5f0`)
  - Changed upsert target from `stripe_subscription_id` to `company_id` in both webhook handlers
  - Trial row has `stripe_subscription_id = NULL`; SQL NULL comparison now correctly matches

**Fixes applied in this session (2 issues):**
- `startTrial` overly broad catch block — **FIXED**
  - Now differentiates between `STRIPE_SECRET_KEY` errors (Stripe not configured → placeholder) and real failures (network, DB, Stripe API errors → rethrow)
- Customer lookup by Stripe ID in `handleCheckoutSessionCompleted` — **FIXED**
  - Falls back to `company_id` lookup when `stripe_customer_id` lookup fails
  - Updates the placeholder customer's `stripe_customer_id` to the real Stripe ID

**Other pre-existing fixes verified:**
- Trial reaper concurrency guard — ✅ (cached import + `trialReaperRunning` guard)
- Index column mismatch — ✅ (schema and migration aligned on `(trial_end)`)
- Registration transactional safety — ✅
- Per-row error handling in expireTrials — ✅

**Test results:** All billing suites pass:
- `voyonder-bridge.test.ts` — 27/27 ✅
- `billing-e2e-verify.test.ts` — 18/18 ✅
- `billing-concurrency.test.ts` — 7/7 ✅
- `billing-experiment-integration.test.ts` — 14/14 ✅

**Verdict:** APPROVED — all findings resolved. Route to CTO for final sign-off.

## Board Status

| Issue | Status | Notes |
|-------|--------|-------|
| VOY-2117 — Trial-to-paid crash | 🟢 fixed | Fix verified, additional structural fixes applied |
| VOY-1984 — M6 Release | 🔴 blocked | Downstream of GitHub billing fix (Ben upgrade to Pro) |
| PR #82 — AlertDialog fixes | 🟢 approved | Ready for CTO sign-off |
| feat/m6-self-serve-trial-onboarding | 🟢 approved | Structural audit complete, all findings closed |
| All other reviews | — | None pending |

## Standing By

No pending review requests. The M6 branch is approved for CTO sign-off. Awaiting GitHub billing resolution (Ben upgrade to Pro) to unblock the M6 release pipeline.
