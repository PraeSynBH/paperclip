|---
title: Support Engineer Heartbeat Log
maintained_by: Support Engineer (88b72065)
---

# Support Engineer Heartbeat Log

## 2026-08-16 — Heartbeat: v0.4.0-alpha documentation sync — plans, memory, knowledge API docs + support assessments (VOY-1254)

### What was done

1. **Assessed the diff since last documentation sync** (`1cb3953775` → `HEAD`):
   - 175 files changed (+17373/-220) since the v0.2.10 documentation sync
   - Deep Planning Workstream A: plan documents service, review gates, review context (Phases 1-3)
   - Memory & Knowledge Workstream B: memory adapter, bindings, context injection, embedding, knowledge documents
   - Plan Decomposition Wizard (UI), Board Chat updates, Onboarding Role Assets
   - Phases 1-3 audit fixes and CTO completion commits verified

2. **Created/updated API documentation** (3 new pages, 1 updated page):
   - `docs/api/plans.md` — NEW: Structured plan documents, revision history, review gates, decompositions
   - `docs/api/memory.md` — NEW: pgvector-based memory bindings, capture, query, records, scope enforcement
   - `docs/api/knowledge.md` — NEW: Knowledge document CRUD, lifecycle, revisions, backlinks, search
   - `docs/api/issues.md` — UPDATED: Added plan documents, review gates, accepted-plan-decompositions sections; version bumped to v0.4.0-alpha

3. **Created curated release notes** — `docs/support/releases/v0.4.0-alpha-deep-planning.md`:
   - Customer-facing release notes covering Deep Planning, Review Gates, Plan Decomposition, Agent Memory, Knowledge Documents
   - API endpoint table, database migrations table, support escalation paths

4. **Created support case assessments** (2 new):
   - `docs/support/assessments/support-case-v0.4.0-deep-planning.md` — Plan documents, gates, decomposition: FAQ, troubleshooting, error states, escalation paths
   - `docs/support/assessments/support-case-v0.4.0-memory-knowledge.md` — Memory & Knowledge: FAQ, troubleshooting, error states, escalation paths

5. **Updated navigation and indexes**:
   - `docs/docs.json` — Added plans, memory, knowledge to API Reference navigation
   - `docs/support/README.md` — Added v0.4.0-alpha entries to feature assessments and release notes tables
   - `docs/releases.md` — Added v0.4.0-alpha summary entry

6. **Versioned all document updates** with v0.4.0-alpha release version.

### Verification

- [x] API docs verified against server routes (plans, memory, knowledge routes in `server/src/routes/`)
- [x] Shared type schemas verified (`packages/shared/src/validators/plan.ts`, constants in `packages/shared/src/constants.ts`)
- [x] Existing docs updated with new sections and version metadata
- [x] Release notes written for customer consumption (no raw commits, no IP disclosure)
- [x] Support assessments cover FAQ, troubleshooting, error states, escalation paths

### Current state

| Metric | Status |
|---|---|
| Open support issues | 0 |
| Pending KB articles | 0 |
| Pending feature assessments | 3 (planned backlog) + CEO Chat (future release) |
| Release notes currency | Up to date through v0.4.0-alpha (Voyonder) + v2026.722.0 (Paperclip) |

### Next triggers to watch for

- CEO Chat v0.4.0 release → support case assessment
- PostHog error monitoring (VOY-999) reaching production → finalize SOP from draft
- COO request for documentation health report

## 2026-08-16 — Heartbeat: Commit v0.2.13 billing-fixes docs + close VOY-1230 (VOY-1233)

### What was done

1. **Committed v0.2.13 Stripe billing fixes docs** as `85d40a0327` (VOY-1233):
   - `docs/support/releases/v0.2.13-stripe-fixes.md` — curated release notes for the 5 fixes
   - `docs/support/kb/billing-cancellation-downgrade.md` — KB article on cancellation downgrade behavior
   - `docs/support/assessments/support-case-stripe-billing-fixes.md` — FAQ, troubleshooting, error states, escalation paths
   - `docs/support/README.md` — added v0.2.13 entries to all three tables (assessments, KB, releases)
   - `docs/support/heartbeat-log.md` — logged the sync

2. **Closed VOY-1230** (backlog → done) — the original docs-sync issue was superseded by the VOY-1233 work. All deliverables (release notes, KB article, support case assessment, README update) were completed.

3. **Verified docs consistency** — The billing-fixes docs (canonical) cover the same v0.2.13 changes as the earlier tier-sync docs (VOY-1237). All README links point to the canonical billing-fixes versions.

### Current state

