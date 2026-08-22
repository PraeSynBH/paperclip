# Staff Engineer — Final Disposition: Billing Structural Fixes Audit

**Date:** 2026-08-22 ~12:00 UTC
**Reviewer:** Staff Engineer
**Audited commit:** c609132363 (HEAD 22c5de5aeb)
**Branch:** `custom` (tracking `origin/docs-deploy-voy-1413`)

## Disposition: CONDITIONALLY APPROVED

All 3 structural findings from the Round 1 audit have been correctly addressed.
2 new P1 issues were found that must be fixed before production billing is enabled.

## Child Issues Created

| Issue | Severity | Title |
|-------|----------|-------|
| VOY-1649 | P1 | Fix P1-1: Apply withStripeRetry to remaining Stripe API calls |
| VOY-1650 | P1 | Fix P1-2: TOCTOU race in createOrUpdateSubscription |
| VOY-1651 | P2 | Fix P2: Add transaction wrapping to handleInvoicePaymentFailed and handleSubscriptionDeleted |
| VOY-1652 | P2 | Fix P2: reportUsage has read-then-write race on usage records |

## Routing

Approve → CTO for sign-off → Implementer for P1 fixes → Release Engineer for production deployment with `PAPERCLIP_BILLING_ENABLED=true`.

The code is safe to stage with `PAPERCLIP_BILLING_ENABLED=false` (the default — billing code does not execute when the env var is unset/false).

## Detail

Full audit report: `doc/review/2026-08-22-billing-service-structural-audit-round2.md`
