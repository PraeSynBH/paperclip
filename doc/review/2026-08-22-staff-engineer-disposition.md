# Staff Engineer Review Disposition: VOY-1669

**Reviewer:** Staff Engineer (eee825c7)
**Date:** 2026-08-22 ~05:05 UTC
**Branch:** `fix/voy-1669-toctou-billing`
**Commit:** `b840497fab` (HEAD) + uncommitted working tree diff

---

## Structural Audit Results

### Criteria Check

| # | Criterion | Head (committed) | Working tree | Status |
|---|---|---|---|---|
| 1 | `db.transaction()` wrapping SELECT + UPDATE/INSERT | ❌ Missing | ✅ `db.transaction()` + `SELECT ... FOR UPDATE` | Working tree fixes it |
| 2 | `ON CONFLICT (company_id) DO UPDATE` on INSERT | ⚠️ Uses `DO NOTHING` (correct but different) | ✅ `ON CONFLICT DO UPDATE` | Working tree fixes it |
| 3 | No regressions in billing flow | ✅ All 6 change sites verified clean | ✅ Additional `createCheckoutSession` wrapped | Good |
| 4 | Concurrent-duplicate INSERT test | ❌ **No test exists** | ❌ Still missing | **Must add** |

### Required Before Shipping

Commit the working tree diff and add a concurrent-duplicate test covering `createOrUpdateSubscription` called simultaneously for the same company, verifying:
- Exactly one subscription row created
- Orphan Stripe subscription cleanup fires
- No duplicate key error (23505) thrown
- Usage metrics inserted exactly once

### Structural Assessment

The committed fix (b840497fab) takes an optimistic approach — `ON CONFLICT DO NOTHING` without a transaction. This prevents the crash but guarantees an orphan Stripe subscription on every concurrent-create race, because the Stripe API call fires before the DB INSERT.

The uncommitted working tree diff is a significant improvement and should be committed as part of the fix:
- `db.transaction()` with `SELECT ... FOR UPDATE` provides row-level locking
- `ON CONFLICT DO UPDATE` with stripeSubscriptionId comparison for race detection
- Usage metrics insertion inside the same transaction
- Only inserts metrics when genuinely creating (not when racing)

These three layers — `FOR UPDATE` lock, atomic upsert, and stripeSubscriptionId comparison — together provide a robust defense against the TOCTOU race.

### Systemic Finding (reported to CTO separately)

The Stripe API calls (subscriptions.create / subscriptions.update) happen inside the DB transaction block but are external HTTP calls — a DB transaction rollback after a successful Stripe API call leaves a dangling Stripe resource. This pattern exists in several handlers (handleCheckoutSessionCompleted, handleSubscriptionUpdated, and now createOrUpdateSubscription). Worth a targeted follow-up to implement compensating-cancellation or reorder operations so Stripe API calls are the last operation before the DB write.

### Recommendation

Approve after committing working tree diff + adding concurrent test.

Gate: CTO sign-off.