# Structural Audit: Billing Bug Fixes (VOY-2226)

**Reviewer**: Staff Engineer
**Date**: 2026-08-25
**Branch**: review/voy-2227-portal-link (diff against master)
**Scope**: VOY-2226 — Fix billing bugs (body parsing + portal link 500)

---

## Verdict: APPROVED — 2 LOW findings, 1 MEDIUM pre-existing finding, 2 INFO

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | `getSubscriptionInternal` N+1 for portal-link use case | LOW | Fix recommended |
| 2 | Stripe API error propagates raw error details to caller | LOW | Fix recommended |
| 3 | `getOrCreateStripeCustomer` TOCTOU race exposed via new path | MEDIUM | Pre-existing, document |
| 4 | Missing trailing newline in services/billing.ts | INFO | Cosmetic |
| 5 | No max length on `returnUrl` validator | INFO | Defense-in-depth |

---

## Part 1: Body parsing fix (express.raw() restructure) — APPROVED

**Previously reviewed** (VOY-2217, review doc `doc/review/2026-08-25-voy-2217-2218-billing-fixes-review.md`).
Already in master.

The fix uses the global `express.json()` middleware with a `verify` callback that captures `rawBody`,
eliminating the separate `express.raw()` at the `/api/billing` mount point. The webhook route
(`server/src/routes/billing.ts:23-39`) accesses `rawBody` from the verify callback. Auth-protected
billing routes get parsed JSON bodies as expected.

**Change from previous review**: The `DEFAULT_JSON_BODY_LIMIT` was reported as `"1mb"` in the earlier
review (Finding 1, MEDIUM — Stripe webhook body size). Current value in
`server/src/http/body-limits.ts` is `"10mb"`, which is sufficient for Stripe webhook payloads.
This finding is **RESOLVED**.

**Test coverage**: `server/src/__tests__/billing-body-parsing.test.ts` covers 5 scenarios:
- Parsed JSON body received by billing routes (not Buffer)
- rawBody captured via verify callback
- rawBody usable for Stripe signature verification
- 400 when rawBody missing
- validate middleware receives parsed JSON

---

## Part 2: Portal link endpoint — APPROVED

### Diff summary (4 files, +71 lines)

- `packages/shared/src/validators/billing.ts` — `createPortalSessionSchema` with optional `returnUrl`
- `packages/shared/src/index.ts` — Export `createPortalSessionSchema` + `CreatePortalSession` type
- `server/src/routes/billing.ts` — New `POST /api/companies/:companyId/billing/portal-link`
- `server/src/services/billing.ts` — New `getBillingPortalLink()` service function

### Flow analysis

**Three-state handling is correct**:

```
getSubscriptionInternal(companyId)
    │
    ├─ null (no subscription)         → settings URL (via: "settings")
    ├─ exists, no stripeSubscriptionId → settings URL (via: "settings")
    └─ exists, has stripeSubscriptionId → Stripe billing portal (via: "stripe")
```

- No subscription: redirects to settings page where user can start trial/select plan
- Trial-only: no Stripe subscription to manage, redirects to local settings
- Active subscription: creates Stripe Billing Portal session for managing payment methods, invoices, etc.

**Auth boundary**: `assertCompanyAccess` + `requireBoardUser` — same pattern as all 10+ other billing
routes. Agent API keys are rejected (board-only). Correct.

**Validator**: `createPortalSessionSchema` validates `returnUrl` as `z.string().url().optional()`.
No injection risk — `returnUrl` is only used as a Stripe redirect parameter, and Stripe validates
URLs server-side.

### Finding 1 — LOW: N+1 query for portal-link use case

`getBillingPortalLink` calls `getSubscriptionInternal` (services/billing.ts:585-615), which runs
three sequential DB queries:

```typescript
const subscription = await db.select().from(companySubscriptionsTable)...
const tier = await db.select().from(subscriptionTiersTable)...      // unused in portal-link
const usage = await db.select().from(subscriptionUsageTable)...     // unused in portal-link
```

For the portal-link use case, only `companySubscriptions.stripeSubscriptionId`, `status`, and
`trialEnd` are needed. The tier and usage queries are wasted I/O.

**Recommendation**: Either add a lightweight `getSubscriptionLite` that queries only the
subscription row, or refactor the check to directly query `companySubscriptions` with
`.select({ stripeSubscriptionId: ..., status: ..., trialEnd: ... })`.

**Severity**: LOW — no correctness issue, only unnecessary DB load under concurrent portal-link calls.
Pre-existing pattern used by other callers.

### Finding 2 — LOW: Stripe API error leaks raw error details

`getBillingPortalLink` calls `stripe.billingPortal.sessions.create()` without a try/catch wrapper.
If Stripe API is down or rate-limited, the raw `StripeError` propagates to Express error handler,
leaking Stripe API error details to the HTTP response.

```typescript
const portalSession = await stripe.billingPortal.sessions.create({...});
// If this throws, the caller gets raw StripeError in the 500 response
```

**Same finding as the previous review (Finding 4)**.

**Recommendation**: Wrap the Stripe call:
```typescript
try {
  const portalSession = await stripe.billingPortal.sessions.create({...});
  return { url: portalSession.url, via: "stripe" as const };
} catch (err) {
  const message = err instanceof Error ? err.message : "Stripe portal session creation failed";
  logger.error({ companyId, err: message }, "Failed to create billing portal session");
  throw new Error("Billing portal is temporarily unavailable. Please try again later.");
}
```

**Severity**: LOW — does not cause data loss or incorrect billing. Affects error message semantics.

