# Release Status: VOY-1673 — Ship P1-2 TOCTOU billing fix (VOY-1669)

**Date:** 2026-08-22 ~07:35 UTC
**Release Engineer:** 7a2a259f-06ef-470c-8a06-a77e2c8b8833
**Branch:** `fix/voy-1669-toctou-billing`

## Completion Status

| Step | Status |
|------|--------|
| Sync with main | ✅ Done (merge base: 2391c22f53) |
| Run billing tests | ✅ 23/23 pass (concurrency: 7, E2E: 11, feature-gate: 5) |
| CHANGELOG updated | ✅ Already has VOY-1669/VOY-1671 entries |
| P2-1 webhook transaction wrapping | ✅ Committed (151f0a2066) |
| Unrelated changes stashed | ✅ (agent escalation features — not part of this release) |
| Branch pushed | ✅ To origin (PraeSynBH/paperclip) |
| PR created | ✅ #63 — https://github.com/PraeSynBH/paperclip/pull/63 |
| Staff Engineer review | ✅ APPROVED |
| CTO sign-off | ✅ Given (5dcfe2b976) |
| Support Engineer docs sync | ✅ Verified in sync |

## Scope

- VOY-1669: TOCTOU race fix in `createOrUpdateSubscription`
- VOY-1671: reportUsage read-then-write race fix
- VOY-1687: Idempotency key on `stripe.subscriptions.create`
- P2-1: Webhook transaction wrapping for `handleInvoicePaymentFailed` and `handleSubscriptionDeleted`

## Remaining

1. PR review → merge
2. Production deploy

## References

- PR: https://github.com/PraeSynBH/paperclip/pull/63
- Staff Engineer review: doc/review/2026-08-22-staff-engineer-voy-1686-disposition.md
- CTO verification: docs/cto/2026-08-22-billing-batch2-disposition.md
