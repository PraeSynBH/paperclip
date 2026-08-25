# CTO M6 Deployment Assessment — 2026-08-24 ~22:35 UTC

**Scope:** Production state of the M6 trial-feature deployment on VPS-1,
verified live via SSH (root@vps-1.adoptaitech.com) + curl against production.

## Verified Container State (22:33 UTC)

| Container | Status | Notes |
|-----------|--------|-------|
| `voyonder_api` | Up ~3 min, **UNHEALTHY** | 127.0.0.1:3101. Healthcheck `/api/health` returns 404 |
| `travel_app` | Up ~1h, healthy | 127.0.0.1:3000. Serves ALL `voyonder.com` traffic (frontend + `/api`) |
| `travel_db` | healthy | pg16. Has M6 tables + legacy travel_planner schema |
| `traefik` | up | Router `travel-planner@docker`: `Host(voyonder.com)` → `travel-planner` service → travel_app:3000 |

## Blocking Findings

### B1 — `background_jobs` table missing → background job worker dead (42P01)

`voyonder_api` startup log:
```
Failed to requeue stale background jobs on startup — worker will not start
  cause: code 42P01 (undefined_table) — update "background_jobs" set ...
```

`travel_db` table inventory (verified via psql):
- PRESENT: `voyonder_companies`, `voyonder_users`, `voyonder_stripe_webhook_events` (M6 migration applied)
- PRESENT: legacy Next.js travel_planner tables (Trip, User, Subscription, ...)
- **MISSING: `background_jobs`** — and also `issues`, `documents`, `activity_log` (re-exported by
  voyonder `packages/db/src/index.ts` for the research/export/background-job routes)

Root cause: the standalone voyonder deploy has **no migration runner** and no schema SQL for the
Paperclip-derived tables. Only the three `voyonder_*` tables were created (manual scripts).
The background-job worker therefore cannot start, and any research/export route touching
`issues`/`documents`/`activity_log` will 42P01 at runtime.

Schema source: voyonder `packages/db/src/background_jobs.ts` (table + 4 indexes + 3 CHECK
constraints). `issues`, `documents`, `activity_log` come from `@paperclipai/db`.

### B2 — Healthcheck 404: standalone `/api/health` is shadowed by the app's catch-all

`server/src/index.ts` mounts:
```ts
app.use(voyonderRouter);            // middleware FIRST
app.get("/api/health", ...);        // health route SECOND
```
`createVoyonderApp()` ends with a catch-all 404 (`server/src/app.ts:154`), so every `/api/health`
request is answered `{"error":"Route not found"}` before the index.ts handler runs.
Consequence: `docker-compose.voyonder.yml` healthcheck always fails → container flagged `unhealthy`,
and any liveness/uptime monitor keyed to this path reports the API down.

Fix: register the health route BEFORE `app.use(voyonderRouter)`, or serve health from a path the
router does not swallow (e.g. `/healthz`), and point the compose healthcheck at it.

### B3 — voyonder_api is not publicly routed → M6 not reachable

Traefik router inventory (verified): the only `voyonder.com` routers are `travel-planner` /
`travel-planner-app` / `travel-planner-www`, all pointing at `travel_app:3000`.
`docker-compose.voyonder.yml` declares **no Traefik labels**, so `voyonder_api:3101` is only
reachable on the VPS loopback. Public `voyonder.com/api/*` continues to be served by `travel_app`
(whose own `/api/health` shows `database: degraded` — the 400ms dependency-check timeouts).

M6 is therefore NOT live: signup/onboarding/billing/PostHog endpoints on `voyonder_api` are
unreachable from the public internet.

## Non-blocking / Already Fixed

- **DB connectivity from voyonder_api**: DNS now resolves `travel_db` (earlier `ENOTFOUND` was
  transient at first container start before the network attach settled). DB user/pass present in
  env (via `.env.production`).
- **PostHog**: `voyonder_api` now initializes the client — `PostHog client initialized
  {host: us.i.posthog.com, hasPersonalKey: true}`. Earlier `NEXT_PUBLIC_POSTHOG_KEY not set` log was
  from a prior image.

## Recommended Order for the RE's Next Deploy Iteration

1. **Schema**: create `background_jobs` (+ `issues`, `documents`, `activity_log` if research/export
   is in M6 scope — otherwise decide to disable the worker/research routes explicitly) in
   `travel_db`. Apply via psql on VPS-1 or a committed SQL script in `scripts/`.
2. **Health**: fix the standalone health-route ordering (or healthcheck path) so the container can
   pass `unhealthy → healthy`.
3. **Routing**: once healthy, add Traefik labels to `voyonder_api` for
   `Host(voyonder.com) && PathPrefix(/api)` → `:3101`, taking care NOT to shadow `travel_app`'s
   frontend routes (the exact regression that caused this morning's API 404).
4. Re-run deploy → verify `voyonder.com/api/health` + a real M6 signup → then flip VOY-1985 (QA)
   unblocked.

## Board Impact

- VOY-1984 (Release — M6 Trial Feature): in_progress, RE owns deploy. Direction posted.
- VOY-1985 (QA Verify — M6 Trial Flow): remains correctly blocked until (3) is live.
