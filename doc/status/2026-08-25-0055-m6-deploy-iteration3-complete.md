# M6 Deploy Iteration 3 — Complete — All 3 Blockers Resolved

**Agent:** Release Engineer (7a2a259f)
**Issue:** VOY-2156 — M6 deploy: fix DB schema + health + routing for voyonder_api
**Time:** 2026-08-25 ~00:55 UTC

## Summary

All three blockers identified in the CTO live assessment (~22:35 UTC) are now resolved and verified live on VPS-1.

## Verification Results (00:55 UTC)

| Check | Result | Blocker |
|-------|--------|---------|
| `voyonder.com/api/health` | ✅ 200 `{"status":"ok"}` | B2 |
| `voyonder.com/api/auth/signup` (POST) | ✅ 400 (route exists, body validation rejects empty) | B3 |
| `voyonder.com/` (frontend root) | ✅ 200 | B3 |
| `voyonder.com/login` | ✅ 200 | B3 |
| Container `voyonder_api` health | ✅ healthy | B2 |
| `background_jobs` table in travel_db | ✅ EXISTS | B1 |
| Paperclip tables (activity_log, documents, issues, issue_comments) | ✅ ALL EXIST | B1b |
| Background job worker startup | ✅ Started without errors (no 42P01) | B1 |
| Traefik certresolver | ✅ `mytlschallenge` (not `letsencrypt`) | B3 |
| Traefik no "nonexistent resolver" errors | ✅ 0 errors | B3 |

## What Was Deployed

| Component | Details |
|-----------|---------|
| `voyonder_api` container | `voyonder-api:latest` image, port 3101, healthy, running 21+ min |
| `travel_app` container | `travel_app:latest` image, port 3000, serving frontend |
| `docker-compose.voyonder.yml` | Specific PathPrefix rules with `certresolver=mytlschallenge` |
| `docker-compose.frontend.yml` | travel_app with `Host(voyonder.com)` catch-all + www redirect |
| SQL scripts | `003_voyonder_background_jobs.sql` + `004_voyonder_paperclip_tables.sql` applied to travel_db |

## Remaining Non-Blocking Items

- **Sentry DSN**: Still has CHANGEME values (VOY-343, founder-gated)
- **Pre-existing ACME cert renewal**: monitor.adoptaitech.com and status.praesyn.com DNS issues (not M6-related)
- **`docker-compose.frontend.yml`**: Exists on VPS-1 but not yet committed to voyonder repo (should be committed for reproducibility)
- **Image missing minor post-build commits**: `connectionTimeoutMillis:10000` and latest auth refactor (not blockers)
