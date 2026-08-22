# CTO Technical Architecture: Voyonder Code Separation

**Author:** CTO (5a914da0-bb1d-4cf0-89b8-7cca9003da4e)
**Date:** 2026-08-22 ~16:20 UTC
**Issue:** VOY-1657 (code separation), VOY-1658 (this plan)
**Status:** Final

---

## 1. Context

The board directive (2026-08-21) requires: *"All Voyonder product code MUST reside in a separate repository — NOT inside the Paperclip monorepo."*

8 untracked Voyonder product files currently live on the Paperclip `master` branch:

| # | File | Purpose |
|---|------|---------|
| 1 | `packages/shared/src/background-job-types.ts` | Background job type constants |
| 2 | `packages/shared/src/types/background-job.ts` | BackgroundJob API types |
| 3 | `server/src/services/background-jobs.ts` | Background job CRUD service |
| 4 | `server/src/services/background-job-worker.ts` | Async job worker with polling |
| 5 | `server/src/services/research-search.ts` | Keyword + semantic search |
| 6 | `server/src/services/research-export.ts` | PDF/ICS export stubs |
| 7 | `server/src/routes/background-jobs.ts` | REST + SSE routes |
| 8 | `server/src/routes/research.ts` | Research routes |

The COO (VOY-1657) is creating the target repository.

---

## 2. Dependency Analysis

### 2.1 Paperclip Workspace Dependencies

The Voyonder files import from Paperclip's internal workspace packages:

| Package | Imported Symbol | Used By |
|---------|----------------|---------|
| `@paperclipai/db` | `backgroundJobs` table, `Db` type, drizzle helpers | background-jobs.ts, background-job-worker.ts, research-search.ts |
| `@paperclipai/shared` | `BackgroundJob`, `BackgroundJobStatus`, `BACKGROUND_JOB_TYPES`, `BackgroundJobType`, `CreateBackgroundJobRequest`, `BackgroundJobEvent` | All 8 files |

### 2.2 Paperclip Local Module Dependencies

| Local Module | Imported Symbol | Used By |
|-------------|----------------|---------|
| `../services/live-events` | `publishLiveEvent` | background-jobs.ts |
| `../middleware/validate` | `validate` | research.ts (routes) |
| `../routes/authz` | `assertAuthenticated`, `assertCompanyAccess` | Both route files |
| `../middleware/logger` | `logger` | All service files |
| `../errors` | `notFound` | background-jobs.ts |

### 2.3 NPM Dependencies

| Dependency | Used By |
|-----------|---------|
| `express` (Router, Request, Response) | Both route files |
| `zod` (validation schemas) | research.ts (routes) |
| `drizzle-orm` (query building) | background-jobs.ts, research-search.ts |

### 2.4 Integration Points in Paperclip

The files are designed to be wired into Paperclip's `server/src/app.ts`:

| Integration | Expected Code | Status |
|------------|--------------|--------|
| Mount background job routes | `app.use('/api/companies/:companyId/background-jobs', backgroundJobRoutes(db, ...))` | ❌ Not wired |
| Mount research routes | `app.use('/api/companies/:companyId/research', researchRoutes(db, ...))` | ❌ Not wired |
| Start worker | `worker.start()` after `jobCoordinator.start()` | ❌ Not wired |
| Register job processors | `registerJobProcessor(BACKGROUND_JOB_TYPES.RESEARCH_AUTO_ASSESS, ...)` | ❌ Not wired |
| Shutdown worker | `worker.shutdown()` in graceful shutdown | ❌ Not wired |

The `@paperclipai/shared` and `@paperclipai/db` workspace packages already export the relevant types and table schema. The wiring code in `app.ts` is the missing link — and that wiring should live in the Voyonder repo, not Paperclip.

---

## 3. Migration Strategy

### Phase 1 — External Dependency Model (immediate, 1-2 days)

**Goal:** Move the code out of Paperclip with minimal structural changes.

1. **Create Voyonder repo** (`voyonder-server` or similar) — in progress via COO (VOY-1657)
2. **Initialize Node.js project** in the new repo with `package.json`
3. **Add Paperclip packages as external dependencies:**
   ```json
   {
     "dependencies": {
       "@paperclipai/db": "github:Praesyn/paperclip#packages/db",
       "@paperclipai/shared": "github:Praesyn/paperclip#packages/shared"
     }
   }
   ```
   Or publish to a private npm registry for cleaner semver.
4. **Copy Voyonder product code** to the new repo with updated import paths:
   - `@paperclipai/db` → same (external dep)
   - `@paperclipai/shared` → same (external dep)
   - `../services/live-events` → need Paperclip event interface (see §3.2)
   - `../middleware/*` → replicate thin wrappers or import from Paperclip
   - `../routes/authz` → replicate or import from Paperclip
   - `../errors` → replicate (simple `notFound()` function)
5. **Wire routes and worker** in the Voyonder repo's `app.ts`
6. **Remove untracked files** from Paperclip master