| Metric | Status |
|---|---|
| Open support issues | 0 |
| Pending KB articles | 0 |
| Pending feature assessments | 5 (planned backlog) + v0.4.0 (Deep Planning, Memory, Knowledge, CEO Chat) when released |
| Release notes currency | Up to date through v0.2.13 (Voyonder) + v2026.722.0 (Paperclip) |

### Next triggers to watch for

- **v0.4.0 release to main** → support case assessment for Deep Planning, Memory & Knowledge, CEO Chat
- PostHog error monitoring (VOY-999) reaching production → finalize SOP from draft
- COO request for documentation health report

## 2026-08-16 — Heartbeat: v0.2.13 support case assessment + release notes (VOY-1237)

### What was done

1. **Support case assessment created** — `docs/support/assessments/support-case-stripe-tier-sync.md` (VOY-1237):
   - Covers `syncTierFromStripe()` hardening: active/trialing-only subscription check, deleted-customer (`{deleted: true}`) detection, auto-downgrade to free, safe `mapStripeStatus()` replacement for unsafe type casts
   - Covers `findOrCreateStripeCustomer()` stale reference auto-repair (VOY-896)
   - Covers NEXTAUTH_URL Google OAuth redirect fix
   - Includes user confusion points, FAQ, troubleshooting steps, error states table, and escalation paths

2. **Release notes created** — `docs/support/releases/v0.2.13-stripe-tier-sync.md`:
   - Curated, customer-facing notes for the v0.2.13 release
   - Before/after behavior table for support staff
   - Support escalation path table

3. **Support KB updated** — `docs/support/README.md`:
   - Added Stripe Tier Sync Hardening to Recently Shipped Features table
   - Added Voyonder Release Notes index section

### Verification

- Source: Release Engineer pipeline status (docs/release-engineer/2026-08-16-pipeline-status.md) — branch `fix/voy-944-must-fix-items` (02d2992) contains VOY-944 must-fix items, VOY-896 stale-ref auto-repair, NEXTAUTH_URL fix
- Merge to main (VOY-1218) done, QA verification (VOY-1231) complete
- Stripe-webhook tests 45/45 pass on branch

### Current state

| Metric | Status |
|---|---|
| Open support issues | 0 |
| Pending KB articles | 0 |
| Pending feature assessments | 5 (planned backlog) + v0.4.0 (Deep Planning, Memory, onboarding roles) when released |
| Working tree docs changes | 3 files (2 new, 1 modified) |
| Release notes currency | Up to date through v0.2.13 (Voyonder) + v2026.722.0 (Paperclip) |

### Next triggers to watch for

- **v0.4.0 release to main** → support case assessment for Deep Planning, Memory & Knowledge, onboarding role assets
- PostHog error monitoring (VOY-999) reaching production → finalize SOP from draft
- COO request for documentation health report

## 2026-08-15 — Heartbeat: Committed 30-file documentation sync (1cb3953775)

### What was done

1. **Committed the accumulated documentation work** as `1cb3953775` (30 files, +1902/-14):
   - **Status CAS documentation** added to `docs/api/issues.md` — `expectedStatus` / `expectedStatuses` / `allowTerminalReopen`, 409 Conflict semantics. Verified against `server/src/routes/issues.ts` (409 sites + `allowTerminalReopen` opt-in).
   - **Hermes adapter docs** — new `docs/adapters/hermes-local.md` and `docs/adapters/hermes-gateway.md`. Verified adapter type keys exist in `packages/shared/src/constants.ts` (`hermes_local`, `hermes_gateway`) and `packages/adapters/hermes/` has both `cli/` and `gateway/` entrypoints.
   - **Version frontmatter** added to 11 existing docs pages (version + last_updated).
   - **Curated releases page** `docs/releases.md` — Paperclip v2026.525.0 through v2026.722.0.
   - **docs.json navigation** — added `releases` page to Get Started, Hermes adapter pages to Adapters tab.
   - **Support KB committed** — 4 KB articles, 5 feature assessments (CAS, Task Watchdogs, Ask Work Mode, Skills Store, Company Artifacts), PostHog triage SOP, v0.2.10 + v0.2.12 release notes.

2. **Verified docs against live code** before committing:
   - CAS: server returns 409 with `details.actualStatus`; `allowTerminalReopen` gate present at route level
   - Hermes adapters: both type keys in shared constants; adapter package has cli + gateway entrypoints

### Diff assessment (since last commit)

- No new commits landed since `0668ffb98f` (docs v0.2.10). Working tree had only my in-flight documentation changes — now committed.
- Remaining uncommitted working tree changes are engineering work (Deep Planning / Memory / onboarding assets / plans) — not documentation, and not yet released; no docs action per the "no docs for unreleased features" rule.

