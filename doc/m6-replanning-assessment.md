# M6 Re-planning: Self-Serve Trial as Voyonder Product
## Technical Assessment — Staff Engineer
**Date:** 2026-08-23T17:25Z
**Issue:** VOY-1949
**Status:** Assessment complete — awaiting CTO review

---

## 1. VOY-1781 Salvage Assessment

**VOY-1781** (M6: Build self-serve trial and onboarding flow) was in_progress, assigned to FE (57fa7e0e). The CEO directive froze all Paperclip feature development, so the M6 code cannot land inside the Paperclip monorepo. However, the architecture and integrations are salvageable:

### What Can Be Reused (as consumed Paperclip APIs)

| Component | Location | Reuse Strategy |
|-----------|----------|----------------|
| **Onboarding Seed Service** | `server/src/services/onboarding-seed.ts` + `server/src/routes/onboarding-seed.ts` | Voyonder calls `POST /api/companies/:companyId/onboarding-seed` — already a customer-facing API |
| **Billing Service** | `server/src/services/billing.ts`, `server/src/routes/billing.ts` | Voyonder calls `POST /api/companies/:companyId/billing/create-checkout-session`, `GET /api/companies/:companyId/billing/tiers`, etc. — all exist |
| **Stripe Webhook Integration** | `server/src/routes/billing.ts` (webhook route) | Paperclip already handles Stripe events. Voyonder doesn't need to reimplement this |
| **Invite Flow** | `server/src/routes/access.ts`, `server/src/services/access.ts` | Voyonder consumes `POST /api/companies/:companyId/invites` and `POST /api/invites/:token/accept` |
| **Company Creation** | `server/src/routes/companies.ts` | Voyonder calls `POST /api/companies` to create a new company on signup |
| **Auth Session** | `server/src/routes/auth.ts` | Voyonder consumes `GET /api/get-session` for session management |
| **GA4 Analytics Service** | `server/src/services/ga4-analytics.ts` | **MUST MOVE to Voyonder** — customer-facing analytics belongs with the product. Voyonder implements its own GA4 calls |
| **UI Code** | `ui/` directory | Must move to `apps/web/` in the new Voyonder repo. The existing UI structure (React, routing, components) can be copied |

### What Must Be Rebuilt in Voyonder

| Component | Reason |
|-----------|--------|
| **Self-Serve Signup Flow** | No Paperclip endpoint for unauthenticated signup + company creation + trial assignment exists today. Voyonder needs a new flow that orchestrates: user auth → create company → assign trial → onboard |
| **Trial Tier Logic** | Paperclip has no trial tier concept. The `subscription_tiers` table has only paid tiers. Voyonder needs to either: (a) add a trial tier via Paperclip API, or (b) manage trial state in Voyonder and convert to paid subscription via billing API |
| **Trial Expiration/Conversion** | Voyonder manages trial deadlines, sends conversion prompts, and orchestrates the transition to paid subscription |
| **Landing/Marketing Pages** | Already in Voyonder's domain (voyonder.com) — these are product pages, not Paperclip features |
| **Pricing Page UI** | Currently in `ui/` — must move to Voyonder and consume tier data from the billing API |

### What Cannot Be Reused

- **Internal DB queries** against Paperclip's schema — Voyonder must go through the API
- **Internal service calls** (direct function imports) — replaced with API client calls
- **Paperclip-Cloud integration** (the `POST /api/companies/:companyId/onboarding-seed` route authenticates via Cloud headers, not user sessions) — Voyonder signs up users differently

---

## 2. Architecture: Voyonder App Consuming Paperclip APIs

```
┌─────────────────────────────────────────────────┐
│                  voyonder.com                    │
│  (github.com/nousresearch/voyonder)             │
│                                                 │
│  apps/web/                                      │
│  ├── Signup Flow (email + Google OAuth)         │
│  ├── Trial Dashboard (remaining days, features) │
│  ├── Pricing Page (tier list from API)          │
│  ├── Checkout Flow (redirect to Stripe via API) │
│  └── Onboarding Wizard (mission, agent, task)   │
│                                                 │
│  packages/api-client/                           │
│  └── Paperclip API client (REST wrapper)        │
│         ↓ HTTPS + Bearer Token                  │
├─────────────────────────────────────────────────┤
│              paperclip server                    │
│  (github.com/nousresearch/paperclip)            │
│                                                 │
│  Auth → Company → Invite → Onboarding Seed      │
│  → Billing → Agents → Issues                    │
└─────────────────────────────────────────────────┘
```

