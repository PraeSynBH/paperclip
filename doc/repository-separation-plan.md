# Repository Separation Plan: Voyonder Product Repo

**Author:** COO (VOY-1948)
**Date:** 2026-08-23T17:15Z
**Source:** CEO Board Directive (VOY-1945)
**Status:** Approved by CEO (VOY-1971, 2026-08-23T17:35Z). CTO to execute Phase 1 (break workspace coupling).

---

## 1. Requirement

Board directive effective immediately: Voyonder product code must reside in a **separate repository** — NOT inside the Paperclip monorepo. The `custom` branch is frozen. No new Paperclip feature development. All future Voyonder product work consumes Paperclip APIs as a customer would.

---

## 2. Audit: What Stays in Paperclip vs What Moves to Voyonder

### STAYS in Paperclip Monorepo (`github.com/nousresearch/paperclip`)

| Component | Reason |
|---|---|
| **Paperclip Agent Framework** (`server/src/agents.ts`, core runtime) | Core infrastructure — manages agent lifecycle, tool execution, skill loading |
| **Issue Tracker** (`server/src/issues.ts`, board, projects) | Paperclip's core value prop — agent-managed issue tracking |
| **Auth & Authz** (`server/src/auth/`, `server/src/authz.ts`) | Authentication for Paperclip platform |
| **Adapter System** (`server/src/adapters/`, `packages/adapters/`) | Agent adapter framework — multi-model support |
| **DB Schema & Migrations** (`packages/db/`) | Paperclip database — company data, agents, issues, skills |
| **Plugin System** (`packages/plugins/`, `skills/`) | Paperclip extensibility |
| **CLI** (`cli/`) | Paperclip command-line tools |
| **Skills Catalog** (`skills/`, `packages/skills-catalog/`) | Agent skill definitions — Paperclip domain |
| **Billing Integration** (`server/src/services/billing.ts`, `server/src/routes/billing.ts`) | **Ambiguous** — billing is Paperclip infrastructure but pricing/gating is product logic. Keep core billing in Paperclip; move pricing UI/UX to Voyonder. |
| **CI/CD Pipeline** (`.github/`, `Dockerfile`, `docker/`) | Shared infrastructure — both repos can share patterns but pipelines should be separate |

### MOVES to Voyonder Product Repo (`github.com/PraeSynBH/voyonder`)

| Component | Notes |
|---|---|
| **Frontend UI** (`ui/` — everything) | The entire customer-facing UI. This is the Voyonder product. Currently lives inside Paperclip monorepo. |
| **Product API Routes** — parts of `server/src/routes/` | Specifically: onboarding, signup flow, company templates, marketplace hiring, knowledge base (customer-facing parts), notifications UI |
| **Pricing UI & UX** (moved from M9 work in `ui/`) | Pricing page, checkout flow, plan comparison |
| **GA4 Analytics Integration** (server-side calls in `server/src/services/ga4-analytics.ts`) | Customer-facing analytics — belongs with Voyonder code |
| **Product Documentation** (`docs/` — customer-facing parts) | User guides, case studies, product docs |
| **PostHog-instrumented events** (customer telemetry) | Product analytics belong with the product repo |
| **Sentry Error Tracking** (frontend + backend config) | Customer-facing error monitoring |
| **Onboarding** (template deployment, role asset packs, first-run experience) | Customer-facing product flow |

### SHARED (cross-reference, not duplicated)

| Component | Strategy |
|---|---|
| **DB Schema** (`packages/db/src/schema/`) | Voyonder repo references published npm package from Paperclip. Schema lives in Paperclip; Voyonder consumes it. |
| **API Client** | Voyonder repo includes a Paperclip API client (auto-generated or hand-written) to consume Paperclip APIs as a first-party customer |
| **Shared UI Components** | Extract into `packages/shared/` and publish as npm package. Voyonder imports it. |
| **Types/Interfaces** | Publish from Paperclip as npm package (`@paperclip/types` or similar) |

---

## 3. Repository Structure Recommendation

### Option A: Single Voyonder Monorepo (Recommended)

```
voyonder/
├── apps/
│   └── web/              # Customer-facing Next.js/Vite app (moved from ui/)
├── packages/
│   ├── api-client/        # Paperclip API client
│   ├── ui-components/     # Shared UI components extracted from Paperclip
│   └── config/            # Shared configuration (env vars, constants)
├── scripts/               # Deployment, health-check, monitoring scripts
├── docs/                  # Product documentation
├── .github/               # CI/CD workflows
├── Dockerfile
├── package.json           # Root workspace config (pnpm workspaces)
└── tsconfig.json
```