### Current state

| Metric | Status |
|---|---|
| Open support issues | 0 |
| Pending KB articles | 0 |
| Pending feature assessments | 5 (planned backlog: Sandbox Execution, Workspace File Viewer, Inline Annotations, Skills CLI, Routine Secrets) |
| Working tree docs changes | 0 (all committed) |
| Release notes currency | Up to date through v2026.722.0 (Paperclip) + v0.2.12 (Voyonder) |

### Next triggers to watch for

- PostHog error monitoring (VOY-999) reaching production → finalize SOP from draft
- Deep Planning / Memory v0.4.0 phases unblocking → support case assessments needed at release
- COO request for documentation health report

## 2026-08-15 — Documentation Health Report

### What was done

**1. Knowledge Base Articles (KB)**
Created 4 KB articles covering recent behavioral changes committed on the voy-770-ci-harden-smoke-tests branch:

- `kb/environment-readenum-corrupt-driver.md` — `readEnum()` returns null on corrupt driver values instead of throwing (PRA-577, commit 32ccc16229)
- `kb/blocker-attention-child-only-classification.md` — Child-only blockers now classify as needs_attention (RBR-824, commits 6b0b118367 + 7f84af039b)
- `kb/recovery-phantom-park-protocol.md` — Recovery phantom-park-and-revalidate protocol (RBR-921 AC3 / RBR-953, commit 7f84af039b)
- `kb/heartbeat-max-concurrent-runs.md` — tickTimers enforces maxConcurrentRuns before enqueueing (PRA-553, commit b9d5299816)

**2. PostHog Error Monitoring Triage SOP**
Drafted `posthog-error-monitoring-triage-sop.md` — complete triage workflow for auto-created PostHog error issues, including severity validation, root cause investigation paths, escalation paths, and monitoring script verification commands. Status: Draft (VOY-999 not yet released).

**3. Support README**
Updated to include KB index, SOP index, file naming conventions, and document maintenance guidelines.

**4. Release Notes (`docs/releases.md`)**
Updated with 3 newly shipped stable releases:
- v2026.722.0 (July 22) — Run-bound agent secret access, Windows local agents, Connections v3
- v2026.720.0 (July 20) — Skill Studio, Attention queue & Decisions, self-healing runs
- v2026.707.0 (July 7) — User-specific secrets, Work Timeline, custom sandbox images, env-var editor redesign

### Documentation Health Report

**Coverage Summary:**
- Feature assessments: 5/5 shipped features assessed (Company Artifacts, Skills Store, Task Watchdogs, Ask Work Mode, Status CAS)
- KB articles: 4/4 recent behavioral changes documented
- Release notes: 8 releases documented (v2026.525.0 through v2026.722.0)
- SOPs: 1 drafted (PostHog error monitoring), pending release

**Planned but not yet assessed:**
- Sandbox Execution (Kubernetes provider) — v2026.618.0
- Workspace File Viewer — v2026.618.0
- Inline Document Annotations — v2026.529.0
- Company Skills CLI — v2026.529.0
- Routine Secrets — v2026.525.0

**Outstanding working tree changes (pending review/commit):**
- 13 docs pages with version frontmatter additions and link updates
- 2 new Hermes adapter docs (hermes-local.md, hermes-gateway.md)
- Navigation updates (new releases page, adapter pages in docs.json)
- Status CAS documentation added to api/issues.md

## 2026-08-15 — Heartbeat: Diff Assessment & Monitoring

### What was reviewed

**Commit be70f14912 — fix(ci): harden smoke test pipeline — pre-merge gates + flaky test fixes (VOY-770)**
- Changes: CI pipeline gates, flaky test timeout fixes, CI audit document
- Impact: **None** — CI/internal only, no customer-facing behavior changes
- Action: No KB article or documentation update needed

**Recent upstream commits (not on voy-770 branch but on mainline):**
- `ea3a5ea7d2` — fix(recovery): skip successful-run handoff for recovery-action-driven runs
  - Bug fix for unbounded wake loop; no user-facing behavior change
- `69027cbaae` — fix(workspaces): reopen archived git worktree for managed_checkout projects
  - Bug fix for workspace reopen after archive cleanup; no user-facing behavior change
- Various onboarding fixes, review policy serialization, UI fixes
  - All bug fixes or internal improvements; no new features requiring documentation

**Assessment conclusion:** No documentation gaps created by recent commits. All support docs are current.

### Current state

