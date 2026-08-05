#!/usr/bin/env bash
# RBR-791: measure board-queue depth (pending issue-thread interactions) and
# split it into decisions that are still answerable vs. exhaust pending on
# issues that are already done/cancelled.
#
# Usage:
#   PAPERCLIP_API_URL=... PAPERCLIP_API_KEY=... \
#     ./scripts/report-board-queue-depth.sh <companyId> [outfile.tsv]
#
# Emits a summary to stdout and, if outfile is given, a TSV of
#   issueId<TAB>identifier<TAB>issueStatus<TAB>pendingCount
set -euo pipefail

company_id="${1:?usage: report-board-queue-depth.sh <companyId> [outfile.tsv]}"
outfile="${2:-}"

api="${PAPERCLIP_API_URL%/}"
case "$api" in */api) ;; *) api="$api/api" ;; esac

auth=(-H "Authorization: Bearer ${PAPERCLIP_API_KEY:?PAPERCLIP_API_KEY is required}")

issues_tsv="$(mktemp)"
pending_tsv="${outfile:-$(mktemp)}"
trap 'rm -f "$issues_tsv"' EXIT
: > "$pending_tsv"

curl -sS "$api/companies/$company_id/issues?limit=1000" "${auth[@]}" \
  | jq -r 'if type=="array" then . else (.issues // .data // .items) end
           | .[] | "\(.id)\t\(.identifier)\t\(.status)"' > "$issues_tsv"

while IFS=$'\t' read -r id identifier status; do
  count="$(curl -sS "$api/issues/$id/interactions" "${auth[@]}" \
    | jq -r '[.[]? | select(.status == "pending")] | length' 2>/dev/null || echo 0)"
  [ -z "$count" ] && count=0
  [ "$count" = "0" ] && continue
  printf '%s\t%s\t%s\t%s\n' "$id" "$identifier" "$status" "$count" >> "$pending_tsv"
done < "$issues_tsv"

awk -F'\t' '
  {
    total += $4
    if ($3 == "done" || $3 == "cancelled") { dead += $4; deadIssues++ }
    else { live += $4; liveIssues++ }
  }
  END {
    printf "issues with pending asks : %d\n", NR
    printf "total pending asks       : %d\n", total
    printf "  answerable (open)      : %d across %d issues\n", live + 0, liveIssues + 0
    printf "  exhaust (done/cancel)  : %d across %d issues\n", dead + 0, deadIssues + 0
    if (total > 0) printf "  exhaust share          : %.1f%%\n", (dead * 100.0) / total
  }
' "$pending_tsv"

if [ -n "$outfile" ]; then
  echo "per-issue detail written to $outfile"
fi
