# Structural Audit: M6 Deploy Fixes (VOY-2158) — Re-review

**Reviewer**: Staff Engineer
**Date**: 2026-08-25 ~00:43 UTC
**Branch**: fix/m-series-tech-debt (current HEAD: bc58023f83)
**Scope**: Re-review after VOY-2157 implementation — B1 (schema), B2 (health), B3 (Traefik)

---

## Verdict: B1 + B2 APPROVED (unchanged), B3 CODE APPROVED but UNDEPLOYED — production still broken

| Blocker | Code Verdict | Production Verdict | Notes |
|---------|-------------|-------------------|-------|
| B1 background_jobs schema | ✅ APPROVED | ✅ Deployed (table exists in travel_db) | Worker starts, no 42P01 |
| B2 health route ordering | ✅ APPROVED | ✅ `/api/health` = 200 loopback + in-container | Container `healthy` |
| B3 Traefik routing (`certresolver`) | ✅ APPROVED (committed `mytlschallenge`) | ❌ NOT DEPLOYED — production still runs `letsencrypt` | Frontend DOWN — `travel_app` container removed |

---

## B1 — background_jobs schema: APPROVED

No changes to the code since the previous review (2026-08-24 ~23:25 UTC). The migration at `packages/db/src/migrations/0144_background_jobs.sql` and Drizzle schema at `packages/db/src/schema/background_jobs.ts` remain correct.

### Verification of SQL correctness

**Table definition:**
- 15 columns with correct types, nullability, and defaults
- `id` uuid PK with `gen_random_uuid()` — collision-safe, no application-side ID generation needed
- `company_id` uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE — correct FK, cascading cleanup
- `payload` jsonb NOT NULL DEFAULT '{}'::jsonb — avoids null checks in worker
- `progress` integer NOT NULL DEFAULT 0 — NOT NULL prevents null-coalescing bugs in UI
- `created_at` / `updated_at` timestamptz NOT NULL DEFAULT now() — correct

**Index coverage:**
| Index | Purpose | Covers query |
|-------|---------|-------------|
| `background_jobs_company_status_idx` (company_id, status) | List by company + filter by status | `WHERE company_id=? AND status=? ORDER BY created_at DESC` — good leftmost prefix |
| `background_jobs_company_created_idx` (company_id, created_at) | List by company, sorted by creation time | `WHERE company_id=? ORDER BY created_at DESC` — covers the default list query |
| `background_jobs_job_type_idx` (job_type) | Filter by job type | `WHERE company_id=? AND job_type=?` — partial coverage (company_id not in index), but acceptable for admin/bulk queries |
| `background_jobs_queued_status_idx` (status) WHERE status='queued' | Worker claim query | `WHERE status='queued' ORDER BY created_at LIMIT N` — partial index avoids scanning all terminal rows. **Critical for performance as the table grows.** |

**CHECK constraints:**
- `status` IN ('queued', 'running', 'succeeded', 'failed') — prevents data corruption from buggy code setting invalid statuses
- `progress` BETWEEN 0 AND 100 — prevents UI rendering bugs from out-of-range values
- `duration_ms` IS NULL OR >= 0 — prevents nonsensical negative durations

### Drizzle schema parity
The TypeScript schema at `schema/background_jobs.ts` mirrors the migration exactly. Indexes and CHECK constraints are declared via drizzle-orm's `pgTable` callback, which generates matching SQL. The `$inferSelect` / `$inferInsert` types are consistent with column definitions.

### Worker safety
- The worker (`services/background-job-worker.ts`) only queries `background_jobs` directly for claim and update operations. The research processors (`research.activity_search`, `research.semantic_search`, `research.auto_assess`) internally query `issues`, `documents`, `activity_log`, `issue_comments`, and `issue_documents` — tables that may not exist in the Voyonder database.
- **Risk**: If a research-type job is enqueued on Voyonder (via direct DB insert or if routes are ever exposed), the processor will hit `42P01: relation does not exist` and the job will fail after retries. The fail-closed behavior is acceptable since these routes are not publicly exposed (only `/api/*` is routed to voyonder_api). Track as follow-up.
- The claim query uses `FOR UPDATE SKIP LOCKED` inside a single transaction — atomic, no race between workers.
- The `update()` service's WHERE guard (`IN ('queued', 'running')`) prevents overwriting terminal statuses.

