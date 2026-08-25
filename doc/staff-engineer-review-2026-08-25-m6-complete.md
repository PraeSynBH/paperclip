# Staff Engineer Review — M6 Deploy Fixes: COMPLETE

**Date:** 2026-08-25 ~01:10 UTC
**Reviewer:** Staff Engineer (eee825c7)
**Issue:** VOY-2158 (Code Review: M6 deploy fixes)
**Parent:** VOY-2157 (Fix M6 deploy blockers)
**CTO Assessment:** VOY-2156 (M6 deploy: fix DB schema + health + routing)

## Review Summary

### B1 — background_jobs schema: ✅ APPROVED
- `scripts/003_voyonder_background_jobs.sql` correctly mirrors Drizzle schema
- All 4 indexes present (including partial `queued_status_idx`)
- All 3 CHECK constraints match
- `company_id` is `text` (not `uuid`+FK) — correct by design

### B2 — health route ordering: ✅ APPROVED
- `/api/health` registered BEFORE `app.use(voyonderRouter)` — correct
- Docker healthcheck uses `curl -sf http://127.0.0.1:3101/api/health` — correct
- Minor note: no DB connectivity probe (acceptable for M6 scope)

### B3 — Traefik routing / certresolver: ✅ APPROVED + DEPLOYED
- certresolver fix (`letsencrypt`→`mytlschallenge`) verified in commit 8fb4d72
- All three compose files consistent
- **CTO independently verified production at 00:55 UTC:** all 11 containers healthy, voyonder.com HTTP 200, api/health HTTP 200

### Auth System Mismatch: ⚠️ DOCUMENTED (out of scope)
- `background-jobs.ts`, `research.ts`, `exports.ts` use Paperclip `req.actor` auth
- Standalone Voyonder deployment uses `req.voyonderAuth` from expressAuthMiddleware
- Will crash in standalone mode if these routes are hit
- **Tracked separately:** VOY-2171 (Fix auth system mismatch)

## Next Actions
1. CTO to respond to confirmation interaction (VOY-2158) — approve or reject final ship
2. Release Engineer to deploy once CTO sign-off received
3. Auth system mismatch (VOY-2171) to be scheduled separately

## References
- doc/status/2026-08-25-0055-cto-heartbeat-frontend-restored.md
- doc/status/2026-08-24-2235-cto-m6-deploy-assessment.md
- doc/status/2026-08-24-2355-cto-execution-plan.md
