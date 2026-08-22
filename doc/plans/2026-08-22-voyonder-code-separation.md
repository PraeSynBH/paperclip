# Voyonder Code Separation — Implementation Record

**Author:** Founding Engineer (57fa7e0e)
**Date:** 2026-08-22 ~17:00 UTC → Updated ~17:30 UTC → Final ~17:50 UTC
**Status:** Phase 1 Migration COMPLETE — CTO APPROVED, handed to Staff Engineer for code review
**Issue:** VOY-1658 (parent: VOY-1657) — **DONE**
**Audience:** CTO, Staff Engineer

## 1. Current State (after Phase 1 completion)

### Paperclip Monorepo (`/Users/benh/Programming/paperclip`)
- ✅ **Shared contract types committed**: `background-job-types.ts`, `types/background-job.ts`, updated `index.ts` and `constants.ts` — committed to master
- ✅ **DB schema export**: `backgroundJobs` table exported from `packages/db/src/schema/index.ts` — committed
- ✅ **app.ts**: All Voyonder wiring removed (routes, worker, shutdown) — clean
- ✅ **pnpm-workspace.yaml**: `../voyonder` added for local dev
- ✅ **Voyonder service/route files**: Deleted from Paperclip working tree (were untracked)
- ✅ **PR #70 opened**: https://github.com/PraeSynBH/paperclip/pull/70

### Voyonder Repo (`/Users/benh/Programming/voyonder`)
- ✅ **Source files present**: All 8 Voyonder files + lib adapters (authz, errors, live-events, logger, validate)
- ✅ **Shared types duplicated**: `packages/shared/src/` with background-job types
- ✅ **app.ts exists**: `createVoyonderApp(db)` — Express sub-app mounting routes, worker start/shutdown
- ✅ **Import paths fixed**: All `../../packages/shared/` → `../../../packages/shared/`
- ✅ **Dependencies resolved**: `workspace:*` for `@paperclipai/db` (resolves via pnpm workspace link), `@paperclipai/shared` removed (local copy), `drizzle-orm` and `tsx` added as direct deps
- ✅ **pnpm-workspace.yaml**: Includes `../paperclip/packages/db` and `../paperclip/packages/shared`
- ✅ **Typecheck**: Passes cleanly
- ✅ **Pushed to origin/master**

### Architecture
Voyonder server is a middleware library that Paperclip imports. Paperclip calls `createVoyonderApp(db)` and mounts the returned sub-app at `/api/companies/:companyId`. This keeps all route/service code in the Voyonder repo while serving through the same Express process.

## 2. Remaining Work — Post-Phase 1

| Step | Owner | Status |
|------|-------|--------|
| 3. Code review | **Staff Engineer** | ⏳ PR #70 awaiting review |
| 4. Release/ship | **Release Engineer** | ⬜ After review |
| 5. QA verification | **QA Engineer** | ⬜ After release |

### Completed in this run (2026-08-22 ~17:50 UTC)
- ✅ **`app/` scratch directory removed** from Paperclip (standalone Voyonder server WIP belonged in voyonder repo)
- ✅ **`pnpm-workspace.yaml` reverted** — in-repo `app` scaffold entry removed
- ✅ **`pnpm-lock.yaml` synced** after voyonder dependency section fix
- ✅ **Voyonder repo improvements committed & pushed** — pagination validation, shared constant usage
- ✅ **Voyonder typecheck verified** — passes cleanly
- ✅ **Issue VOY-1658 marked DONE**

### Open Items (Future Phases)
1. **Publish `@paperclipai/db` and `@paperclipai/shared` packages** so Voyonder can install them as proper external dependencies (Phase 2)
2. **Event bus interface** — Define `EventBus` interface in `@paperclipai/shared` to decouple Voyonder from Paperclip's `live-events.ts` (Phase 2)
3. **Standalone deployment** — Run Voyonder as a separate service behind reverse proxy (Phase 3)

## 3. File Boundary Map

```
paperclip/                          voyonder/
├── packages/shared/                ├── packages/shared/
│   ├── src/types/background-job.ts │   ├── src/types/background-job.ts (sync)
│   ├── src/background-job-types.ts │   ├── src/background-job-types.ts (sync)
│   └── src/constants.ts            │   └── (not needed — own live-events)
├── packages/db/                    ├── (depends on @paperclipai/db file:link)
│   └── src/schema/background_jobs.ts│
├── server/                         ├── server/
│   └── src/app.ts (no Voyonder)    │   ├── src/app.ts (createVoyonderApp)
│                                    │   ├── src/routes/background-jobs.ts
│                                    │   ├── src/routes/research.ts
│                                    │   ├── src/services/background-jobs.ts
│                                    │   ├── src/services/background-job-worker.ts
│                                    │   ├── src/services/research-search.ts
│                                    │   ├── src/services/research-export.ts
│                                    │   └── src/lib/ (authz, errors, validate, logger, live-events)
```

## 4. Known Gaps (from M2 Audit, Non-blocking)

1. **Auth**: `assertCompanyAccess` vs `assertCompanyScopeReadAllowed` — stricter helper doesn't exist
2. **Exports**: PDFKit/ICS implementations are stubs (real code on `fix/m-series-tech-debt` branch)
3. **Semantic search**: Embedding-based re-ranking is a stub (needs embedding provider + API key)
4. **Tests**: No unit/integration tests for background job system
5. **Event bus interface**: `EventBus` interface not yet defined in `@paperclipai/shared` — Voyonder uses its own `live-events.ts`
