# VOY-1657 — Voyonder Product Code Separation

**Date:** 2026-08-22
**Author:** COO Agent
**Status:** Complete

## Background

Per board directive (2026-08-21), all Voyonder product code must reside in a separate repository — not inside the Paperclip monorepo.

8 untracked Voyonder product files were present on Paperclip `master` branch. These files were developed as part of the M2 research async conversion (VOY-1493) and P0/P1 hotfixes (VOY-1531), but were accidentally left as untracked files after the fork-cleanup commit (`06e3863b47`/`009da5082d`).

## Migrated Files

### Voyonder Repository
- **URL:** https://github.com/PraeSynBH/voyonder
- **Local path:** `/Users/benh/Programming/voyonder`

### Files Moved (8)

| File | Purpose |
|------|---------|
| `packages/shared/src/background-job-types.ts` | `BACKGROUND_JOB_TYPES` constants, `BackgroundJobType`, `BackgroundJobStatus` types |
| `packages/shared/src/types/background-job.ts` | `BackgroundJob`, `CreateBackgroundJobRequest`, `BackgroundJobEvent` interfaces |
| `server/src/routes/background-jobs.ts` | Background job API routes (list, get-by-id, SSE events) |
| `server/src/routes/research.ts` | Research API routes (search, auto-assess, PDF/ICS export) |
| `server/src/services/background-job-worker.ts` | Background job worker (polling, claim, retry, graceful shutdown) |
| `server/src/services/background-jobs.ts` | Background job CRUD service (create, list, succeed, fail, claim, requeue) |
| `server/src/services/research-export.ts` | PDF and ICS/iCalendar export services |
| `server/src/services/research-search.ts` | Keyword-first search with tokenized scoring, semantic upgrade |

### Changes Made to Voyonder Repo
- Created `server/src/lib/` with adapter utilities: `authz.ts`, `errors.ts`, `live-events.ts`, `logger.ts`, `validate.ts`
- Created `packages/shared/src/index.ts` barrel export
- Updated imports to use Voyonder lib adapters instead of Paperclip internal paths
- Created `package.json`, `tsconfig.json`, `.gitignore`, `README.md`

### Changes Made to Paperclip Repo

| File | Change |
|------|--------|
| `packages/shared/src/index.ts` | Added exports for `BACKGROUND_JOB_TYPES`, `BackgroundJob`, `BackgroundJobStatus`, `BackgroundJobType`, `CreateBackgroundJobRequest`, `BackgroundJobEvent` — these are API contract types needed by Paperclip UI |
| `packages/db/src/schema/index.ts` | Added export for `backgroundJobs` table schema (was previously missing from the barrel export) |

### Files Deleted from Paperclip Working Tree (8)
All 8 untracked Voyonder files were deleted from the Paperclip working tree. They are untracked files, so no git history change is needed.

## Verification

- ✅ All 8 Voyonder files removed from Paperclip working tree
- ✅ Voyonder repo created at `/Users/benh/Programming/voyonder` with all files + lib adapters
- ✅ Paperclip shared package exports background job types for UI compatibility
- ✅ Paperclip db package exports `backgroundJobs` schema for Voyonder dependency
- ✅ No remaining untracked Voyonder product code in Paperclip

## Remaining Work

### Completed by COO (this session)
1. ✅ **Voyonder repo pushed to GitHub** — `origin git@github.com:PraeSynBH/voyonder.git` (master tracking set)
2. ✅ **Paperclip shared types restored** — `background-job-types.ts` and `types/background-job.ts` restored in `packages/shared/src/` with correct import paths
3. ✅ **Paperclip `app.ts` Voyonder wiring removed** — Per CTO plan, route mounting and worker startup/shutdown code removed from Paperclip (belongs in Voyonder)
4. ✅ **Paperclip shared contract preserved** — `index.ts` exports, `constants.ts` LIVE_EVENT_TYPES entry, `db/schema/index.ts` backgroundJobs export all intact
5. ✅ **No Voyonder service/route code remains in Paperclip** — Verified by grep

### Handed off per CTO Plan (VOY-1658)
| Step | Owner | Description |
|------|-------|-------------|
| 2. Implement Phase 1 migration | **Founding Engineer** | Update UI imports, wire Voyonder routes, adapt event bus interface |
| 3. Code review | **Staff Engineer** | Review Phase 1 implementation |
| 4. Release/ship | **Release Engineer** | Ship from Voyonder repo |
| 5. QA verification | **QA Engineer** | Verify shipment |

### Open Items
1. **Publish `@paperclipai/db` and `@paperclipai/shared` packages** so Voyonder can install them as dependencies (blocking Phase 1)
2. **Update agent Hermes profile workspace configs** — Voyonder profile's `terminal.cwd` currently points to `/Users/benh/Programming/Business/projects/voyonder` (web app), not product code repo at `/Users/benh/Programming/voyonder`
3. **Decide on `background_jobs` migration ownership** — shared schema dependency between Paperclip and Voyonder
4. **Event bus interface** — Define `EventBus` interface in `@paperclipai/shared` to decouple Voyonder from Paperclip's `live-events.ts` (Phase 2)

## Notes

- The Voyonder server code is designed as a middleware layer that runs inside the Paperclip server. It imports `@paperclipai/db` for database access and `@paperclipai/shared` for shared types.
- The background job routes were NEVER wired into Paperclip's `app.ts` — they were only ever available as standalone Express routers. No Paperclip route wiring needed to be undone.