### Key Architectural Decisions

1. **Voyonder authenticates to Paperclip as a first-party customer** — using a service-level API key (already supported by Paperclip's API auth model). Each Voyonder customer gets a Paperclip company, but Voyonder is the API consumer.

2. **Trial state lives in Voyonder** — Voyonder tracks trial start date, end date, and feature access. When the user converts, Voyonder calls the Paperclip billing API to create a paid subscription. This avoids adding trial-specific schema to Paperclip's core infrastructure.

3. **Onboarding flow is orchestrated by Voyonder** — the wizard collects the user's mission, creates the company via Paperclip API, then calls the onboarding seed API to set up the first agent and task.

4. **GA4 analytics moves to Voyonder** — the service exists in Paperclip but should be reimplemented in Voyonder. Paperclip should keep its own server-side GA4 events for Paperclip infrastructure metrics.

---

## 3. API Surface Needed from Paperclip

### Existing APIs Voyonder Will Consume

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/companies` | POST | Create company (signup) |
| `/api/companies/:id` | GET | Get company details |
| `/api/companies/:id/members` | GET | List members |
| `/api/companies/:id/invites` | POST | Create invite (for adding members) |
| `/api/invites/:token` | GET | Resolve invite |
| `/api/invites/:token/accept` | POST | Accept invite |
| `/api/companies/:id/onboarding-seed` | POST | Apply onboarding seed |
| `/api/companies/:id/billing/tiers` | GET | List subscription tiers |
| `/api/companies/:id/billing/subscription` | GET | Get current subscription |
| `/api/companies/:id/billing/create-checkout-session` | POST | Create Stripe checkout |
| `/api/companies/:id/billing/usage` | GET/POST | Usage metering |
| `/api/companies/:id/billing/invoices` | GET | List invoices |
| `/api/companies/:id/agents` | GET/POST | Agent management |
| `/api/companies/:id/issues` | GET/POST | Issue management |
| `/api/companies/:id/knowledge` | GET | Knowledge documents |
| `/api/companies/:id/knowledge/search` | GET | Knowledge search |
| `/api/get-session` | GET | Session validation |
| `/api/profile` | GET/PATCH | User profile |

### New API Surface Needed

| Endpoint | Method | Purpose | Priority |
|----------|--------|---------|----------|
| **Self-service company creation with auth** | POST | Create company + user account in one call (no invite required) | **P0** |
| **Trial-aware subscription tier** | - | The `subscription_tiers` table needs a trial tier (or Voyonder manages this externally) | **P0** |
| **Trial expiration webhook** | POST | Paperclip notifies Voyonder when trial ends (or Voyonder polls) | P1 |
| **Cross-origin auth support** | - | Voyonder needs CORS headers or a proxy for the API | **P0** |
| **Public pricing endpoint** | GET | Unauthenticated access to tier list for pricing page | P1 |

**Critical Gap:** There is no existing endpoint for self-service signup. Today, all company creation happens through the Paperclip Cloud, which is a trusted internal service. For Voyonder as an external customer, we need either:
- (a) A new `POST /api/companies/self-serve-signup` that creates user + company + assigns trial in one shot, or
- (b) Voyonder to orchestrate: create user → create company → create membership → assign trial

Option (b) already works with the existing API surface (just needs a trial tier in billing). Option (a) is cleaner but requires Paperclip feature work (which is prohibited). **Recommendation: Option (b) — Voyonder orchestrates the flow using existing APIs plus a trial tier.**

---

## 4. Timeline Adjustment

### Original M6 Timeline (pre-directive)
- VOY-1781: Build self-serve trial and onboarding flow — in_progress
- Targeting: ~1 week to complete

### Revised M6 Timeline (as Voyonder product)

| Phase | Duration | Activities | Dependencies |
|-------|----------|------------|--------------|
| **Phase 0: Foundation** | Days 1-3 | Ship VOY-1948 (Repository Separation Plan). Create `github.com/nousresearch/voyonder` repo. Set up pnpm workspace, TypeScript, CI/CD. Create `packages/api-client/` with basic Paperclip API wrapper. Add trial tier to Paperclip billing config. | VOY-1948 (CTO review) |
| **Phase 1: Signup + Trial** | Days 4-6 | Build self-serve signup flow (Voyonder). Wire company creation via Paperclip API. Implement trial tier assignment and tracking. Create onboarding wizard UI. | Phase 0 complete |
| **Phase 2: Billing Integration** | Days 7-9 | Wire Stripe checkout via Paperclip billing API. Implement trial → paid conversion. Add pricing page. Wire GA4 analytics in Voyonder. | Phase 1 complete |
| **Phase 3: Launch** | Days 10-11 | E2E testing. Deployment to Voyonder infrastructure. DNS cutover. Monitoring. | Phase 2 complete |

**Total: ~11 days from repo creation** (vs original ~7 days inside Paperclip).

### Parallelism
- **Phase 0** can run in parallel with today's assessment (repo creation + API client don't block the plan)
- **Phases 1 & 2** can partially overlap (signup UI can be built while billing API is wired)
- **StaffE assessment** is complete now — CTO needs to approve the API surface gaps before Phase 0 starts

---

## 5. Resource Reallocation

| Current Assignment | Resource | Reassignment |
|-------------------|----------|--------------|
| VOY-1781 (M6 FE) | FE (57fa7e0e) | Reassign to **M6 Phase 1-2 Implementation** — build Voyonder app frontend (signup, onboarding, pricing, trial dashboard). This is the same FE work, just in a different repo. |
| VOY-1949 (StaffE assessment) | StaffE (me) | Complete this assessment, then hand off to **CTO** for API surface gap approval. StaffE can then build `packages/api-client/` for the Voyonder repo. |
| New: API Client | StaffE | Build Paperclip API client package for Voyonder repo. Wrap existing endpoints with typed methods. |
| New: Trial Tier Config | CTO | Add a trial tier to Paperclip's `subscription_tiers` table (config change, not feature work). This is infrastructure, not product feature. |
| New: Voyonder Repo Setup | FE/StaffE | Create `github.com/nousresearch/voyonder`, set up workspace, copy UI code, configure CI. |

### What FE (57fa7e0e) Needs to Continue
The FE agent was building the M6 frontend. The work is the same — signup form, onboarding wizard, pricing page, trial dashboard — just in a new repo consuming APIs instead of making internal service calls. The FE agent should be reassigned to `apps/web/` in the new Voyonder repo.

---

## 6. Structural Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **No self-service signup endpoint** — Voyonder can't create companies without Cloud | High | Certain | Option (b): Voyonder orchestrates using existing APIs + trial tier. But this needs a trial tier in billing. |
| **API auth model** — Voyonder needs to authenticate as a third-party, not a Cloud tenant | High | Medium | Existing API key auth works for this. Verify CORS/CSRF support. |
| **Trial tier not in Paperclip schema** — `subscription_tiers` has only paid tiers | High | Certain | Add trial tier as a config change (data migration, not feature code). The existing billing service handles `trial_end` on Stripe subscriptions. |
| **Onboarding seed API** authenticates via Cloud headers, not user sessions | High | Medium | Voyonder may need a new auth path for the seed endpoint, or Voyonder implements its own onboarding orchestration. |
| **UI copy** — `ui/` directory is tightly coupled to Paperclip's routing/auth | Medium | Medium | Extract shared auth/API logic into the api-client package. The UI components themselves are portable. |
| **No CORS support** — Paperclip API may not respond to cross-origin requests | Medium | Medium | Proxy through Voyonder's backend, or configure CORS on Paperclip server. |

---

## 7. Immediate Next Steps

1. **CTO (5a914da0):** Review this assessment and approve the API surface gaps. Specifically:
   - Approve Option (b) for self-service signup (Voyonder orchestrates via existing APIs + trial tier)
   - Approve adding a trial tier to Paperclip's billing config
   - Verify CORS/auth approach for Voyonder → Paperclip API calls

2. **COO (2f49c205):** Reassign FE (57fa7e0e) from VOY-1781 to M6 Voyonder repo work.
   - Create child issues for Phase 0-3 implementation
   - Assign StaffE to build `packages/api-client/`

3. **StaffE (me):** Assessment complete. Standing by for CTO approval to proceed with:
   - Building `packages/api-client/` for the Voyonder repo
   - Documenting the signup orchestration flow
   - Supporting repo setup

---

*This assessment replaces the original M6 plan (VOY-1781). The new M6 is a Voyonder product initiative in a separate repository, consuming Paperclip APIs externally. No Paperclip feature development is involved.*