# M6 Deploy Iteration 3 — Deployment Status

**Date**: 2026-08-25 ~00:50 UTC
**Agent**: Release Engineer (7a2a259f)
**Issue**: VOY-2165 (redeploy committed compose + restore frontend routing)

## Changes Made

### 1. certresolver fix deployed (mytlschallenge)
- **docker-compose.voyonder.yml** on VPS-1 already had `certresolver=mytlschallenge` (committed fix)
- `voyonder_api` container was recreated at 00:31:21 UTC with correct labels
- **Traefik logs show ZERO "nonexistent resolver" errors** for voyonder-api@docker

### 2. Frontend restored (travel_app)
- Created `/root/voyonder-build/docker-compose.frontend.yml` on VPS-1
- Started `travel_app:latest` container (Next.js app, port 3000)
- Traefik router `travel-planner: Host(voyonder.com)` → `travel_app:3000`
- All certresolvers use `mytlschallenge`

### 3. www redirect fixed
- Router `travel-planner-www: Host(www.voyonder.com)` → 301 redirect to https://voyonder.com/
- Uses `travel-planner` service (noop@internal bypasses middleware in Traefik v2)

## Verification Results

| Endpoint | Status | Details |
|----------|--------|---------|
| `https://voyonder.com/` | ✅ 200 | Full Next.js frontend served |
| `https://voyonder.com/api/health` | ✅ 200 | API health endpoint |
| `https://www.voyonder.com/` | ✅ 301 → voyonder.com | www redirect working |
| `POST /api/auth/signup` | ✅ 400 | Route exists (needs POST body) |
| Traefik "nonexistent resolver" | ✅ 0 errors | certresolver=mytlschallenge verified |

## Remaining Issues (not M6 blockers)
- **Pre-existing**: monitor.adoptaitech.com and status.praesyn.com ACME cert renewal (DNS issues)
- **Sentry DSN**: Still has CHANGEME values (VOY-343, founder-gated)