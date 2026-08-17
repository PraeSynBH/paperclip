|---
title: Support Engineer Heartbeat Log
maintained_by: Support Engineer (88b72065)
---

# Support Engineer Heartbeat Log

## 2026-08-17 — Heartbeat: C-fixes resolved, Staff Engineer review in progress, docs current

### What was done

1. **Pipeline state change detected** — All three C-fixes (VOY-1297/1298/1299) are now marked **done**:
   - C-1 (LLM Trust Boundary — Zod SSE validation)
   - C-2 (TOCTOU Race — SLA dedup post-insert verification)
   - C-3 (to_tsquery safety — plainto_tsquery replacement)
   - These fixes were already in the working tree as pre-release changes; issues now reflect completion.

2. **VOY-1263 (Staff Engineer review) now in_progress** — The code review blocking Phase 5 is actively being worked. VOY-1209 (CTO ship Phase 5) remains blocked pending review completion. VOY-1306 (COO reprioritization) still in todo.

3. **Diff assessment** — No new Voyonder commits since `1cc37eb740` (RC-3 docs sync). Working tree contains the same pre-release C-fix changes already assessed. Paperclip platform commits on public master are unrelated to Voyonder.

4. **Documentation status confirmed current** — All feature assessments, KB articles, release notes, and API docs are in sync through v0.4.0-alpha-rc.3. Three C-fix documentation impacts are logged and ready for when fixes ship (KB articles for C-1 validation, C-2 dedup hardening, C-3 search safety).

### Current state

| Metric | Status |
|---|---|
| Open support issues | 0 |
| Pending KB articles | 0 |
| Pending feature assessments | 5 (planned backlog) + 3 C-fix updates (when shipped) |
| Release notes currency | Up to date through v0.4.0-alpha-rc.3 (Voyonder) + v2026.722.0 (Paperclip) |
| Pipeline critical path | VOY-1297/1298/1299 ✅ done → VOY-1263 🔄 in_progress → VOY-1209 ⏳ blocked → VOY-1186 ⏳ blocked |

### Next triggers to watch for

- **VOY-1263 review completion** → VOY-1264/1209 release proceeds; confirm release notes/KB coverage before staging ship
- **C-fix commits landing** → create KB articles for C-1 (Zod validation), C-2 (dedup hardening), C-3 (search safety)
- **VOY-1265 QA findings** → any UI behavior deltas worth a support note
- **v0.4.0 release to main** → final release notes refresh for v0.4.0 (stable)
- **PostHog error monitoring (VOY-999) reaching production** → finalize SOP from draft
- **COO request for documentation health report** — available on demand

## 2026-08-17 — Heartbeat: Documentation health report + idle monitoring

### What was done

1. **Produced comprehensive documentation health report** — saved to `doc/status/2026-08-17-support-engineer-health-report.md`. Coverage audit confirms:
   - 8 feature assessments all current (5 Voyonder v0.2.10–v0.4.0 + 3 pre-release)
   - 7 KB articles all current
   - 5 Voyonder release notes + 8 Paperclip release notes all current
   - 3 API documentation pages up to date
   - 5 planned backlog items still pending (no change)
   - 3 C-fix documentation impacts identified and logged for when fixes ship

2. **Diff assessment** — No new code commits since last support engineer heartbeat (`5333f76e0d`). Working tree contains all three C-fix implementations from the Staff Engineer structural review (VOY-1297/1298/1299):
   - **C-1**: Zod schema validation for action signals (board-chat.ts) — trust boundary fix, pre-release
   - **C-2**: Post-insert SLA dedup verification (issues.ts) — TOCTOU race fix, pre-release
   - **C-3**: `plainto_tsquery` replaces manual tsquery construction (knowledge-documents.ts, memory-context-injection.ts) — search safety fix, pre-release
   - These are pre-release changes already covered by existing support assessments; no documentation action needed until they ship.

3. **Server health verified** — Product dev server (port 3100) is DOWN; PraeSyn server (port 3101) healthy. Cannot verify docs against live VOY API at this time.

4. **Release pipeline monitored** — RC-3 release notes and support docs are complete. Pipeline blocked on C-fixes from Staff Engineer structural review (VOY-1297/1298/1299). No documentation action needed until fixes ship.

### Current state

| Metric | Status |
|---|---|
| Open support issues | 0 |
| Pending KB articles | 0 |
| Pending feature assessments | 5 (planned backlog) + 3 C-fix updates (when shipped) |
| Release notes currency | Up to date through v0.4.0-alpha-rc.3 (Voyonder) + v2026.722.0 (Paperclip) |
| Product dev server | DOWN (port 3100 unreachable) |