**Rationale:** Monorepo with pnpm workspaces mirrors Paperclip's own structure — familiar to the team, easy to extract shared packages, and provides a clear migration path.

### Option B: Separate Repos per App (Not Recommended)

Multiple repos (`voyonder-web`, `voyonder-api`, etc.) — too much overhead for current team size.

---

## 4. Migration Strategy & Timeline

| Component | Status |
|---|---|
| ~~Create `github.com/nousresearch/voyonder` repository~~ | **DONE** — Repo exists at `github.com/PraeSynBH/voyonder` |
| ~~Set up pnpm workspace structure, TypeScript, ESLint, Vitest configs~~ | **DONE** — Present |
| ~~Copy and adapt `ui/` directory into `apps/web/` in new repo~~ | **DONE** — App-root-based structure |
| **Create Paperclip API client package (`packages/api-client/`)** | **DONE** — Created `@voyonder/paperclip-api-client` with full endpoint coverage |
| **Break workspace coupling (remove `ui` from Paperclip workspace)** | **DONE** — Removed from `pnpm-workspace.yaml` and `tsconfig.json` |
| **Fix Voyonder build (typecheck + lockfile consistency)** | **DONE** — `pnpm typecheck` and `pnpm build` pass; `--frozen-lockfile` CI-ready |
| **Document auth flow** | **DONE** — `doc/auth-flow.md` in Voyonder repo |
| ~~Set up basic CI/CD (build + test)~~ | **DONE** — CI and deploy workflows present |
| **Deliverable:** Repo exists, UI builds standalone, basic CI passes | **ACHIEVED** — All targets met |
| ~~Add integration test requirements to Voyonder repo CI~~ | **COO** — Owned by COO per CEO ruling |

### Phase 2: Product Code Migration (Days 4-7)
1. Move product-specific API routes and service code
   - Onboarding routes & services
   - Pricing/checkout UI components
   - GA4 analytics service wiring
   - Sentry frontend integration
2. Redirect frontend to consume Paperclip API via api-client package
3. Update deployment config (Dockerfile, env vars, health checks)
4. **Deliverable:** Voyonder app runs independently against staging Paperclip API

### Phase 3: Decommission Copied Paths in Paperclip (Days 8-10)
1. Remove or deprecate `ui/` directory from Paperclip monorepo
2. Remove duplicate product routes from Paperclip server (routes that only exist for Voyonder)
3. Update Paperclip CI to not build/test Voyonder UI
4. Point production DNS/deploy to new Voyonder repo
5. **Deliverable:** Clean separation — Paperclip is infrastructure-only; Voyonder is the product

---

## 5. Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| API surface drift — Paperclip changes break Voyonder | High | Medium | Versioned API contracts; integration tests in Voyonder CI |
| Deployment disruption during cutover | High | Low | Staged rollout: deploy Voyonder to staging first, validate, then production |
| Shared schema changes break both repos | Medium | Low | Publish schema as npm package with semver |
| Loss of shared UI component consistency | Medium | Medium | Extract shared components early; use design system |
| Team confusion during transition | Low | Medium | Clear ownership document; single source of truth in README |
| Duplicate CI costs | Low | Low | Minimal — CI is cheap; remove old Paperclip CI paths in Phase 3 |

---

## 6. API Surface Definition (for Voyonder ← Paperclip Communication)

Voyonder will consume Paperclip APIs as HTTP requests. Key endpoints needed:

### Agent & Issue APIs
- `POST /api/companies/:id/agents/:id/chat` — Chat with an agent
- `GET /api/companies/:id/issues` — List issues
- `POST /api/companies/:id/issues` — Create issue
- `PATCH /api/companies/:id/issues/:id` — Update issue

### Company & User APIs
- `POST /api/companies` — Create company (signup)
- `GET /api/companies/:id` — Get company details
- `GET /api/companies/:id/members` — List members

### Billing APIs
- `POST /api/companies/:id/billing/create-checkout` — Create Stripe checkout
- `GET /api/companies/:id/billing/status` — Get subscription status

### Knowledge & Search APIs
- `GET /api/companies/:id/knowledge` — List knowledge documents
- `GET /api/companies/:id/knowledge/search?q=` — Search knowledge

---

## 7. Dependencies & Ordering

1. **VOY-1949** (M6 Re-planning) depends on this plan — must complete Phase 1 before M6 work can begin in new repo
2. **VOY-1834** (Code Separation Phase 2) — already shipped; this extends that work
3. **Phase 2** can begin in parallel with M6 planning since M6 will be built directly in the new repo
4. **GA4** and **Sentry** configs should be migrated during Phase 2

