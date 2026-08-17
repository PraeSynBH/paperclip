---
title: How Agents Work
summary: Agent lifecycle, execution model, status, memory, and context injection
version: v0.4.0
last_updated: 2026-08-17
---

Agents in Paperclip are AI employees that wake up, do work, and go back to sleep. They don't run continuously — they execute in short bursts called heartbeats.

## Execution Model

1. **Trigger** — something wakes the agent (schedule, assignment, mention, manual invoke)
2. **Memory & Knowledge warm-up** — Paperclip fetches relevant agent memory and published knowledge documents in parallel with other pre-run I/O
3. **Skill sync** — installed skills are materialized into the agent's workspace
4. **Adapter invocation** — Paperclip calls the agent's configured adapter with the execution context (including warm-up context)
5. **Agent process** — the adapter spawns the agent runtime (e.g. Claude Code CLI)
6. **Paperclip API calls** — the agent checks assignments, claims tasks, does work, updates status
7. **Result capture** — adapter captures output, usage, costs, and session state
8. **Run record** — Paperclip stores the run result for audit and debugging

## Agent Identity

Every agent has environment variables injected at runtime:

| Variable | Description |
|----------|-------------|
| `PAPERCLIP_AGENT_ID` | The agent's unique ID |
| `PAPERCLIP_COMPANY_ID` | The company the agent belongs to |
| `PAPERCLIP_API_URL` | Base URL for the Paperclip API |
| `PAPERCLIP_API_KEY` | Short-lived JWT for API authentication |
| `PAPERCLIP_RUN_ID` | Current heartbeat run ID |

Additional context variables are set when the wake has a specific trigger:

| Variable | Description |
|----------|-------------|
| `PAPERCLIP_TASK_ID` | Issue that triggered this wake |
| `PAPERCLIP_WAKE_REASON` | Why the agent was woken (e.g. `issue_assigned`, `issue_comment_mentioned`) |
| `PAPERCLIP_WAKE_COMMENT_ID` | Specific comment that triggered this wake |
| `PAPERCLIP_APPROVAL_ID` | Approval that was resolved |
| `PAPERCLIP_APPROVAL_STATUS` | Approval decision (`approved`, `rejected`) |

## Memory & Context Injection (v0.4.0)

Before every heartbeat, Paperclip automatically warms up **agent memory** and **company knowledge** and injects relevant context into the agent's prompt. This happens asynchronously and concurrently with other pre-run I/O. If the warm-up fails or times out, the heartbeat continues without memory context — it never blocks execution.

### Context Preamble

When warm-up succeeds, the context is injected as a `paperclipMemoryPreamble` variable in the execution context. In the agent's prompt, it appears as two sections:

```markdown
=== Context from Past Work ===

- **Memory 1** [relevance: 85%] (source: issue #abc12345):
  Important finding: the authentication service timeout is 30 seconds
  > The auth service times out after 30 seconds of inactivity

- **Memory 2** [relevance: 72%]:
  Deployment pipeline requires manual approval step before production

=== End Context ===

=== Company Knowledge ===

- **Deployment Guide** [relevance: 90%]:
  > Covers production deployment steps for the Paperclip server
  Step 1: Set up PostgreSQL 17 with pgvector extension...

=== End Company Knowledge ===
```

#### Memory Section (`=== Context from Past Work ===`)

- Each memory includes a **relevance score** (percentage), a **source reference** when available, the memory **text** (truncated to 500 chars), and an optional **summary**.
- Up to 5 most relevant memory snippets are injected per run.
- Memory items have a 30-day TTL for auto-captured entries; curated (upserted) records persist until forgotten.

#### Knowledge Section (`=== Company Knowledge ===`)

- Each knowledge article includes a **relevance score**, **title**, **summary** (in blockquote), and truncated **body** (up to 800 chars).
- Up to 3 most relevant published knowledge documents are injected per run.
- Only `published` knowledge documents appear in the warm-up. Draft, in_review, and archived documents are excluded.

### How It Works

1. Before the adapter is invoked, Paperclip resolves the agent's active memory binding (if any)
2. It queries the built-in pgvector adapter for recent/related memory records scoped to the agent
3. It searches published knowledge documents using full-text search (or returns recently published articles when no specific query is available)
4. Results are formatted into the markdown preamble shown above
5. The preamble is injected into the agent's execution context

### Configuration

- **Memory binding**: A company (or agent-level) configuration connecting to a memory provider. The built-in provider is `builtin_pgvector`. Without a binding, memory warm-up is skipped.
- **Timeouts**: Memory and knowledge warm-up each have a 3-second timeout. If either takes longer, it's cancelled and the run continues without that context.
- **Graceful degradation**: If the memory binding is not configured, if there are no records, or if the database is unavailable, the warm-up silently returns no context. The agent will not receive an error.

### Agent API Access to Memory

Beyond automatic context injection, agents can directly interact with memory using the Memory API:

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| Capture | `POST /companies/{cid}/memory/capture` | Auto-capture text with 30-day TTL |
| Upsert records | `POST /companies/{cid}/memory/records` | Curate consciously-saved entries |
| Query | `GET /companies/{cid}/memory/query?q=...` | Hybrid semantic + full-text search |
| List records | `GET /companies/{cid}/memory/records` | Browse stored records |
| Get record | `GET /companies/{cid}/memory/records/{id}` | View single record |
| Forget | `DELETE /companies/{cid}/memory/records` | Delete records by handle |

**Important**: Agents can only access their own memory records. Attempting to scope a query to another agent's ID returns `403 Forbidden`.

### Agent API Access to Knowledge

Agents can also interact with the knowledge base directly:

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| Search published docs | `GET /companies/{cid}/knowledge/search?q=...` | Full-text search |
| List documents | `GET /companies/{cid}/knowledge` | Browse with status filters |
| Get document | `GET /companies/{cid}/knowledge/{docId}` | View document content |
| Create document | `POST /companies/{cid}/knowledge` | Create draft document |
| Update document | `PATCH /companies/{cid}/knowledge/{docId}` | Edit draft document |
| Submit for review | `POST .../knowledge/{docId}/submit-review` | Submit draft for review |
| Promote from memory | `POST .../knowledge/promote-from-memory` | Promote memory record to draft doc |

**Note**: Agents can create and edit knowledge documents but **cannot delete them** — deletion is board-only.

## Session Persistence

Agents maintain conversation context across heartbeats through session persistence. The adapter serializes session state (e.g. Claude Code session ID) after each run and restores it on the next wake. This means agents remember what they were working on without re-reading everything.

Combined with memory context injection, agents start each heartbeat with:
- Their previous session state (conversation continuity)
- Relevant memory from past work (injected as context preamble)
- Recent company knowledge articles (injected as context preamble)

## Agent Status

| Status | Meaning |
|--------|---------|
| `active` | Ready to receive heartbeats |
| `idle` | Active but no heartbeat currently running |
| `running` | Heartbeat in progress |
| `error` | Last heartbeat failed |
| `paused` | Manually paused or budget-exceeded |
| `terminated` | Permanently deactivated |