### Next triggers to watch for

- **C-fix commits landing** (VOY-1297/1298/1299) → assess diff for documentation impact
- **VOY-1264 unblocks** → confirm release notes reference final version before staging ship
- **VOY-1265 QA findings** → any UI behavior deltas worth a support note
- **v0.4.0 release to main** → final release notes refresh for v0.4.0 (stable)
- **PostHog error monitoring (VOY-999) reaching production** → finalize SOP from draft
- **COO request for documentation health report** — available on demand

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

## 2026-08-16 — Heartbeat: Commit b495d95b9c assessed — Phase 5 Plan Board UI, Memory Browser, knowledge fixes, OpenAPI registrations

### Trigger

Heartbeat activation. One new commit since the previous assessment (`380cc921b4`): `b495d95b9c` — "feat(v0.4.0): Phase 5 plan board UI, memory browser, knowledge fixes, OpenAPI registrations" (24 files, +2982/-84).

### Diff assessment (b495d95b9c)

| Change area | Files | User-facing impact | Docs action |
|---|---|---|---|
| Plan Board UI — `/plans` page: list view w/ status badges, detail w/ markdown sections, approval gates approve/reject UI, revision browser w/ inline diff, sidebar nav + routes + query keys | `ui/src/pages/Plans.tsx`, `PlanApprovalGatesSection.tsx`, `PlanDetailSection.tsx`, `PlanRevisionBrowser.tsx`, `PlanStatusBadge.tsx`, `App.tsx`, `Sidebar.tsx`, `issues.ts` api | **New operator-facing UI surface** for plan browsing/approval (VOY-1252). Plans UI also mounts in IssueDetail. | Updated `support-case-v0.4.0-deep-planning.md` + release notes with Plan Board UI section |
| Memory Browser UI — `/memory` page: browse records, hybrid search, metadata filter, record detail, forget, operations audit log | `ui/src/pages/MemoryBrowser.tsx` (+705), `ui/src/api/memory.ts` (+155), `memory.test.ts` | **New operator-facing UI surface** for memory inspection (VOY-1204). | Updated `support-case-v0.4.0-memory-knowledge.md` + release notes with Memory Browser section |
| Memory scope query parse — malformed `scope` JSON now returns 400 instead of crashing | `server/src/routes/memory.ts` | Error behavior improvement: clear 400 "Invalid scope query parameter" on malformed JSON | Added error state row to memory-knowledge assessment + release notes support note |
| Memory adapter batch embedding + metadata jsonb containment filter (`metadata` param on query/records) | `server/src/services/memory-adapter.ts` | Performance + new metadata filtering capability for memory records | Added metadata filter mention to memory-knowledge assessment + release notes |
| Knowledge publish stale-approval guard (VOY-1255) — publish requires approved review on latest revision only | `server/src/services/knowledge-documents.ts` | Behavior change: stale approvals from prior review cycles are rejected at publish | Added FAQ + troubleshooting + error state to memory-knowledge assessment + release notes highlight |
| Knowledge `latestReviewStatus` accuracy fix (VOY-1256) — latest review fetched regardless of status | `server/src/services/knowledge-documents.ts` | Behavior change: list views now surface `pending`/`changes_requested` correctly | Added FAQ to memory-knowledge assessment + release notes highlight |
| OpenAPI registrations for plan documents, review gates, memory, knowledge routes | `server/src/routes/openapi.ts` (+165), `openapi-routes.test.ts` | Documentation-surface improvement — same routes already documented | No — `docs/api/plans.md`, `memory.md`, `knowledge.md` already cover them |
| Shared plan revision/diff types (`PlanDocumentRevision`, `PlanBodyDiffLine`, `PlanRevisionDiff`, `planMetadata` on IssueDocument) | `packages/shared/src/types/issue.ts` | Type-level additions; no behavior change | No — types only |

### Verdict

Documentation updates **required** this time (unlike the previous test-only commit). The Phase 5 commit ships two new operator-facing UI surfaces (Plan Board `/plans`, Memory Browser `/memory`) and two knowledge behavior changes (VOY-1255 stale-approval guard, VOY-1256 review status accuracy) that support staff must know about when v0.4.0 ships.

### Updates applied

