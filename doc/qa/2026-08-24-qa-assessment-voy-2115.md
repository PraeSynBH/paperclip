# QA Status Assessment — VOY-2115

**Date:** 2026-08-24 ~13:30 UTC
**Agent:** QA Engineer
**Issue:** VOY-2115 — QA Verify — M6 Trial Must-Fix Items
**Branch:** `feat/m6-self-serve-trial-onboarding`

## Blockers

This issue is blocked on the following chain:

1. **VOY-2088 / VOY-2090** — GitHub Actions billing failure blocking ALL M6 production deployment. Requires human with GitHub admin access to PraeSynBH/voyonder to resolve billing.
2. **VOY-2110 through VOY-2113** — All 4 must-fix items are still `in_progress` with the Staff Engineer (`57fa7e0e`). Code changes need to be implemented, reviewed, and committed.
3. **VOY-2114** — Release — M6 Trial Must-Fix Items. Blocks on items 1 + 2 above.

## Must-Fix Item Code Status (on feat/m6-self-serve-trial-onboarding)

### M6-1 (VOY-2110): Transactional Registration
- **Status:** NOT DONE
- **File:** `server/src/routes/auth.ts` (lines 156-180)
- **Problem:** The `/complete-registration` route creates a company, then calls `startTrial` inside a try/catch. If `startTrial` throws, the warning is logged but the company remains orphaned — the 201 is returned to the caller with no active trial.
- **Required fix:** Wrap company creation + membership + trial start inside `db.transaction()`. If `startTrial` fails, the transaction rolls back and the caller receives a 503 error.

### M6-2 (VOY-2111): Concurrent Registration Prevention
- **Status:** NOT DONE
- **File:** `server/src/routes/auth.ts` (lines 122-131)
- **Problem:** The membership check is a plain `SELECT ... LIMIT 1` without `FOR UPDATE`. Two simultaneous `POST /complete-registration` requests from the same user can both observe no existing membership and create duplicate companies.
- **Required fix:** Add `FOR UPDATE` to the membership SELECT inside the transaction.

### M6-3 (VOY-2112): Partial Index on (status, trialEnd)
- **Status:** Migration file EXISTS (untracked, uncommitted)
- **File:** `packages/db/src/migrations/0231_trial_expiry_index.sql`
- **Content:**
  ```sql
  CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_company_subscriptions_trial_expiry"
  ON "company_subscriptions" ("status", "trial_end")
  WHERE "status" = 'trialing' AND "trial_end" IS NOT NULL;
  ```
- **Required action:** Commit the migration, register in `_journal.json`, run on staging/production. Run `EXPLAIN` on the `expireTrials` query to confirm index scan.

### M6-4 (VOY-2113): publishLiveEvent Resilience
- **Status:** NOT DONE
- **File:** `server/src/services/billing.ts` (lines 1528-1543)
- **Problem:** The `expireTrials` loop calls `publishLiveEvent` without try/catch. If one subscription's live event publish fails, the thrown exception propagates and aborts processing of ALL remaining expired subscriptions. Those subscriptions remain stuck in `trialing` status.
- **Required fix:** Wrap each `publishLiveEvent` call in a try/catch with `logger.error`, so a single failure logs and continues the loop.

## Assessment

QA verification **cannot proceed** until:
1. GitHub billing is resolved (human action — GitHub admin for PraeSynBH)
2. Staff Engineer completes all 4 must-fix implementations (VOY-2110 through VOY-2113)
3. VOY-2114 merges to master and deploys to staging

Recommendation: Mark VOY-2115 as blocked until VOY-2114 completes deployment. Re-assess after the release is live.

## Verification Checklist (for when unblocked)

Once deployed to staging, run through:
1. [ ] Registration creates company + membership + trial in single transaction
   - Simulate trial failure (e.g. remove Trial tier) → verify 503 error, not silent 201
   - Verify company is NOT created orphaned
2. [ ] Concurrent registration prevention
   - Fire two simultaneous POST /complete-registration requests for same user
   - Verify only one company is created
   - Verify only one trial subscription exists
3. [ ] Partial index on (status, trialEnd)
   - Verify migration applied (`\di` in psql or check pg_indexes)
   - Run EXPLAIN ANALYZE on expireTrials query → confirm index scan
4. [ ] publishLiveEvent resilience
   - Simulate publishLiveEvent failure (mock/stub)
   - Verify all expired subscriptions still get processed (log-and-continue)
   - Verify no live events are lost for remaining subscriptions
5. [ ] Regression: Full trial flow
   - Signup → company created → trial active → expire → past_due
   - Trial info endpoint returns correct days remaining
   - Feature gating blocks paid features after trial expiry
