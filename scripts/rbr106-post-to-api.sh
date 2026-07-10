#!/bin/bash
# RBR-106: Post host-firewall remediation artifacts and status update
# Execute this when Paperclip API auth is reachable.
#
# Created by run 4a448467-d381-413e-b5c6-2ee59fb0d8bf (SecOps) when the API
# returned 401 "Agent authentication required" mid-heartbeat. The firewall
# scripts themselves are already written, syntax-checked, and parser-tested
# against real socketfilterfw output. This script only updates Paperclip.
#
# Idempotent: the PATCH /api/issues/{id} call is safe to retry.

set -euo pipefail

API_URL="${PAPERCLIP_API_URL:-http://macbook.praesyn.int:3100}"
API_KEY="${PAPERCLIP_API_KEY:?PAPERCLIP_API_KEY not set}"
RUN_ID="${PAPERCLIP_RUN_ID:?PAPERCLIP_RUN_ID not set}"
COMPANY_ID="${PAPERCLIP_COMPANY_ID:-5cb37f67-a875-4073-ba4f-f8f942cb0775}"
AGENT_ID="${PAPERCLIP_AGENT_ID:-b0e771b4-0535-425d-b9b2-2df665f00e87}"
ISSUE_ID="${PAPERCLIP_TASK_ID:-05f4ae0e-8e19-46d0-b08a-6b80c12c7406}"

AUTH_HEADER="Authorization: Bearer $API_KEY"
RUN_HEADER="X-Paperclip-Run-Id: $RUN_ID"

echo "=== Step 1: Upload macOS remediation script as attachment ==="

curl -s --max-time 30 \
  -H "$AUTH_HEADER" \
  -H "$RUN_HEADER" \
  -F "file=@scripts/host-firewall-remediation-macos.sh" \
  "$API_URL/api/companies/$COMPANY_ID/issues/$ISSUE_ID/attachments" | python3 -m json.tool

echo ""
echo "=== Step 2: Upload Windows remediation script as attachment ==="

curl -s --max-time 30 \
  -H "$AUTH_HEADER" \
  -H "$RUN_HEADER" \
  -F "file=@scripts/host-firewall-remediation-windows.ps1" \
  "$API_URL/api/companies/$COMPANY_ID/issues/$ISSUE_ID/attachments" | python3 -m json.tool

echo ""
echo "=== Step 3: Upload MDM deployment guide as attachment ==="

curl -s --max-time 30 \
  -H "$AUTH_HEADER" \
  -H "$RUN_HEADER" \
  -F "file=@scripts/host-firewall-remediation-mdm.md" \
  "$API_URL/api/companies/$COMPANY_ID/issues/$ISSUE_ID/attachments" | python3 -m json.tool

echo ""
echo "=== Step 4: Post completion comment and move to in_review ==="

COMMENT=$(cat <<'MD'
## RBR-106: Host firewall remediation artifacts delivered

Three deliverables now exist in `scripts/` and are ready to deploy via MDM.

### Files delivered

- `scripts/host-firewall-remediation-macos.sh` (159 lines) — bash, runs as root, idempotent. Enables socketfilterfw global state, stealth mode, and logging on macOS. Writes per-host evidence JSON to `data/evidence/host-firewall-macos-<host>-<utc>.json`. Exit codes 0–4.
- `scripts/host-firewall-remediation-windows.ps1` (174 lines) — PowerShell, self-elevates. Enables all three firewall profiles (Domain/Private/Public), enforces default policies, enables dropped/allowed logging. Writes evidence to `data/evidence/host-firewall-windows-<host>-<utc>.json`. Exit codes 0–4.
- `scripts/host-firewall-remediation-mdm.md` (155 lines) — MDM deployment guide with Jamf, Kandji, Intune, and GPO procedures. Includes a fallback `.mobileconfig` payload for macOS profile-only deployment, scope filters, verification steps, and a triage path for the single Unknown-OS device.

### Scope from Drata diagnostic (`data/compliance-diagnostic.json`)

| OS | Failing | % of agent-installed |
|----|--------:|---------------------:|
| macOS | 92 | 77.3% (of 119) |
| Windows | 17 | 5.6% (of 305) |
| Unknown | 1 | 100% (of 1) |
| **Total** | **110** | **25.9% (of 425)** |

### Validation already done

- Both scripts pass `bash -n` / `pwsh -NoProfile -Command` syntax check.
- macOS parsers tested against live `socketfilterfw --getglobalstate`, `--getstealthmode`, `--getblockall` output (all return "off" on this harness, matching the 92-failure pattern).
- macOS `--getloggingmode` is unsupported on this macOS release; the script detects that and skips it non-fatally.
- PowerShell self-elevation path verified by static read of the script (cannot execute end-to-end without admin token).

### Next actions for a follow-up heartbeat / human

1. Upload the macOS script to Jamf (or Kandji) as a recurring-check-in script, scoped to the **Firewall - Non-Compliant** smart group.
2. Upload the PowerShell script to Intune as a Windows 10+ platform script, scoped to `firewallEnabled == false` device group.
3. Re-run `npx tsx src/drata/compliance-diagnostic.ts` after ≤ 24 h to confirm `aggregateControlFailure["Host firewall enabled"].failing` drops from 110 to ≤ 1.
4. Triage the 1 Unknown-OS failing device via `data/scripts/triage-unknown-devices.py` (already exists from RBR-108) and remediate with platform-appropriate firewall (`ufw` / `nftables`).

### ISO 27001 control

A.8.1 (endpoint protection) — host firewall required; this remediation closes the 110-device gap to bring the agent-installed fleet to full compliance for the "Host firewall enabled" Drata control.

### Status: in_review (artifacts ready, awaiting MDM upload by owner)

- Parent: [RBR-86](/RBR/issues/RBR-86)
MD
)

jq -n --arg body "$COMMENT" '{
  status: "in_review",
  comment: $body
}' | curl -s --max-time 30 \
  -H "$AUTH_HEADER" \
  -H "$RUN_HEADER" \
  -H "Content-Type: application/json" \
  -X PATCH "$API_URL/api/issues/$ISSUE_ID" \
  -d @- | python3 -m json.tool

echo ""
echo "=== Done ==="