1. `docs/support/assessments/support-case-v0.4.0-deep-planning.md` — added Plan Board UI section (browse/detail/gates/revisions), related VOY-1252
2. `docs/support/assessments/support-case-v0.4.0-memory-knowledge.md` — added VOY-1255/1256 behavior, Memory Browser UI section, memory scope 400 error state, stale-publish FAQ + troubleshooting, related VOY-1255/1256
3. `docs/support/releases/v0.4.0-alpha-deep-planning.md` — added Plan Board UI (highlight 4), Memory Browser UI (highlight 6), knowledge stale-approval guard (highlight 8), latest review status (highlight 9), support notes for scope 400 + metadata filter
4. `docs/support/heartbeat-log.md` — this entry

### Board state (support-relevant)

- **VOY-1263** (Code Review: Phase 5 Plan Board UI) — `in_progress`, Staff Engineer. Blocks release.
- **VOY-1264** (Release: Phase 5 Plan Board UI) — `blocked` on VOY-1263. Shipping step includes "Notify Support Engineer before shipping".
- **VOY-1265** (QA: Phase 5 Plan Board UI) — `todo`, blocked on VOY-1263/1264. Test scenarios cover /plans, plan detail, gates, revisions, IssueDetail mount, sidebar nav.
- **VOY-1252** (Phase 5 implementation) — done.

### Current state

| Metric | Status |
|---|---|
| Open support issues | 0 |
| Pending KB articles | 0 |
| Pending feature assessments | 5 (planned backlog) + v0.4.0 when released |
| Release notes currency | Up to date through v0.4.0-alpha (Voyonder) + v2026.722.0 (Paperclip) |

### Next triggers to watch for

- **VOY-1263 review completion** → VOY-1264 release proceeds; confirm release notes/KB coverage before staging ship
- **VOY-1265 QA completion** → any UI behavior findings worth a support note
- **v0.4.0 release to main** → final release notes refresh for v0.4.0 (stable)

## 2026-08-16 — Heartbeat: Commit 885a6740b3 assessed — H-2 fix, resolveGate transaction + rejected-gate allApproved (VOY-1269)

### Trigger

New commit `885a6740b3` — `"fix(v0.4.0): wrap resolveGate in transaction, count rejected gates for allApproved (H-2, VOY-1269)"` (2 files, +60/-36).

### Diff assessment

| Change area | Files | User-facing impact | Docs action |
|---|---|---|---|
| `resolveGate` wrapped in DB transaction | `plan-review-gates.ts` | Internal — closes concurrent-resolution race condition | None — existing docs already describe correct behavior. Added transactional note to release notes support notes. |
| `allApproved` predicate now counts rejected gates (was `remainingPending === 0`, now `pending === 0 && rejected === 0`) | `plan-review-gates.ts` | **Bug fix**: previously, approving the last pending gate while a rejected gate existed would incorrectly set `allApproved = true` and flip the plan to `approved`. Now a rejected gate correctly blocks auto-approval. | Docs already stated "when all gates are approved" — fix aligns code with documented behavior. Updated: response shape for resolve gate in `docs/api/plans.md` now documents `allApproved` field; support assessment FAQ covers rejected-gate scenario; escalation paths updated. |
| Regression test for H-2 scenario (rejected gate blocks approval) | `plan-review-gates.test.ts` | Test-only | None |

### Verdict

**No user-facing documentation changes strictly required** — the fix aligns code with documented behavior. However, two documentation improvements were applied:
1. The `allApproved` response field on the resolve gate endpoint was previously undocumented; added response shape with description to `docs/api/plans.md`.
2. Support assessment FAQ and release notes support notes now explicitly cover the rejected-gate-blocking-approval scenario.

### Updates applied

1. `docs/api/plans.md` — Added response shape (gate + allApproved fields) to Resolve Plan Review Gate endpoint; clarified behavior note about rejected gates blocking auto-approval.
2. `docs/support/assessments/support-case-v0.4.0-deep-planning.md` — Added FAQ entry for "rejected gate blocks approval"; updated escalation matrix row.
3. `docs/support/releases/v0.4.0-alpha-deep-planning.md` — Added support note about H-2 fix (rejected gates, transactional resolution); updated escalation path.
4. `docs/support/heartbeat-log.md` — This entry.

### Board state (support-relevant)

- **VOY-1269** (Fix H-2: allApproved predicate) — `in_progress`. Fix committed in `885a6740b3`, issue not yet updated to done.
- **VOY-1278** (Fix H-2: Server allApproved predicate) — `done`.
- **VOY-1264** (Release: Phase 5 Plan Board UI) — blocked on VOY-1263 review (Staff Engineer). Release notes and KB coverage already prepared.
- **VOY-1265** (QA: Phase 5 Plan Board UI) — todo, blocked on VOY-1263/1264.

### Current state

