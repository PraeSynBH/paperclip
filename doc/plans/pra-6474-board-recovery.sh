#!/usr/bin/env bash
# PRA-6474 — board-user procedure for orphaned board-owned recovery actions.
#
# Why this exists: issue_recovery_actions rows with owner_type='board' and
# owner_agent_id IS NULL have no owner id for the resolve route to authorize
# against. Until the PRA-6474 server fix is deployed, no agent can resolve them
# and the issues behind them cannot be moved. A board user can; this script does
# the whole set in one pass.
#
# Usage (dry run — prints what it would do, changes nothing):
#   ./pra-6474-board-recovery.sh
#
# Usage (execute — needs a board credential):
#   PAPERCLIP_BOARD_TOKEN=... ./pra-6474-board-recovery.sh --execute
#
# Options:
#   --rollup-status done|todo   Where heartbeat/status rollups land (default: done)
#   --include-agent-owned       Also resolve agent-owned rows (normally left to
#                               their owner; those are resolvable by their agent)
#   --plan PATH                 Alternate plan file (default: alongside this script)
#
# Environment:
#   PAPERCLIP_API_BASE          Default http://macbook.praesyn.int:3100/api
#   PAPERCLIP_BOARD_TOKEN       Board bearer token; required only with --execute
#
# Regenerate the plan file with:
#   psql -h 127.0.0.1 -p 54329 -U paperclip -d paperclip -t -A -F'|' -c "
#     select ra.id, ra.source_issue_id, i.identifier, ra.owner_type,
#            case when i.title ~* '(heartbeat|status) *(—+|--) *PraeSyn'
#                 then 'rollup' else 'real_work' end,
#            i.status, ra.attempt_count,
#            replace(left(coalesce(i.title,''),58),'|','/')
#     from issue_recovery_actions ra join issues i on i.id = ra.source_issue_id
#     where ra.company_id='44c1cd6d-01eb-43fa-adbb-267b83d99a15' and ra.status='active'
#     order by 4,5,i.status,i.identifier;" > pra-6474-board-actions.psv
#
# The resolve call is idempotent in effect: if another actor already cleared an
# action, the row disappears from the next census. A 404 ("Active recovery action
# not found") is therefore reported as ALREADY, not FAIL.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLAN="$HERE/pra-6474-board-actions.psv"
API_BASE="${PAPERCLIP_API_BASE:-http://macbook.praesyn.int:3100/api}"
ROLLUP_STATUS="done"
EXECUTE=0
INCLUDE_AGENT_OWNED=0

while [ $# -gt 0 ]; do
  case "$1" in
    --execute) EXECUTE=1 ;;
    --rollup-status)
      ROLLUP_STATUS="${2:-}"; shift
      case "$ROLLUP_STATUS" in done|todo) ;; *) echo "invalid --rollup-status: $ROLLUP_STATUS" >&2; exit 2;; esac
      ;;
    --include-agent-owned) INCLUDE_AGENT_OWNED=1 ;;
    --plan)
      PLAN="${2:-}"; shift
      ;;
    -h|--help) sed -n '2,45p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

[ -f "$PLAN" ] || { echo "plan file not found: $PLAN" >&2; exit 2; }
if [ "$EXECUTE" = 1 ] && [ -z "${PAPERCLIP_BOARD_TOKEN:-}" ]; then
  echo "REFUSING: --execute needs PAPERCLIP_BOARD_TOKEN (a board credential)." >&2
  exit 2
fi

ok=0; already=0; failed=0; skipped=0
body_file="$(mktemp "${TMPDIR:-/tmp}/pra6474-resolve.XXXXXX")"
trap 'rm -f "$body_file"' EXIT

while IFS='|' read -r action_id issue_id identifier owner_type klass status attempts title; do
  [ -z "${action_id:-}" ] && continue

  if [ "$owner_type" != "board" ] && [ "$INCLUDE_AGENT_OWNED" = 0 ]; then
    printf 'SKIP     %-9s agent-owned (its agent owner can resolve it)  status=%s\n' "$identifier" "$status"
    skipped=$((skipped + 1)); continue
  fi

  if [ "$klass" = "rollup" ]; then
    target="$ROLLUP_STATUS"
    note="PRA-6474: orphaned board-owned action on a heartbeat/status rollup; cleared so the rollup stops blocking the board."
  else
    target="todo"
    note="PRA-6474: orphaned board-owned action (no agent or human owner) cleared; issue returned to the queue."
  fi

  payload=$(printf '{"actionId":"%s","outcome":"restored","sourceIssueStatus":"%s","resolutionNote":"%s"}' \
    "$action_id" "$target" "$note")

  if [ "$EXECUTE" = 0 ]; then
    printf 'DRY      %-9s %-9s %-7s -> restored/%s\n' "$identifier" "$klass" "$status" "$target"
    ok=$((ok + 1)); continue
  fi

  code=$(curl -sS -o "$body_file" -w '%{http_code}' \
    -X POST "$API_BASE/issues/$issue_id/recovery-actions/resolve" \
    -H "Authorization: Bearer $PAPERCLIP_BOARD_TOKEN" \
    -H "Content-Type: application/json" \
    --data-binary "$payload")

  case "$code" in
    200)
      printf 'OK       %-9s %-9s %-7s -> restored/%s\n' "$identifier" "$klass" "$status" "$target"
      ok=$((ok + 1))
      ;;
    404)
      printf 'ALREADY  %-9s action no longer active\n' "$identifier"
      already=$((already + 1))
      ;;
    *)
      printf 'FAIL     %-9s HTTP %s  %s\n' "$identifier" "$code" "$(head -c 200 "$body_file")"
      failed=$((failed + 1))
      ;;
  esac
done < "$PLAN"

echo
if [ "$EXECUTE" = 0 ]; then
  echo "DRY RUN: would resolve $ok, skip $skipped (agent-owned). Re-run with --execute and a board token."
else
  echo "DONE: resolved $ok, already cleared $already, failed $failed, skipped $skipped (agent-owned)."
fi
[ "$failed" = 0 ]
