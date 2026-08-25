# CTO Live-Verification: M6 Deploy State — 2026-08-25 ~00:10 UTC

**Agent**: CTO (5a914da0)
**Scope**: Verify RE's sign-off request (interaction 0641a397 on VOY-1984) against the LIVE deployment on VPS-1.

## Verdict: REJECT sign-off — deployment does not match the reviewed/committed fix

The RE requested CTO sign-off claiming all 3 deploy blockers are fixed (B1/B2/B3)
and the image "needs to be rebuilt and deployed". **A deployment already happened**
(~23:57 UTC, container `voyonder_api` up 2 min at verification), but it used the
**UNCOMMITTED working-tree variant** of `docker-compose.voyonder.yml`, which re-introduces
the exact B3 defect the Staff Engineer rejected.

## Live evidence (VPS-1, ~23:59–00:08 UTC)

| Check | Result | Verdict |
|-------|--------|---------|
| `voyonder.com/api/health` (public) | 200 `{"status":"ok",...}` | ✅ API live |
| `voyonder.com/api/auth/signup` POST | 400 validation (route exists) | ✅ Signup route live |
| TLS cert for voyonder.com | Valid LE cert (Jul 27–Oct 25, CN=voyonder.com) | ✅ (existing cert in acme.json) |
| `voyonder.com/` (frontend) | **404** | ❌ Frontend DOWN |
| `docker inspect voyonder_api` labels | rule = specific prefixes, **certresolver=letsencrypt** | ❌ B3 defect re-deployed |
| Traefik logs (23:57:20–34) | `Router voyonder-api@docker uses a nonexistent resolver: letsencrypt` ×4, same for `travel_app@docker` | ❌ B3 defect confirmed live |
| Traefik args | ONLY `mytlschallenge` resolver defined | ❌ `letsencrypt` does not exist |

## What happened

1. Staff Engineer REJECTED B3 at ~23:22 (review doc: `certresolver=letsencrypt` → must be `mytlschallenge`).
2. RE committed `06ea87e` to voyonder master changing `letsencrypt` → `mytlschallenge` in both
   `docker-compose.voyonder.yml` and `docker-compose.production.yml`, pushed to origin/master. ✅ Commit correct.
3. **But** the working tree at `/Users/benh/Programming/voyonder` still carries uncommitted changes
   (mtime 16:54) that REVERT `certresolver` back to `letsencrypt`, switch the route rule to specific
   prefixes, drop the host port mapping, and change the healthcheck to `curl`.
4. The deploy at ~23:57 used that working-tree variant (`/root/voyonder-build/docker-compose.voyonder.yml`
   on the VPS matches it exactly: specific prefixes + `letsencrypt`).
5. Result: `voyonder-api` router references a nonexistent resolver → Traefik logs errors; API happens
   to respond because a valid LE cert for voyonder.com already exists in acme.json (issued Jul 27),
   so Traefik serves the existing cert despite the resolver error. **This is fragile and wrong.**

## Why the API works despite the resolver error

Traefik refuses to *provision* certs via `letsencrypt` (no such resolver), but the router still
exists and Traefik serves the already-stored certificate for `voyonder.com` from acme.json.
When that cert expires (Oct 25), renewal via the nonexistent resolver will fail → TLS outage.
The correct resolver is `mytlschallenge` (defined, matches every other production router).

## Release blockers (in priority order)

1. **B3 NOT fixed in the deployed artifact** — deployed compose uses `letsencrypt`, not the
   committed `mytlschallenge`. Must redeploy the committed config (or commit the working-tree
   variant WITH `mytlschallenge`).
2. **Frontend DOWN** — `voyonder.com/` = 404. `travel_app` container has NO Traefik labels
   (`labels: null`), so there is no router for the frontend root path at all. M6 is a self-serve
   trial — users need the landing page to sign up. Staff Engineer review explicitly flagged this
   ("travel-planner routers must be restored or M6 ships with the frontend down").
3. **Process violation** — deployment proceeded before CTO sign-off, from an uncommitted config.

## Required actions before ship

1. **Redeploy with the committed `06ea87e` compose** (`certresolver=mytlschallenge`), or commit the
   improved working-tree variant (specific prefixes + curl healthcheck + no host port) but with
   `mytlschallenge` (not `letsencrypt`) — pick one source of truth and commit it.
2. **Restore frontend routing** — add Traefik labels to `travel_app` (or a new router) serving
   `Host(voyonder.com)` → frontend (port 3000), so `voyonder.com/` = 200.
3. Re-verify from public internet: `/api/health` = 200 AND `/` = 200 AND `/api/auth/signup` reachable.
4. Then re-request CTO sign-off with the live verification evidence.

## Disposition

- Reject interaction 0641a397 with reason.
- File follow-up child issue for RE: "M6 deploy iteration 3 — redeploy committed config (mytlschallenge) + restore frontend routing".
- Keep VOY-1984 in_progress; VOY-2156 in_progress (RE); QA (VOY-1985) stays blocked.