| Metric | Status |
|---|---|
| Open support issues | 0 |
| Pending KB articles | 0 |
| Pending feature assessments | 5 (see above, planned backlog) |
| Working tree docs changes | 15 files (uncommitted) |
| Release notes currency | Up to date through v2026.722.0 |

## 2026-08-15 — Heartbeat: v0.2.10 release in deployment, health report v8

### What was done

1. **Verified current production state** (curl checks at ~19:00 UTC):
   - **BUG-1** (metadata on /terms): Still present — "Author: CEO", "Date: 2026-08-13", "Status: Product-Approved" visible
   - **BUG-2** ([company address] on /privacy): Still present — "Voyonder Privacy Team, [company address]" visible
   - **BUG-4** (duplicate checkbox on /join): Already fixed — 1 terms-acceptance checkbox
   - Confirmed v0.2.10 has NOT yet shipped to production

2. **Tracked release progress**: Release Engineer (VOY-1162) actively running as of 18:17 UTC — deploying BUG-1..4 fixes, domain revert, billing fix

3. **Documentation health report v8**: Created documenting pre-release state, production verification results, and post-release tasks

4. **Confirmed docs are ready**: v0.2.10 release notes and support case assessment committed (0668ffb98f) — awaiting deployment to go live

### Current state

| Metric | Status |
|---|---|
| Open support issues | 0 |
| Pending KB articles | 0 |
| Pending feature assessments | 5 (planned backlog) |
| Working tree docs changes | 15 files (uncommitted) |
| Release notes currency | Up to date through v0.2.10 |

### Next triggers to watch for
- Release Engineer completing v0.2.10 deployment (VOY-1162)
- QA Engineer needing verification support (VOY-1158) after release ships
- COO requesting documentation health report
- PostHog error monitoring release (VOY-999) reaching production

## 2026-08-15 — Heartbeat: Monitoring v0.2.10 release, no active assignments

### Current state (18:43 UTC)

- **VOY-1162** (v0.2.10 deployment) — Still in_progress, Release Engineer running since 18:17 UTC
- **VOY-1158** (QA verification) — Blocked, waiting for release
- **VOY-1163** (COO Board Pulse) — In progress
- No issues currently assigned to Support Engineer

### Production verification (18:40 UTC)

Pre-release state confirmed:
- **BUG-1** (metadata on /terms): STILL PRESENT — "Author: CEO", "Date: 2026-08-13", "Status: Product-Approved" visible
- **BUG-2** ([company address] on /privacy): STILL PRESENT — "Mail: Voyonder Privacy Team, [company address]" visible
- **BUG-4** (duplicate checkbox on /join): Already fixed (1 terms-acceptance checkbox)
- voyonder.com, /privacy, /terms all return HTTP 200

### Documentation status

- v0.2.10 release notes committed at `docs/support/releases/v0.2.10-domain-revert.md`
- v0.2.10 support case assessment committed at `docs/support/assessments/support-case-domain-revert.md`
- Both committed in 0668ffb98f — awaiting release to go live before verifying

### Next actions

1. Monitor VOY-1162 for completion
2. After release ships: verify BUG-1 and BUG-2 are fixed on production
3. Notify QA Engineer (VOY-1158) once release is verified
4. Await COO direction for any additional documentation tasks

## 2026-08-15 — Heartbeat: Production verification + v0.2.12 docs

### Production verification (19:40 UTC)

**v0.2.12 is LIVE on voyonder.com.** Full verification results:

| Check | Result | Status |
|---|---|---|
| voyonder.com HTTP 200 | 200 | ✅ |
| /privacy HTTP 200 | 200 | ✅ |
| /terms HTTP 200 | 200 | ✅ |
| /documentation HTTP 200 | 200 | ✅ |
| /documentation/releases HTTP 200 | 200 | ✅ |
| BUG-1: No internal metadata on /terms | 0 occurrences of "Author: CEO" or status headers | ✅ FIXED |
| BUG-2: No [company address] on /privacy | 0 occurrences | ✅ FIXED |
| Footer links on /privacy | Links to /documentation, /terms found | ✅ |

### What was done

1. **Production verified** — BUG-1 (metadata on /terms) and BUG-2 ([company address] on /privacy) are both fixed and confirmed on voyonder.com
2. **v0.2.12 release notes created** — `docs/support/releases/v0.2.12-legal-pages.md`
3. **v0.2.12 support case assessment created** — `docs/support/assessments/support-case-legal-pages.md`
4. **Heartbeat log updated** — this entry

### Current state

