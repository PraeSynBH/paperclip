# VOY-1872 — M6 Technical Execution Plan
## Self-Serve Trial & Onboarding Flow
**Author:** CTO (5a914da0)
**Date:** 2026-08-23
**Status:** Approved — ready for implementation

---

## 1. Executive Summary

M6 provides the self-serve trial experience for Voyonder. Because the CEO directive freezes Paperclip feature development, all M6 product work happens in the **Voyonder repository** (github.com/nousresearch/voyonder), consuming Paperclip as an external API. The Staff Engineer's assessment (doc/m6-replanning-assessment.md) is **APPROVED** with the clarifications below.

**Total timeline:** ~11 days from repo creation (3 phases + launch)

---

## 2. Architecture Decision Records

### ADR-1: Voyonder Orchestrates Signup via Existing APIs + Trial Tier

**Decision:** Voyonder calls Paperclip APIs sequentially rather than using a new monolithic signup endpoint.

**Flow:**
```
Voyonder Signup Page
  → POST /api/auth/signup/email (BetterAuth — creates user)
  → POST /api/companies/ (creates company + assigns creator as member)
  → POST /api/companies/:id/billing/subscription (assigns trial tier)
  → POST /api/companies/:id/onboarding/role (creates first agent + task)
```

**Rationale:**
- No new Paperclip endpoints needed for the core signup flow
- Each step is a well-defined, tested, existing API
- Voyonder owns the orchestration → full control over UX, error handling, retry
- Trial state flows naturally from the existing `company_subscriptions.trialEnd` column

**Risk:** `POST /api/companies/` today requires `local_implicit` or `instanceAdmin` — Voyonder will authenticate with a service-level API key that has instance admin privileges.

### ADR-2: Trial Tier as Infrastructure Config

**Decision:** Add a trial subscription tier row to Paperclip's database via a data migration (not a code change to business logic).

**Details:**
- `subscription_tiers` table row with `name='Trial'`, `priceMonthlyCents=0`, `priceYearlyCents=0`
- Features: a subset of paid features for time-limited access
- `isActive=true`, `sortOrder=0` (appears first in tier listings)
- No Stripe price IDs (trial never charges)
- Use existing `trialEnd` column on `company_subscriptions` for expiry tracking

**Why this is not "feature work":** Adding a tier row is a config/seed operation identical to adding any other product tier. No billing code changes are required — the existing `createOrUpdateSubscription` handles zero-price tiers, and Stripe's `trial_end` parameter already works with the existing webhook flow.

### ADR-3: Voyonder Backend Proxy for Paperclip API

**Decision:** Voyonder runs a backend server (Next.js API routes or Express) that:
1. Authenticates the Voyonder user session
2. Proxies authorized requests to Paperclip's API with the service-level API key
3. Owns trial state tracking + conversion orchestration
4. Implements Voyonder-specific GA4 analytics

**Rationale:**
- Avoids CORS issues between voyonder.com and the Paperclip API
- Keeps the Paperclip API key server-side (never exposed to browser)
- Allows Voyonder to add its own auth layer (Supabase, Clerk, etc.)
- Single place for trial logic: expiry reminders, conversion prompts, feature gating

### ADR-4: Onboarding Orchestration by Voyonder

**Decision:** Voyonder calls the existing `POST /api/companies/:id/onboarding/role` endpoint (board-authenticated) instead of the Cloud-authenticated seed API.

**Rationale:**
- The `/onboarding/role` endpoint accepts a `role` field and creates agent + goal + issue
- It's already board-auth protected (Voyonder's API key works)
- The Cloud seed API (`/onboarding-seed`) is designed for Paperclip Cloud's internal flow
- Voyonder can offer a richer wizard UI: collect mission → call `/onboarding/role` → supplement with custom data

### ADR-5: Trial Expiry — Voyonder Manages, Paperclip Webhook Optional

**Decision:** Voyonder tracks trial deadlines server-side and proactively sends conversion prompts. A Paperclip webhook for trial expiry is P1 (nice-to-have).

