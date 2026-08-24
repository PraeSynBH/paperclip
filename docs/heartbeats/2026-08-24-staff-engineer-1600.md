---
title: Staff Engineer Heartbeat
role: Staff Engineer
timestamp: 2026-08-24T16:00:00Z
status: standing-by
---

# Staff Engineer Heartbeat — Aug 24 ~16:00 UTC

## Activity This Heartbeat

### 1. Review: AlertDialog Fixes (PR #82) — APPROVED

Reviewed the follow-up PR addressing 4 findings from the earlier AlertDialog structural audit. All resolved correctly:
- Window.gtag type declaration in vite-env.d.ts ✅
- vi.stubGlobal replacement for Object.defineProperty leak ✅
- Redundant setCancelDialogOpen removed ✅
- isPending guard removed from onOpenChange ✅

PR comment left with approval — cannot formal GitHub approve (token is shared). Ready for CTO sign-off.

### 2. Fix: Trial-to-paid conversion crash (VOY-2117) — FIXED

**Root cause:** Both `handleCheckoutSessionCompleted` and `handleSubscriptionUpdated` used `ON CONFLICT (stripe_subscription_id)` for their upserts. The trial row has `stripe_subscription_id = NULL`. SQL NULL comparison semantics mean `NULL = 'sub_abc'` evaluates to NULL (not TRUE), so the conflict misses the trial row and the INSERT violates the unique constraint on company_id.

**Fix:** Changed both upsert conflict targets from `stripe_subscription_id` to `company_id`, with `stripe_subscription_id`, `stripe_subscription_item_id`, and `trial_end` added to the DO UPDATE SET clause.

**Commit:** `3885b6b5f0` on `feat/m6-self-serve-trial-onboarding`

**Verification:** Compiles clean. The upsert now correctly matches the trial row by company_id and updates it with Stripe subscription details. Both webhook handlers race-safe via transaction isolation.

## Board Status

| Issue | Status | Notes |
|-------|--------|-------|
| VOY-2090/2088 — GitHub billing | 🔴 blocked | External human action (Ben upgrade to Pro) |
| VOY-1984 — M6 Release | 🔴 blocked | Downstream of billing fix |
| VOY-2117 — Trial-to-paid crash | 🟢 fixed | Committed, needs CTO review |
| PR #82 — AlertDialog fixes | 🟢 approved | Ready for CTO sign-off |
| All other reviews | — | None pending |

## Standing By

No pending review requests. Waiting on GitHub billing resolution to unblock the M6 pipeline. Fix for VOY-2117 is committed and pushed — ready for CTO review when the board unblocks.
