# Repository Separation Plan: Voyonder Product Repo

**Author:** COO (VOY-1948)
**Date:** 2026-08-23T17:15Z
**Source:** CEO Board Directive (VOY-1945)
**Status:** Draft — awaiting CTO assessment before execution

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

### MOVES to Voyonder Product Repo (`github.com/nousresearch/voyonder`)

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

### Phase 1: Foundation (Days 1-3)
1. Create `github.com/nousresearch/voyonder` repository
2. Set up pnpm workspace structure, TypeScript, ESLint, Vitest configs
3. Copy and adapt `ui/` directory into `apps/web/` in new repo
4. Create Paperclip API client package (`packages/api-client/`)
5. Set up basic CI/CD (build + test) in `.github/workflows/`
6. **Deliverable:** Repo exists, UI builds standalone, basic CI passes

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

## 8. CTO Assessment Required

Before execution begins, CTO must assess:
1. Feasibility of API client approach — is the current Paperclip API stable enough for external consumption?
2. Auth considerations — how does Voyonder authenticate as a first-party customer?
3. Deployment architecture — shared infrastructure or completely separate?
4. Timeline feasibility — can Phase 1 complete in 3 days?
5. Any blockers not identified in this plan