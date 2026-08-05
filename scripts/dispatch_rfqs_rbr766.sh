#!/usr/bin/env bash
#
# RBR-766 — dispatch the A-LIGN + Schellman ISO 27001 RFQs.
#
# This is the "single command" the issue asks for. It is deliberately
# gate-first: nothing leaves the building until `selftest` and `roundtrip`
# both prove we can send AND read on the dispatch address. An RFQ sent from
# a mailbox we cannot read is worse than no RFQ — the reply lands nowhere.
#
#   Usage:  ./scripts/dispatch_rfqs_rbr766.sh            # gate + dispatch
#           ./scripts/dispatch_rfqs_rbr766.sh --gate-only # prove readability only
#           ./scripts/dispatch_rfqs_rbr766.sh --dry-run   # show what would send
#
# Credential: COMPLIANCE_MAILBOX_PASSWORD must be present in the environment,
# injected by Paperclip from the company secret via secret_ref. This script
# never reads, prints, or persists the password. See docs/SECRETS.md.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAILBOX="$ROOT/scripts/compliance_mailbox.py"

# Dispatch artifacts live in the CISO agent workspace (RBR-758 package).
PKG="${RFQ_PACKAGE_DIR:-/Users/benh/.paperclip/instances/default/workspaces/aad16410-d617-4ef3-8534-cb81fd6a2e41/data/rbr-758-dispatch}"

export COMPLIANCE_MAILBOX_ADDRESS="${COMPLIANCE_MAILBOX_ADDRESS:-ben.hamilton@aira.io}"
export COMPLIANCE_MAILBOX_PROFILE="${COMPLIANCE_MAILBOX_PROFILE:-google}"
export COMPLIANCE_MAILBOX_DISPLAY_NAME="${COMPLIANCE_MAILBOX_DISPLAY_NAME:-Ben Hamilton, CISO — Aira (Rambur Inc.)}"

SUBJECT="ISO 27001:2022 Certification RFQ — Aira (Rambur Inc.)"

GATE_ONLY=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --gate-only) GATE_ONLY=1 ;;
    --dry-run)   DRY_RUN=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 64 ;;
  esac
done

# A-LIGN and Schellman intake addresses. Both CBs also run web contact forms;
# the cover-message .txt files are formatted to paste into those forms if
# email intake bounces.
ALIGN_TO="${ALIGN_TO:-info@a-lign.com}"
SCHELLMAN_TO="${SCHELLMAN_TO:-info@schellman.com}"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

# --------------------------------------------------------------------------
# Pre-flight: the artifacts must carry no unresolved template tokens.
# --------------------------------------------------------------------------
say "0. Pre-flight — unresolved template tokens"
if grep -rn '{{' "$PKG"/align-cover-message.txt "$PKG"/schellman-cover-message.txt \
       "$PKG"/align-rfq-pdftext.txt "$PKG"/schellman-rfq-pdftext.txt 2>/dev/null; then
  echo "ABORT: unresolved {{...}} token in a dispatch artifact." >&2
  exit 1
fi
for f in align-cover-message.txt align-rfq.pdf schellman-cover-message.txt schellman-rfq.pdf; do
  [ -s "$PKG/$f" ] || { echo "ABORT: missing or empty artifact $PKG/$f" >&2; exit 1; }
done
echo "ok — zero tokens, all 4 dispatch artifacts present"

# --------------------------------------------------------------------------
# THE GATE. No RFQ goes out on an address we have not proven we can read.
# --------------------------------------------------------------------------
say "1. Gate — selftest (IMAP + SMTP auth on $COMPLIANCE_MAILBOX_ADDRESS)"
python3 "$MAILBOX" selftest || {
  echo "ABORT: selftest failed. Nothing dispatched." >&2; exit 1; }

say "2. Gate — roundtrip (send-to-self, retrieve over IMAP)"
python3 "$MAILBOX" roundtrip || {
  echo "ABORT: roundtrip failed — cannot prove inbound is readable. Nothing dispatched." >&2
  exit 1; }

echo
echo "GATE PASSED — $COMPLIANCE_MAILBOX_ADDRESS is provably send- and read-capable."

if [ "$GATE_ONLY" = 1 ]; then
  echo "--gate-only set; stopping before dispatch."
  exit 0
fi

# --------------------------------------------------------------------------
# Dispatch. Message-IDs are printed and must be recorded on RBR-398.
# --------------------------------------------------------------------------
send_one() {
  local cb="$1" to="$2"
  say "3.$cb — dispatch to $to"
  if [ "$DRY_RUN" = 1 ]; then
    echo "[dry-run] would send \"$SUBJECT\" to $to"
    echo "[dry-run]   body:   $PKG/${cb}-cover-message.txt"
    echo "[dry-run]   attach: $PKG/${cb}-rfq.pdf"
    return 0
  fi
  python3 "$MAILBOX" send \
    --to "$to" \
    --subject "$SUBJECT" \
    --body-file "$PKG/${cb}-cover-message.txt" \
    --attach "$PKG/${cb}-rfq.pdf"
}

send_one align     "$ALIGN_TO"
send_one schellman "$SCHELLMAN_TO"

# --------------------------------------------------------------------------
# Activate the inbound watch. AC5 — replies must wake an agent, not sit unread.
# Installed here rather than earlier on purpose: before dispatch there is
# nothing to watch for, and a cron entry that fails every 30 minutes for days
# on a missing credential is noise, not monitoring.
# --------------------------------------------------------------------------
say "4. Activating inbound watch"
if [ "$DRY_RUN" = 1 ]; then
  echo "[dry-run] would install the inbound-watch cron entry"
else
  CRON_LINE="*/30 * * * * cd $ROOT && COMPLIANCE_MAILBOX_ADDRESS=$COMPLIANCE_MAILBOX_ADDRESS COMPLIANCE_MAILBOX_PROFILE=$COMPLIANCE_MAILBOX_PROFILE PAPERCLIP_API_URL=${PAPERCLIP_API_URL:-} PAPERCLIP_API_KEY=\${COMPLIANCE_WATCH_API_KEY} python3 scripts/watch_rfq_replies_rbr766.py --once >> $ROOT/data/evidence/rbr-766-watch.log 2>&1"
  if crontab -l 2>/dev/null | grep -q "watch_rfq_replies_rbr766"; then
    echo "inbound watch already installed in crontab — leaving it alone"
  else
    (crontab -l 2>/dev/null; echo "# RBR-766 inbound watch — A-LIGN / Schellman RFQ replies"; echo "$CRON_LINE") | crontab -
    echo "inbound watch installed (every 30 min)"
  fi
  # Prove it works right now rather than trusting the schedule.
  python3 "$ROOT/scripts/watch_rfq_replies_rbr766.py" --once || \
    echo "[warn] first watch poll failed — check $ROOT/data/evidence/rbr-766-watch.log"
fi

say "5. Record the Message-IDs"
cat <<'NEXT'
  Record both Message-IDs printed above on RBR-398 (AC4).
  Watch state:  data/evidence/rbr-766-inbound-watch-state.json
  Watch log:    data/evidence/rbr-766-watch.log
NEXT
