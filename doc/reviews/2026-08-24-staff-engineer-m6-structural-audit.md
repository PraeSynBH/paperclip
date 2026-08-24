# Staff Engineer — Structural Audit: M6 Self-Serve Trial Onboarding (Re-review)

**Branch:** `feat/m6-self-serve-trial-onboarding` (ahead 8 behind 0 vs master)
**Audit Date:** 2026-08-24
**Reviewer:** Staff Engineer (eee825c7)
**Previous audit:** `doc/reviews/2026-08-24-staff-engineer-m6-structural-audit.md`

---

## 1. Change Summary

This branch implements self-serve trial onboarding (M6) and carries additional M5 pricing experiment infrastructure, SEO metadata, Voyonder code separation, and accessibility improvements. Since the previous audit, 3 fix commits have landed (VOY-2111, VOY-2112, VOY-2113).

---

## 2. Previously Identified Issues — Status Check

### Previously Critical/High — Must Fix

| # | Issue | Previous Status | Current Status | Verdict |
|---|-------|----------------|----------------|---------|
| 1 | Registration flow not transactional | ❌ Not fixed | **FIXED** (d37fb3db22 — transaction + pg_advisory_xact_lock + FOR UPDATE) | ✅ |
| 2 | Trial failure silently returns 201 | ❌ Not fixed | **FIXED** (d37fb3db22 — errors now propagate, no try-catch) | ✅ |
| 3 | `publishLiveEvent` failures lose remaining events | ❌ Not fixed | **FIXED** (5dd66e81 — per-row try/catch in expireTrials) | ✅ |
| 4 | Trial reaper no concurrency guard + dynamic import | ❌ Not fixed | **STILL OPEN** — see §3 below | ❌ |
| 5 | Trial expiry index migration untracked | ❌ Not committed | **FIXED** (5dd66e81 — migration committed). However working tree modifies the index columns — see §3. | ✅ (pending fix) |

### Previously Medium — Should Fix

| # | Issue | Status | Verdict |
|---|-------|--------|---------|
| 6 | `trialDays` client-controlled up to 90 days | ⚠️ By design | Accept. Flag for future config. |
| 7 | Stripe customer creation outside subscription transaction | ⚠️ Pre-existing pattern | Accept. Self-healing on retry. |
| 8 | `start-trial` route could use tighter admin auth | ⚠️ Existing pattern | Accept. Not blocking. |

---

## 3. New Findings

### 🔴 CRITICAL: Trial-to-paid conversion fails — webhook ON CONFLICT target does not match trial row

**Files:**
- `server/src/services/billing.ts:489-511` (`handleCheckoutSessionCompleted`)
- `server/src/services/billing.ts:335-357` (`handleSubscriptionUpdated`)

**Issue:**
When a user completes a Stripe Checkout session after starting a local trial, both `handleCheckoutSessionCompleted` and `handleSubscriptionUpdated` attempt:

```sql
INSERT INTO "company_subscriptions" ("company_id", ...)
VALUES ($companyId, ...)
ON CONFLICT ("stripe_subscription_id") DO UPDATE SET ...
```

The ON CONFLICT target is `stripe_subscription_id`. The existing trial row has `stripe_subscription_id = NULL`. SQL NULL comparison semantics mean `NULL = 'sub_abc'` evaluates to `NULL` (not TRUE), so the conflict does **not** match the trial row. The INSERT attempts to create a **second row** for the same `company_id`, which violates the `company_subscriptions_company_unique_idx` UNIQUE constraint on `company_id`.

The transaction aborts with a constraint violation, the webhook handler fails, and the user's subscription is never recorded locally. The user sees "payment successful" from Stripe but the local system never transitions from trial to paid.

**Trigger path:**
```
startTrial() → INSERT company_subscriptions (company_id=X, stripe_subscription_id=NULL, status='trialing')
  → User completes Stripe Checkout
  → handleCheckoutSessionCompleted() → INSERT ... ON CONFLICT (stripe_subscription_id)
  → NULL != 'sub_abc' → no conflict match → tries to insert row for company_id=X
  → UNIQUE constraint violation on company_id → transaction aborts
```

