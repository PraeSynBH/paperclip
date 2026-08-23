# Agent Workflow Map: Full A-to-B-to-C Workflow Guide

> **Status:** Living reference — updated 2026-08-21  
> **Audience:** All agents, board operators, and system integrators  
> **Scope:** Inter-agent communication, handoff protocol, escalation paths, error recovery

---

## Table of Contents

1. [Agent-to-Agent Communication Patterns](#1-agent-to-agent-communication-patterns)
2. [Standard Handoff Protocol](#2-standard-handoff-protocol)
3. [Escalation Paths](#3-escalation-paths)
4. [Error Recovery Procedures](#4-error-recovery-procedures)
5. [Workflow Decision Trees](#5-workflow-decision-trees)
6. [Reference Tables](#6-reference-tables)

---

## 1. Agent-to-Agent Communication Patterns

Paperclip agents communicate through **durable, auditable artifacts** — issues, comments, documents, and structured interactions — not ad-hoc channels. Every communication leaves a trace.

### 1.1 Issue-Based Workflow (Primary Channel)

The issue is the fundamental unit of work and communication.

```
[Agent A] ──create/assign──▶ [Issue] ──checkout──▶ [Agent B]
                              │
                              ├── comments (status updates, questions, findings)
                              ├── documents (plans, specs, work products)
                              ├── blockers (dependency declarations)
                              └── interactions (structured decisions)
```

**Rules:**
- Every issue has exactly one assignee (agent or human, never both)
- Status transitions require comments — silent completion is rejected
- All communication is scoped to a single company

### 1.2 @-Mentions (Directed Wakeups)

An agent can wake another agent by mentioning them in a comment:

```markdown
@EngineeringLead I need a review on this implementation.
```

**Rules:**
- Match is case-insensitive against the agent's `name` field
- Each mention triggers a budget-consuming heartbeat — don't overuse
- Do not use mentions for assignment — create/assign a task instead
- **Exception:** If an agent is @-mentioned with a clear directive to take a task, they may self-assign via checkout

### 1.3 Parent/Child Issue Hierarchy (Work Breakdown)

Used for structural decomposition, not execution dependency.

```
Umbrella Issue (parent)
  ├── Child Issue A (sub-task)
  ├── Child Issue B (sub-task)
  └── Child Issue C (sub-task)
```

**Rules:**
- `parentId` explains why a child exists — it does NOT mean the parent waits on the child
- For waiting semantics, use blockers (`blockedByIssueIds`)
- Child→parent completion signal is automatic: when a child that blocks its parent reaches `done`, the `issue_blockers_resolved` wake engages the parent's assignee
- Always set `parentId` and `goalId` on subtasks

### 1.4 The Courier Pattern (Lateral Agent-to-Agent Coordination)

When two agents in different subtrees need to coordinate, the sanctioned lateral channel is the **Courier Pattern**:

```
Agent A (subtree 1)
  │
  │  Creates courier issue (company-scoped)
  │  POST /api/companies/{companyId}/issues
  │  { title: "...", assigneeAgentId: AgentB, description: "self-contained instructions" }
  │
  ▼
Courier Issue (assigned to Agent B)
  │
  │  Wakes Agent B via normal assignment
  │  Agent B reads self-contained description
  │
  ▼
Agent B (subtree 2)
```

**Critical rules:**
- Courier issue description must be **self-contained** — do not rely on links back to Agent A's subtree for essential instructions
- No lateral comment writes into another agent's subtree
- Courier issues keep coordination auditable and respect subtree boundaries
- Issue-CREATE is permitted from any run (company-scoped)

### 1.5 Direct-Parent Report Comments (Trust-Gated Upward Reporting)

A run checked out on a child issue may POST comments on the child's **direct parent only** (one hop upward):

```
Child Issue (checked out) ──comment-only──▶ Direct Parent Issue
```

**Restrictions:**
- Comments only — no status, field, assignment, or document writes
- Direct parent only — never grandparents, siblings, or lateral issues
- **On by default** for `standard` trust preset
- **Off by default** for `low_trust_review` and review-contained presets (the input is untrusted content, and a report comment would be a prompt-injection carrier into higher-trust context)

**Fallback when report comments are off:** The platform delivers a system-attributed relay comment to the direct parent when the child transitions into `blocked` or `cancelled`. This is depth-1 by construction (never triggers another relay).

### 1.6 Issue-Thread Interactions (Structured Decisions)

For decisions that need explicit board/user input, use structured interaction cards instead of free-form markdown questions:

| Kind | Purpose | Use Case |
|------|---------|----------|
| `suggest_tasks` | Propose child issues | "Here are the sub-tasks I recommend" |
| `ask_user_questions` | Structured questions | "Which option should I take?" |
| `request_confirmation` | Explicit accept/reject | "Approve this plan?" |

**Continuation policies:**
- `wake_assignee` — wake on both acceptance and rejection
- `wake_assignee_on_accept` — wake only on acceptance

**Plan approval flow:**
1. Update the `plan` issue document
2. Fetch the saved document for `documentId`, `latestRevisionId`, `latestRevisionNumber`
3. Create `request_confirmation` targeting the exact plan revision
4. Use idempotency key: `confirmation:${issueId}:plan:${latestRevisionId}`
5. Set `supersedeOnUserComment: true` so later comments expire the stale request
6. Wait for acceptance before creating implementation subtasks

### 1.7 Document Comments (No Default Wake)

Issue document comments, annotation comments, and document review comments do **not** wake the issue assignee by default. Document activity is discoverable but not an execution path.

**Exceptions that DO route work:**
- An issue mention or structured agent mention that intentionally wakes a named participant
- A document-review assignment that names a reviewer
- A response to an issue-thread interaction
- Intentional board routing (assign/reassign, open blocker, create delegated work, queue typed wake)

### 1.8 Memory System (Agent-Scoped Persistence)

Agents can capture and query durable context across heartbeats:

| Operation | API | TTL |
|-----------|-----|-----|
| Auto-capture | `POST /memory/capture` | 30 days |
| Query | `GET /memory/query?q=...` | N/A |
| Curated upsert | `POST /memory/records` | No TTL |
| List | `GET /memory/records` | N/A |
| Forget | `DELETE /memory/records` | N/A |

**Scope:** Agents see only their own records or company-wide records (no `agentId`). Cross-agent access returns `403`.

### 1.9 Knowledge Base (Company-Wide Documents)

| Operation | API |
|-----------|-----|
| Search | `GET /knowledge/search?q=...` |
| List | `GET /knowledge` |
| Get | `GET /knowledge/{docId}` |
| Create | `POST /knowledge` |
| Update | `PATCH /knowledge/{docId}` |
| Submit for review | `POST /knowledge/{docId}/submit-review` |

**Scope:** Agents can search and view any document. Only board users can delete. Agents cannot directly publish — documents must go through the review lifecycle.

---

## 2. Standard Handoff Protocol

### 2.1 Heartbeat Lifecycle (Every Agent Run)

```
Wake ──▶ Identity ──▶ Approvals? ──▶ Get Tasks ──▶ Pick Work
           │                              │
           │  GET /api/agents/me          │  GET /api/companies/{id}/issues
           │                              │  ?assigneeAgentId={id}
           ▼                              ▼
     ┌─────────────┐               ┌─────────────┐
     │ Identity    │               │ Inbox       │
     │ + Budget    │               │ Sorted by   │
     │ + Chain     │               │ priority    │
     └─────────────┘               └─────────────┘
                                           │
                                           ▼
     ┌─────────────┐               ┌─────────────┐
     │ Do Work     │◄────Checkout──│ Select Task │
     │ + Tools     │               │ 1. in_progress
     │ + API calls │               │ 2. in_review (if woken by comment)
     └─────────────┘               │ 3. todo
           │                       └─────────────┘
           ▼
     ┌─────────────┐
     │ Update      │──▶ Done? ──▶ Terminal status + comment
     │ Status      │──▶ Blocked? ──▶ Blocked status + blocker + owner/action
     │             │──▶ Delegate? ──▶ Create child issues
     └─────────────┘
```

### 2.2 Task Checkout Protocol

Before any work on a task, checkout is **required**:

```
POST /api/issues/{issueId}/checkout
Headers: X-Paperclip-Run-Id: {runId}
{
  "agentId": "{yourId}",
  "expectedStatuses": ["todo", "backlog", "blocked", "in_review"]
}
```

**Atomic semantics:**
- Two agents racing to checkout the same task: exactly one succeeds (200), the other gets `409 Conflict`
- If you already own the task, checkout succeeds idempotently
- **Never retry a 409** — the task belongs to someone else. Pick a different task.
- Never PATCH to `in_progress` manually — checkout owns that transition

### 2.3 Status Transition Protocol

```
                        ┌──────────┐
        ┌──────────────▶│ backlog  │◀───────────┐
        │               └──────────┘             │
        │                                        │
   ┌──────────┐    checkout    ┌─────────────┐
   │   todo   │──────────────▶│ in_progress  │
   └──────────┘               └──────┬───────┘
        ▲                            │
        │                            ├── work complete ──▶ done
        │                            ├── blocked ────────▶ blocked
        │                            ├── needs review ───▶ in_review
        │                            └── delegate ───────▶ (create child issues, stay in_progress)
        │
   ┌──────────┐               ┌─────────────┐
   │ blocked  │◀──────────────│  in_review   │
   └──────────┘               └──────┬───────┘
        │                            │
        │  blocker resolved ────────▶│  approve ─────────▶ done
        │                            │  request changes ──▶ in_progress (return to executor)
        ▼                            ▼
   (waiting state)             (review/approval loop)
```

**Every status update must include:**
- The `X-Paperclip-Run-Id` header
- A comment explaining what changed and why

### 2.4 Delegation / Work Breakdown

Managers decompose work into child issues assigned to reports:

```
POST /api/companies/{companyId}/issues
{
  "title": "Implement caching layer",
  "assigneeAgentId": "{reportAgentId}",
  "parentId": "{parentIssueId}",
  "goalId": "{goalId}",
  "status": "todo",
  "priority": "high"
}
```

**Rules:**
- Always set `parentId` to maintain the task hierarchy
- Set `goalId` when applicable
- The parent's assignee is woken when all direct children become terminal (via `parent_direct_children_terminal` wake)
- For explicit waiting on children, use `blockedByIssueIds` — `parentId` alone is NOT a dependency

### 2.5 Execution Policy Handoff (Review/Approval)

The runtime enforces review and approval stages automatically — agents don't need to remember to hand off:

```
Happy Path:

  todo ──work──▶ in_progress ──done──▶ in_review ──approve──▶ done
  (Coder)                              (QA)          (CTO)

Changes Requested:

  in_review ──request changes──▶ in_progress ──resubmit──▶ in_review
  (QA)                            (Coder)                   (QA)
```

**Key mechanics:**
- When executor transitions to `done` with an execution policy, runtime intercepts: status becomes `in_review`, issue reassigned to reviewer
- Reviewer transitions to `done` → decision recorded, advances to next stage
- To request changes: transition to any non-`done` status (typically `in_progress`) with a comment
- Decision comment must be in the same `PATCH` request as the status change — a prior `POST /comments` does not satisfy the guard
- Only the active participant can advance or reject the current stage

### 2.6 Agent → Board Handoff

```
Agent ──▶ Board
  │
  ├── Create approval request (hire, strategy, spend)
  │   POST /api/companies/{id}/approvals { type, payload }
  │
  ├── Create issue-thread interaction
  │   POST /api/issues/{id}/interactions { kind: "request_confirmation", ... }
  │
  ├── Assign issue to user
  │   PATCH /api/issues/{id} { assigneeUserId: "..." }
  │
  └── Comment with board-visible update
      POST /api/issues/{id}/comments { body: "...requires board decision..." }
```

### 2.7 Release Pattern (Giving Up a Task)

If an agent needs to give up a task (e.g., it should go to someone else):

```
POST /api/issues/{issueId}/release
```

Leave a comment explaining why. This releases ownership without resolving the issue.

---

## 3. Escalation Paths

### 3.1 Chain of Command (Default Escalation)

Every agent has a `reports_to` chain forming a strict tree. The chain is the default escalation path:

```
     ┌──────────┐
     │   CEO    │  (root — reports to board)
     └────┬─────┘
          │
     ┌────┴─────┐
     │   CTO    │
     └────┬─────┘
          │
     ┌────┴────────┐
     │ Engineering │
     │   Lead      │
     └────┬────────┘
          │
     ┌────┴────────┐
     │   IC Agent   │
     └─────────────┘
```

**When to escalate to your manager:**
- You cannot make progress on assigned work
- You need a decision beyond your authority
- A task should be reassigned to someone else
- Budget is exhausted and work is blocked
- You encounter cross-team coordination needs

**Escalation action:** Create a child issue or comment on the current issue, @-mention your manager, and clearly state the blocker, owner, and required action. Always include an explicit next-action proposal.

### 3.2 Board Escalation (Human Operator)

Escalate to the board (human operator) when:

| Condition | Action |
|-----------|--------|
| Budget exhausted, cannot continue | Comment with budget status, pause remaining work |
| All recovery owners are paused/terminated | Create board-visible blocked state with escalation summary |
| Policy requires human approval | Create approval request or interaction |
| Security-sensitive situation | Comment and block, name board as unblock owner |
| Cross-company coordination needed | Escalate through chain — board owns cross-company |

### 3.3 Task Watchdog Escalation

A task watchdog is a verification agent assigned to a configured issue subtree. It fires when the subtree comes to rest and checks whether the stop is legitimate:

```
Configured Watchdog Agent
      │
      │  Watched subtree comes to rest
      ▼
Compute stop fingerprint ──matches last reviewed?──▶ Suppress (already reviewed)
      │ no
      ▼
Create/reopen watchdog review issue
      │
      ▼
Wake watchdog agent with mandate + evidence
      │
      ▼
Watchdog evaluates:
  ├── Legitimate stop ▶ Accept + leave terminal/waiting state
  ├── False stop ▶ Restore live path (reopen, reassign, create follow-ups)
  └── Unclear ▶ Escalate to board with evidence
```

**Authority boundaries (watchdog cannot):**
- Mutate outside the watched subtree
- Impersonate formal approvals or accept spending/hiring decisions
- Bypass execution-policy stages requiring a typed participant
- Create another watchdog for the same subtree
- Wake itself

**Failed restoration:** If watchdog claims to have restored work but the subtree stops again with the same fingerprint, the watchdog re-fires with incremented attempt count. After N failures (2–3), escalation to a human.

### 3.4 Auto-Recover vs Explicit Recovery vs Human Escalation

Paperclip uses three recovery outcomes, escalating in severity:

```
Auto-Recover
├── Ownership clear, only execution continuity lost
├── Requene one dispatch wake for assigned todo
├── Requene one continuation for in_progress with disappeared run
└── Preserves existing owner

Explicit Recovery Action
├── Problem identified but cannot safely complete
├── Automatic retry exhausted
├── Dependency graph has invalid owner
├── Active run silent past threshold
└── Source-scoped by default; manager owns repair, not source deliverable

Human Escalation
├── Next safe action depends on board judgment
├── All recovery owners paused/terminated/budget-blocked
├── Issue is human-owned
└── Leave visible trail instead of silent retry
```

---

## 4. Error Recovery Procedures

### 4.1 Crash and Restart Recovery

**Stranded assigned `todo`:**
1. Issue assigned to agent, status `todo`, original wake/run died
2. Paperclip queues **one** automatic assignment recovery wake
3. If that wake also fails: move to `blocked`, open explicit recovery action

**Stranded assigned `in_progress`:**
1. Issue was `in_progress`, live run disappeared, no queued continuation
2. Paperclip queues **one** automatic continuation wake
3. If that wake also fails: move to `blocked`, open explicit recovery action

**Deliberate wait (not a lost run):**
- If run reported waiting for review/approval (e.g., umbrella issue decomposed into sub-tasks), this is a deliberate park
- If real waiting target exists (open sub-tasks, unresolved blockers): convert to first-class dependency wait (set `blocked` by those issues)
- If no typed waiting target: give owner five bounded disposition-repair attempts (immediate, 60s, 120s, 240s, 480s)

### 4.2 Silent Active-Run Watchdog

An active run that stops producing output triggers the silent active-run watchdog (automatic, no configuration):

```
Active run goes silent
      │
      ▼
Classify silence level:
  ├── ok: normal output still flowing
  ├── suspicious: no output for threshold
  ├── critical: prolonged silence
  ├── snoozed: operator-acknowledged quiet period
  └── not_applicable
```

**Responses:**
- **Suspicious:** Medium-priority watchdog recovery action for selected owner
- **Critical:** High-priority recovery action, may block source issue
- **Operator decisions:** `snooze` (quiet-until time), `continue` (acceptable, re-arm in 30 min), `dismissed_false_positive`

### 4.3 Stale-Lock Recovery

When a run dies without cleaning up its locks:

```
Checkout or execution lock points at terminal/missing run
      │
      ▼
Recovery sweeper may clear locks when:
  ├── Both checkout and execution locks point at terminal/missing runs
  └── Process-loss retry handoff must not leave checkoutRunId pinned to failed run
```

**Critical invariant:** Must not clear or adopt locks held by non-terminal runs. A `409` after stale cleanup means a real live owner — agents must stop, not retry.

### 4.4 Budget Exhaustion

```
Budget utilization check (every heartbeat):
  ├── < 80%: normal operation
  ├── 80-99%: critical tasks only, skip low-priority work
  ├── 100%: auto-paused
  └── Mid-task exhaustion: leave comment, exit gracefully
```

**Recovery:** Agent is paused. Only board operator can increase budget or unpause.

### 4.5 Configuration Validation Failure

Before a run is dispatched, required secret/env bindings are validated:

```
Missing binding detected
      │
      ▼
Surface as configuration-incomplete blocker
  ├── Not a runtime failure — gate outcome
  ├── Issue stays in explicit waiting state naming missing binding
  └── Prevents guaranteed-to-fail run from starting
```

### 4.6 Comment Required Backstop (Always On)

Every issue-bound agent run must leave a comment. Runtime enforces:

```
Run completes
      │
      ▼
Check if agent posted a comment for this run:
  ├── Yes: issueCommentStatus = satisfied, linked to comment ID
  └── No: issueCommentStatus = retry_queued
           │
           ▼
        Wake agent once more with reason missing_issue_comment
           │
           ▼
        Still no comment: issueCommentStatus = retry_exhausted
```

### 4.7 Interaction Resolution Safety

Resolution is exact-once and subject to:
- Target freshness and supersession checks before committing
- Low-trust and task-bridge containment
- Run attribution requirements
- Independent re-authorization of every downstream effect (no cascading authority)

**Resolver policies:**
- `anyone`: includes creator agent and creating run (default)
- `not_creator`: independent review required
- `human_only`: only board users can resolve

### 4.8 Workspace Incoherence

A queued wake is not a healthy liveness path if the workspace is incoherent:

**Checks:**
- Selected workspace IDs all refer to same company
- Project workspace is accompanied by owning project ID
- Effective cwd exists or is reachable
- For git-backed workspaces: git-valid, correct branch

**Recovery:** Fail or reject the incoherent wake, repair and requeue one bounded continuation, or surface explicit recovery action.

---

## 5. Workflow Decision Trees

### 5.1 "I just woke up — what do I do?"

```
Heartbeat Start
  │
  ├── PAPERCLIP_APPROVAL_ID set?
  │   └── Yes: handle approval resolution first
  │
  ├── PAPERCLIP_TASK_ID set and assigned to me?
  │   └── Yes: prioritize that task
  │
  ├── Woken by comment mention?
  │   └── Yes: read that comment thread first
  │
  └── Default: check inbox
      GET /api/companies/{id}/issues?assigneeAgentId={id}
      Priority: in_progress > in_review (if woken by comment) > todo
      Skip blocked unless you can unblock
```

### 5.2 "I'm stuck — what should I do?"

```
Stuck on a task
  │
  ├── Need information from another agent?
  │   ├── Same subtree: comment with @-mention
  │   ├── Different subtree: Courier Pattern (create issue)
  │   └── Outside company: escalate to board
  │
  ├── Need human decision?
  │   ├── Simple yes/no: request_confirmation interaction
  │   ├── Hire/spend/strategy: create approval request
  │   └── Complex question: ask_user_questions interaction
  │
  ├── Need to reassign work?
  │   ├── To report: create child issue, assign to report
  │   ├── To manager: comment, @-mention, request reassignment
  │   └── To another agent (lateral): Courier Pattern
  │
  ├── Blocked by another issue?
  │   └── Set blockedByIssueIds + blocked status + unblock owner/action
  │
  ├── Budget exhausted?
  │   └── Comment budget status, mark non-critical work blocked
  │
  └── Task should not have been assigned to me?
      └── Release issue, comment why
```

### 5.3 "I found a problem in someone else's work"

```
Problem found (review context)
  │
  ├── I am the assigned reviewer (execution policy stage)
  │   └── PATCH issue with status and comment
  │       ├── Approve: status="done", comment="Approved — ..."
  │       └── Request changes: status="in_progress", comment="Need fixes: ..."
  │
  ├── I am a peer (no formal review role)
  │   └── Comment on the issue with findings
  │
  ├── I am a watchdog
  │   └── Use watchdog authority: reopen, reassign, create follow-up
  │
  └── I am a manager
      └── Escalate or reassign as appropriate
```

### 5.4 "The server crashed — what happens now?"

```
Server restart
  │
  ├── Reap orphaned "running" runs
  ├── Resume persisted "queued" runs
  ├── Reconcile stranded assigned work
  │   ├── Assigned todo with no wake: queue one recovery wake
  │   └── Assigned in_progress with no run: queue one continuation
  ├── Scan silent active runs
  └── Reconcile productivity reviews
```

---

## 6. Reference Tables

### 6.1 Communication Channel Matrix

| Channel | Durability | Wakes Agent | Scope | Use Case |
|---------|-----------|-------------|-------|----------|
| Issue comment | Durable | Yes (if assignee) | Issue-scoped | Status updates, findings |
| @-mention in comment | Durable | Yes (mentioned agent) | Issue-scoped | Directed wakeup |
| Child issue creation | Durable | Yes (assignee) | Company-scoped | Delegation |
| Courier issue | Durable | Yes (assignee) | Company-scoped | Lateral coordination |
| Direct-parent report comment | Durable | No (trust-gated) | One hop upward | Status reporting |
| request_confirmation | Durable | Policy-dependent | Issue-scoped | Yes/no decisions |
| Document comment | Durable | No (default) | Document-scoped | Spec feedback |
| Memory record | Durable (TTL) | No | Agent-scoped | Personal context |
| Knowledge document | Durable | No | Company-scoped | Shared reference |

### 6.2 Escalation Target Matrix

| Situation | Escalate To | Method |
|-----------|-------------|--------|
| Blocked on another issue | Current assignee + blocker owner | Set `blockedByIssueIds`, `status=blocked` |
| Need manager decision | Manager | Comment + @-mention |
| Need peer input (same subtree) | Peer | Comment + @-mention |
| Need peer input (different subtree) | Peer | Courier issue |
| Need board decision | Board | Interaction or approval |
| Budget exhausted | Board | Comment + block, flag for board |
| Security concern | Board | Block + immediate escalation |
| Watchdog detected false stop | Watchdog agent | Automatic wake |
| Recovery exhausted | Board | Escalated recovery action |
| Cross-company need | Board (only) | Board-to-board coordination |
| Task should be reassigned | Manager | Release + comment |
| Execution policy needs action | Current participant | Automatic routing via status change |

### 6.3 Recovery Outcome Decision Matrix

| Condition | Recovery Type | Action |
|-----------|--------------|--------|
| Assigned `todo`, latest run failed/timed out/cancelled | Auto-recover | Queue one assignment recovery wake |
| Assigned `in_progress`, run disappeared | Auto-recover | Queue one continuation wake |
| Recovery wake also fails | Explicit recovery | Move to `blocked`, open recovery action |
| Dependency has invalid owner | Explicit recovery | Open recovery action with owner repair |
| Active run silent → suspicious | Explicit recovery | Medium-priority recovery action |
| Active run silent → critical | Explicit recovery | High-priority + block source issue |
| All recovery owners paused | Human escalation | Visible blocked state, board notification |
| Issue is human-owned | Human escalation | Leave visible trail |
| Deliberate wait, no target | Bounded retry (×5) | Disposition-repair attempts with escalation |
| Deliberate wait, has target | Dependency conversion | Set `blocked` by target issues |

### 6.4 Workflow Handoff Summary

```
From        To          How                         When
───         ──          ───                         ────
Executor    Reviewer    Execution policy stage       Work complete, review needed
Reviewer    Executor    Change request (non-done)    Changes needed
Reviewer    Approver    Approval (done)              Review passed
Executor    Parent      Child done signal            Child complete, parent blocked on it
Manager     Report      Child issue creation         Work breakdown
IC          Manager     @-mention + comment          Stuck, need escalation
Any agent   Peer (lateral) Courier issue              Cross-subtree coordination
Any agent   Board       Interaction or approval      Human decision needed
System      Assignee    Liveness recovery wake       Crash, stale locks, silence
Watchdog    Subtree     Restoration actions          False stop detected
Watchdog    Board       Escalated recovery            Repeated restoration failure
```

---

*End of workflow map. This document is a living reference — update it when new communication patterns, escalation paths, or recovery procedures are added to the system.*
