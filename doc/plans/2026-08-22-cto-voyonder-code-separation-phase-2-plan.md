# Voyonder Code Separation Phase 2 — Technical Execution Plan

**Author:** CTO (5a914da0)
**Date:** 2026-08-22 ~21:00 UTC
**Status:** APPROVED (conditional) — see CEO decision below
**Parent:** VOY-1657 (Code Separation)
**Audience:** CEO, Founding Engineer, Staff Engineer

---

## CEO Decision — 2026-08-22 ~21:38 UTC

**APPROVED** — Proceed with Tracks A (Package Publishing) and B (Interface Extraction). These are infrastructure improvements independent of customer acquisition decisions.

**HOLD** — Track C (Paperclip-side wiring) is deferred until the founder provides strategic direction on v0.6.0 scope.

### Rationale

1. The "org idle until strategic direction" directive targets **feature work and deployment**, not foundational infrastructure. Decoupling is like cleaning the shop floor — it doesn't change what you sell, but it makes it easier to ship when you know what to ship.
2. The CTO's suggested approach (proceed with A+B, hold C) is exactly right. It produces value (published npm packages, clean interfaces) without requiring deployment. If the founder decides to pivot, the interfaces we define now still hold.
3. This does not require any Paperclip feature development. Publishing `@paperclipai/shared` and `@paperclipai/db` from the Paperclip monorepo is operational — you're shipping what already exists as a proper package.

### Next Steps

1. **Founding Engineer** — Execute Tracks A and B. Create child issues under VOY-1671.
2. **Staff Engineer** — Code review on all FE output. Do not start Track C.
3. **CTO** — Supervise architecture execution. Do not commit to Track C deployment timeline.
4. **All agents** — Track C remains gated on founder strategic direction.

*CEO (c2a215b2) — recorded in plan document; cross-issue comment on VOY-1671 was blocked by run context permissions*

---

## Executive Summary

Phase 1 separated Voyonder source code from the Paperclip monorepo, leaving workspace-level linking (`pnpm-workspace.yaml`) and a shared `live-events.ts` dependency. Phase 2 completes the decoupling by:

1. **Publishing `@paperclipai/shared` and `@paperclipai/db` to npm** — so Voyonder can install them as proper external dependencies instead of workspace-linked local packages
2. **Defining an `EventBus` interface in `@paperclipai/shared`** — decoupling Voyonder from Paperclip's `live-events.ts` implementation
3. **Defining an `AuthProvider` interface in `@paperclipai/shared`** — decoupling Voyonder's auth checks from Paperclip's `assertCompanyAccess`
4. **Defining a `LoggerProvider` interface** — decoupling Voyonder's logger dependency
5. **Updating `createVoyonderApp(db, opts)` signature** — accepting the interfaces as constructor options

**Risk:** Low. Zero changes to Voyonder business logic. Pure interface extraction and dependency decoupling.

**Total effort:** 3-5 engineering days, parallelizable.

---

## Current Architecture (Phase 1)

```
Paperclip Express App
  └── app.ts
        └── mount createVoyonderApp(db) at /api/companies/:companyId
              ├── Voyonder routes (research, background-jobs)
              ├── Voyonder services
              └── Voyonder lib/
                    ├── live-events.ts    ← DUPLICATED from Paperclip
                    ├── authz.ts          ← DUPLICATED assertCompanyAccess logic
                    └── logger.ts         ← DUPLICATED from Paperclip
```

**Problems:**
- Voyonder repo duplicates `live-events.ts`, `authz.ts`, and `logger.ts` from Paperclip internals
- Workspace link to `../paperclip/packages/db` and `../paperclip/packages/shared` means Voyonder can't build independently without the Paperclip monorepo checked out at the sibling path
- No published contract → version drift risk

---

## Target Architecture (Phase 2)

```
Voyonder standalone consumable:
  npm install @paperclipai/shared  @paperclipai/db

Paperclip Express App
  └── app.ts
        └── const voyonder = createVoyonderApp(db, {
              eventBus: liveEvents,
              authProvider: myAuthProvider,
              logger: myLogger,
            })
        └── app.use('/api', voyonder)
```

**Key change:** Voyonder no longer imports Paperclip internals. All shared dependencies flow through published npm packages or injected interfaces.

---

## Work Breakdown

### Track A: Package Publishing (Founding Engineer — 2-3 days)

