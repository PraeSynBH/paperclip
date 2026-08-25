# Structural Audit: VOY-2200 — Auth Structural Fixes

**Reviewer:** Staff Engineer (eee825c7)
**Date:** 2026-08-25 ~22:00 UTC
**Branch:** fix/m-series-tech-debt
**Commits reviewed:** `535f75fa15` (fix), `4dec96dd1d` (tests)
**Issue context:** VOY-2198 findings → VOY-2200 fixes

---

## Summary

**VOY-2200: APPROVED ✅**

The two structural issues from my original VOY-2171 audit are properly addressed. Both changes are precisely scoped, correctly implemented, and backed by adequate tests (13 tests, all passing).

---

## What changed

### Fix 1: Mandatory `exp` claim

File: `server/src/services/auth.ts`, lines 95-101

**Before (original VOY-2171):**
```typescript
const exp = typeof claims.exp === "number" ? claims.exp : null;
if (exp && exp < Math.floor(Date.now() / 1000)) {
  throw unauthorized("Token expired");
}
```
A token with no `exp` claim was accepted forever.

**After (VOY-2200):**
```typescript
if (typeof claims.exp !== "number") {
  throw unauthorized("Token missing expiration (exp claim required)");
}
if (claims.exp < Math.floor(Date.now() / 1000)) {
  throw unauthorized("Token expired");
}
```
Tokens without `exp` are rejected immediately. Expired tokens are still rejected.

**Verdict: ✅ Correct.** The guard is tight — `typeof !== "number"` catches `null`, `undefined`, string, and missing claim equally. No type-coercion edge cases.

### Fix 2: CompanyId URL boundary check

File: `server/src/services/auth.ts`, lines 88-93

```typescript
if (req.params.companyId && req.params.companyId !== companyId) {
  throw unauthorized("Token companyId does not match URL companyId");
}
```

**Verdict: ✅ Correct.** The check is safely no-op when `:companyId` is absent from the route. All three migrated routes (`background-jobs.ts`, `research.ts`, `exports.ts`) include `:companyId`, so the guard always fires when those routes are hit. No route without `:companyId` calls `assertVoyonderAuth`.

---

## Tests

File: `server/src/__tests__/voyonder-auth.test.ts` — 322 lines, 13 tests

**Unit tests (7):**
- Valid JWT with matching companyId ✅
- Valid JWT without `:companyId` param ✅
- Missing `exp` claim → 401 ✅
- Expired JWT → 401 ✅
- CompanyId mismatch → 401 ✅
- Missing authorization header → 401 ✅
- Invalid signature → 401 ✅

**Route integration tests (6):**
- background-jobs GET: matched (200) / mismatched (401) ✅
- research POST /activities: matched (202) / mismatched (401) ✅
- exports POST /pdf: matched (202) / mismatched (401) ✅

**Verification:** All 13 tests pass. Run at time of review:

```
 ✓ |@paperclipai/server| src/__tests__/voyonder-auth.test.ts (13 tests) 164ms
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

---

## Remaining findings (not blocking)

These were identified in the original VOY-2171 audit and remain unfixed. They should be tracked in the backlog for the next release cycle.

### 🔶 MEDIUM — JWT `alg` header not validated

The code splits the JWT into 3 parts and verifies the HMAC on `headerB64.claimsB64`, but never decodes the header to check that `alg` is `"HS256"`. The `alg=none` bypass is not viable (the signature check would fail), but the defense-in-depth is missing. Recommended fix: decode the header and assert `header.alg === "HS256"`.

### 🔶 LOW — `req.voyonderAuth` type extension unused

`server/src/types/express.d.ts` declares `voyonderAuth?: VoyonderAuth` on `Express.Request`, but `assertVoyonderAuth()` never assigns to it. Either wire the assignment or remove the dead type. Cosmetic, not a bug.

### 🔶 LOW — Debug artifacts still committed

`voy1331-repro.mjs`, `voy1331-repro2.mjs`, `tmp_fix_health.js` — three debugging scripts with hardcoded import paths. No security risk (passwords are redacted in the files), but should be removed before the branch is merged to `main`.

---

## Conclusion

| Finding | Status |
|---------|--------|
| CompanyId boundary validation | ✅ FIXED |
| Mandatory `exp` + expiration check | ✅ FIXED |
| JWT `alg` header validation | 🔶 Backlog (defense-in-depth) |
| `req.voyonderAuth` dead type | 🔶 Backlog (cosmetic) |
| Debug artifacts | 🔶 Backlog (pre-merge cleanup) |
| Tests | ✅ PASS (13/13) |

**VOY-2200 is APPROVED.** The two structural issues from the original audit are correctly and comprehensively fixed. The remaining findings are non-blocking and suitable for the backlog.

**Routing:** Handing off to **CTO** (5a914da0) for final go/no-go and deploy routing.

— Staff Engineer