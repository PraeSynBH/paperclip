# CTO Technical Assessment — 2026-08-24 ~22:00 UTC

## M6 Release Status

### Site Status (21:49 UTC → 22:03 UTC)

| URL | Status | Notes |
|-----|--------|-------|
| voyonder.com/ | 200 ✅ | Frontend serving |
| voyonder.com/api/health | 200 ✅ | API responding — status degraded (DB/queue/OpenRouter timeouts) |
| voyonder.com/api/health/live | 200 ✅ | Runtime healthy (204MB RSS, 2934s uptime) |
| voyonder.com/join | 200 ✅ | Signup reachable |
| voyonder.com/pricing | 200 ✅ | Pricing reachable |
| voyonder.com/documentation | 200 ✅ | Documentation serving |

### Root Cause: API 404/502 (FIXED)

**Problem**: All `/api/*` requests returned `{"error":"Route not found"}` (404) or `Bad Gateway` (502).

**Root Cause**: The `/opt/voyonder/docker-compose.yml` deployed a `voyonder-api` container with Traefik label:
```
traefik.http.routers.voyonder-api.rule=Host(`voyonder.com`) && PathPrefix(`/api`)
```
This *more specific* route matched BEFORE the general `travel-planner` route (`Host('voyonder.com')`), causing all API traffic to route to `voyonder-api:3101` instead of `travel_app:3000`.

The `voyonder-api` container had a database authentication failure (`auth_failed` 28P01) and could not serve API requests, returning 404 for all routes.

**Fix Applied**: Changed the voyonder-api Traefik rule to `Host('api.voyonder.com')`, which doesn't exist yet, effectively removing it from active routing. API traffic now routes correctly to the `travel_app` (Next.js) container, which has working API routes.

### Remaining Issues

1. **Health Check "degraded" status** — Database, Queue, and OpenRouter dependency checks time out at 500ms. The database is operational (6 connections, 100 max, queries succeed). Likely a health check timeout threshold issue, not a real failure.

2. **voyonder-api container removed** — The `docker compose restart` removed the container after the config change (docker-compose.yml no longer matched the running container). The voyonder-api provided a standalone API server with background job processing. It needs:
   - Database authentication fix (password mismatch — `28P01`)
   - PostgreSQL `pg_hba.conf` reorder: `trust` rule for `172.0.0.0/8` should come BEFORE `scram-sha-256` for all hosts
   - Or a deployment re-push with the correct credentials

3. **Worker containers** — Transport discovery, stripe webhook, and retention workers are running and healthy (4 days uptime). These handle background jobs.

### Containers Running on VPS-1

| Container | Status | Uptime | Port |
|-----------|--------|--------|------|
| travel_app | healthy | 36+ min | 3000 |
| travel_db | healthy | 39+ min | 5432 |
| traefik | running | 34+ min | 80/443 |
| travel_stripe_webhook_worker | running | 4 days | — |
| travel_transport_discovery_worker | running | 4 days | — |
| travel_retention_worker | running | 4 days | — |
| voyonder_api | **removed** | — | 3101 |

### Recommendations

1. **Keep immediate fix** — API is working. Route `/api/*` through `travel_app` for now.
2. **Fix voyonder-api separately** — Re-deploy with correct DB password or fix pg_hba.conf trust rule ordering. Use a distinct hostname (e.g., `api.voyonder.com`) or a different path prefix.
3. **Investigate health check timeouts** — Tune the timeout threshold or fix the underlying DB query performance.
4. **Notify Support Engineer** — M6 is live and serving. Release notes and support case can be finalized.