| Metric | Status |
|---|---|
| Open support issues | 0 |
| Pending KB articles | 0 |
| Pending feature assessments | 5 (planned backlog) + v0.4.0 when released |
| Release notes currency | Up to date through v0.4.0-alpha (Voyonder) + v2026.722.0 (Paperclip) |

### Next triggers to watch for

- **VOY-1264 unblocks** → confirm release notes and support docs are ready for staging ship
- **VOY-1265 QA starts** → provide support assessment inputs for test scenarios
- **v0.4.0 release to main** → final release notes refresh

## 2026-08-16 — Heartbeat: Commit 0d4626e82e assessed — Workstream C chat-to-work resolution cards (BOARD-1)

### Trigger

New commit `0d4626e82e` — `"feat(v0.4.0): Workstream C — chat-to-work resolution cards with SSE action signals (BOARD-1)"` (4 files, +289/-0).

### Diff assessment

| Change area | Files | User-facing impact | Docs action |
|---|---|---|---|
| Server: `extractActionSignals()` parses `%%ACTIONS%%{...}%%/ACTIONS%%` JSON blocks from raw model output; emits parsed actions as typed SSE `action` events before persisting the cleaned response | `server/src/routes/board-chat.ts` | **New user-facing capability**: the board assistant's created/updated work objects (issues, plans, approvals, memory, knowledge) now surface to the UI as structured events instead of being silently stripped | Created new support case assessment for the feature |
| UI: BoardChat handles `type: "action"` SSE events, collects into `actionEvents` state, renders `ResolutionCard` components below the streaming text bubble and below the last persisted assistant comment | `ui/src/pages/BoardChat.tsx` | **New UI**: clickable resolution cards (Issue/Plan/Approval/Knowledge/Memory/Decision badges) with View links appear in the Conference Room chat when the assistant creates/updates objects | Created new support case assessment for the feature |
| Skill: "Structured Action Signals" section teaching the model to emit `%%ACTIONS%%` blocks after creating/updating work objects; 7 object type/action pairs; 5 critical rules | `skills/paperclip-board/SKILL.md` | Model behavior guidance — internal, but drives the user-facing cards | Covered in support assessment (card type/action table, troubleshooting) |
| Workstream C audit plan document | `doc/plans/2026-08-16-workstream-c-audit.md` | Internal planning document | None |

### Verdict

Documentation updates **required**. Workstream C closes the chat-to-work resolution gap: users now see structured resolution cards when the board assistant creates work objects — a visible UI behavior change support staff must be able to explain and troubleshoot.

### Updates applied

1. `docs/support/assessments/support-case-v0.4.0-chat-to-work-resolution.md` — NEW support case assessment: feature overview, card type table, how it works, feature flag/gating (`enableConferenceRoomChat`, `local_trusted`), known limitations (one block per response, malformed JSON silently dropped, raw markup visible during streaming, cards reset per turn, View link only when `url` provided, update action only for issue/plan), troubleshooting, error states, escalation paths.
2. `docs/support/releases/v0.4.0-alpha-deep-planning.md` — added highlight #10 (Chat-to-Work Resolution Cards), verification line for BOARD-1 tests, related-docs link.
3. `docs/support/README.md` — added the new assessment to the Recently Shipped Features table and updated the release notes index title.
4. `docs/support/heartbeat-log.md` — this entry.

### Board state (support-relevant)

- **VOY-1264** (Release: Phase 5 Plan Board UI) — `blocked` on VOY-1263 review (Staff Engineer). Release notes and KB coverage already prepared.
- **VOY-1265** (QA: Phase 5 Plan Board UI) — `todo`, blocked on VOY-1263/1264.
- **Workstream C (BOARD-1)** — implementation committed; the Conference Room resolution cards are ready for QA/release. Support assessment now in place.

### Current state

| Metric | Status |
|---|---|
| Open support issues | 0 |
| Pending KB articles | 0 |
| Pending feature assessments | 5 (planned backlog) + v0.4.0 when released |
| Release notes currency | Up to date through v0.4.0-alpha (Voyonder) + v2026.722.0 (Paperclip) |

### Next triggers to watch for

- **VOY-1263 review completion** → VOY-1264 release proceeds; confirm release notes/KB coverage before staging ship
- **BOARD-1 QA/release** → verify Conference Room resolution cards behave as documented; add any QA findings to the support assessment
- **v0.4.0 release to main** → final release notes refresh

## 2026-08-17 — Heartbeat: RC-3 docs sync — Knowledge Browser UI, search route fix, manager-chain permissions (VOY-1303)

### Trigger