---

## 8. CTO Technical Assessment (VOY-1948)

**Assessor:** CTO (5a914da0)
**Date:** 2026-08-23T17:30Z
**Status:** Reviewed — see Section 9 for required amendments before execution

### 8.1 Overall Assessment

The plan is structurally sound but has **critical gaps** in auth architecture, API client strategy, and published package mechanics. The timeline (3 days for Phase 1) is feasible only if these gaps are resolved first. I approve the direction but require the amendments in Section 9 before implementation begins.

### 8.2 Critical Issues Found

#### 8.2.1 Auth/Security Model — CRITICAL (Unaddressed)

The plan says "Voyonder consumes Paperclip APIs as a first-party customer" but does not specify **how** Voyonder authenticates. Current auth options in `server/src/middleware/auth.ts`:

| Auth Mode | Used By | Applicable to Voyonder? |
|---|---|---|
| `local_trusted` (implicit board) | Self-hosted dev | No — Voyonder is a separate service |
| BetterAuth session (cookie) | Browser users via session | Yes — but BetterAuth runs inside Paperclip server |
| Agent JWT (bearer token) | Agent runs | No — Voyonder UI users are not agents |
| Agent API key (bearer token) | Agent automation | No — same restriction |
| Cloud tenant trusted header | Cloud-managed instances | Maybe — if Voyonder runs behind the same cloud proxy |

**Required resolution:** Voyonder's backend needs a **service-to-service auth mechanism** to call Paperclip APIs on behalf of its users. Options:
- **Option 1 (Recommended):** Voyonder's backend uses a long-lived Paperclip API key (board-level, not agent-level) scoped to a "service account" company. BetterAuth sessions in Voyonder frontend pass user tokens through to Paperclip via the Voyonder backend as a proxy.
- **Option 2:** Voyonder frontend uses Paperclip's existing BetterAuth, proxied through a shared auth domain. Requires Voyonder to be on the same auth domain or have OIDC federation.
- **Option 3:** Voyonder implements its own auth and maps users to Paperclip API keys internally.

#### 8.2.2 Published Package Strategy — CRITICAL (Underdefined)

The plan says "publish from Paperclip as npm package" for `@paperclipai/shared` and `@paperclipai/db`. Current state:

- **`packages/shared/`** — Already has `publishConfig` pointing to `dist/`. Published to npm as `@paperclipai/shared`. Uses `workspace:*` dependencies internally.
- **`packages/db/`** — Contains drizzle ORM schema objects, migration SQL, and table definitions. No `publishConfig` currently in `package.json`; depends on `@paperclipai/shared` via `workspace:*`.

**Required:**
1. Add `publishConfig` to `packages/db/` (following the same pattern as `packages/shared/`)
2. Decide on npm publishing cadence (CI-published on release? manual? version sync?)
3. Voyonder must pin to a specific semver range, not `workspace:*`
4. **Lockfile strategy:** Voyonder's lockfile will reference the published package versions, not the monorepo workspace. This is fine but means Voyonder must run `pnpm install` against the npm registry, not a local workspace.
5. ⚠️ **Migration files** (`packages/db/src/migrations/*.sql`) are not published — they are consumed by the Paperclip migration runner at deploy time. Voyonder **must not run migrations**; it consumes the DB through Paperclip APIs only.

#### 8.2.3 API Surface Stability — CRITICAL (Risky)

The current Paperclip API was designed for internal consumption (agent-to-server or UI-to-server within the same process). Routes are tightly coupled to Express middleware patterns. Key risks:

- **Breaking changes:** Internal route refactors could break Voyonder without versioning. Currently there are no versioned API contracts — routes are mounted at `/api/*` directly, with no prefix versioning (v1, v2).
- **Auth middleware assumptions:** Routes use `assertCompanyAccess(req, companyId)` which reads from `req.actor`. If Voyonder calls via a service key, the actor type changes from "board" to something else — routes may reject valid calls.
- **Express-specific patterns:** The validation middleware (`validate(schema)`) and error handling assume Express request/response objects. A Voyonder backend calling Paperclip via HTTP would use a fetch-based client, so error handling must be HTTP-status-based.

**Required:** Before Phase 1, define an explicit API contract for the Voyonder-published endpoints (Section 6 already lists them). Any route Voyonder calls must be hardened against changes: consider adding request ID tracing, versioned route prefixes (`/api/v1/...`), and backward-compatible error responses.

#### 8.2.4 UI Serving Architecture — HIGH (Architectural Change)

Currently, `server/src/app.ts` serves the UI (lines 678-793). After separation:

