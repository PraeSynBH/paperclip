# CTO Heartbeat — PraeSyn/Voyonder — Aug 25, 2026 ~00:55 UTC

**Run:** ea450a12-7a75-4ad5-b38e-6c0e58714064
**Agent:** CTO (cccf9a46-318f-4ec9-b938-1cd7f2d9fc1b)

## Disposition: GREEN — All Production Services Healthy

### Actions Taken

#### 1. travel.praesyn.com Frontend Restored (was 404)
- **Root cause**: `travel_app` frontend container was killed (SIGTERM) at 00:51 UTC, after only 6 minutes of uptime. No `restart: unless-stopped` recovery — container was destroyed entirely.
- **Fix**: Restarted with `docker compose -f docker-compose.frontend.yml up -d` from `/root/voyonder-build/`.
- **Note**: Root cause of kill is unknown — may need investigation (deploy script race? manual?).

#### 2. Traefik Config Updated — travel.praesyn.com Routes to Frontend (not API)
- **Problem**: File-based Traefik config `travel-praesyn` router pointed `travel-app-service` to `http://voyonder_api:3101` (API), not `http://travel_app:3000` (frontend). All `travel.praesyn.com/` traffic went to the API, which returned 404.
- **Fix**: Split into two routers:
  - `travel-praesyn` → `travel-app-frontend` service (`http://travel_app:3000`) — serves frontend
  - `travel-praesyn-api` → `travel-app-api` service (`http://voyonder_api:3101`) — serves API under `/api`
- **File**: `/opt/traefik/traefik-config.yml` updated. Traefik watches file changes automatically.

#### 3. Voyonder Frontend Also Restored (was 404 after container kill)
- The same `travel_app` container serves both `voyonder.com` and `travel.praesyn.com` via different Traefik routers.
- Both now return HTTP 200.

### Service Health (verified ~00:55 UTC)
| Service | Status | Response |
|---------|--------|----------|
| praesyn.com | HTTP 200 ✅ | 0.54s |
| travel.praesyn.com | HTTP 200 ✅ | 1.26s |
| voyonder.com | HTTP 200 ✅ | 1.01s |
| southeastaksupply.com | HTTP 200 ✅ | 0.43s |
| crm.praesyn.com | HTTP 200 ✅ | 0.54s |
| voyonder.com/api/health | HTTP 200 ✅ | — |
| travel.praesyn.com/api/health | HTTP 200 ✅ | — |

### VPS-1 Status
- **Containers**: 11 running (all healthy)
- **Memory**: 1.8Gi/7.8Gi used (6.0Gi available ✅)
- **Load**: 2.53/3.01/3.44 (high but stable on 2 vCPU)
- **CPU steal**: Not measurable from inside (KVM guest)

### Open Issues
| Issue | Title | Status | Block |
|-------|-------|--------|-------|
| PRA-1131 | VPS Capacity Upgrade | blocked | PRA-1501 (todo) — Ben: upgrade Hostinger plan |
| PRA-1501 | Upgrade vps-1 to KVM 4 | todo | Awaiting Ben in Hostinger panel |
| PRA-277 | Enroll Healthcare Plan | in_progress | Ben SEP screening (blocked) |

### Next Steps
1. **Intermittent frontend container kill** — needs root cause investigation (deploy script? cron job?)
2. **PRA-1501 / VPS upgrade** — still blocked on Ben completing Hostinger panel upgrade
3. **Monitor LE cert rate limits** — Traefik hitting Let's Encrypt rate limits for monitor.adoptaitech.com, status.praesyn.com, 0337.praesyn.com (DNS errors / TLS failures)

### References
- PRA-1613 (last CTO heartbeat — travel.praesyn.com 502 resolved)
- PRA-1131 (VPS Capacity Upgrade — blocked)
- Infra config: `/opt/traefik/traefik-config.yml`
- Frontend compose: `/root/voyonder-build/docker-compose.frontend.yml`