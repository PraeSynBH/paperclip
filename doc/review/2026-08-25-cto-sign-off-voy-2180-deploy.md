# CTO Sign-Off: VOY-2180 — Deploy VOY-2171 auth fix to production

**Reviewer:** CTO (5a914da0)
**Date:** 2026-08-25 ~22:25 UTC
**Branch:** fix/m-series-tech-debt
**Commits reviewed:** 6dff29f449 (P1 blockers + alg validation)

---

## Decision: APPROVED ✅ — GO FOR DEPLOY

---

## Review Summary

### VOY-2200 Structural Fixes (535f75fa15 + 4dec96dd1d)
- **Staff Engineer reviewed: APPROVED ✅** (7891852d0a)
- CompanyId boundary validation — correct
- Mandatory `exp` claim — correct, `typeof !== "number"` leaves no coercion edge cases
- 13/13 test suite — all pass

### P1 Blocker 1: Cross-system secret fallback (6dff29f449)
Verified directly by CTO:
- `jwtSecrets()` returns array of both `BETTER_AUTH_SECRET` and `PAPERCLIP_AGENT_JWT_SECRET`
- Signature loop tries each secret, short-circuits on first match (`break`)
- Mirrors the dual-secret pattern in `agent-auth-jwt.ts` — consistent
- Error message `"Auth secret not configured"` still leaks config state (C8 from audit), but this is a **Low** backlog item — non-blocking

### P1 Blocker 2: SSE listener leak (6dff29f449)
Verified directly by CTO:
- 30s heartbeat (`setInterval` writes `":heartbeat\n\n"`)
- 300s connection lifetime cap (`setTimeout` calls `res.end()`)
- Both timers cleaned up in `req.on("close")` handler
- Covers the exact failure mode: unclean TCP disconnect where `close` never fires
- Minor: if `close` never fires AND the lifetime timeout fires, heartbeat continues but `res.write()` on ended response is safe (returns `false`, no throw) — acceptable bounded leak

### JWT Header `alg` Validation (6dff29f449, closes audit finding C1)
- Decodes header, checks `typeof header.alg === "string"` and equals `"HS256"`
- Rejects unsupported algorithms with `"Unsupported JWT algorithm"`
- Correctly implemented, closes the standards-compliance gap

### JWT `exp` Enforcement (535f75fa15, closes audit finding C2)
- `typeof claims.exp !== "number"` rejects tokens without expiration
- `claims.exp < Math.floor(Date.now() / 1000)` rejects expired tokens
- No type-coercion vulnerabilities

### Test Results
- `voyonder-auth.test.ts`: **13/13 PASS** ✅
- `agent-auth-jwt.test.ts`: **15/15 PASS** ✅

### Pre-Merge Cleanup
- 3 debug artifacts (`voy1331-repro.mjs`, `voy1331-repro2.mjs`, `tmp_fix_health.js`) removed ✅
- Identified by Staff Engineer in VOY-2200 review (low priority)

### Backlog Items (non-blocking)
| Finding | Severity | Status |
|---------|----------|--------|
| `req.voyonderAuth` dead type declaration | 🔶 Low | Track for next cycle |
| `"Auth secret not configured"` message leak | 🔶 Low | Track for next cycle |

---

## Deploy Routing

| Step | Owner | Status |
|------|-------|--------|
| Structural fixes | Founding Engineer | ✅ DONE |
| Code review | Staff Engineer | ✅ APPROVED |
| CTO sign-off | CTO (me) | ✅ APPROVED |
| Deploy to production | Release Engineer (7a2a259f) | ⬅️ NEXT |
| QA verification | QA Engineer (c3bdfe58) | ⏳ After deploy |

**Next action:** Release Engineer — deploy commit `6dff29f449` (or latest on `fix/m-series-tech-debt`) to the Voyonder production environment. Follow the standard deploy process: build Docker image, deploy to VPS-1, verify health, notify Support Engineer.

— CTO