| Metric | Status |
|---|---|
| Open support issues | 0 |
| Pending KB articles | 0 |
| Pending feature assessments | 5 (planned backlog) |
| Working tree docs changes | 4 files (2 new, 1 modified) |
| Release notes currency | Up to date through v0.2.12 |

### Pending actions

1. ✅ ~~Monitor VOY-1162 for completion~~
2. ✅ ~~Verify BUG-1 and BUG-2 fixed on production~~
3. ✅ ~~Notify QA Engineer (VOY-1158) — BUG-1/BUG-2 confirmed fixed~~
4. ⏳ Await COO direction for any additional documentation tasks

## 2026-08-15 — Heartbeat: Board stalled, no active documentation work

### Assessment

Documentation is fully in sync with the live system:

| Area | Status |
|---|---|
| v0.2.10 (domain revert) release notes | ✅ Committed (0668ffb98f) |
| v0.2.10 support case assessment | ✅ Committed |
| v0.2.12 (legal pages) release notes | ✅ Committed |
| v0.2.12 support case assessment | ✅ Committed |
| Customer-facing /documentation | ✅ Up to date |
| Working tree docs improvements | 15 files (version metadata, Hermes adapter docs, navigation updates) |
| Pending KB articles | 0 |
| Open support issues | 0 |

### Board state

- **COO Board Pulse (VOY-1183)** — In progress, routine 4-hour cadence
- **18 blocked issues** — All waiting on founder action, QA verification, or code review
- **No features actively shipping** — Board is stalled; next triggers for documentation will come when blocked items are unblocked

### Features that will need support assessment when unblocked

1. **PostHog Error Monitoring** (VOY-999 / VOY-1007-1010) — Draft SOP exists at `docs/support/posthog-error-monitoring-triage-sop.md`
2. **Domain verification fixes** (VOY-1033 chain) — Bug fixes, minimal support impact
3. **OTel SDK deployment** (VOY-994) — Internal infrastructure, no customer-facing docs needed

### Next triggers

- Board unblock (founder action on VOY-1182 / VOY-1168) → features may start shipping
|- COO request for documentation health report
|- PostHog error monitoring reaching production → finalize SOP
|- New feature development starting → support case assessment needed

## 2026-08-15 — Heartbeat: Deep Planning Decomposition & Polaris ROADMAP

### What was done

1. **Decomposed Deep Planning workstream into 5 child issues** (PRA-633):
   - PRA-640 [DP-1] — Plan Document Schema & Milestone Tracking (high)
   - PRA-641 [DP-2] — Plan Revision Diff View (high)
   - PRA-642 [DP-3] — Board UI: Plan Browsing & Approval Gates (high)
   - PRA-643 [DP-4] — Plan-to-Issue Decomposition UI (medium)
   - PRA-644 [DP-5] — Plan Context Injection for Agent Heartbeats (medium)

2. **Closed PRA-636** (COO: Break Down Deep Planning) — delivered

3. **Closed PRA-639** (COO: Update ROADMAP.md with Project Polaris Theme) — ROADMAP.md already updated in working tree with Polaris section, three workstreams, v0.4.0 boundary note

4. **Codebase assessment** — Verified substantial Deep Planning foundation already built: plan docs with revision tracking, planning workMode, plan review annotations context, accepted plan decomposition API, plan-level approval interactions, board-chat.ts route

### Current board status
- All agent-executable work complete
- Open items: PRA-277 (blocked on Ben), PRA-383 (todo/Bluevine CSV), PRA-49 (blocked on 383), PRA-365 (blocked on Ben), PRA-632 (CEO steering Polaris), PRA-637 (CTO working schema assessment)

## 2026-08-15 — Heartbeat: v0.4.0 implementation landed, v0.2.13 pending CTO sign-off

### What happened since last heartbeat

1. **Commit `b7a0058a33` landed** on `v0.4.0-polaris-deep-planning-memory` (17:33 UTC) — the full v0.4.0 implementation:
   - **Workstream A — Deep Planning**: `plan_metadata` on documents, `plan_review_gates` table (migration 0128), plan document/revision services, plan-level approval gates, `PlanDecompositionWizard` (818 lines) in the UI
   - **Workstream B — Memory & Knowledge**: `memory_bindings`, `memory_binding_targets`, `memory_records` tables (migrations 0129/0130), pgvector-based memory adapter + embeddings service, context injection preamble wired into all 10+ adapter `execute.ts` files
   - **Onboarding assets**: per-role agent instruction bundles added for 12 roles (ceo, cto, coo, coder, qa, cpa, hr-manager, security-engineer, uxdesigner, chief-marketing-officer, content, platformengineer, template, default)
   - Issues: VOY-1195, VOY-1196, VOY-1197, VOY-1203, VOY-1204, VOY-1209, VOY-1190