**Race/intent note:** The `createOrUpdateSubscription` route (used by server-side subscription API, not the webhook path) correctly uses `ON CONFLICT (company_id) DO UPDATE` with `FOR UPDATE` locking. But the webhook handlers — which are the actual path trial users take when subscribing via Stripe Checkout — use the wrong conflict target.

**Severity:** Critical — blocks the core conversion funnel (trial → paid). Every trial user who attempts to subscribe will hit this error silently (the webhook handler logs and returns without throwing, so the Stripe Checkout succeeds but the local subscription is never created).

**Fix:**
In `handleCheckoutSessionCompleted` and `handleSubscriptionUpdated`, change the upsert to target `company_id` instead of `stripe_subscription_id`, or use a two-step approach:
1. First try UPDATE by `company_id` where `stripe_subscription_id IS NULL` (upgrade the trial row)
2. Fall back to INSERT ON CONFLICT (`stripe_subscription_id`) for the normal case

The cleanest fix: use `ON CONFLICT (company_id) DO UPDATE` in both handlers, matching the pattern already used by `createOrUpdateSubscription`.

---

### 🔴 CRITICAL: `handleSubscriptionUpdated` fallback INSERT can orphan company with two conflicting subscription rows

**File:** `server/src/services/billing.ts:289-377`

**Issue:** The `handleSubscriptionUpdated` webhook handler checks for an existing subscription by `stripe_subscription_id`. If the trial row has `stripe_subscription_id = NULL`, the check misses it. The handler then attempts a fallback INSERT with `ON CONFLICT (stripe_subscription_id)`. As described above, this fails with a unique constraint violation on `company_id`.

But there's a **second-order effect**: the error is caught at the transaction level (if at all — the handler does not have a try-catch around the transaction). If the DB error propagates, the express webhook handler returns a 500, Stripe retries the webhook event, and each retry also fails. The company is permanently stuck in trial mode with no way to subscribe through the webhook path.

**Severity:** Critical — permanent stuck state. Requires manual DB intervention to fix.

**Fix:** Same as above — use `ON CONFLICT (company_id)` or pre-check + upgrade pattern.

---

### 🟠 HIGH: `startTrial` catch block is too broad — masks non-Stripe errors

**File:** `server/src/services/billing.ts:861-864`

```typescript
try {
  const cust = await getOrCreateStripeCustomer(companyId);
  stripeCustomerId = cust.id;
} catch {
  // Stripe not configured — create a placeholder customer row
  const [record] = await db.execute(sql`
    INSERT INTO "stripe_customers" ...
  `);
  ...
}
```

**Issue:** The empty `catch` block assumes the only reason `getOrCreateStripeCustomer` throws is that Stripe is not configured. But it can throw for other reasons:
- `getStripeClient()` throws if `STRIPE_SECRET_KEY` is empty — this is the intended case
- Network timeout — `withStripeRetry` exhausts retries and re-throws
- DB connection error during the `stripe_customers` SELECT
- Stripe API returns a non-retryable error (e.g., 401 from invalid key)

All of these are silently swallowed and treated as "Stripe not configured." The function creates a local placeholder `trial-local-{companyId}` customer and continues. The error is lost — no log, no metric, no alert.

**Severity:** High — masks real operational errors (network partitions, DB failures, expired API keys). Production observability is blind to these failures.

**Fix:**
```typescript
try {
  const cust = await getOrCreateStripeCustomer(companyId);
  stripeCustomerId = cust.id;
} catch (err) {
  if (err instanceof Error && err.message.includes("STRIPE_SECRET_KEY")) {
    // Stripe not configured — local-only trial
    // ... create placeholder ...
  } else {
    // Real error — rethrow
    throw err;
  }
}
```

Or even better: check `getStripeClient()` separately first, and only call `getOrCreateStripeCustomer` when Stripe is configured.

---

### 🟠 HIGH: Trial reaper still has no concurrency guard

**File:** `server/src/index.ts:1582-1605`

