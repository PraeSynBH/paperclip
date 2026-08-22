# CTO Technical Readiness & Migration Guidance
**Date:** 2026-08-22 ~13:05 UTC
**Author:** CTO (5a914da0)

## Executive Summary

The platform (v0.5.0) is shipped with Stripe billing, feature gating, onboarding, and all core infrastructure. The Board Directive prohibits further Paperclip feature development. All Voyonder product code MUST operate from a separate repository. The strategic direction is **Scope Reduction** — use the platform to build the travel business, not extend the platform.

This document provides:
1. Technical guidance for the Voyonder repository migration
2. Engineering team readiness assessment
3. Recommended next-phase technical architecture

---

## 1. Voyonder Repository Migration — Technical Guidance

### 1.1 What Needs to Migrate

The Voyonder company configuration currently lives inside the Paperclip monorepo at:
- `~/.paperclip/instances/default/companies/ce49ee2f-48ea-43f1-99c3-fd78c119f32e/` — company config, agent instructions, plans, reports
- Various deck/outreach content under `doc/outreach/` and `docs/case-studies/`
- Agent onboarding templates and quickstart materials

**Items that MUST move to the new Voyonder repo:**
- Company-specific agent instructions (AGENTS.md files per agent role)
- Business plans, outreach materials, marketing content
- Travel concierge product specifications
- Customer acquisition materials (beta prospect lists, demo scripts, email templates)
- Deployment configurations that are Voyonder-specific (environment variables for Stripe live keys, domain configs)

**Items that stay in Paperclip monorepo:**
- The Paperclip platform source code (this repo is frozen — no new feature work)
- Paperclip infrastructure (Docker, DB migrations, CI/CD for Paperclip itself)
- Core platform documentation

### 1.2 Recommended Repository Structure

```
voyonder/
├── .github/workflows/     # CI/CD for Voyonder deployment
├── agents/                # Agent instructions, one per role
│   ├── ceo/
│   ├── cto/
│   ├── coo/
│   ├── founding-engineer/
│   ├── staff-engineer/
│   ├── release-engineer/
│   ├── qa-engineer/
│   └── support-engineer/
├── config/                # Company configuration
│   ├── paperclip-workspace.yaml  # Workspace config pointing to Paperclip API
│   ├── agent-roles.json
│   └── environment/
│       ├── .env.staging
│       └── .env.production
├── plans/                 # Business and product plans
├── outreach/              # Customer acquisition materials
├── docs/                  # Voyonder-specific documentation
├── scripts/               # Automation scripts
└── README.md
```

### 1.3 Paperclip Workspace Configuration

The new repo does NOT need to host the Paperclip server. It only needs workspace configuration that tells Paperclip agents where to find their instructions and what company context to use.

Key workspace config points:
- The Paperclip API base URL remains the same (the running Paperclip instance)
- Company ID remains `ce49ee2f-48ea-43f1-99c3-fd78c119f32e`
- Agent instructions should be fetched from the new repo via the `instructions-path` mechanism
- The `executionWorkspaceId` in issues should reference the new repo path

### 1.4 Migration Steps (Technical)

1. **Create repository** — GitHub repo `voyonder/voyonder` (or equivalent)
2. **Copy agent instructions** — Migrate AGENTS.md files from Paperclip company config
3. **Copy plans and docs** — Migrate business plans, outreach, case studies
4. **Configure workspace** — Set up Paperclip workspace YAML pointing to the new repo
5. **Update CI/CD** — Add GitHub Actions for Voyonder-specific automation (e.g., docs deploy)
6. **Test** — Verify agents can read instructions from the new repo
7. **Cut over** — Update Paperclip workspace configs to point to new repo

### 1.5 What Does NOT Change

- Paperclip server continues running on the same infrastructure
- Agent API keys, company ID, and auth tokens remain the same
- The goal ($50k MRR travel concierge service) stays unchanged
- Issue tracking continues in Paperclip board

---

## 2. Engineering Team Readiness Assessment

### 2.1 Current State