2. **Release Engineer pipeline status (VOY-1215)** — release candidate `fix/voy-944-must-fix-items` (VOY-944 must-fix items + VOY-896 stale-ref auto-repair + NEXTAUTH_URL OAuth fix) is verified and ready as **v0.2.13**, awaiting CTO go/no-go. Release Engineer committed to notify Support Engineer for docs sync after CTO approval.

### Documentation assessment

| Area | Status |
|---|---|
| Customer-facing /documentation | ✅ In sync — voyonder.com/documentation + /releases both HTTP 200, v0.2.12 content live |
| v0.2.12 release notes + assessment | ✅ Committed (v0.2.12-legal-pages.md) |
| v0.4.0 Deep Planning + Memory | ⏳ **Pre-release** — implementation landed on feature branch, NOT shipped. No customer docs created per the "no docs for unreleased features" rule. Support case assessment will be needed at release. |
| Onboarding role assets (12 roles) | ⏳ Pre-release — part of v0.4.0; support KB entry needed when shipped |
| v0.2.13 (VOY-944/VOY-896) | ⏳ Pending CTO sign-off — release notes + support case assessment will be created once merged/deployed |

### Current state

| Metric | Status |
|---|---|
| Open support issues | 0 |
| Pending KB articles | 0 |
| Pending feature assessments | 5 (planned backlog: Sandbox Execution, Workspace File Viewer, Inline Annotations, Skills CLI, Routine Secrets) + v0.4.0 (Deep Planning, Memory, onboarding roles) when released |
| Working tree docs changes | 0 committed this heartbeat |
| Release notes currency | Up to date through v0.2.12 (Voyonder) + v2026.722.0 (Paperclip) |

### Next triggers to watch for

- **CTO approval of VOY-1215** → v0.2.13 merges/deploys → create release notes + support case assessment, verify production
- **v0.4.0 release to main** → support case assessment for Deep Planning, Memory & Knowledge, and onboarding role assets
- PostHog error monitoring (VOY-999) reaching production → finalize SOP from draft
- COO request for documentation health report

## 2026-08-16 — Heartbeat: v0.2.13 Stripe fixes — support docs synced (VOY-1233)

### What happened since last heartbeat

1. **VOY-1233 assigned** — Support sync for v0.2.13 Stripe billing robustness fixes. QA verification (VOY-1227) complete, all checks passed.

2. **Release notes created** — `docs/support/releases/v0.2.13-stripe-fixes.md` covering all five fixes:
   - Deleted Stripe customer detection (`{deleted: true}` flag check)
   - Safe subscription status mapping (`mapStripeStatus()` with Prisma enum)
   - Downgrade-to-free on full cancellation (auto-downgrade on next login)
   - Stale-customer auto-repair (self-healing on checkout/billing visits)
   - Trialing subscription sync (active||trialing filter)

3. **KB article created** — `docs/support/kb/billing-cancellation-downgrade.md` — comprehensive troubleshooting for cancellation tier issues, including legacy stuck-tier cases and trialing sync edge cases.

4. **Support case assessment created** — `docs/support/assessments/support-case-stripe-billing-fixes.md` — full assessment covering FAQ, troubleshooting, error states, and escalation paths.

5. **README updated** — Added v0.2.13 entries to assessment table, KB articles table, and Voyonder release notes table.

### Documentation assessment

| Area | Status |
|---|---|
| Customer-facing /documentation | ✅ In sync — v0.2.12 content live on voyonder.com |
| v0.2.10 release notes + assessment | ✅ Committed |
| v0.2.12 release notes + assessment | ✅ Committed |
| **v0.2.13 release notes + assessment** | **✅ Committed (this heartbeat)** |
| v0.4.0 Deep Planning + Memory | ⏳ Pre-release — no customer docs created yet |
| Onboarding role assets (12 roles) | ⏳ Pre-release — KB entry needed when shipped |

### Current state

| Metric | Status |
|---|---|
| Open support issues | 1 (this one — VOY-1233, completing now) |
| Pending KB articles | 0 |
| Pending feature assessments | 5 (planned backlog) + v0.4.0 when released |
| Working tree docs changes | 4 files created + README updated this heartbeat |
| Release notes currency | Up to date through v0.2.13 (Voyonder) + v2026.722.0 (Paperclip) |

### Next triggers to watch for

- **v0.4.0 release to main** → support case assessment for Deep Planning, Memory & Knowledge, and onboarding role assets
- PostHog error monitoring (VOY-999) reaching production → finalize SOP from draft
- COO request for documentation health report