**Issue:** The reaper still:
1. Uses `import("./services/billing.js")` dynamically every 30 minutes (wasteful, fragile)
2. Has no concurrency guard — if `expireTrials()` takes >30 minutes, overlapping runs produce duplicate live events

The startup sweep at line 1597 doesn't have retry logic, while the interval does (via the `import` try-catch). Inconsistent error handling.

**Severity:** High at scale. Currently low probability (<30min sweep) but grows with customer base.

**Fix:**
```typescript
const billingServiceInstance = billingService(db);
let reaperRunning = false;

setInterval(async () => {
  if (reaperRunning) return;
  reaperRunning = true;
  try {
    const count = await billingServiceInstance.expireTrials();
    if (count > 0) logger.info({ count }, "Trial reaper expired subscriptions");
  } catch (err) {
    logger.error({ err }, "Trial reaper failed");
  } finally {
    reaperRunning = false;
  }
}, TRIAL_REAPER_INTERVAL_MS).unref();

// Startup sweep
try {
  const count = await billingServiceInstance.expireTrials();
  if (count > 0) logger.info({ count }, "Trial reaper expired subscriptions on startup");
} catch (err) {
  logger.warn({ err }, "Trial reaper startup sweep failed (non-fatal)");
}
```

---

### 🟡 MEDIUM: Partial index column mismatch between committed migration and Drizzle schema

**Files:**
- `packages/db/src/migrations/0231_trial_expiry_index.sql` (committed: `(status, trial_end)`, working tree: `(trial_end)`)
- `packages/db/src/schema/company_subscriptions.ts` (working tree: `.on(table.trialEnd)`)

**Issue:** The committed migration (5dd66e81) creates the partial index with columns `(status, trial_end)`. The working tree changes both the SQL file and the Drizzle schema definition to `(trial_end)` only. These must be consistent.

**Analysis:** For the `expireTrials` query:
```sql
WHERE status = 'trialing' AND trial_end IS NOT NULL AND trial_end < $1
```
The partial index already filters on `status = 'trialing'`, so including `status` in the indexed columns is redundant for index scans. The change to `(trial_end)` alone is **correct** — it produces a smaller, more efficient index for the range query. But:

1. If 0231 was already applied to any database with `(status, trial_end)`, changing the Drizzle schema alone won't retroactively change the production index
2. If anyone regenerates migrations from the schema, the generated SQL will differ from the committed migration

**Fix:** Commit the working tree changes (both the SQL migration and the schema file) so they are atomically consistent. Add a DROP/CREATE sequence or use `CREATE INDEX IF NOT EXISTS` with the new definition so production and schema stay in sync. Since `IF NOT EXISTS` ignores existing indexes with the same name, production will keep the old `(status, trial_end)` index — which is still functionally correct, just slightly larger.

---

### 🟡 MEDIUM: `handleSubscriptionUpdated` calls Stripe API inside DB transaction

**File:** `server/src/services/billing.ts:289-377`

**Issue:** `handleSubscriptionUpdated` does NOT call Stripe APIs inside the transaction (it only does local DB work). This is correct. However, the `publishLiveEvent` call at line 381 is outside the transaction, which is the right pattern. **No bug here** — this is fine.

Wait — re-reading the code: the Stripe subscription retrieve is NOT inside the transaction. Only the DB read/write is inside the transaction. This is correct. Strike this finding.

---

### 🟡 MEDIUM: `emitMany` uses `Promise.all` — no batching, no ordering

**File:** `server/src/services/voyonder-bridge.ts:39-50`

```typescript
async emitMany(events: Array<{...}>): Promise<LiveEvent[]> {
  return Promise.all(
    events.map((e) =>
      publishLiveEvent({ companyId: e.companyId, type: e.type, payload: e.payload }),
    ),
  );
}
```

**Issue:** `Promise.all` fires all events concurrently. If this is used for bulk background-job status updates, events may arrive out of order (e.g., "succeeded" before "running" if the "running" event hits a slow listener). The downstream subscriber sees a status regression.

**Severity:** Medium — depends on how Voyonder uses `emitMany`. If it's used for batch job status updates, ordering matters.

**Fix:** Use serial execution or a sequenced approach if event ordering matters for the consumer.