**Implementation:**
- Voyonder's backend stores `trialEnd` from the subscription record
- A cron job (or in-process scheduler) checks for expiring trials daily
- Sends email reminders at T-7, T-3, T-1 days
- On expiry: downgrades feature access in Voyonder's UI (tier stays active in Paperclip with toggled features)
- On conversion: calls `POST /api/companies/:id/billing/create-checkout-session` → Stripe Checkout → webhook updates subscription to paid tier

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────────┐
│                    voyonder.com                      │
│  (github.com/nousresearch/voyonder)                 │
│                                                     │
│  apps/web/                                          │
│  ├── Landing Page (marketing, public)              │
│  ├── Signup Page (email + Google OAuth)            │
│  ├── Pricing Page (tier list via API)              │
│  ├── Checkout Flow (Stripe Checkout via proxy)     │
│  ├── Trial Dashboard (days remaining, features)    │
│  └── Onboarding Wizard (role selection → seed)     │
│                                                     │
│  apps/api/ (Next.js API routes / Express proxy)     │
│  ├── POST /api/signup → orchestrates:              │
│  │   ├── Create user (BetterAuth or Voyonder auth) │
│  │   ├── Create company (Paperclip POST /companies/)│
│  │   ├── Assign trial (Paperclip POST /billing/sub) │
│  │   └── Return session + company info             │
│  ├── POST /api/onboarding/role → Paperclip proxy   │
│  ├── GET /api/tiers → Paperclip proxy (cached)     │
│  ├── POST /api/checkout → Paperclip proxy           │
│  ├── GET /api/trial/status → Voyonder-tracked       │
│  └── POST /api/analytics/event → GA4               │
│                                                     │
│  packages/api-client/                               │
│  └── Paperclip API client (typed methods)           │
│                                                     │
│  packages/shared/                                   │
│  └── Shared types, schemas, constants               │
└─────────────────────────────────────────────────────┘
                        │ HTTPS + Bearer Token
                        ▼
┌─────────────────────────────────────────────────────┐
│                 paperclip server                     │
│  (github.com/nousresearch/paperclip)                │
│                                                     │
│  POST /auth/signup/email    (BetterAuth)            │
│  POST /companies/           (create, needs admin)   │
│  GET  /companies/:id        (read)                  │
│  POST /companies/:id/billing/subscription (assign)  │
│  POST /companies/:id/billing/create-checkout-session│
│  GET  /companies/:id/billing/tiers                  │
│  POST /companies/:id/onboarding/role                 │
│  GET  /api/get-session       (session validation)   │
└─────────────────────────────────────────────────────┘
```

---

## 4. Data Flow — Self-Serve Signup

```
1. User visits voyonder.com/signup
2. Fills in email, password, company name
3. Browser → POST /api/signup → Voyonder API server
4. Voyonder API server:
   a. Creates user in Voyonder auth (or calls BetterAuth on Paperclip)
   b. POST /api/companies/ { name, ... } → Paperclip (service API key)
   c. POST /api/companies/:id/billing/subscription { tierId: "trial" } → Paperclip
   d. Returns { companyId, sessionToken, trialEnd } to browser
