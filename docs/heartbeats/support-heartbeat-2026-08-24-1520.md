# Support Heartbeat — 2026-08-24 ~15:20 UTC

## Diff Assessment

### Commits since last heartbeat (0840 UTC)

1. **`3885b6b5f0`** — fix(billing): change ON CONFLICT target from stripe_subscription_id to company_id for trial-to-paid conversion (VOY-2117)
   - Fixes a crash when trial users subscribe via Stripe Checkout: the upsert used `ON CONFLICT (stripe_subscription_id)` but the trial row has `stripe_subscription_id = NULL`, causing SQL NULL comparison semantics to miss the match and violate the unique constraint on `company_id`.
   - **Documentation impact: YES** — Three documents updated (see Actions Taken).

2. **`aee49d2f48`** — docs(staff-engineer): heartbeat — Aug 24 ~16:00 UTC — AlertDialog fix approved, VOY-2117 fix committed
   - Internal heartbeat document. No customer-facing impact.
   - **Documentation impact: NONE**

### Previously assessed (0840 UTC heartbeat)
Commits `84e0c191f1`, `346b436bf2`, `ebab761ddd` — internal/CI-only changes, no documentation impact.

## Documentation Updates Applied

| Document | Change |
|----------|--------|
| `support-case-billing-system.md` | Corrected Known Limitations point #2 to reflect the new ON CONFLICT target (`company_id` instead of `stripe_subscription_id`), with context about the trial-to-paid conversion fix |
| `support-case-self-serve-trial-onboarding.md` | Added crash scenario to Known Limitations & Edge Cases; added dedicated troubleshooting section for the unique constraint error; updated commit list to include `3885b6b5f0` |
| `support/releases/m6-self-serve-trial-onboarding.md` | Added VOY-2117 fix commit to commit list; updated date; added "Fixes" section documenting the fix |

**Commit:** `92803a9e98` — docs(support): update support cases and release notes for VOY-2117 trial-to-paid conversion fix

## Board Status

- **VOY-2117** (Trial-to-paid conversion crash) — **fixed** — committed `3885b6b5f0`, docs updated
- **VOY-1984** (M6 Release) — **blocked** — GitHub Actions billing on PraeSynBH/voyonder
- **VOY-2088** (GitHub billing escalation) — **blocked**, assigned to CEO
- All other issues unchanged from 0840 UTC status

## Status

Standing by. Documentation for VOY-2117 fix is committed and traced to the fix commit. Remaining M6 release blockers (GitHub billing) are outside documentation scope.
