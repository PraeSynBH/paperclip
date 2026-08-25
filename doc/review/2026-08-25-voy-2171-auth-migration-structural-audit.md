# Structural Audit: VOY-2171 Auth Migration (Paperclip → Voyonder JWT)

**Reviewer:** Staff Engineer
**Commit:** `99b3917519`
**Branch:** `fix/m-series-tech-debt`
**Files:** 5 files changed (+125/-55)

## Summary

This commit migrates the background-jobs, exports, and research route families from Paperclip's `assertAuthenticated`/`assertCompanyAccess` auth system to a new Voyonder JWT verification (`assertVoyonderAuth`). A new `server/src/services/auth.ts` implements standalone HS256 JWT verification without any database dependency.

## Issues Found

### C1. JWT Header Algorithm Not Validated

**File:** `server/src/services/auth.ts:65-69`
**Severity:** Moderate (standards compliance, future-proofing)

The JWT header is decoded (line 77: `base64UrlDecode(claimsB64)`) but the header segment (`headerB64` on line 69) is NEVER parsed or validated. The code must verify:

- `alg` equals `"HS256"` — without this check, if the signing key ever changes algorithm (e.g., to RS256 or EdDSA), the code would still try to verify with HMAC-SHA256, producing confusing failures.
- `typ` equals `"JWT"` — standards compliance per RFC 7519.

The classic `alg: "none"` evasion attack is partially mitigated by the `parts.length !== 3` guard (a `none` token without a signature segment would have 2 parts), but a 3-part `none` token (`base64({"alg":"none"}).base64({}).`) would still fail HMAC verification. This is not a practical bypass today but is a standards gap that should be closed before it causes confusion later.

### C2. Missing Required JWT Claims Validation

**File:** `server/src/services/auth.ts:82-91`
**Severity:** Moderate

- **`exp` (expiration) is optional:** Line 88-91 checks `if (exp && exp < ...)` — tokens without an `exp` claim are accepted and live forever. Per RFC 7519 section 4.1.4, `exp` is RECOMMENDED but in practice should be REQUIRED for any token that crosses a trust boundary. A leaked token has no natural expiry.
- **No `iat` (issued at) validation:** Prevents tokens minted far in the future from being used.
- **No `nbf` (not before) validation:** A token could be used before its intended validity window.
- **No `iss` (issuer) validation:** Any secret holder can mint tokens that impersonate any user.
- **No `aud` (audience) validation:** A token minted for service A could be used against service B if they share the same secret.

**Fix:** Reject tokens without `exp`. Validate `iat` and `nbf` as a sanity measure. At minimum require `exp` and validate it strictly.

### C3. Dual-Auth Confusion: `boardMutationGuard` Still Operates on Paperclip `req.actor`

**File:** `server/src/app.ts:226`, `server/src/middleware/board-mutation-guard.ts:54`
**Severity:** High (architectural / future-bug surface)

The `api` router (line 225) has `boardMutationGuard()` middleware that checks `req.actor.type`. But the Voyonder routes now completely ignore `req.actor` in favor of `assertVoyonderAuth`. This creates a dual-auth architecture:

1. `actorMiddleware` (line 210) runs first, populating `req.actor` based on Paperclip auth (or defaulting to `{ type: "none" }` when no Paperclip auth is present).
2. `boardMutationGuard` (line 226) checks `req.actor.type !== "board"` and passes through for non-board actors.
3. The route handler calls `assertVoyonderAuth` which independently verifies the Voyonder JWT.

**Current behavior for Voyonder JWT requests:** The `actorMiddleware` finds a bearer token but fails to validate it as Paperclip auth, so `req.actor.type` stays `"none"`. The `boardMutationGuard` sees `"none"` and passes through. The route handler validates the Voyonder JWT successfully.

**Risks:**
- Any future middleware added to the `api` router that relies on `req.actor` will silently make incorrect auth decisions for Voyonder-authenticated requests.
- If `actorMiddleware` is ever changed to throw instead of default to `"none"` for unrecognized tokens, all Voyonder routes would break.
- The `boardMutationGuard` is dead code for these routes but looks like it's protecting them.

**Fix:** Create a `voyonderAuthMiddleware` that wraps `assertVoyonderAuth` and translates the result into `req.actor` so downstream middleware sees a consistent auth state. Or, explicitly bypass/mask these routes from the board mutation guard.

### C4. `assertVoyonderAuth` Returns Auth But Never Sets `req.voyonderAuth`

**File:** `server/src/services/auth.ts:49-93`, `server/src/types/express.d.ts:29`
**Severity:** Low (code/doco mismatch)

The type declaration says `voyonderAuth` is "populated by assertVoyonderAuth()" (express.d.ts:28-29), but `assertVoyonderAuth` only returns the value — it never writes `req.voyonderAuth = ...`. The routes use the return value as a local variable. The type comment is aspirational; the property is never actually set.