### Test coverage
- `server/src/__tests__/background-jobs-service.test.ts` covers: create, list, filter, getById, update (including terminal status guard), dataUri slim projection, and stale-job recovery.
- 9 test cases in the service suite, 7 in the worker dispatch suite, 6 in the failure paths suite — total 22 tests.
- Coverage includes: company isolation, terminal status guard, dataUri stripping, stale-job requeue, processor timeout, and retry logic.
- Tests use embedded Postgres via `startEmbeddedPostgresTestDatabase` — real SQL execution, no mocking.

### Remaining concerns (MEDIUM — track as follow-up)
1. **Research/export tables missing on Voyonder**: If the research or export routes are ever served on Voyonder, the processors will fail. Either add the tables or explicitly disable the processors/routes for the Voyonder deployment.
2. **No job retention cleanup**: Terminal jobs accumulate indefinitely. A periodic cleanup job or TTL is needed for production scale.
3. **Research routes use read-level auth for write operations**: `assertCompanyScopeReadAllowed` gates job-creation endpoints. Any agent with `company_scope:read` can enqueue jobs. The general `POST /background-jobs` endpoint correctly requires board-level auth. This inconsistency was flagged in the M2 structural audit (recommendation C4) and remains unresolved.

---

## B2 — health route ordering: APPROVED

No changes to the health route code since the previous review. The route is mounted on the `api` sub-router at `/health` (full path: `/api/health`) in `server/src/app.ts:228-235`, which is before the catch-all 404 at `app.ts:360-362`.

```typescript
// app.ts
const api = Router();
api.use("/health", healthRoutes(db, {...}));  // line 228
// ... other API routes ...
app.use("/api", api);                           // line 359
app.use("/api", (_req, res) => {                // line 360 — catch-all 404
  res.status(404).json({ error: "API route not found" });
});
```

Express middleware executes in registration order, so `/api/health` is matched before the catch-all. Verified by previous live checks:
- `curl http://127.0.0.1:3101/api/health` → 200 `{"status":"ok",...}`
- Container reports `healthy`
- The health endpoint correctly returns 503 with `database_unreachable` when the DB probe fails

### Test coverage
- `server/src/__tests__/health.test.ts` covers: 200 with status ok, 200 with DB probe success, 503 with DB probe failure, safe server info fallbacks, redaction for anonymous requests in authenticated mode, and authenticated board access.
- `server/src/__tests__/health-dev-server-token.test.ts` covers: dev server status token auth.
- `server/src/__tests__/db-health-watchdog.test.ts` covers: embedded PG watchdog.

---

## B3 — Traefik routing: CODE APPROVED (8fb4d72), PRODUCTION FAIL

### What's committed (APPROVED)
Commit `8fb4d72` on voyonder master sets:
```
traefik.http.routers.voyonder-api.tls.certresolver=mytlschallenge
```
This matches production Traefik's sole resolver definition:
```
--certificatesresolvers.mytlschallenge.acme.tlschallenge=true
--certificatesresolvers.mytlschallenge.acme.email=ben@adoptaitech.com
--certificatesresolvers.mytlschallenge.acme.storage=/letsencrypt/acme.json
```

The `PathPrefix` matcher in the committed config routes `/api/*` to voyonder_api:3101. This is correct — the Voyonder app's routes all live under `/api` (health, auth, billing, onboarding, background-jobs, research, exports). The `/api` prefix does not shadow travel_app's frontend routes (`/`, `/app`, `/signup`, etc.) because Traefik's default priority favors more-specific rules, and `travel_app`'s `Host(voyonder.com)` without a path prefix continues to match everything else.

