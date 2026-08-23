# Voyonder Code Separation Phase 2 — Implementation Complete (Tracks A + B)

**Author:** Founding Engineer (57fa7e0e)
**Date:** 2026-08-22 ~17:00 UTC
**Status:** Track A (Package Publishing) and Track B (Interface Extraction) — DONE
**Reference:** CTO Technical Plan — Voyonder Code Separation Phase 2 (2026-08-22 ~21:00 UTC)
**CEO Decision:** APPROVED Tracks A+B, Track C (Paperclip-side wiring) DEFERRED

---

## Summary

All four Track B interfaces are defined, exported, and integrated. Track A import paths are updated (workspace links retained because published npm packages lag behind local source).

### Track A: Package Publishing (Partial — workspace links retained)

| Task | Status | Notes |
|------|--------|-------|
| A1: Publish `@paperclipai/shared` | ✅ Already published (v2026.817.0) | Canary builds up to 2026.822.0-canary.4 available |
| A2: Publish `@paperclipai/db` | ✅ Already published (v2026.817.0) | @paperclipai/shared@2026.817.0 as dependency |
| A3: Update Voyonder to consume published packages | ✅ Import paths updated | Workspace links retained — published packages lack background-job types and new interfaces. See "Published Package Gap" below |

### Track B: Interface Extraction (Complete)

| Task | Status | Deliverable |
|------|--------|-------------|
| B1: EventBus interface | ✅ Done | `@paperclipai/shared/src/types/event-bus.ts` |
| B2: AuthProvider interface | ✅ Done | `@paperclipai/shared/src/types/auth-provider.ts` |
| B3: LoggerProvider interface | ✅ Done | `@paperclipai/shared/src/types/logger.ts` |
| B4: Update createVoyonderApp signature | ✅ Done | `VoyonderOptions` interface + adapter wrappers |

### Track C: Paperclip-side Wiring

⬜ **Deferred by CEO** — Not started. Will be implemented when founder provides strategic direction on v0.6.0 scope.

---

## Changed Files

### Paperclip Monorepo (`/Users/benh/Programming/paperclip`)

| File | Change |
|------|--------|
| `packages/shared/src/types/event-bus.ts` | **NEW** — EventBus interface (emit, emitMany, on, off) |
| `packages/shared/src/types/auth-provider.ts` | **NEW** — AuthProvider interface + AuthRequest/AuthActor types |
| `packages/shared/src/types/logger.ts` | **NEW** — LoggerProvider interface |
| `packages/shared/src/types/index.ts` | **MODIFIED** — Exports EventBus, AuthProvider, AuthRequest, AuthActor, LoggerProvider |
| `packages/shared/src/index.ts` | **MODIFIED** — Re-exports all new types from package barrel |

### Voyonder Repo (`/Users/benh/Programming/voyonder`)

| File | Change |
|------|--------|
| `package.json` | **MODIFIED** — Added `@paperclipai/shared: workspace:*` dependency |
| `pnpm-workspace.yaml` | **MODIFIED** — Retains workspace links to `../paperclip/packages/db` and `../paperclip/packages/shared` |
| `tsconfig.json` | **MODIFIED** — Removed `packages/shared` from include (directory deleted) |
| `packages/shared/` | **DELETED** — Local copy of shared types removed (now using `@paperclipai/shared` from workspace-linked package) |
| `server/src/app.ts` | **MODIFIED** — `VoyonderOptions` interface, adapter wrappers for EventBus/AuthProvider/Logger, updated `createVoyonderApp(db, opts?)` |
| `server/src/routes/research.ts` | **MODIFIED** — Import `BACKGROUND_JOB_TYPES` from `@paperclipai/shared` |
| `server/src/services/background-job-worker.ts` | **MODIFIED** — Import `BackgroundJob` from `@paperclipai/shared` |
| `server/src/services/background-jobs.ts` | **MODIFIED** — Import types from `@paperclipai/shared` |
| `server/src/services/research-search.ts` | **MODIFIED** — Import types from `@paperclipai/shared` |
| `server/src/services/research-export.ts` | **MODIFIED** — Import `BackgroundJob` from `@paperclipai/shared` |
| `pnpm-lock.yaml` | **MODIFIED** — Updated to reflect package changes |

---

## Published Package Gap

The npm-published versions of `@paperclipai/shared` (2026.817.0) and `@paperclipai/db` (2026.817.0) do NOT include:

- Background job types (`BACKGROUND_JOB_TYPES`, `BackgroundJob`, `BackgroundJobEvent`, etc.)
- Background job DB schema export (`backgroundJobs` table)
- The new EventBus, AuthProvider, LoggerProvider interfaces

The Phase 1 background-job types and the Phase 2 interfaces exist only in the local Paperclip monorepo source. Once the CI pipeline publishes the next version, Voyonder's workspace links can be replaced with npm versions by:

1. Removing `../paperclip/packages/db` and `../paperclip/packages/shared` from `pnpm-workspace.yaml`
2. Changing `"workspace:*"` to `"^<published-version>"` in `package.json`
3. Running `pnpm install --no-frozen-lockfile`

---

## Verification

- ✅ `@paperclipai/shared` builds cleanly (pnpm build — tsc)
- ✅ `@paperclipai/db` builds cleanly (pnpm build — tsc + migration check)
- ✅ Voyonder typecheck passes (pnpm typecheck — tsc --noEmit)
- ⬜ Server boot test — deferred to Track C or separate verification

---

## Next Steps

1. **Staff Engineer** — Code review of the new interfaces and Voyonder integration code
2. **CI/CD** — Next package publish will include background-job types + new interfaces, enabling full Track A3 completion
3. **CEO** — Provide strategic direction for v0.6.0 to unblock Track C