| Role | Agent ID | Status | Last Worked On | Skill Warmth |
|---|---|---|---|---|
| **CTO** (me) | 5a914da0 | Idle | VOY-1569 (adapter fix), VOY-1612 (SSE recovery) | Hot — architecture, code review, release approval |
| **Founding Engineer** | 57fa7e0e | Idle | VOY-1611 (billing UI), VOY-1609 (feature gating) | Hot — full-stack TypeScript, Stripe, React, SSE |
| **Staff Engineer** | eee825c7 | Idle | VOY-1533 (M2 hotfix code review) | Warm — code review, architecture, TypeScript |
| **Release Engineer** | 7a2a259f | Idle | VOY-1640 (PR #66 ship) | Hot — Docker, CI/CD, DB migrations, staging |
| **QA Engineer** | c3bdfe58 | Idle | VOY-1592 (invite flow verification) | Warm — E2E testing, Stripe test-mode |
| **Support Engineer** | 88b72065 | Idle | VOY-1637 (docs assessment) | Cool — documentation, release notes |
| **Chief of Staff** | e60c8e46 | Idle | Long-term planning | Cool — coordination, docs |

### 2.2 Readiness for Next Phase

**Strengths:**
- Full-stack TypeScript expertise is fresh across FE and Staff Engineer
- Release pipeline is battle-tested from multiple shipping cycles
- Stripe/ billing knowledge is current
- Agent team has completed 190+ issues together — well-practiced collaboration

**Gaps:**
- No one has built a travel concierge product before — this is greenfield
- No travel industry API experience (Amadeus, Sabre, etc.)
- Customer acquisition is human-gated (needs founder for prospect names + live Stripe keys)
- Support Engineer has been idle longest — may need ramp-up

**Risk:**
- The team is optimized for platform-building, not travel-business-building
- Scope reduction means fewer issues, smaller surface area — but quality bar is higher
- Customer-facing travel product has real-money implications (booking failures, billing errors)

### 2.3 Recommended Team Configuration for Travel Business Phase

```
CTO (me)          → Technical direction, architecture, code review gate
Founding Engineer → Lead implementation (travel features, integrations)
Staff Engineer    → Code review, quality assurance, architecture review
Release Engineer  → Deployment pipeline, staging/production management
QA Engineer       → E2E testing, regression, travel booking verification
Support Engineer  → Customer docs, runbooks, release notes
Chief of Staff    → Coordination, planning, cross-team communication
```

---

## 3. Next-Phase Technical Architecture (Pre-Design)

Once the CEO defines the product scope for the travel concierge, we'll need:

### 3.1 Likely Components
- **Travel Booking Engine** — API integration with travel suppliers (Amadeus, Sabre, Expedia APIs)
- **Concierge Agent Logic** — Agent instructions + tools for travel planning, booking, modifications
- **Customer Portal** — Web UI for travelers to view bookings, itineraries, preferences
- **Notification System** — Email/SMS for booking confirmations, changes, reminders
- **Payment Flows** — Stripe integration already done; adapt for travel-specific billing
- **Supplier Management** — Commission tracking, inventory management

### 3.2 Integration Points with Paperclip
- **Agent Execution** — Paperclip runs the concierge agents (no change needed)
- **File Storage** — Itinerary PDFs, booking confirmations stored via Paperclip attachments
- **Webhooks** — Travel supplier webhooks → Paperclip events → agent triggers
- **SSE** — Real-time booking status updates (infra already exists)

### 3.3 Quick Wins (0-2 Weeks)
1. Create separate Voyonder repo with agent instructions
2. Document travel API integration patterns
3. Set up Voyonder-specific CI/CD
4. Prepare test environment for travel booking flows

---

## 4. Action Items for COO (Technical Track)

For the COO's repo creation work (VOY-1642), here are the technical specifics:

1. **Repository name**: `voyonder/voyonder` on GitHub
2. **Initial content**: Copy from Paperclip instance config directory; I can provide file list
3. **Workspace config**: Use Paperclip's workspace YAML to point agent `instructions-path` at the new repo
4. **CI/CD**: Start with a basic Node.js TypeScript setup (matches existing stack)
5. **No Paperclip fork needed** — the new repo only needs configs + docs, not a server

---

## 5. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Repo migration causes agent instruction loss | Low | High | Test with one agent first before cutting over |
| Travel API integration complexity | Medium | High | Prototype with one supplier API first |
| Customer acquisition delayed (founder-gated) | High | Medium | Prepare everything that can be automated |
| Team loses context during transition | Medium | Medium | Document all active patterns in the new repo |
| Platform bugs surface during travel use | Low | Medium | QA runs regression on Paperclip before travel sprints |

---

*Prepared by CTO for COO execution and CEO review. Ready for discussion when the product direction is set.*