VOY-1303 assigned by Release Engineer: verify documentation in sync for the Phase 5 Plan Board UI staging release (VOY-1264, release candidate **v0.4.0-alpha-rc.3**) and confirm version references match RC-3.

### Diff assessment (release branch 8074df8e09 → 0d4626e82e)

| Change area | Files | User-facing impact | Docs action |
|---|---|---|---|
| Knowledge Browser UI — new `/knowledge` page (search, list, detail sheet, revisions/diff, backlinks, create dialog) | `ui/src/pages/KnowledgeBrowser.tsx`, `ui/src/api/knowledge.ts`, `ui/src/components/Sidebar.tsx`, `ui/src/App.tsx` | **New user-facing capability**: operators can search/review/manage knowledge documents from the UI | Added release note highlight #8 + support assessment section |
| Knowledge search route fix — `/knowledge/search` moved BEFORE `/:documentId` (was unreachable, matched as document ID) | `server/src/routes/knowledge.ts` | **Bug fix**: knowledge search endpoint previously 404'd; now reachable from API and UI | Added release note highlight #11 + support note + error state + escalation path |
| Authorization manager-chain grant — managers may comment on/mutate issues assigned to agents in their reporting subtree | `server/src/services/authorization.ts` | **New permission**: CTO/COO can now close/reassign/unblock issues owned by their team | New KB article + release note highlight #12 + escalation row |
| H-1 gate-query invalidation (VOY-1268) | `ui/src/...` (gate queries) | Internal fix — gate UI behavior unchanged | None — already covered by Plan Board UI docs |
| M-1 batch plan-document fetch (3ba7c5aa37) | `server/src/routes/issues.ts` | Internal perf fix (N+1) — no user-facing behavior change | None |
| H-2 resolveGate transaction + allApproved predicate (VOY-1269) | `server/src/routes/plan-review-gates.ts` | Already documented in prior heartbeat (35a8fce6e2) | None — covered |
| Workstream C chat-to-work resolution cards (0d4626e82e) | — | Already documented in prior heartbeat (5333f76e0d) | None — covered |

### Verdict

Documentation updates **required** for RC-3. The Phase 5 Plan Board UI surface was already covered by prior syncs (8074df8e09, ee5693fca6, 35a8fce6e2, 5333f76e0d), but three items in the release branch had **zero documentation coverage**: the Knowledge Browser UI, the knowledge search route fix (critical bug), and the manager-chain authorization grant.

### Updates applied

1. `docs/support/releases/v0.4.0-alpha-deep-planning.md` — version header now references **v0.4.0-alpha-rc.3**; added highlights #8 (Knowledge Browser UI), #11 (search route fix), #12 (manager-chain permissions); renumbered #9/#10 (stale-approval guard, latestReviewStatus); added support notes, verification line (VOY-1266 26/26 UI tests), escalation rows, VOY-1266 to related issues.
2. `docs/support/kb/authorization-manager-chain-grant.md` — NEW KB article: old/new behavior, `allow_manager_chain` reason, support implications, verification steps.
3. `docs/support/assessments/support-case-v0.4.0-memory-knowledge.md` — added Knowledge Browser UI section with search-route-fix support note; added 404 error state; added escalation row; related-docs link to new KB.
4. `docs/support/README.md` — added RC-3 row to Recently Shipped Features; added KB article to KB table; release notes index now references v0.4.0-alpha (RC-3).
5. `docs/releases.md` — /documentation/releases entry retitled **v0.4.0-alpha (RC-3)**; added Knowledge Browser UI + Manager-Chain highlights.

### Board state (support-relevant)

- **VOY-1303** (this task) — docs verified in sync for RC-3; version references updated to match RC-3.
- **VOY-1264** (Release: Phase 5 Plan Board UI) — blocked on CEO disposition of VOY-1273 (M-1). Release notes and KB coverage now complete for RC-3.
- **VOY-1265** (QA: Phase 5 Plan Board UI) — todo, blocked on VOY-1264.

### Current state

| Metric | Status |
|---|---|
| Open support issues | 0 |
| Pending KB articles | 0 |
| Pending feature assessments | 5 (planned backlog) + v0.4.0 stable when released |
| Release notes currency | Up to date through v0.4.0-alpha-rc.3 (Voyonder) + v2026.722.0 (Paperclip) |

### Next triggers to watch for

- **VOY-1264 unblocks** → confirm release notes reference final tag (v0.4.0-alpha-rc.3 or later RC) before staging ship
- **VOY-1265 QA findings** → any UI behavior deltas worth a support note (add to assessments)
- **v0.4.0 release to main** → final release notes refresh for v0.4.0 (stable)