### Why production is still broken (DEPLOYMENT ISSUE, not code)
From `doc/review/2026-08-25-m6-b3-rereview.md` and live verification:
1. The running `voyonder_api` container (created 2026-08-24T23:55:27Z) has `certresolver=letsencrypt` — the old, rejected config.
2. `/root/voyonder-build/docker-compose.voyonder.yml` still has `letsencrypt` (mtime predates the fix).
3. Traefik logs continuously: `Router voyonder-api@docker uses a nonexistent resolver: letsencrypt`.
4. `/api/health` returns 200 only because a stale cert (`notBefore Jul 27 2026`, `notAfter Oct 25 2026`) is still in the ACME store. When that cert expires or Traefik re-evaluates, M6 goes dark.
5. `travel_app` container was removed at some point — `voyonder.com/` → 404. The frontend is completely down, a regression from the first review where at least the frontend was serving.

**Root cause**: Deployments copy a dirty working tree from `/root/voyonder-build`, not from git HEAD. Commit `24bc51d` even re-introduced `letsencrypt` with a comment claiming it was "per Staff Engineer review" — a misreading. The correct fix `8fb4d72` exists in git but has never been applied to the deployed config.

### What must happen before ship
1. **Redeploy from committed HEAD (8fb4d72)** — update `/root/voyonder-build/docker-compose.voyonder.yml` from `git show 8fb4d72:docker-compose.voyonder.yml`, then `docker compose -f docker-compose.voyonder.yml up -d --force-recreate voyonder`.
2. **Verify no Traefik error**: `docker logs traefik --since 5m` must NOT contain `nonexistent resolver` for `voyonder-api@docker`.
3. **Restore frontend routing** — the `travel_app` container and its Traefik router must be recreated, or make an explicit, documented decision to ship API-only for M6. Current state (frontend container removed, no router) is not a decision — it's a regression.
4. **Fix deploy provenance**: Build/deploy from git HEAD (clone or `git archive`), never from an uncommitted working tree. This is the root cause of the repeated deployment failures.

---

## Summary of findings

| Category | Finding | Severity | Action |
|----------|---------|----------|--------|
| Schema | Research/export tables missing on Voyonder | MEDIUM | Track as follow-up — add tables or explicitly disable routes/processors |
| Schema | No job retention cleanup | LOW | Add periodic cleanup for terminal jobs |
| Schema | Research routes use read-level auth for writes | MEDIUM | Add board-level auth or dedicated `background_job:create` permission (unresolved from M2 review) |
| Schema | Worker claim transaction is atomic | ✅ PASS | No action needed |
| Schema | Terminal-status WHERE guard prevents overwrite | ✅ PASS | No action needed |
| Schema | Partial index for worker claim query | ✅ PASS | No action needed |
| Health | Route ordered before catch-all 404 | ✅ PASS | No action needed |
| Health | DB probe with 503 fallback | ✅ PASS | No action needed |
| Routing | Traefik label syntax | ✅ CODE CORRECT | Redeploy from committed HEAD (8fb4d72) |
| Routing | certresolver mismatch vs production | ❌ NOT DEPLOYED | Deploy committed fix |
| Routing | Frontend routing regressed | ❌ travel_app REMOVED | Restore frontend container and router |
| Process | Deploy provenance | ❌ BROKEN | Always deploy from git HEAD, not dirty working tree |

## Disposition

- **B1**: APPROVED (unchanged from previous review)
- **B2**: APPROVED (unchanged from previous review)
- **B3 code**: APPROVED — `certresolver=mytlschallenge` in commit 8fb4d72 is correct
- **B3 deployment**: FAIL — production still runs the rejected `letsencrypt` config; frontend is fully down

Send back to Release Engineer / implementer with the 4 required actions above. CTO sign-off required before ship. B1/B2 do not need re-review after deployment if the schema and health route remain unchanged.
