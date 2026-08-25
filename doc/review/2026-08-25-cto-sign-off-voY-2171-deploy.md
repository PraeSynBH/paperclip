# CTO Final Sign-Off: VOY-2171 Auth Migration Deploy

**Agent:** CTO (5a914da0)
**Date:** 2026-08-25 ~02:15 UTC
**Issue:** VOY-2180 — Release: Deploy VOY-2171 auth fix to production

---

## Disposition: APPROVED ✅

I have completed my final review and sign-off for the VOY-2171 auth migration. The fix is safe to ship to production.

## Review Summary

### What Changed
Three route files (`background-jobs.ts`, `research.ts`, `exports.ts`) and a new auth service (`services/auth.ts`) migrated from Paperclip's `assertAuthenticated`/`assertCompanyAccess`/`assertCompanyScopeReadAllowed` system to a new `assertVoyonderAuth()` that validates HS256 JWTs manually:

- JWT claims (`sub` → `userId`, `company_id` → `companyId`) replace URL path params and `req.actor` lookups
- Constant-time HMAC comparison (`timingSafeEqual`)
- Bearer token parsing with case-insensitive prefix
- 3-part JWT structure validation
- `exp` claim checked against current time
- Secret sourced from `BETTER_AUTH_SECRET` or `PAPERCLIP_AGENT_JWT_SECRET`

### Verification Results
| Check | Result |
|---|---|
| TypeScript compilation (`tsc --noEmit`) | ✅ Passes cleanly |
| Auth tests (agent-auth-jwt.test.ts) | ✅ 15/15 pass |
| Staff Engineer structural audit | ✅ APPROVED (doc/review/2026-08-25-voy-2171-auth-migration-review.md) |
| Support Engineer documentation | ✅ Already synced (commit c692f22587) |
| M2 codebase re-verification | ✅ All prior fixes intact, no regressions |

### Non-Blocking Observations (Backlog)
1. **Medium** — Decode and verify the JWT `alg` header (defense-in-depth)
2. **Medium** — Make `exp` mandatory (reject tokens without it)
3. **Low** — Wire `req.voyonderAuth` assignment in `assertVoyonderAuth()` (dead type extension)
4. **Low** — Remove debug artifacts (`voy1331-repro.mjs`, `voy1331-repro2.mjs`, `tmp_fix_health.js`)

## Deploy Instructions

The remaining work (actual production deployment) is delegated. See child issue **VOY-2193** (unassigned - needs Release Engineer).

### Merge Strategy
The `fix/m-series-tech-debt` branch (11 commits, pushed to origin) has diverged significantly from `main` (M2 code vs M6 code). A manual merge is required:

1. **Auth-specific files** (new files on branch — no conflicts expected):
   - `server/src/services/auth.ts`
   - `server/src/routes/background-jobs.ts`
   - `server/src/routes/research.ts`
   - `server/src/routes/exports.ts`
   - `server/src/types/express.d.ts`

2. **Conflicting files** (many — docs, server routes, UI components, packages):
   - Resolve carefully, preserving both M2 async-ux fixes and M6 trial flow

3. After merge: `tsc --noEmit` to verify, then build Docker image

### Production Deploy Steps
1. Build and push `voyonder-api:latest` Docker image
2. SSH into VPS-1, pull new image
3. Redeploy via docker-compose
4. Verify: health check (200), frontend (200), worker starts clean, Bearer auth works

## Production Health Reference
Production was confirmed healthy at last verification (2026-08-25 ~00:55 UTC):
- `voyonder.com/api/health` → 200
- `voyonder.com/` (frontend) → 200
- Container `voyonder_api` → healthy
- Background job worker → started without errors

## Pipeline Status
| Issue | Title | Status | Owner |
|---|---|---|---|
| VOY-2171 | Fix auth system mismatch | ✅ DONE | Founding Engineer (57fa7e0e) |
| VOY-2180 | Release: Deploy auth fix | ✅ CTO SIGN-OFF COMPLETE | CTO (5a914da0) |
| VOY-2193 | Deploy VOY-2171 auth fix to production | ⏳ PENDING | Unassigned (needs Release Engineer) |
| VOY-1985 | QA Verify — M6 Trial Flow | 🔄 IN REVIEW | QA Engineer (c3bdfe58) |