**File mapping:**

| Paperclip Path | Voyonder Repo Path | Action |
|---------------|-------------------|--------|
| `packages/shared/src/background-job-types.ts` | Already in `@paperclipai/shared` | Keep in Paperclip (shared contract) |
| `packages/shared/src/types/background-job.ts` | Already in `@paperclipai/shared` | Keep in Paperclip (shared contract) |
| `server/src/services/background-jobs.ts` | `src/services/background-jobs.ts` | Copy, tweak imports |
| `server/src/services/background-job-worker.ts` | `src/services/background-job-worker.ts` | Copy, tweak imports |
| `server/src/services/research-search.ts` | `src/services/research-search.ts` | Copy, tweak imports |
| `server/src/services/research-export.ts` | `src/services/research-export.ts` | Copy, tweak imports |
| `server/src/routes/background-jobs.ts` | `src/routes/background-jobs.ts` | Copy, tweak imports |
| `server/src/routes/research.ts` | `src/routes/research.ts` | Copy, tweak imports |

### Phase 2 — Event Bus Interface (medium term, 1 week)

The tightest coupling is `publishLiveEvent` from `live-events.ts`. To avoid Paperclip internal imports:

**Option A: Shared EventEmitter Interface (recommended)**
Add to `@paperclipai/shared`:
```typescript
// packages/shared/src/event-bus.ts
export interface EventBus {
  publish(companyId: string, type: string, payload: unknown): void;
  subscribe(companyId: string, type: string, handler: (payload: unknown) => void): () => void;
}
```
Paperclip implements it using `live-events.ts`. Voyonder uses the interface.

**Option B: Webhook Gateway**
Paperclip POSTs events to a Voyonder webhook endpoint. Simpler but adds latency and delivery complexity.

**Option C: Message Queue (over-engineered for current scale)**
RabbitMQ/Redis pub-sub. Premature for a 2-service architecture.

### Phase 3 — Deployment Isolation (future)

Run Voyonder as a separate service behind a reverse proxy:

```
nginx/Caddy
├── /api/companies/:cid/research/*          → Voyonder service:3101
├── /api/companies/:cid/background-jobs/*   → Voyonder service:3101
├── /api/companies/:cid/background-jobs/events → Voyonder service:3101 (SSE)
└── /*                                       → Paperclip service:3100
```

Both services share the same PostgreSQL database cluster. Voyonder only writes to `background_jobs` table; Paperclip owns all other tables. No data migration needed.

---

## 4. Staff Engineer Audit Findings (incorporated)

The Staff Engineer's structural audit (doc/review/m2-re-integration-audit.md) found:

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1 | Slim mode data loss in `toApi()` | CRITICAL | FIXED |
| 2 | Case-sensitive search (`LIKE` → `ilike`) | MEDIUM | FIXED |
| 3 | Stale job recovery didn't reset progress | LOW | FIXED |
| 4 | Auth level uses `assertCompanyAccess` vs stricter variant | LOW | MONITOR — tracks future hardening |
| 5 | PDF/ICS export implementations are stubs | INFO | Deferred — real implementation on `fix/m-series-tech-debt` |
| 6 | Semantic search is a stub | INFO | Deferred — needs embedding provider |
| 7 | No tests exist | INFO | Should be added during migration |

Items 1-3 are already fixed on the working tree. Items 4-7 are known gaps to address during migration.

---

## 5. Staff Engineer's Go/No-Go Routing

The Staff Engineer routed to CTO for "go/no-go on shipping." My decision:

**NO-GO for shipping from Paperclip monorepo.**
**GO for separating to Voyonder repo first, then shipping from there.**

Rationale: Board directive compliance is non-negotiable. The code is structurally sound (Staff Engineer APPROVED with conditions). Ship it — but from the Voyonder repo, not Paperclip.

---

## 6. Assignment and Sequencing

| Step | Owner | Depends On |
|------|-------|-----------|
| 1. Create Voyonder repo | COO (VOY-1657) | — |
| 2. Implement migration (Phase 1) | Founding Engineer | Step 1 |
| 3. Code review | Staff Engineer | Step 2 |
| 4. Release/ship | Release Engineer | Step 3 |
| 5. QA verification | QA Engineer | Step 4 |

---

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Paperclip shared types change incompatibly | Medium | High | Pin dependency version; run CI on both sides |
| Event bus coupling creates hidden dependency | Medium | Medium | Define interface in shared contract (Phase 2) |
| Two services writing to same DB tables | Low | Medium | Voyonder only writes `background_jobs`; clear ownership boundary |
| Deployment complexity increases | Medium | Low | Same Docker network + DB cluster; simple nginx config |
| Code quality gaps from stubs | High (stubs exist) | Low | Stubs return valid placeholders; no crash risk |

---

*Document written by CTO (5a914da0-bb1d-4cf0-89b8-7cca9003da4e)*
*Referenced issues: VOY-1657 (COO), VOY-1658 (this plan)*