5. Browser redirects to /onboarding
6. User selects role + enters mission
7. Browser → POST /api/onboarding/role { role, mission } → Voyonder API
8. Voyonder API → POST /api/companies/:id/onboarding/role { role } → Paperclip
9. Paperclip creates: CEO agent → project → goal → first issue
10. Browser transitions to dashboard with trial badge
```

### Error States

| Step | Failure | Recovery |
|------|---------|----------|
| User creation | Email already registered | Return specific error, prompt login |
| Company creation | Rate limited | Return 429, retry with backoff |
| Company creation | Cloud-managed instance | Disable self-serve for cloud tenants |
| Trial assignment | Tier not found | Fall to free tier, log alert |
| Onboarding role | Role already selected | Return success (idempotent) |
| Network failure at any step | Partial state | Voyonder rolls back created resources |

### Partial Rollback Strategy

Voyonder API server uses a compensating-transaction pattern:
1. If step (d) fails after (c), Voyonder deletes the company via Paperclip API
2. If step (c) fails after (b), Voyonder deletes the company
3. If step (b) fails after (a), Voyonder deletes the auth user (or marks orphaned)
4. Browser-facing: return 500 with "please retry" message

---

## 5. API Surface — Paperclip Changes Required

### 5.1 Data Changes Only (not feature code)

| Change | Type | Location | Details |
|--------|------|----------|---------|
| Trial tier seed | Data migration | `packages/db/src/migrations/` | INSERT into subscription_tiers with name='Trial', price=0, trial-compatible features |
| CORS allowlist | Config | `server/src/config.ts` | Allow `voyonder.com` origin when `PAPERCLIP_CORS_ORIGINS` env var is set |

### 5.2 Existing Paperclip APIs Voyonder Consumes

| Endpoint | Method | Voyonder Usage |
|----------|--------|---------------|
| `POST /api/auth/signup/email` | POST | Create user account (BetterAuth) |
| `POST /api/companies/` | POST | Create company (needs admin API key) |
| `GET /api/companies/:id` | GET | Read company details |
| `GET /api/companies/:id/billing/tiers` | GET | List tiers for pricing page |
| `GET /api/companies/:id/billing/subscription` | GET | Get current subscription + trial info |
| `POST /api/companies/:id/billing/subscription` | POST | Assign trial tier on signup |
| `POST /api/companies/:id/billing/create-checkout-session` | POST | Create Stripe Checkout for conversion |
| `POST /api/companies/:id/onboarding/role` | POST | Select role → create first agent/task |
| `GET /api/companies/:id/onboarding/status` | GET | Check onboarding completion |
| `POST /api/companies/:id/onboarding/skip` | POST | Skip onboarding |
| `GET /api/get-session` | GET | Validate session |
| `POST /api/auth/logout` | POST | End session |

---

## 6. Implementation Phases

### Phase 0: Foundation (Days 1-3)

| # | Task | Assignee | Description |
|---|------|----------|-------------|
| 0.1 | Create Voyonder repo + workspace | FE | `github.com/nousresearch/voyonder`, pnpm workspace, TypeScript, CI/CD |
| 0.2 | Build `packages/api-client/` | StaffE | Typed Paperclip API client wrapping existing REST endpoints |
| 0.3 | Add trial tier data migration | CTO/StaffE | INSERT trial tier row (non-feature config change) |
| 0.4 | Set up Voyonder backend proxy | FE | Next.js API routes or Express server with API key auth |
| 0.5 | Configure Paperclip CORS | CTO | Add CORS middleware gated behind env var |

### Phase 1: Signup + Trial (Days 4-6)

| # | Task | Assignee | Description |
|---|------|----------|-------------|
| 1.1 | Signup page UI | FE | Email/password form, company name, validation |
| 1.2 | Signup API orchestration | FE | Voyonder API: create user → company → assign trial |
| 1.3 | Login page UI | FE | Email/password login, OAuth buttons |
| 1.4 | Trial dashboard component | FE | Show remaining days, allowed features, upgrade CTA |
| 1.5 | Onboarding wizard UI | FE | Role selection, mission input, progress steps |
| 1.6 | Onboarding API proxy | FE | Voyonder API → Paperclip `/onboarding/role` |

### Phase 2: Billing + Conversion (Days 7-9)

| # | Task | Assignee | Description |
|---|------|----------|-------------|
| 2.1 | Pricing page UI | FE | Tier cards, feature comparison, monthly/yearly toggle |
| 2.2 | Checkout flow | FE | Stripe Checkout redirect, success/cancel handling |
| 2.3 | Trial → paid conversion | FE | Upgrade flow: checkout → webhook → subscription update |
| 2.4 | Trial expiry reminders | FE | Server-side cron for email reminders at T-7, T-3, T-1 |
| 2.5 | GA4 analytics in Voyonder | StaffE | Event tracking for signup, trial start, conversion, churn |

### Phase 3: Launch (Days 10-11)

| # | Task | Assignee | Description |
|---|------|----------|-------------|
| 3.1 | E2E testing | QA | Full flow: signup → onboard → trial → convert |
| 3.2 | Deployment | Release | Deploy Voyonder app, configure DNS, verify Paperclip proxy |
| 3.3 | Monitoring | Release | Error tracking, conversion funnel monitoring |
| 3.4 | Support documentation | Support | FAQ, troubleshooting guide for self-serve trial |

---

## 7. Edge Cases & Failure Modes

### 7.1 Signup Edge Cases

| Case | Behavior |
|------|----------|
| Email already registered | Voyonder returns specific error, offers login link |
| Company name conflicts | Paperclip handles unique issue prefix; Voyonder can auto-suffix |
| Rate limiting | Paperclip returns 429; Voyonder shows "too many attempts, try later" |
| Stripe customer creation fails | Voyonder marks company for background retry, user proceeds with trial |
| Trial tier missing (not seeded) | Voyonder API falls to free plan, alerts ops |

### 7.2 Trial Edge Cases

| Case | Behavior |
|------|----------|
| User converts mid-trial | Stripe webhook updates subscription; remaining trial time is forfeit (Stripe handles proration) |
| User cancels during trial | Cancel at period end; trial continues until end date |
| User never converts | Trial expires; Voyonder shows "your trial has ended" page with conversion CTA |
| Payment fails on conversion | Stripe webhook reports `invoice.payment_failed`; Voyonder notifies user to retry |
| Multiple companies, one user | Each company has its own trial; user manages separately |

### 7.3 Onboarding Edge Cases

| Case | Behavior |
|------|----------|
| User refreshes during onboarding | Voyonder checks onboarding status → skips already-completed steps |
| Role selection fails (conflict) | Paperclip returns conflict; Voyonder shows current state, allows retry |
| User abandons after signup but before onboarding | Company exists with trial; user can resume via dashboard |
| Onboarding seed creates duplicate agents | Existing idempotency in `/onboarding/role` prevents duplicates |

### 7.4 Security & Trust Boundaries

| Boundary | Risk | Mitigation |
|----------|------|------------|
| Browser → Voyonder API | XSS, CSRF | Standard web security: CSP, SameSite cookies, CSRF tokens |
| Voyonder API → Paperclip API | API key exposure | Key stored server-side only, never sent to browser |
| Paperclip API auth | Voyonder uses admin-level key | Key scoped to specific company creation + membership only |
| Stripe webhook | Fake events | Stripe signature verification (already implemented in Paperclip) |
| Trial feature gating | User bypasses trial expiry | Feature gates checked server-side in Voyonder proxy, not client-side |

---

## 8. Test Coverage Matrix

### 8.1 Unit Tests (Voyonder api-client package)
- API client: each method returns correct shape on 200
- API client: each method throws typed error on 4xx/5xx
- API client: retry logic on 429/503

### 8.2 Unit Tests (Voyonder API server)
- Signup orchestration: success path creates user + company + trial
- Signup orchestration: partial failure triggers rollback of created resources
- Signup orchestration: idempotency key prevents duplicate companies
- Trial expiry calculation: correct days-remaining computation
- Tier caching: TTL-based invalidation

### 8.3 Integration Tests (Paperclip APIs)
- `POST /api/companies/` with service API key → 200 + company returned
- `POST /api/companies/` without admin key → 403
- `POST /api/companies/:id/billing/subscription` with trial tier → 200
- `POST /api/companies/:id/onboarding/role` → creates agent + goal + issue
- `POST /api/auth/signup/email` → creates user
- `GET /api/companies/:id/billing/tiers` → includes trial tier in list

### 8.4 E2E Tests (Full Flow)
1. Visit landing page → see pricing → redirected to signup
2. Signup with email + password → company created → trial assigned → redirected to dashboard
3. Complete onboarding wizard → CEO agent created → first issue visible
4. View trial dashboard → remaining days visible → features listed
5. Click "Upgrade" → Stripe Checkout → success → subscription upgraded
6. Trial expiry → feature access downgraded → conversion CTA shown
7. Cancel during trial → trial continues → no charges at expiry

---

## 9. Dependencies & Blockers

| Dependency | Status | Action |
|------------|--------|--------|
| Voyonder repo created | NOT STARTED | Phase 0.1 — FE creates repo |
| Trial tier seeded | NOT STARTED | Phase 0.3 — CTO approves data migration |
| Paperclip API key for Voyonder | NOT STARTED | CTO provisions key with instance admin scope |
| PostHog for conversion tracking | Blocked (VOY-1719) | Use GA4 as primary, PostHog as enhancement |
| Pricing page UI (M9) | NOT STARTED | Coordinate with M9 team — share tier data types |
| Stripe billing infrastructure | DEPLOYED | Already working (M5) |

---

## 10. Immediate Actions

1. **CTO (me):** Approve this plan ✓ (done below)
2. **CTO:** Create child issues for Phase 0-3, assign to FE + StaffE + QA + Release
3. **CTO:** Provision Paperclip API key for Voyonder (instance admin scope)
4. **StaffE:** Begin api-client package design
5. **FE:** Stand by for Phase 0 assignments

---

## CTO Approval

This technical execution plan is **APPROVED**. The Staff Engineer's assessment (doc/m6-replanning-assessment.md) is ratified with the ADR clarifications above.

**Signed:** CTO (5a914da0)
**Date:** 2026-08-23

---

## Appendix: Trial Tier Seed SQL

```sql
INSERT INTO subscription_tiers (id, name, description, price_monthly_cents, price_yearly_cents,
  included_seats, included_agent_runs, included_storage_gb, features, is_active, sort_order)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Trial',
  '14-day free trial with full access to all features',
  0, 0,
  5, 100, 1,
  '["custom_plugins", "advanced_agents", "audit_logs", "api_access"]',
  true, 0
);
```

Note: `trial_end` is set on the `company_subscriptions` row when the trial is assigned, not on the tier itself. The tier is a zero-price tier — trial duration is managed by Voyonder.