# Structural Review: M6 Deploy Fixes (VOY-2157 / commits d4a0e4c + 6dddff1)

**Reviewer**: Staff Engineer
**Date**: 2026-08-24 ~23:25 UTC
**Branch**: voyonder master
**Commits**: d4a0e4c (health route ordering), 6dddff1 (background_jobs schema + Traefik labels)
**Verification**: live checks against VPS-1 (~23:22 UTC) — container state, travel_db, Traefik routers/logs, public curl

---

## Verdict: REJECT — B3 broken (certresolver mismatch), B1 + B2 approved

| Blocker | Fix | Verdict | Live evidence |
|---------|-----|---------|---------------|
| B1 background_jobs schema | `scripts/003_voyonder_background_jobs.sql` | ✅ APPROVED | Table exists in travel_db; worker starts cleanly; no 42P01 |
| B2 health 404 | health route before `app.use(voyonderRouter)` | ✅ APPROVED | `/api/health` = 200 loopback + in-container; container `healthy` |
| B3 Traefik routing | labels added | ❌ REJECTED | Router rejected: nonexistent resolver `letsencrypt`; `voyonder.com/api/health` = 404 |

---

## B1 — background_jobs schema: APPROVED

`scripts/003_voyonder_background_jobs.sql` matches `packages/db/src/background_jobs.ts` exactly:

- All 15 columns with correct types, nullability, defaults (`id` uuid PK `gen_random_uuid()`, `payload` jsonb default `{}`, `progress` int default 0, `created_at`/`updated_at` timestamptz default now())
- All 4 indexes: `background_jobs_company_status_idx (company_id, status)`, `background_jobs_company_created_idx (company_id, created_at)`, `background_jobs_job_type_idx (job_type)`, partial `background_jobs_queued_status_idx (status) WHERE status='queued'`
- All 3 CHECK constraints: status IN (...), progress 0–100, duration_ms >= 0
- Uses `IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` → idempotent

Live-verified: table exists in travel_db (`SELECT count(*) FROM background_jobs` → 0 rows), worker started:
```
Starting background job worker {pollIntervalMs:2000,...}
Voyonder server listening on port 3101
```

**Note (non-blocking, track as follow-up)**: `issues`, `documents`, `activity_log`, `issue_comments` from `@paperclipai/db` are still missing. The worker itself only touches `background_jobs`, so it is safe to run. Research/export routes (`/research`, `/exports`, `/background-jobs` in app.ts) are mounted but are NOT under `/api`, so the Traefik `PathPrefix(/api)` rule never exposes them publicly — they are unreachable in the M6 deploy. Acceptable for M6 scope (signup/billing/onboarding); create a follow-up issue to either add those tables or explicitly disable the routes before any future research/export work.

## B2 — health route ordering: APPROVED

`server/src/index.ts` now registers `app.get("/api/health")` BEFORE `app.use(voyonderRouter)`. Since `createVoyonderApp()` returns a full Express app at runtime (with its own catch-all 404 at app.ts:154), mounting the health route first is required — Express matches routes in registration order. The comment documenting this is accurate.

Live-verified: `curl http://127.0.0.1:3101/api/health` → 200 `{"status":"ok",...}` both from the host loopback and from inside the container; container reports `healthy`.

## B3 — Traefik routing: REJECTED — certresolver mismatch

`docker-compose.voyonder.yml` sets:
```
traefik.http.routers.voyonder-api.tls.certresolver=letsencrypt
```
But production Traefik on vps-1 defines ONLY `mytlschallenge` (verified live from container args):
```
--certificatesresolvers.mytlschallenge.acme.tlschallenge=true
--certificatesresolvers.mytlschallenge.acme.email=ben@adoptaitech.com
--certificatesresolvers.mytlschallenge.acme.storage=/letsencrypt/acme.json
```
Traefik is rejecting the router (live log):
```
level=error msg="Router voyonder-api@docker uses a nonexistent resolver: letsencrypt"
```
The router is absent from the live router table (`docker exec traefik .../api/http/routers` → no `voyonder-api@docker`). Result: `voyonder.com/api/health` = 404 from the public internet; M6 is still NOT reachable.

The commit message's claim that `letsencrypt` "matches production convention" is wrong — every production file router (9) plus the repo's own `docker-compose.yml` use `mytlschallenge`.

### Required fix before ship
1. `docker-compose.voyonder.yml`: `certresolver=letsencrypt` → `certresolver=mytlschallenge`
2. Redeploy voyonder_api, then verify `voyonder.com/api/health` = 200 from public internet
3. Verify the frontend router is intact after redeploy — at review time `travel_app` had NO traefik labels (`docker inspect travel_app` → labels null) and `voyonder.com/` also returned 404. The `/api` router must not be the only thing present; the `travel-planner` routers (`Host(voyonder.com)` → travel_app:3000) must be restored or M6 ships with the frontend down.

### What is correct about B3 (keep it)
The rule itself — `Host(`voyonder.com`) && PathPrefix(`/api`)` → port 3101 — is the right shape. Traefik default priority favors the longer/more-specific rule, so `/api/*` goes to voyonder_api while all other paths fall through to travel_app's frontend router. No frontend shadowing by design.

---

## Disposition

Send back to the VOY-2157 implementer (child issue filed: "B3: fix Traefik certresolver letsencrypt→mytlschallenge"). One-line label fix + redeploy + re-verify. CTO sign-off still required before ship. B1/B2 remain approved and do not need re-review.