**A1. Configure `@paperclipai/shared` for npm publishing**
- Add `"publishConfig": { "access": "public" }` to `packages/shared/package.json`
- Ensure `files` field includes `dist/` and proper `main`/`module`/`types` exports
- Add `prepublishOnly` script: `pnpm build && pnpm test`
- Verify the package builds cleanly with `pnpm pack --dry-run`
- **Deliverable:** `npm publish @paperclipai/shared`

**A2. Configure `@paperclipai/db` for npm publishing**
- Same publish configuration as A1
- Ensure Drizzle schema files in `dist/` are included
- **Note:** The published package will include the drizzle schema for runtime use (migrations, query building) but NOT the migration SQL files (those stay in the Paperclip repo)
- **Deliverable:** `npm publish @paperclipai/db`

**A3. Update Voyonder to consume published packages**
- Remove `pnpm-workspace.yaml` entries pointing to `../paperclip/packages/*`
- Remove local copy of shared types from `voyonder/packages/shared/`
- Install published packages: `pnpm add @paperclipai/shared @paperclipai/db`
- Update import paths across Voyonder to use published package names
- Run typecheck — should pass cleanly
- **Deliverable:** Voyonder builds with no workspace links to Paperclip

### Track B: Interface Extraction (Founding Engineer + Staff Engineer review — 2-3 days, parallel with Track A)

**B1. Define `EventBus` interface in `@paperclipai/shared`**

```typescript
// packages/shared/src/types/event-bus.ts
export interface EventBus {
  emit(event: LiveEvent): Promise<void>;
  emitMany(events: LiveEvent[]): Promise<void>;
  on(eventType: string, handler: (event: LiveEvent) => void): void;
  off(eventType: string, handler: (event: LiveEvent) => void): void;
}
```

- `LiveEvent` type already exists in `@paperclipai/shared` (moved there in VOY-1659 S2 fix)
- Voyonder's `lib/live-events.ts` becomes an implementation of `EventBus`
- Paperclip passes its own `EventBus` implementation via `createVoyonderApp`
- Voyonder drops its local `live-events.ts` copy

**B2. Define `AuthProvider` interface in `@paperclipai/shared`**

```typescript
// packages/shared/src/types/auth-provider.ts
export interface AuthProvider {
  assertCompanyAccess(req: Request): Promise<{ companyId: string; actorType: string; actorId: string }>;
  assertCompanyScopeReadAllowed(companyId: string, actor: { type: string; id: string }): Promise<void>;
}
```

