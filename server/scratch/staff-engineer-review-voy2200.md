# Structural Audit: VOY-2200 Fixes — Re-review of commit 535f75fa15

**Reviewer:** Staff Engineer
**Commit:** 535f75fa15
**Branch:** fix/m-series-tech-debt
**Date:** 2026-08-25 ~03:20 UTC

---

## Fix Verification

**Issue 1 (companyId boundary check):** ✅ FIXED
`assertVoyonderAuth` now validates `req.params.companyId` against the JWT `company_id` claim. When `:companyId` is present in the URL path and doesn't match, returns 401. Routes without `:companyId` are unaffected (the check is a no-op when `req.params.companyId` is undefined).

**Issue 2 (JWT exp validation):** ✅ FIXED
- Tokens without `exp` claim are rejected immediately ("Token missing expiration")
- Tokens with expired `exp` claim are rejected ("Token expired")
- All three route files validated by inspection

---

## Remaining Issues (Not Fixed in this Commit)

### C1: JWT Header `alg` Not Validated (P1)
**File:** `server/src/services/auth.ts:65-69`
The header segment is decoded but the `alg` field is never read. While the signature verification always uses HS256 regardless of the header, this is an RFC 7519 standards compliance gap. A token with `{"alg":"none"}` in the header passes parsing without scrutiny. The classic `alg: none` evasion fails because the code always verifies HMAC, but debugging algorithm-related signing failures will be confusing without this check.

### C1b: No `iss`/`aud`/`nbf`/`iat` Validation (P1)
- **No `iss` (issuer) validation:** Any secret holder can mint tokens that impersonate any user.
- **No `aud` (audience) validation:** A token minted for service A could be used against service B if they share the same secret.
- **No `nbf` (not before) validation:** A token with a future `nbf` claim would be accepted before its intended validity window.
- **No `iat` (issued at) sanity check:** A token with `iat` significantly in the future could indicate a clock-skew attack.

---

## New Findings

### 🔴 BLOCKER 1 — Cross-System Secret Fallback (P1)

**Severity:** CRITICAL — must fix before production deploy

`jwtSecret()` in `server/src/services/auth.ts:34-36`:
```typescript
function jwtSecret(): string | null {
  return process.env.BETTER_AUTH_SECRET?.trim() || process.env.PAPERCLIP_AGENT_JWT_SECRET?.trim() || null;
}
```

The agent JWT creation in `server/src/agent-auth-jwt.ts:35` uses the reverse priority:
```typescript
const secret = process.env.PAPERCLIP_AGENT_JWT_SECRET?.trim() || process.env.BETTER_AUTH_SECRET?.trim();
```

**The problem:** When only one secret is configured (common in development, single-env deployments), both systems silently share the same key. An agent JWT contains `sub: agentId` and `company_id: companyId` — both claims are accepted by `assertVoyonderAuth` as a valid user session. This means:

1. Any agent with a valid agent JWT can call `POST /api/companies/:companyId/research/search`
2. Any agent with a valid agent JWT can queue `POST /api/companies/:companyId/exports/pdf`
3. Any agent with a valid agent JWT can trigger research activities via `POST /api/companies/:companyId/research/activities`
4. The agent's ID is recorded as `createdByActorId` in background jobs — this loses the agent-vs-user distinction

**Fix (any one of):**
- **Option A:** Remove the fallback. Require distinct secrets for each system with no fallback chain.
- **Option B:** Add a required token-type claim (e.g., `token_type: "user_session"`) that `assertVoyonderAuth` validates before accepting the token. Agent JWTs would carry `token_type: "agent_jwt"` and be rejected.
- **Option C:** At minimum, validate that the `sub` claim value matches a user ID format (Voyonder user IDs have a specific prefix/pattern distinct from agent IDs), though this is fragile and not recommended as the sole fix.

### 🔴 BLOCKER 2 — SSE Listener Leak (P1)

**Severity:** CRITICAL — must fix before production deploy

**File:** `server/src/routes/background-jobs.ts:44-62`

The SSE endpoint registers a listener via `subscribeCompanyLiveEvents` and cleans up on `req.on("close")`:

