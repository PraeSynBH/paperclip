#!/usr/bin/env bash
# rbr431-verify-evidence-scope.sh
# Verifies the Drata API key has the evidence-post write scope enabled.
# Run this AFTER the human has added evidence-post scope in Drata UI.
#
# RBR-431 — Upgrade Drata API key with evidence-post write scope
# Author: Compliance agent (fdd2c995)
# Date: 2026-07-11

set -euo pipefail

DRATA_BASE="${DRATA_BASE_URL:-https://public-api.drata.com/public/v2}"
DRATA_KEY="${DRATA_API_KEY:-${DRATA_EVIDENCE_WRITE_TOKEN:-}}"
DRATA_WS_ID="${DRATA_WORKSPACE_ID:-1}"

if [[ -z "$DRATA_KEY" ]]; then
  echo "ERROR: DRATA_API_KEY (or DRATA_EVIDENCE_WRITE_TOKEN) is not set." >&2
  echo "       Export the rotated/upgraded key first, then re-run." >&2
  exit 2
fi

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
blue()  { printf '\033[34m%s\033[0m\n' "$*"; }
yellow_warn() { printf '\033[33m%s\033[0m\n' "$*"; }

key_tail="${DRATA_KEY: -4}"
blue "[RBR-431] Verifying Drata API key ...${key_tail}"
blue "[RBR-431] Base URL: $DRATA_BASE"
blue "[RBR-431] Workspace ID: $DRATA_WS_ID"

echo
blue "── Probe 1: GET /workspaces (read scope baseline) ──"
read_status=$(/usr/bin/curl -s -o /tmp/rbr431_read.json -w "%{http_code}" \
  -H "Authorization: Bearer $DRATA_KEY" \
  "$DRATA_BASE/workspaces")
if [[ "$read_status" == "200" ]]; then
  green "  PASS — read scope intact (HTTP 200)"
else
  red   "  FAIL — read scope broken (HTTP $read_status). Key invalid or revoked."
  /bin/cat /tmp/rbr431_read.json 2>/dev/null || true
  exit 1
fi

echo
blue "── Probe 2: POST /workspaces/{id}/evidence (write scope target) ──"
probe_payload='{
  "name": "RBR-431 scope probe",
  "description": "Temporary probe to confirm evidence-post scope is active. Will be deleted if write succeeds.",
  "controlId": 1
}'
write_status=$(/usr/bin/curl -s -o /tmp/rbr431_write.json -w "%{http_code}" \
  -H "Authorization: Bearer $DRATA_KEY" \
  -H "Content-Type: application/json" \
  -X POST "$DRATA_BASE/workspaces/$DRATA_WS_ID/evidence" \
  -d "$probe_payload")

write_body=$(/bin/cat /tmp/rbr431_write.json 2>/dev/null || true)

case "$write_status" in
  200|201)
    green "  PASS — evidence-post scope ACTIVE (HTTP $write_status)"
    echo
    blue "── Cleanup: delete probe evidence ──"
    probe_id=$(printf '%s' "$write_body" | /usr/bin/python3 -c "import sys,json; d=json.load(sys.stdin); print((d.get('data') or {}).get('id') or d.get('id') or '')" 2>/dev/null || true)
    if [[ -n "$probe_id" ]]; then
      del_status=$(/usr/bin/curl -s -o /dev/null -w "%{http_code}" \
        -H "Authorization: Bearer $DRATA_KEY" \
        -X DELETE "$DRATA_BASE/workspaces/$DRATA_WS_ID/evidence/$probe_id")
      if [[ "$del_status" =~ ^2 ]]; then
        green "  Probe evidence $probe_id deleted."
      else
        yellow_warn "  Could not delete probe (HTTP $del_status). Remove manually from Drata UI."
      fi
    else
      yellow_warn "  Probe created but ID not extractable. Remove manually from Drata UI if needed."
    fi
    echo
    green "────────────────────────────────────────"
    green "  RBR-431 VERIFICATION: PASS"
    green "  evidence-post scope confirmed active."
    green "  RBR-54 (Track 1b evidence upload) is unblocked."
    green "────────────────────────────────────────"
    exit 0
    ;;
  403)
    red   "  FAIL — still missing evidence-post scope (HTTP 403)"
    echo "        $write_body"
    echo
    echo "  Likely cause: API key was rotated but the new key still does not have"
    echo "                'evidence-post' scope, OR the Drata admin granted the"
    echo "                scope on the old key (ending 354f) but the script is using"
    echo "                a different key."
    echo
    echo "  Next step: confirm the new key was saved into:"
    echo "    - AWS Secrets Manager: aria/secrets (DRATA_API_KEY secret)"
    echo "    - local .env: DRATA_API_KEY"
    echo "  And that the key's scope list in Drata UI includes 'evidence-post'."
    exit 1
    ;;
  401)
    red   "  FAIL — authentication error (HTTP 401). Key invalid or revoked."
    echo "        $write_body"
    exit 1
    ;;
  *)
    red   "  UNEXPECTED — HTTP $write_status"
    echo "        $write_body"
    exit 1
    ;;
esac