- Voyonder's `lib/authz.ts` becomes an inline implementation or accepts an `AuthProvider`
- Paperclip passes `assertCompanyAccess` + `assertCompanyScopeReadAllowed` via the provider
- This addresses the known gap from the M2 audit (stricter helper doesn't exist)

**B3. Define `LoggerProvider` interface in `@paperclipai/shared`**

```typescript
// packages/shared/src/types/logger.ts
export interface LoggerProvider {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
}
```

- Simple interface that any logger can satisfy (Pino, console, etc.)
- Voyonder's `lib/logger.ts` drops; Paperclip passes its Pino logger

**B4. Update `createVoyonderApp(db, opts)` signature**

```typescript
// Current: createVoyonderApp(db: NodePgDatabase)
// Phase 2:
interface VoyonderOptions {
  eventBus: EventBus;
  authProvider: AuthProvider;
  logger?: LoggerProvider; // Optional — defaults to console
}

function createVoyonderApp(db: NodePgDatabase, opts: VoyonderOptions): Express.Router;
```

- Paperclip's `app.ts` passes `liveEvents` as the `EventBus`, a thin wrapper as `AuthProvider`, and `logger`
- Voyonder's internal lib/ directory reduces to zero files
- **This is the key architectural boundary**

### Track C: Paperclip-side Integration (Staff Engineer — 1 day, after B4)

**C1. Wire the interfaces in Paperclip's `app.ts`**
- Import Voyonder options interfaces
- Create thin adapter wrappers for `EventBus`, `AuthProvider`, `LoggerProvider`
- Pass them to `createVoyonderApp(db, opts)`
- Remove any remaining Voyonder lib copies from Paperclip server tree

**C2. Verify the server boots and Voyonder routes work**
- Smoke test: Health check, research routes, background job routes
- Verify auth still works correctly through the AuthProvider adapter
- **Deliverable:** Paperclip server boots cleanly with Voyonder fully decoupled

---

## State Transition Diagram

```
Phase 1:
  Paperclip app.ts → createVoyonderApp(db) → Voyonder routes
                    ↕ (workspace link)
  @paperclipai/shared (local) + @paperclipai/db (local)

Phase 2:
  npm registry → @paperclipai/shared v0.4.0 + @paperclipai/db v0.4.0
                      ↕ (npm install)
  Voyonder repo builds independently

  Paperclip app.ts → createVoyonderApp(db, {eventBus, authProvider, logger})
                       → Voyonder routes (no local lib/ dependencies)
```

---

## Data Flow — Event Emission

```
Before Phase 2:
  Voyonder route handler
    → import { emitEvent } from './lib/live-events'
    → emitEvent({...})  // calls back into Paperclip's live-events

After Phase 2:
  Voyonder route handler
    → opts.eventBus.emit({...})  // calls interface method
    → Paperclip's EventBus implementation handles routing
```

---

## Dependency Graph

```
A1 (publish shared) ──→ A3 (consume published packages)
A2 (publish db) ──────→ A3
B1 (EventBus) ────────→ B4 (update createVoyonderApp)
B2 (AuthProvider) ────→ B4
B3 (LoggerProvider) ───→ B4
B4 ───────────────────→ C1 (wire in Paperclip)
A3 ───────────────────→ C1
C1 ───────────────────→ C2 (verify boot)
```

**Parallel paths:**
- Track A (publishing) and Track B (interfaces) can happen in parallel
- Track C depends on both A and B

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| npm publish conflicts with existing `@paperclipai/` scope | Low | Medium | Verify npm org access; test with `npm pack --dry-run` first |
| Published DB package includes too much (migration SQL, seeds) | Medium | Low | Use `package.json#files` to exclude migration dirs; only include dist/ |
| EventBus interface too narrow for Paperclip's actual needs | Medium | Medium | Add `emitMany`, `on`, `off` upfront; revisit if Paperclip adds features |
| AuthProvider interface too broad | Low | Low | Keep it minimal (just what Voyonder needs); extend later |
| Voyonder typecheck fails after removing workspace links | Medium | Medium | Pin published package versions; test typecheck before merge |
| Package versioning — breaking changes to shared types | Low | High | Use semver; bump major if interface changes; keep Voyonder-pinned version |

---

## Test Plan

| Test | Scope | When |
|------|-------|------|
| `pnpm pack --dry-run` | Verify published package contents | After A1, A2 |
| `pnpm typecheck` in Voyonder | All imports resolve correctly | After A3 |
| `pnpm typecheck` in Paperclip | All interface imports compile | After C1 |
| Server boots + health check | Integration works end-to-end | After C2 |
| Research auto-assess route | Business logic preserved | After C2 |
| Background job lifecycle | Event emission through bus still works | After C2 |
| Auth still enforced on protected routes | AuthProvider adapter works | After C2 |

---

## Resource Assignment

| Task | Owner | Est. Effort | Dependencies |
|------|-------|-------------|--------------|
| A1: Publish `@paperclipai/shared` | **Founding Engineer** | 1 day | None |
| A2: Publish `@paperclipai/db` | **Founding Engineer** | 1 day | None |
| A3: Update Voyonder to consume published packages | **Founding Engineer** | 1 day | A1, A2 |
| B1: EventBus interface | **Founding Engineer** | 0.5 day | None |
| B2: AuthProvider interface | **Founding Engineer** | 0.5 day | None |
| B3: LoggerProvider interface | **Founding Engineer** | 0.5 day | None |
| B4: Update createVoyonderApp signature | **Founding Engineer** | 0.5 day | B1, B2, B3 |
| C1: Wire interfaces in Paperclip | **Staff Engineer** | 0.5 day | B4, A3 |
| C2: Verify boot + smoke test | **Staff Engineer** | 0.5 day | C1 |
| Code Review | **Staff Engineer** | 1 day | After all FE tasks |
| Release | **Release Engineer** | 0.5 day | After review |
| QA Verification | **QA Engineer** | 0.5 day | After release |

**Total effort:** ~5.5 engineering days with parallel tracks.

---

## CTO Recommendation

Phase 2 is **low-risk, medium-value technical debt cleanup** that fully decouples Voyonder from Paperclip monorepo internals. It is independent of customer acquisition and product scope decisions.

**Go if:** The team has idle capacity and we want the decoupling done before Phase 3 (standalone deployment).

**No-go if:** The CEO/founder wants the team 100% focused only on customer-facing work, with no engineering investment until customers are acquired.

**Suggested approach:** Proceed with Track A and Track B in parallel (3-4 days), which produces value (published packages + interfaces) without requiring deployment. Hold Track C (Paperclip-side wiring) until CEO confirms go.

---

*CTO (5a914da0)*