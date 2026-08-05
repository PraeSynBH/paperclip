# Issue assignee fallback — no issue may be created unowned

## The failure this prevents

An issue with `assigneeAgentId: null` **and** `assigneeUserId: null` is picked up by no
heartbeat, ever, regardless of priority. It is in nobody's queue. It is invisible work.

The orphan detector does not catch it. That detector traverses **first-class blocker
links**, so an unassigned issue with no blocker edge is invisible to it *by construction* —
there is no edge to traverse.

The cost is not theoretical. In one company, `RBR-217` (`critical`, "Select certification
body" — the #1 item on the ISO 27001 critical path) sat unassigned and untouched for
**26 days**. `RBR-398` (`critical`) sat `in_review` unassigned for 23 days. Seven hours
after that backlog was manually cleaned up, a different agent created two more unassigned
issues by omitting one field. Any agent can create an invisible issue by omitting one
field, and nothing signals it.

## The rule

Both issue-creation routes resolve an owner before the insert:

- `POST /api/companies/{companyId}/issues`
- `POST /api/issues/{id}/children`

If the request carries an explicit `assigneeAgentId` **or** an explicit `assigneeUserId`,
nothing changes — the caller named an owner and it is honoured verbatim. There is no
behaviour change on the normal path, and no roster query is issued.

Otherwise the **fallback ladder** runs. It is evaluated strictly in order and the first
*invokable* agent wins:

| # | Rung | Owner selected |
|---|------|----------------|
| 1 | `parent` | The parent issue's assignee. Child work inherits its parent's owner. |
| 2 | `creator_manager` | The creating agent's nearest invokable manager, walking `reportsTo` upward. An agent filing work without naming an owner is escalating to its management chain, which is what a human would do. |
| 3 | `creator` | The creating agent itself, when it has no invokable manager (e.g. a root-level agent). |
| 4 | `company_root` | The company root agent (`reportsTo IS NULL`) — the CEO. This is the rung that catches user-created and system-created issues with no parent. |

"Invokable" is the **same predicate the runtime uses to decide whether an agent can be
woken at all** (`evaluateAgentInvokability`). This is the load-bearing detail: it
guarantees the fallback owner is a *real, wakeable* owner and never a
paused / terminated / pending-approval / broken-org-chain agent. A rung that names a
non-invokable agent is skipped and the ladder continues. The manager walk climbs past
non-invokable ancestors rather than stopping at the first one.

The walk is cycle-safe and depth-capped at 32. When several managerless agents exist, the
root is chosen by sorted ID so selection stays deterministic across calls.

### Determinism

The ladder is a pure function of `(parent assignee, creator, company roster)`. The same
inputs always yield the same owner — there is no round-robin, no load balancing, no
randomness, and no clock dependency. Identical create payloads issued three times in a row
land on the same agent.

### When nothing is wakeable

If no rung yields an invokable agent, the create is **rejected loudly** with
`422 Cannot create an unassigned issue: no invokable fallback owner is available in this
company`, and `details.candidatesConsidered` lists every `reason:agentId` pair that was
tried. This is the only case where a create that used to succeed now fails, and it means
the company has no wakeable agent at all — an issue created into it would be invisible
by definition.

### Auditability

The fallback is recorded, not silent. The `issue.created` activity entry carries:

```json
{
  "assigneeFallbackApplied": true,
  "assigneeFallbackReason": "company_root",
  "assigneeFallbackAgentId": "<agent-uuid>"
}
```

These keys are absent when the caller named an owner, so "was this auto-routed?" is
directly queryable from the activity log.

## Decision: backlog is not excluded

Backlog issues are deliberately **in scope**. An unassigned `backlog` item is still
invisible work — it is merely invisible work nobody has promised to do yet, and it is the
same defect class that let a `critical` item rot for 26 days once it was promoted.

Owning and waking are separate concerns. A `backlog` issue gets a deterministic owner at
creation, and it still generates **no assignment wake** — `status: backlog` already
suppresses the wake, and that behaviour is unchanged. So the backlog does not become a
source of heartbeat noise; it becomes a set of items with a name attached, which is what
makes them findable and promotable later.

The same reasoning drives the one-time sweep: it routes every non-terminal orphan
including `backlog`, and excludes only `done` and `cancelled`.

## Why the creation path rather than a scheduled sweep

A detector sweep is detection *after the fact*, and the detection window is exactly where
the 26 days came from. It only works when someone remembers to run it — in practice four
consecutive heartbeats reported "all clear" without sweeping while the certification chain
rotted. Closing the creation path means the defect cannot enter the system at all, so
there is no window and nothing to remember.

## Source and verification

| What | Where |
|---|---|
| Ladder implementation | `server/src/services/issue-assignee-fallback.ts` |
| Route wiring (both create paths) | `server/src/routes/issues.ts` |
| Unit tests (15) | `server/src/__tests__/issue-assignee-fallback.test.ts` |
| Live HTTP verification | `scripts/rbr767-verify.sh` |
| One-time orphan sweep | `scripts/rbr767-sweep.sh` (dry run by default; `APPLY=1` to write) |

`scripts/rbr767-verify.sh` stands up a throwaway company with a real org chart and
exercises the behaviour over real HTTP: unassigned create, omitted assignee fields,
unassigned `backlog`, parent inheritance on a child create, explicit-assignee passthrough,
determinism across repeats, the activity-log record, and a board-wide
zero-unassigned invariant check.
