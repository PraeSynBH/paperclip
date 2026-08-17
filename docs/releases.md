---
title: Release Notes
summary: Curated release notes for each Paperclip release
version: v2026.722.0
last_updated: 2026-07-22
---

# Release Notes

Paperclip ships continuously. This page documents each release to the main branch with curated, customer-facing notes.

---

## v0.4.0-alpha (RC-4) — August 17, 2026

[Full release notes →](/support/releases/v0.4.0-alpha-deep-planning)

### Highlights

- **Deep Planning (Workstream A)** — Structured plan documents with sections, milestones, revision history, and approval gates. Plans are now revisioned, gate-approved, and decomposable into child issues. Replaces ad-hoc plan descriptions.

- **Plan Review Gates** — Approval gates on plan revisions with per-milestone acceptance criteria. When all gates for the current revision approve, the plan auto-transitions to `approved`.

- **Approved Plan Decomposition** — Approved plans can be decomposed into child issues after a board user accepts the plan confirmation, creating a direct link from the approved plan to executable work items. Human acceptance is required — agents cannot accept plan confirmations.

- **Agent Memory (pgvector)** — A durable, queryable agent memory system. Agents capture text (30-day TTL), upsert curated records, and search via hybrid semantic + full-text retrieval. Memory is scoped per-agent with shared company-wide records.

- **Knowledge Documents** — A full knowledge base with lifecycle management (draft → review → published → archived), revision history, diff, backlinks to issues, and full-text search.

- **Knowledge Browser UI** — A new Knowledge Base page at `/knowledge` for searching, browsing, reviewing, diffing revisions, and creating knowledge documents — no API needed. Also fixes a critical bug where the knowledge search endpoint was unreachable.

- **Chat-to-Work Resolution Cards** — In the Conference Room chat, the board assistant's created/updated work objects (issues, plans, approvals, memory records, knowledge articles) now appear as clickable resolution cards with type badges and direct links, instead of only conversational mentions.

- **Manager-Chain Issue Permissions** — Managers can now comment on and mutate issues assigned to agents in their reporting subtree, so leadership can close, reassign, and unblock their team's work.

- **C-Fixes** — Zod validation of LLM action signals (C-1), a TOCTOU safety net preventing duplicate SLA alerts (C-2), and special-character-safe knowledge search via `plainto_tsquery` (C-3).

- **Memory Extraction Jobs** — New API and UI for monitoring background memory extraction jobs, with one-click retry of failed jobs.

- **Batch Gate Counts + Live Events** — Plan cards now show active gate counts, and plan gate creation/resolution events stream to the UI in real time.

[Full release notes →](/support/releases/v0.4.0-alpha-deep-planning)

---

## v2026.722.0 — July 22, 2026

[Full release notes →](/releases/v2026.722.0)

### Highlights

- **Run-bound agent secret access** — Agents can now fetch secrets they've been granted on demand through a run-bound API, instead of relying only on ambient environment injection. A new `access.*` delivery mode exposes API-only secrets, and a new Secret Access editor lets you manage per-agent grants from agent settings.
- **Local agents on Windows** — The embedded ACPX engine no longer wraps local agent commands in a generated Bash script, so Claude, Codex, Gemini, and custom ACP adapters now spawn natively on Windows as well as Linux.
- **Connections v3 foundation (experimental)** — The groundwork for one-click Connected Apps lands: a v3 schema, AppDefinition catalog, and runtime authorization layer, gated behind the Apps experimental setting.

[Full release notes →](/releases/v2026.722.0)

---

## v2026.720.0 — July 20, 2026

[Full release notes →](/releases/v2026.720.0)

### Highlights

- **Skill Studio & skill organization** — A three-pane skill IDE with sandboxed test runs for authoring and editing skills without leaving Paperclip. Skills organize into nested folders, with import from projects, open-by-default company policy, and fork prechecks.
- **Attention queue & Decisions** — A new attention queue and Decisions surface brings everything that needs your input into one place, with faster scrolling and mobile-friendly decision rows.
- **Better search** — Search gains filters, sorting, and operators with command-palette parity, plus a new bulk extract endpoint.
- **Tougher, self-healing runs** — Run restart recovery, workspace self-heal, quota-aware retries, and failed-run metrics mean your instance tries harder before it involves you. Recovery is routed by failure cause, waits for provider quota resets, and throttles serial repeats.

[Full release notes →](/releases/v2026.720.0)

---

## v2026.707.0 — July 7, 2026

[Full release notes →](/releases/v2026.707.0)

### Highlights

- **User-specific runtime secrets** — Secrets can now be scoped to the individual human operator, not just the company. Paperclip deterministically checks that the human behind a run has actually supplied the value a run needs before it dispatches.
- **Work Timeline** — A new company-scoped Work Timeline page renders a compact, Gantt-style SVG view of when your agents worked, how handoffs happened, and where work overlapped.
- **Custom sandbox images with built-in SSH terminal** — Build reusable custom sandbox images with an embedded SSH terminal directly from the environment configuration flow.
- **Redesigned environment variables editor** — A single reusable editor replaces the legacy env-var editor, used consistently across agents, projects, routines, and company environments.
- **One-click recovery for diverged work** — The recovery card diagnoses when a task's branch has diverged from its base and offers a one-click isolated re-issue.
- **Starred resources in the sidebar** — Pin the projects, agents, and tasks you use most to a dedicated starred section in the sidebar.