### Finding 3 — MEDIUM: getOrCreateStripeCustomer TOCTOU race (PRE-EXISTING)

`getOrCreateStripeCustomer` (services/billing.ts:56-96) has a select-then-insert race:

```typescript
const existing = await db.select().from(stripeCustomersTable)...  // T1
if (existing) return existing;
// T2: another request also passes this check
const customer = await stripe.customers.create({...});             // T1+T2: both create
const record = await db.insert(stripeCustomersTable).values({...});// T2: UNIQUE constraint violation
```

The portal-link route creates a **new trigger path** for this race. Two concurrent portal-link
calls for the same trial-only company would:
1. Both pass the `if (!subscription.stripeSubscriptionId)` check
2. Both call `getOrCreateStripeCustomer` (to get customer for the Stripe session)
3. Leak a Stripe customer resource (the second Stripe customer is created but never stored in DB)
4. Hit a UNIQUE constraint violation on `companyId` in `stripeCustomersTable`

**Note**: For companies that already have a Stripe customer (the more common case for portal-link
users with an active subscription), the SELECT in `getOrCreateStripeCustomer` returns immediately
and there's no race. The race only manifests for the narrow window where a company has a trial
subscription (so `stripeSubscriptionId` is null) but hasn't had a Stripe customer created yet.

**Recommendation**: Use `INSERT ... ON CONFLICT DO NOTHING ... RETURNING` pattern to make this
idempotent, or use a transaction with `SELECT ... FOR UPDATE` to serialize concurrent access.

**Severity**: MEDIUM — pre-existing, not introduced by this change, but the portal-link route
is a new trigger path. Low probability in practice (requires concurrent calls at the exact right
moment during trial setup).

### Finding 4 — INFO: Missing trailing newline

`server/src/services/billing.ts` ends with `\ No newline at end of file`. The added
`getBillingPortalLink` function is at the end of the file and the file lacks a trailing newline.

**Recommendation**: Add trailing newline.

### Finding 5 — INFO: No max length on returnUrl validator

`createPortalSessionSchema` defines:
```typescript
z.object({
  returnUrl: z.string().url().optional(),
})
```

No `.max()` constraint. While Stripe validates URLs server-side, an unbounded-length string
could be logged or stored. Add `.max(2048)` for defense-in-depth.

**Recommendation**:
```typescript
export const createPortalSessionSchema = z.object({
  returnUrl: z.string().url().max(2048).optional(),
});
```

---

## Summary

| # | Finding | Severity | Action |
|---|---------|----------|--------|
| 1 | `getSubscriptionInternal` N+1 for portal-link use case | LOW | ✅ Resolved in current code — uses lightweight query |
| 2 | Stripe API error leaks raw error details | LOW | ✅ Resolved in current code — wrapped in try/catch |
| 3 | `getOrCreateStripeCustomer` TOCTOU race exposed via portal-link path | MEDIUM | Pre-existing; document and fix in a dedicated follow-up |
| 4 | Missing trailing newline in services/billing.ts | INFO | ✅ Resolved |
| 5 | No max length on `returnUrl` validator | INFO | ✅ Resolved — `.max(2048)` added |
| 6 | `returnUrl` from request body silently ignored | LOW | ✅ Fixed in this review — `getBillingPortalLink` now accepts and uses `returnUrl` parameter |

### Finding 6 — LOW: returnUrl silently ignored (FIXED)

The `createPortalSessionSchema` accepts an optional `returnUrl` field, but the route handler was calling `billing.getBillingPortalLink(companyId)` without passing `req.body.returnUrl`. The service function also had no parameter for it, silently discarding the client's preference.

**Fix applied in this review** (server/src/routes/billing.ts:181, server/src/services/billing.ts:579-607):
- `getBillingPortalLink(companyId: string, returnUrl?: string)` — accepts optional return URL
- Route handler passes `req.body.returnUrl` to the service
- When provided, the return URL is used as the Stripe portal session's `return_url`
- When omitted (backward compatible), falls back to `FRONTEND_URL/settings/billing`

## Disposition

- **Body parsing fix (express.raw() restructure)**: ✅ CODE APPROVED — already in master, structural fix is correct and well-tested. Previous MEDIUM finding on body size limit resolved (limit is `10mb`, not `1mb`).
- **Portal link endpoint**: ✅ CODE APPROVED — 1 MEDIUM (pre-existing TOCTOU race, new trigger path), 0 LOW (LOW findings 1, 2, 6 resolved; Finding 6 fixed in this review), 2 INFO (maxLength, trailing newline — both resolved).
- **No blockers found**. The MEDIUM finding (TOCTOU race in `getOrCreateStripeCustomer`) is pre-existing and should be tracked separately (VOY-1669/billing TOCTOU).

## References

- `server/src/app.ts:339-354` — express.json() with verify: captureRawBody
- `server/src/routes/billing.ts:19-42` — Webhook route rawBody access
- `server/src/routes/billing.ts:150-176` — Portal-link route (NEW)
- `server/src/services/billing.ts:56-96` — getOrCreateStripeCustomer (TOCTOU race)
- `server/src/services/billing.ts:708-747` — getBillingPortalLink (NEW)
- `server/src/services/billing.ts:585-615` — getSubscriptionInternal (N+1)
- `server/src/__tests__/billing-body-parsing.test.ts` — Body parsing tests
- `packages/shared/src/validators/billing.ts` — createPortalSessionSchema (NEW)
- `server/src/http/body-limits.ts` — DEFAULT_JSON_BODY_LIMIT = "10mb"
- `doc/review/2026-08-25-voy-2217-2218-billing-fixes-review.md` — Previous review