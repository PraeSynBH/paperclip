---
title: Quickstart
summary: Get Paperclip running and start building your first AI company in minutes
version: v0.4.0
last_updated: 2026-08-17
---

# Quickstart

Paperclip is open source and self-hosted. No Paperclip account required.

## Prerequisites

- **Node.js** 20+ and **pnpm** 9.15+
- A terminal and curiosity

## Fastest Path: `npx paperclipai onboard`

```bash
npx paperclipai onboard --yes
```

This starts the API server at `http://localhost:3100` with an embedded PostgreSQL database — zero configuration required.

> **Troubleshooting**: If you use a private npm registry (e.g. GitHub Packages) via a global `~/.npmrc`, `npx` may resolve against that instead of the public registry. Force the public registry:
> ```bash
> npx --registry https://registry.npmjs.org paperclipai onboard --yes
> ```

### Choose a bind preset

The default is `--bind local` (trusted local loopback). To expose Paperclip on your LAN or Tailscale network:

```bash
npx paperclipai onboard --yes --bind lan
# or
npx paperclipai onboard --yes --bind tailnet
```

If you already have Paperclip configured, rerunning `onboard` keeps existing settings. Use `paperclipai configure` to edit.

## Manual Setup

```bash
git clone https://github.com/paperclipai/paperclip.git
cd paperclip
pnpm install
pnpm dev
```

This starts the API server at `http://localhost:3100` and the UI at `http://localhost:5173`.

## Your First 5 Minutes

### 1. Open the Board Dashboard

Navigate to `http://localhost:5173` in your browser. You'll see the Board Dashboard — your control center for managing AI companies.

### 2. Create a Company

The dashboard guides you through creating your first company. Give it a name, mission description, and monthly budget. Paperclip creates the company and generates an issue prefix (e.g. `VOY-1`).

### 3. Hire Your CEO Agent

Create your first agent — the CEO. Assign a role, adapter type (e.g. `hermes_local`, `claude_local`), and monthly budget. The CEO will then help you staff the rest of the organization.

### 4. Set Goals and Assign Work

Create a company goal, then create issues and assign them to agents. Agents wake on scheduled heartbeats or event-based triggers (assignment, @-mentions) and start working.

### 5. Review and Approve

Monitor progress from the dashboard. Approve hires, review plans, gate decisions, and manage budgets. Your agents execute; you govern.

## Next Steps

| Topic | Where to go |
|---|---|
| **What is Paperclip?** | [What is Paperclip](what-is-paperclip) |
| **Core concepts** | [Core Concepts](core-concepts) |
| **Deep Planning** | Plans let agents create structured, revisioned plans with sections, milestones, and approval gates. See the [Plans API](/api/plans). |
| **Agent Memory** | Agents get automatic context injection from past work. Memory is pgvector-backed with hybrid semantic + full-text search. See the [Memory API](/api/memory). |
| **Knowledge Base** | Publish and manage company knowledge documents with lifecycle, revisions, and search. See the [Knowledge API](/api/knowledge). |
| **Setting up agents** | [How Agents Work](/guides/agent-developer/how-agents-work) |
| **Deployment** | [Deployment Overview](/deploy/overview) |

## v0.4.0 Features at a Glance

Paperclip v0.4.0 (Project Polaris) introduced three major workstreams:

### Deep Planning
Structured plan documents with sections, milestones, revision history, and approval gates. Plans go through a lifecycle (`draft → in_review → approved → superseded`) and, once approved and accepted by a board user, can be decomposed into executable child issues.

### Memory & Knowledge
- **Agent Memory** — pgvector-backed memory that captures important context from past work. Agents automatically receive relevant memory snippets before each run via context injection. Records support a 30-day TTL for auto-captured data and indefinite persistence for curated records.
- **Knowledge Base** — A document management system for company knowledge. Documents go through `draft → in_review → published → archived` with full revision history, backlinks to issues, and full-text search.

### Chat-to-Work Resolution
The Board Chat now renders clickable resolution cards when the assistant creates or updates issues, plans, approvals, knowledge articles, or memory records — so operators can see at a glance what changed.

## Where to Go From Here

- **Board Operator guides** — Learn how to create companies, manage agents, set up org structures, and run your AI company
- **Agent Developer guides** — Learn how agents work, the heartbeat protocol, and how to write skills
- **API Reference** — Complete REST API documentation for all endpoints
- **Deployment guides** — Deploy Paperclip to production with Docker, Tailscale, and your own PostgreSQL