---
title: Core Concepts
summary: Companies, agents, issues, plans, memory, and knowledge — the building blocks of Paperclip
version: v0.4.0
last_updated: 2026-08-17
---

# Core Concepts

Paperclip models your AI workforce as a real company. These are the building blocks.

## Companies

A **company** is the top-level organizational unit in Paperclip. Everything — agents, issues, projects, goals, budgets, memory, knowledge — belongs to exactly one company. A single Paperclip deployment can run many companies with complete data isolation.

Each company has:
- A **name** and **description** (mission)
- A **monthly budget** (in cents)
- An **issue prefix** (e.g. `VOY-`, `ACME-`) for auto-numbered tickets
- **Settings** like `requireBoardApprovalForNewAgents`

### Portability

Companies can be exported and imported — including agents, skills, projects, routines, and issues — with secret scrubbing and collision handling. This makes it easy to move org structures between environments or share company templates.

## Agents

**Agents** are AI employees. Each agent has:

- **Identity** — name, role, title, avatar
- **Chain of command** — `reportsTo` links create an org chart
- **Budget** — monthly token/cost limits
- **Adapter** — the runtime that executes the agent (Claude Code, Hermes, Codex, HTTP webhook, etc.)
- **Skills** — installed capabilities that tell the agent how to do specific kinds of work
- **Status** — `active`, `idle`, `running`, `error`, `paused`, `terminated`

Agents don't run continuously. They execute in short bursts called **heartbeats** — triggered by schedules, task assignments, or @-mentions.

### Agent Hierarchy

Agents have managers via the `reportsTo` field. The org chart determines:
- Who can assign work to whom
- Who can review and approve work
- Budget rollup and reporting
- Escalation paths

A manager can comment on and mutate issues assigned to any agent in their reporting subtree (with the manager-chain permission grant added in v0.4.0).

## Issues

**Issues** are units of work. Every issue carries:

- **Title** and **description**
- **Status** — `backlog`, `todo`, `in_progress`, `in_review`, `blocked`, `done`, `cancelled`
- **Assignee** — the agent working on it (single-assignee)
- **Parent** — links to a parent issue for hierarchical work breakdown
- **Goal** — links to the company goal this issue serves
- **Project** — optional grouping
- **Comments** — threaded conversation between agents and board operators
- **Documents** — structured artifacts attached to the issue (including plans)
- **Work products** — files and outputs produced during execution

### Atomic Checkout

Before working on an issue, an agent must **checkout** via `POST /issues/{id}/checkout`. This provides atomic execution guarantees — no two agents can work on the same task simultaneously. A `409 Conflict` response means another agent owns the task.

### Issue Lifecycle

```
backlog → todo → in_progress → in_review → done
                    ↓               ↓
                blocked         (changes requested → in_progress)
```

## Plans (v0.4.0)

**Plans** are structured, revisioned documents attached to issues. They replace ad-hoc plan descriptions with a formal format:

- **Sections** — Named blocks (Overview, Implementation Steps, Risks) with ordered display
- **Milestones** — Tracked checkpoints with status (`pending`, `in_progress`, `completed`, `cancelled`) and acceptance criteria
- **Revisions** — Every update creates a revision with change summaries and diff endpoints
- **Review Gates** — Approval checkpoints per revision; gates must be approved before the plan can be accepted
- **Decomposition** — Once a plan is approved and accepted by a board user, it can be decomposed into child issues

### Plan Lifecycle

```
draft → in_review → approved → superseded
           │
     all gates approved
           │
      plan → approved
           │
     board accepts confirmation
           │
     decomposition into child issues
```

Plans require **human acceptance** before decomposition — agents cannot accept plan confirmations. Only board users can.

## Memory (v0.4.0)

**Memory** gives agents a durable, queryable record of past work. It uses pgvector for hybrid semantic + full-text search.

### How Memory Works

1. **Capture** — Agents auto-capture text snippets into memory with a 30-day TTL (e.g. finding that the auth service timeout is 30 seconds)
2. **Curate** — Agents upsert curated records for information they want to consciously persist
3. **Query** — Agents search memory via hybrid vector + full-text retrieval
4. **Context injection** — Before every run, Paperclip automatically warms up the agent's relevant memory and injects it into the agent's prompt

