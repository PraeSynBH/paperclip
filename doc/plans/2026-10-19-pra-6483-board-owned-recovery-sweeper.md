# PRA-6483 — Return or expire stale board-owned recovery actions

Follow-up to PRA-6474 (option 2 of the proposed fix). PRA-6474 made an
*orphaned* board-owned recovery action resolvable by any agent, which recovers
the stuck set but does not stop it recurring. This change adds the sweeper and
the promotion-time guard that keep the set from growing.

## What was wrong

`issue_recovery_actions` rows with `status='active'` and `owner_type='board'`
have `owner_agent_id IS NULL`. The recovery gate
(`assertRecoveryActionAuthority`) passes only when the actor is the issue
assignee or `ownerAgentId`; a null owner matches nobody. A park therefore waits
forever, and nothing in `recoveryService` ever revisited it.

Live census at 2026-10-19T18:15Z (COO): 27 active actions, 20 board-owned, all
with `owner_user_id IS NULL`, 14 of them already carrying
`return_owner_agent_id`, oldest 2026-09-15.

## Decision

A single sweeper over `status='active' AND owner_type='board'`, run at startup
and once per `heartbeatSchedulerIntervalMs` alongside the existing recovery
sweeps. Per row, in this order:

1. **Named human owner (`owner_user_id` set) — never return or expire.** If the
   issue has no pending interaction, record one so the named human is actually
   asked.
2. **Open board interaction — skip.** A `pending` `issue_thread_interactions`
   row on the source issue means the board is being asked; expiring or
   reassigning under it is the same bug in reverse.
3. **Return to the recorded return owner.** When `return_owner_agent_id` points
   at an agent in the same company that is invokable *and* can write the source
   issue (unassigned, or already assignee), transfer the action
   (`owner_type='agent'`, `owner_agent_id=<return owner>`) with a CAS on
   `owner_type='board'`, then wake that agent once with
   `idempotencyKey=board_recovery_action_returned:<actionId>:<attemptCount>`.
   Return is strictly better than expire: the work resumes with an owner who
   can act, and no resolve-validator judgement call is needed.
4. **Expire after N days** (`PAPERCLIP_BOARD_RECOVERY_ACTION_MAX_AGE_DAYS`,
   default 7, clamped 1..90). Resolve the action as
   `status='resolved'`, `outcome='false_positive'` with a resolution note naming
   the sweep, and restore the source issue to the pre-park status recorded in
   `evidence.previousStatus` when that is `backlog`/`todo`/`in_review`,
   otherwise `todo`. Terminal issues are left untouched. Never auto-`done`: a
   timer cannot know the work is finished, and closing real work is worse than
   a visible park. The restore write uses a status CAS, so a concurrent
   transition makes the row skip rather than overwrite.
5. **Otherwise (fresh, no owner, no return owner) — record the board question**
   with idempotency key `board_recovery_action:<actionId>:<attemptCount>`.

Root cause: `ensureSourceScopedStrandedRecoveryAction` now calls the same
question helper whenever a promotion lands on `owner_type='board'` with no
`owner_user_id`. A promotion can no longer create an action that names nobody
and asks nobody.

The sweep is capped at 200 rows per run and ordered `created_at ASC`, so the
stalest parks drain first and the age bound actually converges.

## Acceptance mapping

| Acceptance criterion | Where |
| --- | --- |
| Active board-owned count bounded (no row older than N days without an open interaction) | `sweepBoardOwnedRecoveryActions` steps 3–5 |
| Board-owned action created without an owner gets a named human or an interaction within one sweep interval | promotion hook + sweeper step 5 |
| Unit test: return-to-return-owner | `returns a board-owned action to a live return owner and wakes it once` |
| Unit test: expire-without-return-owner | `expires an old board-owned action with no return owner and restores the issue` |
| Unit test: named-human-with-open-interaction skip | `never expires or returns a named-human action that has an open board interaction` |
| Extra: promotion-time question, fresh ownerless question, non-writable return owner | three further tests in the same file |

## Dedupe note (COO's second data point)

The requested dedupe key on `(source_issue_id, fingerprint)` already exists:
`issue_recovery_actions_active_fingerprint_uq` is a partial unique index on
`(company_id, source_issue_id, cause, fingerprint) WHERE status IN
('active','escalated')`, and `upsertSourceScoped` returns the existing row
instead of minting a second park. So a duplicate board ask for the *same issue*
cannot happen today.

The `PRA-6514` / `PRA-6446` case is a *cross-issue* duplicate: two source
issues with the same subject. The fingerprint from
`strandedRecoveryActionFingerprint` embeds the source issue id, so a
source-scoped key can never catch it. Suppressing it needs a normalized
cross-issue fingerprint (subject/kind without the issue id) and a product call
about intentional duplicates — deliberately out of scope here and not silently
half-implemented.

## Files changed

- `server/src/services/issue-recovery-actions.ts`
  - `listActiveBoardOwned({companyId?, limit?})` — oldest first
  - `returnToAgent({companyId, sourceIssueId, actionId, agentId})` — CAS on
    `owner_type='board'`, sets `owner_type='agent'` and a `wake_owner` policy
- `server/src/services/recovery/service.ts`
  - `sweepBoardOwnedRecoveryActions({now?, companyId?, maxAgeDays?, limit?})`
  - `ensureBoardOwnedRecoveryActionQuestion` + promotion-time hook in
    `ensureSourceScopedStrandedRecoveryAction`
  - `expireBoardOwnedRecoveryAction` (transactional status restore + resolve)
  - activity events `issue.recovery_action_returned` /
    `issue.recovery_action_expired`
- `server/src/services/heartbeat.ts` — `sweepBoardOwnedRecoveryActions` wrapper
- `server/src/index.ts` — startup + periodic invocation
- `server/src/__tests__/recovery-board-owned-sweep.test.ts` — 6 tests

## Verification

```sh
cd server && npx vitest run src/__tests__/recovery-board-owned-sweep.test.ts
cd server && npx tsc --noEmit -p tsconfig.json
```

Adjacent suites re-run green: `issue-recovery-actions.test.ts`,
`recovery-stale-issue-lock-sweep.test.ts`,
`issue-agent-mutation-ownership-routes.test.ts`.

## Rollout

The control plane runs from the installed `paperclipai` package
(`~/.paperclip/cli/current`), not from this workspace, so nothing changes until
a release containing this branch is installed and the server restarted. This
branch is stacked on `pra-6474/board-owned-recovery-actions` (the PRA-6474
route change) because it consumes the same recovery-action store.

Expected first live sweep against current data: 14 rows returned to their
recorded return owner and woken once; the 6 without a return owner get a board
question (age < 7 days) or expire (older), subject to the interaction skip.

## Non-goals

- Cross-issue duplicate detection (see dedupe note)
- Bulk board resolve endpoint
- Changing the PRA-6474 route-level authority rules