---

### 🟡 MEDIUM: `handleCheckoutSessionCompleted` selects Stripe customer by `stripe_customer_id` (the Stripe-side ID), not local PK

**File:** `server/src/services/billing.ts:470-474`

```typescript
const cust = await tx
  .select()
  .from(stripeCustomersTable)
  .where(eq(stripeCustomersTable.stripeCustomerId, stripeCustomerId as string))
  .then((r) => r[0] ?? null);
```

**Issue:** This selects by the Stripe-side customer ID (e.g., `cus_xxx`), not the local PK. If `getOrCreateStripeCustomer` returned a local placeholder with `stripe_customer_id = 'trial-local-{companyId}'`, this query would fail to find the row (since the placeholder's `stripe_customer_id` is a synthetic string, not a real Stripe customer ID). The handler would log a warning and return without creating the subscription.

This compounds the trial-to-paid conversion bug above.

**Severity:** Medium — secondary effect of the broader trial-to-paid conversion bug.

---

### 🟢 INFO: `trialDays` default constant duplicated

**Files:**
- `packages/shared/src/validators/billing.ts:35` — schema default: `trialDays: z.number().int().min(1).max(90).optional()`
- `server/src/routes/auth.ts:167` — default: `const trialDays = body.trialDays ?? 14;`
- `server/src/services/billing.ts:837` — default: `const trialDays = options?.trialDays ?? 14;`

The default of 14 days is duplicated in two places. If the default changes in the future, one could be missed. Minor — not blocking.

---

## 4. Summary of Current Findings

### Unfixed from previous audit

| # | Issue | Severity | File(s) |
|---|-------|----------|---------|
| 1 | Trial reaper concurrency guard missing + dynamic import | 🟠 HIGH | `server/src/index.ts:1582-1605` |

### New findings

| # | Issue | Severity | File(s) |
|---|-------|----------|---------|
| 2 | Trial-to-paid conversion fails — webhook ON CONFLICT misses trial row | 🔴 CRITICAL | `server/src/services/billing.ts:489-511`, `server/src/services/billing.ts:335-357` |
| 3 | `handleSubscriptionUpdated` fallback INSERT can orphan company (same root cause as #2) | 🔴 CRITICAL | `server/src/services/billing.ts:289-377` |
| 4 | `startTrial` catch block too broad — masks non-Stripe errors | 🟠 HIGH | `server/src/services/billing.ts:861-864` |
| 5 | Partial index column mismatch (committed `(status,trial_end)` vs working tree `(trial_end)`) | 🟡 MEDIUM | `packages/db/src/migrations/0231_trial_expiry_index.sql`, `packages/db/src/schema/company_subscriptions.ts` |
| 6 | `emitMany` has no ordering guarantee | 🟡 MEDIUM | `server/src/services/voyonder-bridge.ts:39-50` |
| 7 | Webhook handler selects by Stripe customer ID, not local PK — compounds #2 | 🟡 MEDIUM | `server/src/services/billing.ts:470-474` |
| 8 | `trialDays` default duplicated in two places | 🟢 INFO | `server/src/routes/auth.ts:167`, `server/src/services/billing.ts:837` |

---

## 5. Approval

**BLOCKED.** Issues #2 and #3 are critical structural bugs that block the trial-to-paid conversion funnel. Every trial user who attempts to subscribe via Stripe Checkout will hit a unique constraint violation. This must be fixed before shipping.

Issue #4 (overly broad catch in startTrial) should be addressed — it masks operational errors.

Issue #5 (index column mismatch) should be committed before shipping to keep the schema and migration in sync.

Issue #1 (reaper concurrency) is a pre-existing finding that remains open — fix it as part of this branch since it's M6 scope.

Once fixed, route to **CTO** for final sign-off. The fixes are well-structured — the three previous fixes (VOY-2111, VOY-2112, VOY-2113) demonstrate the team can address structural issues cleanly. The critical fix needed now is changing the upsert conflict target in `handleCheckoutSessionCompleted` and `handleSubscriptionUpdated` from `stripe_subscription_id` to `company_id`.