[Full release notes →](/releases/v2026.707.0)

---

## v2026.626.0 — June 26, 2026

[Full release notes →](/releases/v2026.626.0)

### Highlights

- **Hermes, now built in (local & remote gateway)** — Hermes is a first-class adapter. Hire `hermes_local` agents that run on your own machine, or `hermes_gateway` agents that run Hermes remotely through a gateway, with secure onboarding defaults.
- **Task watchdogs** — A first-class watchdog control plane lets you attach automated checks to a task and have Paperclip watch it for you, surfacing watchdog state and outcomes right in the issue thread.
- **Ask work mode** — Issues can now run in an "ask" work mode for question-and-answer tasks, so you can point an agent at a question and get an answer back without full execution workflow.
- **Sandbox runtime status, live in your threads** — Ephemeral sandbox runtimes now report their status directly in issue threads, and Daytona sandbox leases are reused across runs.
- **Workspace file downloads & external object references** — Download files your agents produced straight from the workspace, and reference external objects across issue surfaces.

[Full release notes →](/releases/v2026.626.0)

---

## v2026.618.0 — June 18, 2026

[Full release notes →](/releases/v2026.618.0)

### Highlights

- **Skills Store** — Browse, install, and manage agent skills from a dedicated in-app store. Skills are now a first-class, installable unit with install counts and a company-scoped catalog.
- **Self-hostable sandbox execution** — A self-hostable Kubernetes sandbox provider plugin lands alongside server-side K8s execution integration and hardened agent-runtime images. Run your agents in an isolated sandbox on your own infrastructure.
- **Per-company multi-tenant isolation** — Each company now gets its own JWT signing keys, cloud tenants are strictly company-scoped, and plugin data is isolated per tenant.
- **Workspace file viewer and artifact links** — Inspect files your agents produced directly from the issue with a built-in workspace file viewer plus artifact links.
- **Env-driven gateway routing for local adapters** — Codex, Pi, OpenCode, and Gemini local adapters can now route through custom providers and gateways via environment configuration.

[Full release notes →](/releases/v2026.618.0)

---

## v2026.609.0 — June 9, 2026

[Full release notes →](/releases/v2026.609.0)

### Highlights

- **Company Artifacts** — Files, media, and documents your agents produce are now first-class. A new company-scoped Artifacts page indexes every work product across issues and runs.
- **Collapsible sidebar rail and takeover panes** — The primary navigation can now collapse to a persisted rail with hover/focus peek, giving contextual pages far more horizontal room.
- **Rich issue attachments with video** — Issues now accept video attachments and render rich inline previews, including standalone PWA browser controls.
- **Checkbox confirmation interactions** — Issue-thread interactions can now ask the board or user to confirm options via a structured checkbox payload.
- **Information Architecture refresh (experimental)** — An opt-in visual refresh of the project and agent surfaces makes high-frequency workflows easier to scan.
- **Automated PR quality and security gates** — `commitperclip` now runs automated quality and security gates on incoming PRs.

[Full release notes →](/releases/v2026.609.0)

---

## v2026.529.0 — May 29, 2026

[Full release notes →](/releases/v2026.529.0)

### Highlights

- **Inline document annotations and comments** — Issue documents now support inline, revision-aware annotation threads with comments and stable anchor snapshots.
- **Company skills CLI and catalog management** — Skills are now first-class: install, reset, audit, export, and assign company skills with a new CLI and board UI.
- **Hide projects and agents from your sidebar** — User-scoped resource membership lets each user leave projects and agents they don't want cluttering their sidebar.
- **First-admin claim flow for fresh self-hosted deployments** — Private, unclaimed deployments now get a one-time browser claim so operators can create the first admin before any invite exists.
- **Live Claude model discovery** — The Claude Local adapter can refresh its Anthropic model catalog from the UI, so newly released Claude models show up without waiting for a code release.

[Full release notes →](/releases/v2026.529.0)

---

## v2026.525.0 — May 25, 2026

[Full release notes →](/releases/v2026.525.0)

### Highlights

- **Modal sandbox provider is now a first-party plugin** — Paperclip ships a Modal sandbox-provider plugin alongside E2B, Cloudflare, and Daytona.
- **Workspace diffs are a first-class viewer plugin** — The new workspace diff plugin renders staged, unstaged, head, renamed, binary, oversized, and untracked changes.
- **Routines can carry their own secrets** — Routine env now flows through the runtime contract with persisted revisions and `agent < project < routine` precedence.
- **Local Cloud Upstream sync** — A new Cloud Upstream flow with shared types, server routes, persisted run schema, CLI sync helpers, and board UI.
- **ACPX-Claude adapter works seamlessly out of the box** — The `acpx_local` adapter now resolves bare Claude model IDs and surfaces real diagnostic detail.

[Full release notes →](/releases/v2026.525.0)

---

## Earlier Releases

Release notes for earlier versions are available in the [releases directory](/releases/).