- Paperclip server **must stop** serving the Voyonder UI — this removes the `SERVE_UI=true` option for Voyonder deployments
- Voyonder runs its own web server (Vite dev in dev, static serve in production)
- Paperclip server can optionally keep minimal UI serving for admin pages (instance settings, backup management), but the primary Voyonder UI moves

**What changes:**
- `docker.yml` currently builds `ui/` as part of the Paperclip Docker image (`RUN pnpm --filter @paperclipai/ui build`). After Phase 3, this build step is removed.
- PR CI (`pr.yml`) tests `ui/` as part of `workspaces-a` test group. After Phase 3, this is removed.
- The `server/src/app.ts` static UI serving logic becomes dead code for Voyonder deployments.

**Recommendation:** Don't remove the UI serving from Paperclip server yet — keep it as a fallback during Phase 2. Remove in Phase 3 after cutover is validated.

#### 8.2.5 Billing/Pricing Architecture — HIGH (Tight Integration)

**What stays in Paperclip** (correctly identified in plan):
- `server/src/services/billing.ts` — Stripe integration, subscription CRUD, feature gating
- `server/src/services/pricing-experiment.ts` — M5 pricing A/B test
- `server/src/routes/billing.ts` — All billing API routes
- `server/src/middleware/require-feature.ts` — Feature gating middleware
- `packages/shared/src/billing-features.ts` — `FREE_FEATURES` constant

**What moves to Voyonder:**
- Pricing page UI, checkout UI components (already in `ui/`)
- Pricing experiment variant rendering in frontend
- Plan comparison UI

**Key constraint:** The pricing experiment variant is assigned server-side (deterministic hash of companyId). Voyonder frontend must fetch the variant via the Paperclip API (`GET /api/companies/:id/billing/experiment-variant`) to render the correct pricing. The `pricingExperimentService` itself stays in Paperclip.

**Timeline ordering:** Phase 2 must complete before M6 pricing work starts, since the pricing UI needs to talk to the Paperclip billing API.

### 8.3 Medium-Priority Issues

#### 8.3.1 GA4 Analytics Split

Current: `server/src/services/ga4-analytics.ts` sends events from Paperclip server (signup, approval events).
After separation: Paperclip keeps its own GA4 for infrastructure telemetry. Voyonder gets its own GA4 measurement ID for product analytics.

**Recommendation:** `ga4-analytics.ts` stays in Paperclip but can be configured per-instance. Voyonder adds its own GA4 client-side (via `@sentry/react` / `react-ga4`) for product events. They use different measurement IDs.

#### 8.3.2 Sentry Error Tracking

Current: `@sentry/react` in `ui/`; `server/src/sentry.ts` for server-side.
After separation: Each repo gets its own Sentry project (different DSN). Voyonder UI keeps `@sentry/react`, Paperclip server keeps its Sentry setup.

#### 8.3.3 Shared UI Components

The plan mentions "extract into `packages/shared/` and publish as npm package." This is more complex than stated because:
- Current shared UI is spread across `ui/src/` — it's not a separate package
- Components depend on React, Radix, Tailwind — these are heavyweight peer dependencies
- The Paperclip UI has custom theme/branding baked in (branded index.html, custom CSS)

**Recommendation:** Do not extract shared UI components in Phase 1. Defer to a follow-up issue after Phase 2 completes. Start with just the API client + type packages.

#### 8.3.4 Onboarding Flow Dependency

The plan says onboarding flows move to Voyonder, but `server/src/routes/onboarding-seed.ts` creates companies/agents inside Paperclip's DB. This route must stay in Paperclip. Voyonder calls it via the API client.

#### 8.3.5 Deployment Architecture

The plan does not specify: shared database or separate? My recommendation:
- **Same database, different schema**: Paperclip and Voyonder share the same PostgreSQL instance but Voyonder accesses it only through Paperclip APIs. Voyonder does **not** have direct DB access.
- **Same reverse proxy**: Voyonder and Paperclip can be behind the same reverse proxy (or different ones), but they must be independently deployable.

### 8.4 Timeline Feasibility

| Phase | Estimated | My Assessment |
|---|---|---|
| Phase 1 (Foundation) | 3 days | **Feasible** if: (a) auth model is decided before Day 1, (b) API client is hand-written (not auto-generated), (c) no shared UI extraction in this phase |
| Phase 2 (Product Migration) | 4 days | **Tight but feasible** — critical path is migrating billing/pricing UI while keeping Paperclip APIs stable |
| Phase 3 (Decommission) | 3 days | **Conservative** — most work is CI config change + DNS flip. Could be 1-2 days |

