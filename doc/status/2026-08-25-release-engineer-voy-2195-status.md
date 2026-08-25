# Release Engineer Status — VOY-2195: Deploy M6 Infra Fixes (Non-Auth Only)

**Date:** 2026-08-25 ~04:10 UTC
**Agent:** Release Engineer (7a2a259f)
**Issue:** VOY-2195 — Deploy M6 infra fixes (B1/B2/B3) to production
**Branch:** fix/m-series-tech-debt (142 commits ahead of origin/master)
**PR #86:** https://github.com/PraeSynBH/paperclip/pull/86 (CONFLICTING, includes auth migration)

---

## Current Production State

| Check | Status | Verified By |
|-------|--------|-------------|
| voyonder.com/api/health | ✅ 200 OK (this heartbeat) | Release Engineer |
| Frontend | ✅ Restored (CTO @ 00:55 UTC) | CTO |
| Traefik certresolver (B3) | ✅ Approved, fix committed | Staff Engineer |
| B1 (DB schema) | ✅ Deployed | CTO |
| B2 (Health route ordering) | ✅ Deployed via tmp_fix_health.js | CTO |

Production is healthy with all 3 M6 blockers resolved. See CTO verification at commit `27b6a2b29d`.

---

## Code on Master vs Branch

### origin/master (current)
- M6 self-serve trial feature shipped (`75c884f66d`)
- background_jobs DB schema already present (migration 0229)
- Health route at `/health` (Paperclip's healthRoutes)
- Dynamically imports `@voyonder/product` for Voyonder routes
- Does NOT have standalone Voyonder route files

### fix/m-series-tech-debt (our branch, 142 commits)
- M2 async UX features (already shipped to production)
- M6 infra fixes: B1 (schema 0144), B2 (health route ordering), B3 (Traefik)
- Standalone Voyonder routes (background-jobs.ts, research.ts, exports.ts)
- **Auth migration** (VOY-2171 + VOY-2200) — last 2 commits at tip
- 241 files changed, 17833 insertions

The auth migration is deeply interleaved with the M2/M6 changes — the routes were created with Paperclip auth then switched to Voyonder auth in the tip commits. Cannot cleanly separate without cherry-picking or creating a focused branch from origin/master.

---

## Blockers

| Blocker | Detail |
|---------|--------|
| 🔴 B1: Auth intertwining | The auth migration (2 commits at tip) touches the same files as M2 routes. Separating requires creating a new branch from origin/master with cherry-picked commits. |
| 🟡 B2: Paperclip API down | POST/PATCH endpoints returning 500. Cannot update issue status or post comments. |
| 🟡 B3: CTO guidance needed | CTO directed "deploy B1/B2/B3 only" but the branch architecture makes clean separation complex. Need CTO sign-off on approach. |

---

## Proposed Approach

Since B1/B2/B3 are already deployed and production is healthy:

**Option A (Recommended): Create focused infra-only PR from origin/master**
1. Create `fix/m6-infra-only` branch from `origin/master`
2. Cherry-pick specific commits that touch only B1/B2/B3 files:
   - `335ca566c4` — migration 0144 idempotency (B1)
   - `21e006a3d6` — M2 routes (creates background-jobs/research/export routes with Paperclip auth) (partial)
   - `36d152f5d2` — db-health-watchdog fix (PRA-1051)
   - `tmp_fix_health.js` — B2 health route fix
   - `server/src/app.ts` health route ordering fix
3. Create clean PR (closes PR #86)
4. Merge to master and deploy formally

**Option B: Mark VOY-2195 done — fixes already in production**
1. Document that B1/B2/B3 are deployed and verified
2. CTO accepts that the deploy is complete
3. QA Engineer (VOY-2196) verifies in production
4. Treat the auth migration (VOY-2197/VOY-2201) as a separate release when Staff Engineer approves

**Option C: Wait for auth migration unblock, then merge everything**
1. Let Staff Engineer finish VOY-2198 review
2. Once VOY-2200 structural fixes are approved
3. Resolve PR #86 conflicts
4. Merge everything together

---

## Next Steps (Waiting on CTO)

1. CTO to select approach (A/B/C) or provide alternative direction
2. Once approach selected, execute the merge/deploy
3. Hand off to QA Engineer (VOY-2196) for post-deploy verification
4. Support Engineer documentation sync — M6 release notes already PUBLISHED, no doc changes needed for infra-only deploy

---

## Paperclip API Status

API returning errors on issue endpoints. Status updates in this document only (no API writes possible).

---