# PRA-6474 — Make board-owned recovery actions resolvable by agents

## Problem

`issue_recovery_actions` rows can carry `owner_type='board'` with
`owner_agent_id IS NULL`. The recovery gate in `server/src/routes/issues.ts`
(`assertRecoveryActionAuthority`) compared the acting agent against
`activeRecoveryAction.ownerAgentId`. With a null owner there is nothing to
compare against, so the check could never pass for any agent. The 403 response
even proves the dead end: `"recoveryOwnerAgentId": null`.

Result: 63 issues in company `44c1cd6d-...` were frozen since 2026-08-21 (56
blocked, 7 todo; 14 of them real work items). Re-dispositioning the issue was
blocked by the recovery gate, naming a human owner was blocked by the
`unblockDescriptor` gate, and therefore no `blocks` relation could be added
either.

`owner_type='board'` means "the board should decide", but the board is never
notified and no interaction exists on those issues. An owner that never acts is
indistinguishable from an owner that does not exist.

## Decision

Take option 3 from the issue: make the resolve check reachable. A board-owned
action (`owner_type='board'` and `owner_agent_id IS NULL`) may be resolved by
any agent in the company through the dedicated endpoint
`POST /api/issues/{id}/recovery-actions/resolve`, with two guard rails:

1. **A resolution note is required.** The endpoint returns `422` when an agent
   tries to clear a board-owned park without a non-empty `resolutionNote`. The
   note is stored on the action (`resolution_note`) and copied into the audit
   events.
2. **Audit trail is explicit.** The normal `issue.recovery_action_resolved`
   activity entry gains `boardOwnedRecoveryAction` and
   `resolvedByAgentOnBehalfOfBoard` fields, and a dedicated
   `issue.recovery_action_board_owned_resolved` activity event records the
   acting agent, run, outcome, restored status, and the original owner fields.

Generic issue updates (`PATCH /api/issues/{id}`) are deliberately **not**
widened. A board-owned action still gates status/assignee changes on an
unassigned issue; an agent that wants to clear the park must use the resolve
endpoint, which forces the note and produces the audit event. Issue mutations
remain governed by the normal assignee/checkout checks.

Agent-owned recovery actions are unchanged: only the owner, the issue assignee,
or an agent with checkout-management authority may resolve them.

## Why not the alternatives

- **Bulk board resolve endpoint (option 1).** Useful for the board and still
  worth adding later, but it does not remove the dead end: every agent-facing
  workflow keeps hitting the 403, and the board still has to be present to run
  it.
- **Expire board-owned actions (option 2).** Auto-resolving an unknown number of
  real work items as `false_positive` on a timer destroys the evidence that the
  issue was parked for a reason. It also requires a background sweeper whose
  failure mode is silent.
- **Documented board procedure only.** A runbook does not survive an unattended
  board, which is exactly the 58-day failure mode this issue describes.

## Behaviour after the change

| Actor | Action | Board-owned park | Agent-owned park |
| --- | --- | --- | --- |
| Agent (any, same company) | `POST /issues/{id}/recovery-actions/resolve` + note | allowed | 403 unless owner/assignee/manager |
| Agent (any, same company) | `POST .../resolve` without note | 422 | 403 unless owner/assignee/manager |
| Agent (unassigned issue) | `PATCH /issues/{id}` status change | 403 (unchanged) | 403 (unchanged) |
| Agent (issue assignee) | `PATCH /issues/{id}` status change | allowed (unchanged) | allowed (unchanged) |
| Board user | any | allowed | allowed |

Resolving with `outcome="restored"` moves the source issue to
`todo`/`done`/`in_review`; `outcome="blocked"` requires a first-class
unresolved blocker on the source issue (existing validation). Agents cannot
resolve with `false_positive` or `cancelled`; those remain board-only.

## Files changed

- `server/src/routes/issues.ts`
  - new `isBoardOwnedRecoveryAction` helper
  - `assertRecoveryActionAuthority` allows the board-owned claim only for
    `source="recovery_action_resolution"`
  - resolve route: note requirement (422), extra audit fields, dedicated
    `issue.recovery_action_board_owned_resolved` activity event
- `server/src/__tests__/issue-agent-mutation-ownership-routes.test.ts`
  - agent claims board-owned action with note → 200
  - missing note → 422, no writes
  - generic PATCH on a board-owned unassigned issue → 403 (no widening)
  - agent-owned action still 403 for a non-owner even with a note

## Verification

```sh
cd server && npx vitest run src/__tests__/issue-agent-mutation-ownership-routes.test.ts
```

65 tests pass, including the four new ones.

End-to-end against a deployed build:

```sh
curl -sS -X POST "$PAPERCLIP_API_URL/issues/$ISSUE_ID/recovery-actions/resolve" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \
  -H "Content-Type: application/json" \
  -d '{"actionId":"'$ACTION_ID'","outcome":"restored","sourceIssueStatus":"todo",
       "resolutionNote":"PRA-6474: board-owned park cleared by assigned agent; work still valid."}'
```

Expected: `200` with `issue.activeRecoveryAction: null` and
`recoveryAction.status: "resolved"`. On an older build the same call still
returns `403 Agent cannot resolve another owner's recovery action` with
`recoveryOwnerAgentId: null`.

## Rollout

The control plane runs from the installed `paperclipai` package under
`~/.paperclip/cli/current`, not from this workspace, so this does not take
effect until a release that contains the change is installed and the server is
restarted. Do not hand-patch `dist` for this (see the boot-path defect issue).

Two ways to clear the remaining rows:

1. **After deploy — agent path.** Any agent run can call
   `POST /api/issues/{id}/recovery-actions/resolve` with a note. `pra-6474-board-recovery.sh`
   works with either credential; run it without `--execute` first to see the plan.
2. **Before deploy — board path.** The board user runs
   `doc/plans/pra-6474-board-recovery.sh --execute` with `PAPERCLIP_BOARD_TOKEN`.
   Rollups go to `done`, real work items go to `todo`, agent-owned rows are
   skipped (their owners resolve them). A 404 is reported as `ALREADY`, so the
   script is safe to re-run.

Live census at the time of writing (2026-10-19): 19 active actions — 16
board-owned (9 real work items, 7 heartbeat/status rollups) and 3 agent-owned.
The original 63 have been worked down by the COO and other runs.

After resolution, real work items in `todo` are woken by the existing
recovery-restored wakeup, so their assignees resume without another nudge.

## Non-goals

- Bulk resolve endpoint (option 1) for board users
- Automatic expiry sweeper (option 2)
- UI badge for board-owned active actions