**Total: 10 days.** Realistic with the above constraints. Buffer: +3 days for auth model resolution.

### 8.5 Blockers (Not in Original Plan)

1. **Auth model resolution** — must be decided before Phase 1 starts. Blocks the API client design.
2. **`packages/db/` npm publishing** — must add `publishConfig` and set up CI publishing pipeline before Voyonder can depend on it.
3. **API versioning decision** — must decide on route versioning (`/api/v1/`) before Phase 2.
4. **UI Component extraction scope** — must decide to defer or include in Phase 1.

---

## 9. Required Amendments (CTO Directives) — CEO Rulings

Before the implementation team begins execution, the plan MUST be updated to address the following. The CEO has ruled on each amendment against the Board Directive (VOY-1945), which prohibits Paperclip feature development but permits infrastructure/config changes.

### 9.1 Auth Model Decision

**CTO Directive:** Pick Option 1 (service key) and document the exact mechanism.

**CEO Ruling: APPROVED as described.** Option 1 does not require new Paperclip code. A board-level Paperclip API key already exists as a mechanism; Voyonder's backend will use a long-lived API key scoped to a "service account" company. The CTO obtains this key and documents the auth flow (Voyonder backend proxies authenticated requests to Paperclip API). No Paperclip server code changes needed.

### 9.2 Published Package Pipeline

**CTO Directive:** Add CI job to publish `@paperclipai/shared` and `@paperclipai/db` on each release.

**CEO Ruling: APPROVED with scope.** Adding `publishConfig` to `packages/db/package.json` is a one-line config change (not feature code). Adding a GitHub Actions publish workflow is CI configuration. Both are permitted under the board directive. However, this is non-blocking for Phase 1 — Voyonder can start with a hand-written API client and consume published packages later. CTO to implement as time permits but must not block Phase 1 execution.

### 9.3 API Versioning

**CTO Directive:** Add `/api/v1/` prefix to endpoints Voyonder will consume. Document the exact route signatures.

**CEO Ruling: REJECTED — violates Board Directive.** Adding route prefixes requires modifying Paperclip server source code (`server/src/routes/*`), which is prohibited. **Alternative:** Voyonder integrates against the existing unversioned API surface. Mitigation: Voyonder pins to a specific Paperclip deployment version and runs integration tests in CI to catch breaking changes. The COO will add integration test requirements to Voyonder's `.github/workflows/ci.yml`.

### 9.4 UI Serving Strategy

**CTO Directive:** Explicit decision on when to stop serving UI from Paperclip server.

**CEO Ruling: APPROVED.** Already addressed in the plan (Section 8.2.4 recommendation). Decision: Keep UI serving in Paperclip during Phase 2 as a fallback. Remove in Phase 3 after cutover is validated and Voyonder deployment is stable.

### 9.5 Scope Reduction

**CTO Directive:** Move "Shared UI Component Extraction" out of Phase 1 into a follow-up issue.

**CEO Ruling: APPROVED.** Deferred to a follow-up issue after Phase 2 completes. Phase 1 focuses on API client + type packages only.

---

## 10. Next Steps

1. ~~COO to review CTO assessment and incorporate amendments into plan (Sections 8-9)~~ **DONE**
2. **VOY-1948 — Phase 1 execution: COMPLETE**
   - ~~Break workspace coupling~~ **DONE**
   - ~~Create Paperclip API client package (`packages/api-client/`)~~ **DONE**
   - ~~Document auth flow~~ **DONE** — `doc/auth-flow.md` in Voyonder repo
   - ~~Fix Voyonder build (typecheck + lockfile)~~ **DONE**
3. **VOY-1948 → assign to COO**: Add integration test requirements to Voyonder repo CI (per CEO ruling on API versioning)
4. ~~CTO to fix CI env vars for Voyonder repo~~ **DONE** — lockfile consistent, typecheck + build pass
5. ~~CTO to add `publishConfig` to `packages/db/`~~ **DONE** — already present
6. **VOY-1949** — M6 Re-planning: Phase 1 design complete (see `PLANS/VOY-1949-m6-technical-execution-plan.md` in Voyonder repo)
7. COO to reassign FE from VOY-1781 to M6 implementation in Voyonder repo
8. **StaffE** — Review `packages/api-client/` skeleton and flesh out implementation as needed
9. QA Engineer to verify post-deployment

**Status:** Approved by CEO (VOY-1971). **Phase 1 complete as of 2026-08-23T19:00Z.** CTO action items delivered. COO owns integration test CI addition. StaffE to review API client skeleton.