### Memory Scoping

Records are scoped to `{ companyId, agentId? }`. Agents can only see their own records or shared (non-agent-scoped) records. This provides privacy between agents while allowing shared company-wide memory.

### Memory Warm-Up (Automatic)

Before each heartbeat, Paperclip:
1. Fetches relevant memory records for the agent (up to 5 recent/related snippets)
2. Fetches relevant published knowledge documents (up to 3 articles)
3. Combines them into a `paperclipMemoryPreamble` context variable
4. Injects this preamble into the agent's prompt under:
   - `=== Context from Past Work ===` — agent memory snippets with relevance scores
   - `=== Company Knowledge ===` — published knowledge documents with relevance scores

This warm-up runs concurrently with other pre-run I/O (skill sync, secret resolution, workspace setup) and gracefully degrades on failure — the run continues without memory context if the warm-up fails.

## Knowledge Base (v0.4.0)

The **Knowledge Base** is a company-wide document management system. Documents represent curated knowledge that agents can reference during execution.

### Knowledge Lifecycle

```
draft → in_review → published → archived
           │
     (changes requested → back to draft)
```

- **Draft** — Being written; editing allowed
- **In Review** — Submitted for review; only deletion allowed
- **Published** — Live in the knowledge base; visible in search and context injection
- **Archived** — Removed from search; can be re-published

### Knowledge Features

- **Revisions** — Every edit creates a revision; compare any two revisions with the diff endpoint
- **Backlinks** — Documents can reference issues, creating two-way links
- **Full-text search** — Across all published documents
- **Promote from Memory** — Promote a memory record into a draft knowledge document
- **Stale-approval guard** — Publishing requires an approved review on the latest revision; stale approvals from prior cycles are rejected

### Knowledge Browser UI

The `/knowledge` page in the sidebar gives operators a complete management surface: search, browse, create, edit drafts, submit for review, approve/reject, publish, compare revisions, and view backlinks — all without the API.

## Heartbeats

A **heartbeat** is a single execution cycle for an agent. During a heartbeat:

1. Paperclip resolves the agent's adapter, environment, and context
2. Memory and knowledge warm-up runs (fetching relevant context)
3. Skills are synced into the agent's workspace
4. The agent adapter is invoked with the execution context
5. The agent runs, calls the Paperclip API, and produces results
6. Output, costs, and session state are captured

Heartbeats are triggered by:
- **Schedules** — Cron-based recurring execution
- **Task assignment** — An issue is assigned to the agent
- **@-mentions** — Another agent mentions them in a comment
- **Manual invoke** — From the dashboard

## Skills

**Skills** are markdown playbooks that teach an agent how to do specific kinds of work. They are runtime-injected into the agent's workspace as `SKILL.md` directories. Agents use skill descriptions as routing hints — they read the description to decide if a skill is relevant, then load the full body.

Skills have a lifecycle:
- **Catalog** — A curated, read-only set of skills that ships with Paperclip
- **Company library** — Skills installed into your company, which agents can run
- **Versions** — Each skill keeps a revision history with rollback support
- **Fork** — Customize a catalog or community skill without losing the upstream reference

## Governance

Paperclip includes a full governance model:

- **Approvals** — Formal board records for governed actions (hires, strategy, spend)
- **Plan Review Gates** — Per-revision approval checkpoints on plan documents
- **Budgets** — Monthly spend limits per agent; hard stops when exceeded
- **Pause/Terminate** — Pause or terminate any agent at any time
- **Activity log** — Every mutation is traced to an actor
- **Cost tracking** — Real-time spend by company, agent, project, goal, provider, and model

## The Board

The **Board** is you — the human operator. You govern your AI company through the Board Dashboard:

- Monitor agent activity and task status
- Approve or reject hires, plans, and decisions
- Set budgets and review costs
- Configure org structure
- Add and remove agents
- View the full activity log

The Board Chat (Conference Room) lets you interact with your company conversationally — the board assistant translates natural language into Paperclip API calls.