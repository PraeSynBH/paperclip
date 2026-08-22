# CTO Review: VOY-1658 — Voyonder Code Separation Phase 1

**Reviewer:** CTO (5a914da0)
**Date:** 2026-08-22 ~17:25 UTC
**Status:** APPROVED with minor fixes applied

## Assessment

The Founding Engineer's implementation of Phase 1 migration is structurally sound. All 8 Voyonder product files have been successfully relocated to `/Users/benh/Programming/voyonder/` with correct import paths, proper wiring in `createVoyonderApp()`, and passing typecheck.

## Issues Found & Fixed

1. **`@types/*` in wrong dependency section** — `@types/express` and `@types/node` were in `dependencies` instead of `devDependencies`. Fixed.

2. **Duplicate constants in research-search.ts** — `DEFAULT_LIMIT` and `MAX_LIMIT` were redefined inside the `researchSearchService()` function, shadowing the module-level constants. Fixed.

## Design Decision

The original plan called for `github:Praesyn/paperclip#packages/db` style dependency references. The implementation uses `workspace:*` protocol via pnpm workspace inclusion (adding `/Users/benh/Programming/voyonder` to Paperclip's `pnpm-workspace.yaml`). This is acceptable for local development but the team should switch to `github:` references before production deployment.

## Delegation Chain

| Step | Issue | Owner | Status |
|------|-------|-------|--------|
| Implementation | VOY-1658 | Founding Engineer | In Progress |
| Code Review | VOY-1659 | Staff Engineer | Created |
| Release | VOY-1660 | Release Engineer | Created (blocked on review) |
| QA Verification | — | QA Engineer | Not yet created |

## Files Changed (Voyonder Repo)

- `package.json` — minor dep fix
- `server/src/app.ts` — wired routes, worker, shutdown
- `server/src/routes/research.ts` — import paths, type annotations
- `server/src/routes/background-jobs.ts` — type annotations
- `server/src/services/background-jobs.ts` — import paths
- `server/src/services/background-job-worker.ts` — import paths
- `server/src/services/research-search.ts` — import paths, dedup fix
- `server/src/services/research-export.ts` — import paths
- `server/src/lib/errors.ts` — new file (replicated from Paperclip)
- `packages/shared/src/index.ts` — background job types only

## Files Changed (Paperclip Repo)

- `packages/shared/src/background-job-types.ts` — new (shared contract)
- `packages/shared/src/types/background-job.ts` — new (shared contract)
- `packages/shared/src/index.ts` — modified (exports background job types)
- `packages/shared/src/constants.ts` — modified (LIVE_EVENT_TYPES)
- `packages/db/src/schema/index.ts` — modified (exports backgroundJobs)
- `pnpm-workspace.yaml` — modified (added voyonder repo)
- `pnpm-lock.yaml` — modified (dependency resolution)