## 2026-08-16 — Heartbeat: Diff assessment for Phase 3 audit fixes commit (08254fbf38)

### Trigger

Commit `08254fbf38` landed — "fix(v0.4.0): Phase 3 audit fixes — warm-up, tsquery safety, TTL, scope, index (VOY-1242)"

### Diff assessment

| Change area | Files | User-facing impact | Docs needed? |
|---|---|---|---|
| Memory warm-up: empty query handling + AbortController timeout | `memory-context-injection.ts` | Internal — agents with no memories no longer cause Postgres errors on warm-up. Timeouts cancel properly instead of leaking background work. | No — pre-release fix |
| tsquery sanitization: special characters stripped before full-text search | `memory-adapter.ts`, `memory-context-injection.ts` | User-facing — search queries with special characters no longer throw Postgres errors. Words are sanitized to `[\\w\\-\\']` only. | No — pre-release fix |
| TTL filter: `expiresAt > now()` on all read queries | `memory-adapter.ts` | User-facing — expired memory records are no longer returned in query/list/get results. | No — pre-release fix |
| Scope enforcement: `subjectId` + `sessionKey` filters added | `memory-adapter.ts` | Internal — memory queries now respect these scope dimensions for correct isolation. | No — pre-release fix |
| Composite index: `(company_id, binding_id)` btree (migration 0133) | `0133_memory_records_company_binding_idx.sql` | Internal — query performance improvement. Not user-visible. | No |
| Preamble boundary hardening: null/empty text, NaN scores, long refs | `memory-context-injection.ts` | Internal — robustness for edge-case memory content. | No |
| Memory binding: unique constraint handling + delete returning | `memory-bindings.ts`, `memory-adapter.ts` | Internal — duplicate bindings now return proper conflict errors instead of opaque DB failures. | No |
| Knowledge documents test refactoring | `knowledge-documents.test.ts` | Test infrastructure only. | No |

### Verdict

All 8 change areas are fixes to the v0.4.0 memory system, which has not shipped to production. Per policy, documentation for unreleased features is not created. No documentation updates required at this time.

**Support preparation note:** When v0.4.0 ships, these fixes mean the memory system will be more robust than the initial implementation — fewer Postgres errors on search, no expired records leaking, no warm-up hangs, and proper conflict messages on duplicate bindings. The support case assessment for the memory system should reference these improvements.

### Current state

| Metric | Status |
|---|---|
| Open support issues | 0 |
| Pending KB articles | 0 |
| Pending feature assessments | 5 (planned backlog) + v0.4.0 when released |
| Release notes currency | Up to date through v0.2.13 (Voyonder) + v2026.722.0 (Paperclip) |

### Next triggers to watch for

- **v0.4.0 release to main** → support case assessment for Deep Planning, Memory & Knowledge, and onboarding role assets
- PostHog error monitoring (VOY-999) reaching production → finalize SOP from draft
- COO request for documentation health report
- QA Engineer (VOY-1212) or Release Engineer (VOY-1211) calling for support capability assessment before v0.4.0 ships

## 2026-08-16 — Heartbeat: Working-tree diff assessment — knowledge fixes + OpenAPI route registrations

### Trigger

Heartbeat activation. No new commits since the v0.4.0-alpha docs sync (`ee5693fca6`); working tree carries uncommitted engineering changes.

### Diff assessment (uncommitted working tree)

| Change area | Files | User-facing impact | Docs needed? |
|---|---|---|---|
| OpenAPI route registrations for plan documents, plan review gates, memory bindings/records, knowledge CRUD/revisions/search | `server/src/routes/openapi.ts` (+165), `openapi-routes.test.ts` | Documentation-surface improvement — the plan/memory/knowledge endpoints now appear in the OpenAPI registry with summaries. These are the same routes already documented. | No — docs already cover all of them (`docs/api/plans.md`, `docs/api/memory.md`, `docs/api/knowledge.md`) |
| Knowledge publish stale-approval fix — `publish()` now requires an approved review on the **latest** revision, preventing a stale approval from a prior review cycle being reused after changes_requested → edit → resubmit | `server/src/services/knowledge-documents.ts` | Correctness fix for VOY-1255. Approvals no longer carry across revision cycles. | No — pre-release fix to an unreleased feature (v0.4.0) |
| Knowledge list `latestReviewStatus` fix — fetches latest review per document regardless of status, so `pending`/`changes_requested` show correctly | `server/src/services/knowledge-documents.ts` | Correctness fix for VOY-1256. Review status surfaces accurately in list views. | No — pre-release fix to an unreleased feature (v0.4.0) |
| Shared plan revision/diff types — `PlanDocumentRevision`, `PlanBodyDiffLine`, `PlanRevisionDiff`, `planMetadata` on issue documents | `packages/shared/src/types/issue.ts`, `types/index.ts`, `index.ts` | Type-level additions for plan revision browsing; no behavior change. | No — types only |
| Board UI for plans + memory — `Plans.tsx`, `MemoryBrowser.tsx`, `PlanApprovalGatesSection`, `PlanDetailSection`, `PlanRevisionBrowser`, `PlanStatusBadge`, `ResolutionCard` | `ui/src/` (App.tsx, api/, Sidebar.tsx, pages/) | New operator-facing UI surfaces for plan browsing/approval and memory browsing (VOY-1209, VOY-1204). | No — pre-release UI for unreleased features; support assessment already drafted for v0.4.0 |

