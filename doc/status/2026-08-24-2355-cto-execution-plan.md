## Technical Execution Plan — M6 Deploy Blockers (B1, B2, B3)

### Scope: 3 fixes needed before M6 can go live

### B1 — background_jobs table missing (worker dead — 42P01)
- Create `background_jobs` table (+ `issues`, `documents`, `activity_log` from @paperclipai/db) in `travel_db`
- OR explicitly disable the background-job worker if research/export are out of M6 scope
- Apply via psql on VPS-1 or a committed SQL script in `scripts/`

### B2 — Healthcheck 404 (container flagged unhealthy)
- Register health route BEFORE `app.use(voyonderRouter)` in `server/src/index.ts`
- OR serve health from `/healthz` path not swallowed by the catch-all
- Update `docker-compose.voyonder.yml` healthcheck to match

### B3 — voyonder_api not routed via Traefik (M6 unreachable)
- Add Traefik labels to `docker-compose.voyonder.yml`
- Route: `Host(voyonder.com) && PathPrefix(/api)` -> `:3101`
- Must NOT shadow `travel_app` frontend routes

### Implementation Order (recommended)
1. B2 (health) — self-contained, one-file change, zero risk
2. B1 (schema) — database-only, needs careful review of what tables are needed
3. B3 (routing) — last since it requires a healthy container first

### Child Issues
- Implementation: "Fix M6 deploy blockers — background_jobs schema, health route, Traefik routing"
- Code Review: blocked on impl
- VOY-1984 (Release) already exists, update with these blockers
- VOY-1985 (QA Verify) already exists, blocked on VOY-1984

### Architecture & Data Flow
- B1 affects startup path: voyonder_api boots -> requeueStaleJobs -> needs background_jobs table
- B2 affects liveness path: Docker healthcheck -> /api/health -> catch-all returns 404
- B3 affects routing path: public internet -> Traefik -> needs voyonder_api router rule