**Fix:** Either set `req.voyonderAuth` in `assertVoyonderAuth`, or remove the property from the type declaration and the doc comment.

### C5. No Tests for `assertVoyonderAuth`

**File:** `server/src/services/auth.ts` (entire file)
**Severity:** High

Authentication code has zero test coverage. The file introduces a standalone JWT verification path that is production-critical and security-sensitive.

**Required tests:**
- Valid JWT → returns `{ userId, companyId }`
- Missing `Authorization` header → throws 401
- Malformed header (not "Bearer ") → throws 401
- Token with <3 parts → throws 401
- Invalid signature → throws 401
- Expired token → throws 401
- Missing `sub` or `company_id` claim → throws 401
- Token with `alg: "none"` and 3 parts → throws 401 (signature mismatch)
- Empty token after "Bearer " → throws 401
- Unknown env vars (no secret configured) → throws 401

### C6. Route Path Includes `:companyId` But It's Silently Ignored

**Files:** All three route files
**Severity:** Low (API design)

The route paths are e.g. `/companies/:companyId/background-jobs` but `req.params.companyId` is never read — the code uses `auth.companyId` from the JWT claims instead. This means:
- A client calling `GET /api/companies/A/background-jobs` gets company B's data if their JWT encodes company B.
- The URL parameter is misleading. API consumers and future developers will naturally assume the `:companyId` in the path is authoritative.

The async-jobs.md says "URL param is validated but ignored" — it's actually not validated at all, just unused.

**Fix:** Either remove `:companyId` from the route paths (use a fixed segment like `/_/background-jobs`), or validate that `req.params.companyId === auth.companyId` and return 403 on mismatch.

### C7. `createdByActorId` Regression — Loss of Actor-Type Distinction

**Files:** `background-jobs.ts:100`, `exports.ts:74,97`, `research.ts:61,85,119`
**Severity:** Low

The old code selected `createdByActorId` based on actor type:
```typescript
// Old
req.actor.type === "board" ? req.actor.userId 
  : req.actor.type === "agent" ? req.actor.agentId 
  : null
```

The new code uses `auth.userId` unconditionally. If Voyonder's JWT system produces tokens for both human users and automated agents, the `createdByActorId` field loses the ability to distinguish between them. If the Voyonder JWT is only issued to human users, this is fine — but the code should make that assumption explicit.

### C8. Error Messages Leak Server Configuration State

**File:** `server/src/services/auth.ts:62`
**Severity:** Low

`"Auth secret not configured"` reveals to an unauthenticated client that the server has no JWT secret configured. Should use a generic `"Authentication unavailable"` or `"Unauthorized"`.

Also applies to error messages like `"Auth secret not configured"` returning 401 instead of 500 — secret misconfiguration is a server fault, not a client auth problem. Should probably return 500 or silently degrade.

### C9. `safeCompare` Has Timing-Variable Early Return on Length Mismatch

**File:** `server/src/services/auth.ts:23-28`
**Severity:** Informational

`safeCompare` returns `false` immediately when buffer lengths differ, without calling `timingSafeEqual`. Since HMAC-SHA256 output is always 32 bytes (43 base64url chars), the length is fixed in practice, making this a non-exploitable issue. Still, a constant-time comparison library or a pattern that pads to equal length would be more robust.

## Positive Observations

1. **Clean separation:** The new auth service has zero database dependencies — it's a pure function of the request headers and env vars. This makes it testable and easy to reason about.

2. **Consistent pattern:** All three route files use `assertVoyonderAuth` identically — no inconsistency in how the JWT is consumed.

3. **Good error handling:** All failure paths throw `HttpError(401)` via `unauthorized()`, which will be caught by the Express error handler.

4. **Documentation updated:** `async-jobs.md` and `m6-trial-support-assessment.md` accurately reflect the new auth model.

## Verdict

**Conditional approval.** Issues C3 (dual-auth confusion) and C5 (no test coverage) must be addressed before shipping. C1 (header validation) and C2 (claim validation) should be fixed in the same heartbeat — they are small, well-understood changes to `auth.ts`.

The core mechanism (standalone HS256 JWT verification) is sound. The structural concerns are around incomplete validation, testing gaps, and the confusing dual-auth middleware interaction with the existing Paperclip auth layer.

## Dispatch

- **C3** → **Implementer:** Add assertion that `req.params.companyId === auth.companyId` OR remove `:companyId` from route paths. Either choice eliminates the misleading URL contract.
- **C5** → **Implementer:** Add `server/src/__tests__/auth-service.test.ts` covering the nine scenarios listed above.
- **C1/C2** → **Implementer:** Validate JWT header (`alg === "HS256"`) and require `exp` claim. Add `iat`/`nbf` sanity validation.
- **C4/C6-C9** → Low-priority; address opportunistically.