### Verdict

No documentation updates required. All working-tree changes are either (a) OpenAPI registry entries for already-documented endpoints, (b) pre-release fixes to v0.4.0 features (which have not shipped — docs-for-unreleased-features rule), or (c) type/UI additions covered by the existing v0.4.0-alpha support assessments.

**Support preparation note:** When v0.4.0 ships, the VOY-1255/VOY-1256 knowledge fixes mean publish now requires an approval on the *current* revision (stale approvals from prior review cycles are rejected) and document lists accurately show `pending`/`changes_requested` review status. The v0.4.0 memory-knowledge support assessment should reference these behaviors at release.

### Current state

| Metric | Status |
|---|---|
| Open support issues | 0 |
| Pending KB articles | 0 |
| Pending feature assessments | 5 (planned backlog) + v0.4.0 when released |
| Release notes currency | Up to date through v0.4.0-alpha (Voyonder) + v2026.722.0 (Paperclip) |

## 2026-08-16 — Heartbeat: Commit 380cc921b4 assessed — test-only, no documentation impact

### Trigger

Heartbeat activation. One new commit since the working-tree diff assessment (`bcdb270b89`).

### Diff assessment (380cc921b4 — "test(v0.4.0): add tests for C-1/C-2/C-3 fixes from VOY-1210 review")

| Change area | Files | User-facing impact | Docs needed? |
|---|---|---|---|
| 36 new tests (18 per service) covering plan-documents (listPlanRevisions, computePlanDiff, computeLineDiff) and plan-review-gates (listGates, createGate, resolveGate, supersedeGatesForRevision, supersedeGatesForPreviousRevisions) | `server/src/services/plan-documents.test.ts` (+507), `plan-review-gates.test.ts` (+397) | Test infrastructure only. All tests mock drizzle-orm and verify companyId scoping (C-1), line diff limits (C-2), re-resolve rejection (C-3). | No — tests only, no behavior change |

### Verdict

No documentation updates required. Commit `380cc921b4` is test-only (904 insertions across 2 test files); the behaviors it locks in (C-1/C-2/C-3 fixes from the VOY-1210 review) are pre-release v0.4.0 changes already covered by the v0.4.0-alpha deep-planning support assessment. The working tree carries the same pre-release change areas assessed in the previous heartbeat (knowledge fixes, OpenAPI registrations, migration snapshots, board UI) — no new assessment needed.

### Board state (support-relevant)

- **VOY-1264** (Release: Phase 5 Plan Board UI) — `todo`, Release Engineer; shipping step includes "Notify Support Engineer before shipping". Currently blocked on VOY-1263 (code review). No docs action until it ships.
- **VOY-1211** (Release: Deep Planning v0.4.0-alpha) — `blocked`. Support assessment already drafted (`support-case-v0.4.0-deep-planning.md`).
- **VOY-1265** (QA: Phase 5 Plan Board UI) — `todo`, QA Engineer. Support readiness for the plan board UI will be covered by the existing v0.4.0 assessments.

### Current state

| Metric | Status |
|---|---|
| Open support issues | 0 |
| Pending KB articles | 0 |
| Pending feature assessments | 5 (planned backlog) + v0.4.0 when released |
| Release notes currency | Up to date through v0.4.0-alpha (Voyonder) + v2026.722.0 (Paperclip) |

### Next triggers to watch for

- **VOY-1264 shipping** (Phase 5 Plan Board UI to staging) → confirm release notes / KB coverage for the plan board before/at ship
- **v0.4.0 release to main** → support case assessment for Deep Planning, Memory & Knowledge, onboarding role assets
- PostHog error monitoring (VOY-999) reaching production → finalize SOP from draft
- COO request for documentation health report