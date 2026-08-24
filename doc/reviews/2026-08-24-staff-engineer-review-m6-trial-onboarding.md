# Staff Engineer Review — M6 Self-Serve Trial Onboarding

**Branch:** `feat/m6-self-serve-trial-onboarding`
**Base:** `master`
**Reviewer:** Staff Engineer
**Date:** 2026-08-24

## Summary

This branch implements the self-serve trial onboarding flow: user signs up → company created → trial subscription started. The diff touches 39 files across server, UI, shared validators, and docs. The core logic is in `server/src/services/billing.ts` (startTrial, getTrialInfo, expireTrials), `server/src/routes/auth.ts` (POST /complete-registration), and `server/src/index.ts` (trial expiry reaper).

The ON CONFLICT and race-lost handling inside `startTrial` is well done. The idempotency design is sound. However, there are structural issues in the registration flow and the reaper that must be fixed before this ships.

---

## Must Fix Before Shipping

### 1. Registration flow is not transactional — trial failure leaves company in limbo

**File:** `server/src/routes/auth.ts:157-180`

The registration performs four steps sequentially without a wrapping DB transaction:

1. `companies.create(...)` — creates the company
2. `access.ensureMembership(...)` / `ensureRoleDefaultGrants(...)` — binds the user
3. `billing.startTrial(...)` — starts the trial (error **swallowed**)
4. `logActivity(...)` — audit log

If step 3 fails (e.g. Trial tier not seeded, Stripe misconfigured, DB transient error), the catch block at line 175-180 **swallows the error** and the route returns `201 Created` with `created: true`. The company exists but has no subscription nor trial. The user lands on their dashboard thinking they're set up, and will hit a paywall immediately with no explanation.

**Fix:** Either wrap steps 1-3 in a transaction and let errors propagate (503 instead of silent success), or at minimum return a partial-success response (`created: true, trialStarted: false`) so the client can show a warning. Swallowing the error behind a 201 is a broken invariant.

### 2. Concurrent registration race creates orphan companies

**File:** `server/src/routes/auth.ts:122-164`

Two simultaneous `POST /complete-registration` requests from the same user pass the membership check (line 123-131) concurrently, because there's no pessimistic lock or transaction. Both will create separate companies (different UUIDs), both get membership in their respective companies, and both start trials. The user ends up with **two companies on trial** instead of one.

The unique constraint `company_memberships_company_principal_unique_idx` prevents duplicate memberships *within the same company*, but the companies themselves have different IDs. The result is:

- Company A (user=owner, status=trialing) — created by request 1
- Company B (user=owner, status=trialing) — created by request 2
- User only sees Company B in the UI (whichever the session settles on)

**Fix:** Wrap the company + membership + trial creation in a transaction. Use `SELECT ... FOR UPDATE` on a user-scoped lock row, or use `pg_advisory_xact_lock()` for a lightweight named lock scoped to the user ID. Alternatively, defer to the unique constraint on `company_memberships_company_principal_unique_idx` by checking membership *inside* the same transaction that creates the company, so the second request fails rather than succeeding silently.

### 3. Missing composite index on (status, trialEnd)

**File:** `server/src/services/billing.ts:1510-1526`

The `expireTrials()` query runs every 30 minutes:

```sql
UPDATE company_subscriptions
SET status = 'past_due', updated_at = $1
WHERE status = 'trialing'
  AND trial_end IS NOT NULL
  AND trial_end < $2
RETURNING id, company_id
```

There is no composite index on `(status, trial_end)`. The table has `company_subscriptions_company_idx` (on company_id) and `company_subscriptions_company_unique_idx` (unique on company_id), but neither covers this query. As the subscriber base grows, this update will sequential-scan. With a 30-minute interval, a slow scan on a large table becomes self-reinforcing — the reaper may not finish before the next tick.

**Fix:** Add a partial index:
```sql
CREATE INDEX CONCURRENTLY idx_trialing_expiry
  ON company_subscriptions (trial_end)
  WHERE status = 'trialing' AND trial_end IS NOT NULL;
```

### 4. publishLiveEvent failures in expireTrials lose remaining events

**File:** `server/src/services/billing.ts:1528-1543`

After the UPDATE succeeds, the code iterates over expired subscriptions and calls `publishLiveEvent` for each. If one call throws (e.g. Redis is down, event channel saturated), the loop aborts and remaining expired subscriptions do not get their live events dispatched. The subscriptions have already been transitioned to `past_due` in the DB, but no live notification fires for those companies.

**Fix:** Either:
- Collect all events and fire them in a single batch call (if available), or
- Wrap each `publishLiveEvent` in a try/catch so one failure doesn't abort the rest, or
- Log-and-continue so the loop drains fully

---

## Should Fix

### 5. startTrial does not validate trialDays internally

**File:** `server/src/services/billing.ts:1349`

```ts
const trialDays = options?.trialDays ?? 14;
const trialEnd = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
```

No validation on `trialDays`. The auth route uses the zod-validated request body (which enforces `z.number().int().min(1).max(90)`), but the `/billing/start-trial` route (line 320) calls `startTrial` with no `validate()` middleware and ignores the request body entirely — so it's harmless for now. However, any future caller that passes an invalid value (negative, NaN, >90) will silently create a wrong trial window.

**Fix:** Add an internal clamp/guard:
```ts
const trialDays = Math.max(1, Math.min(90, Math.floor(options?.trialDays ?? 14)));
```

### 6. Dynamic import in trial reaper is unreliable

**File:** `server/src/index.ts:1582-1605`

Both the interval and startup sweep use `import("./services/billing.js")` which resolves to the same ESM cached module every time. If the dynamic import fails once (e.g. transient file-read error), the reaper stays dead until the server is restarted. The startup import failure (line 1597) is logged as `warn` (not `error`), so ops might miss it.

**Fix:** Import `billingService` statically at the top of the file or memoize the result of the first successful dynamic import. Change the startup failure log level to `error`.

### 7. `db as any` cast loses type safety

**File:** `server/src/index.ts:1584,1598`

```ts
bs(db as any).expireTrials()
```

`billingService(db)` has a well-defined return type. The `as any` cast on `db` silently bypasses any future type mismatch. Since the module is already loaded at this point, just call `billingService(db)` with the proper type.

---

## Notes (Non-Blocking)

- The dynamic import pattern in the reaper is defensible as lazy-loading, but the startup call (line 1597) eagerly loads it anyway, defeating the purpose.
- The `package.json` addition of `test:a11y` and `@axe-core/playwright` plus the `aria-label` additions to `Sidebar.tsx` and `Layout.tsx` are unrelated accessibility improvements piggybacking on this diff. They're fine, but they should be called out in the PR description as scope creep.
- The SEO test file (`seo.test.ts`) is unrelated to this feature and appears to be a carry-over from a merge. Confirm it belongs in this diff.

---

## Recommendation

**CONDITIONAL APPROVAL** — address items 1-4 before shipping. Items 5-7 should be fixed but are not blockers.

Routing to CTO for final go/no-go decision.

---