```typescript
const unsubscribe = subscribeCompanyLiveEvents(companyId, (event) => {
  if (event.type === "background_job.status") {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
});

req.on("close", () => {
  unsubscribe();
});
```

**The problem:** The `EventEmitter` in `live-events.ts` has `setMaxListeners(0)` (unlimited, no warnings). If a client's TCP connection drops without a clean FIN/ACK handshake (network partition, laptop lid close, browser background throttle, mobile signal loss), the Node.js `close` event on the request may never fire. This leaks:
- The listener function (referenced by the emitter)
- The `res` object (captured in the listener closure)
- The entire SSE response chain

In production with even moderate SSE traffic, dead listeners accumulate. Over days, this is a measurable memory leak.

**Fix:**
- Add a heartbeat interval (e.g., 30s) that writes `:heartbeat\n\n` to detect dead connections.
- Set a maximum listener lifetime (e.g., 5 minutes) and auto-unsubscribe if no heartbeat ack.
- Consider using the WebSocket path (already implemented in `live-events-ws.ts`) which has more reliable close detection.

### 🟡 MODERATE — Tests Not Committed (P2)

A comprehensive test file exists at `server/src/__tests__/voyonder-auth.test.ts` (322 lines) but is **untracked** in the working tree. It covers:
- Valid JWT accepted
- No `:companyId` param (no-op check)
- Missing `exp` claim rejected
- Expired token rejected
- CompanyId mismatch rejected
- Missing Authorization header rejected
- Invalid signature rejected
- Route integration tests for all three route families

**Fix:** `git add server/src/__tests__/voyonder-auth.test.ts` and commit with the fix.

### 🟢 Minor: Auto-Assess Only Handles Issues (P3)

`researchSearchService.autoAssess` only queries the `issues` table. It ignores documents and activity log entries. The `itemIds` filter also only matches against issues. If the research feature is expected to assess all research item types, this scope limitation should be documented or expanded.

### 🟢 Minor: `Express.voyonderAuth` Type Property Never Populated (P3)

The type declaration in `express.d.ts:28-29` says `voyonderAuth` is "populated by assertVoyonderAuth()" but `assertVoyonderAuth` never writes to `req.voyonderAuth` — it only returns the value. Routes use the return value as a local variable. Already flagged as C4 in the prior audit; still unfixed.

---

## Prior Findings Status

| Finding | Severity | Status |
|---------|----------|--------|
| C1: JWT header `alg` not validated | P1 | Not fixed |
| C2: Missing exp/iat/nbf claims | P1 | Partially fixed (exp done, iat/nbf not) |
| C3: Dual-auth confusion (boardMutationGuard) | P2 | Not addressed |
| C4: `req.voyonderAuth` never set | P3 | Not fixed |
| C5: No test coverage for `assertVoyonderAuth` | P1 | Tests exist as untracked file |
| C6: Route `:companyId` ignored in old code | P1 | **FIXED** (boundary check added) |
| C7: `createdByActorId` distinction lost | P3 | Acceptable for Voyonder-only |
| C8: Error messages leak config state | P3 | Not fixed |
| C9: `safeCompare` length leak (informational) | Info | Not fixed |

---

## Verdict

**CONDITIONAL APPROVAL.** The two original VOY-2200 issues (companyId boundary check, JWT exp validation) are correctly fixed in commit 535f75fa15. The code passes structural review for the stated acceptance criteria.

**However, two new P1 blockers were identified** that must be resolved before this code deploys to production:

1. **Cross-system secret fallback** — `jwtSecret()` shares secrets between Voyonder and agent JWT systems, allowing agent JWTs to authenticate against Voyonder routes
2. **SSE listener leak** — Unclean TCP disconnects on the background-jobs SSE endpoint leak listeners indefinitely

**Recommended next actions:**
- Implementer: Fix BLOCKER 1 (secret fallback) and BLOCKER 2 (SSE leak)
- Implementer: Commit the untracked test file
- Implementer: Optionally validate JWT header `alg` (quick win, closes remaining prior-audit gap)
- Route back to Staff Engineer for re-review after fixes
- Once approved, hand off to Release Engineer for shipping

*Staff Engineer, 2026-08-25 ~03:20 UTC*
