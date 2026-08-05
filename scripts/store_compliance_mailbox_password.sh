#!/usr/bin/env bash
#
# RBR-775 — one-command intake for the ben.hamilton@aira.io Google App Password.
#
# Collapses "generate an App Password" -> "prove the mailbox is send- AND
# read-capable" into a single interaction that never writes the secret to disk
# in cleartext, never puts it in argv, and never echoes it.
#
# Usage:
#   ./scripts/store_compliance_mailbox_password.sh
#
# The password is read from the terminal with echo off. It is NOT accepted as a
# command-line argument, because argv is visible to every process on the host
# via `ps` and is captured in shell history.
#
# Storage: macOS Keychain, service `aira-compliance-mailbox`, account
# `ben.hamilton@aira.io` — exactly the coordinates already documented in
# .env.example, so `COMPLIANCE_MAILBOX_PASSWORD_CMD` resolves with no further
# configuration.
#
# This is the LOCAL path. The production path is a Paperclip company secret
# named COMPLIANCE_MAILBOX_PASSWORD bound onto the CTO agent's
# adapterConfig.env as a secret_ref; see docs/SECRETS.md. Both resolve to the
# same value in scripts/compliance_mailbox.py — the local path exists so
# dispatch is not gated on board-console availability.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Overridable only so the test suite can use a throwaway service name and never
# touch the operator's real Keychain entry. Do not set this in normal use.
SERVICE="${COMPLIANCE_MAILBOX_KEYCHAIN_SERVICE:-aira-compliance-mailbox}"
ACCOUNT="${COMPLIANCE_MAILBOX_ADDRESS:-ben.hamilton@aira.io}"

say()  { printf '%s\n' "$*"; }
fail() { printf '[error] %s\n' "$*" >&2; exit 1; }

if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "This helper uses the macOS Keychain. On another host, set
  COMPLIANCE_MAILBOX_PASSWORD_CMD to your own credential helper, or store the
  value as the Paperclip company secret COMPLIANCE_MAILBOX_PASSWORD."
fi

command -v security >/dev/null 2>&1 || fail "macOS 'security' binary not found."

say "== Store the Google App Password for ${ACCOUNT}"
say ""
say "Get one at: https://myaccount.google.com/apppasswords"
say "  (2-Step Verification must be ON for that page to be reachable.)"
say "  App type: Mail. Google shows it as 4 groups of 4 characters."
say ""
say "Paste it below. Input is hidden. Spaces are stripped automatically."
say ""

# -s: no echo. -r: no backslash mangling. Read from the TTY, not stdin, so a
# stray pipe cannot silently feed this a value from a file.
if [[ ! -t 0 ]]; then
  fail "Refusing to read the password from a pipe or file — run this interactively."
fi

# Disable terminal echo BEFORE the prompt is printed, not just during `read`.
# `read -rs` only suppresses echo once it is already running; any keystrokes
# that arrive between `printf 'App Password: '` and `read` starting are echoed
# by the tty driver and land in the scrollback in cleartext. That window is
# small but real, and it is reliably hit by fast paste and by automation.
# Turning echo off at the driver level first closes it. The trap guarantees the
# terminal is restored even if we abort or are interrupted.
STTY_SAVE="$(stty -g)"
restore_tty() { stty "$STTY_SAVE" 2>/dev/null || stty echo 2>/dev/null || true; }
trap restore_tty EXIT INT TERM
stty -echo

printf 'App Password: '
IFS= read -r RAW
printf '\n'
printf 'Confirm:      '
IFS= read -r RAW2
printf '\n\n'

restore_tty
trap - EXIT INT TERM

# Google displays app passwords space-separated; the actual secret has no spaces.
PW="${RAW//[[:space:]]/}"
PW2="${RAW2//[[:space:]]/}"
unset RAW RAW2

[[ -n "$PW" ]] || fail "Empty input. Nothing stored."

if [[ "$PW" != "$PW2" ]]; then
  unset PW PW2
  fail "The two entries did not match. Nothing stored."
fi
unset PW2

# Shape check. Advisory, not fatal — Google's format could change, and a wrong
# guess here must never block a genuine credential. The selftest below is the
# real arbiter.
if [[ ${#PW} -ne 16 || ! "$PW" =~ ^[a-z]{16}$ ]]; then
  say "[warn] That does not look like a Google App Password (expected 16"
  say "       lowercase letters). If you pasted your normal account password,"
  say "       stop — that would be a policy violation and Google will reject it"
  say "       anyway. Continuing to the live selftest, which will settle it."
  say ""
fi

# Overwrite any previous entry (-U) and pass the value via -w on stdin-free
# form. `security` is invoked with the secret in argv here, which is the one
# unavoidable exposure; we minimise the window and immediately verify.
if ! security add-generic-password \
      -s "$SERVICE" -a "$ACCOUNT" -w "$PW" -U \
      -D "Aira compliance mailbox app password (RBR-775)" \
      -j "IMAP/SMTP app password for ISO 27001 vendor correspondence" 2>/dev/null; then
  unset PW
  fail "Keychain write failed. Nothing stored."
fi
unset PW

say "Stored in Keychain: service=${SERVICE} account=${ACCOUNT}"
say ""

# Prove the resolution path works without ever printing the value.
CMD="security find-generic-password -s ${SERVICE} -a ${ACCOUNT} -w"
if ! RESOLVED_LEN=$($CMD 2>/dev/null | tr -d '\n' | wc -c | tr -d ' '); then
  fail "Stored, but read-back failed. Check Keychain access."
fi
[[ "$RESOLVED_LEN" -gt 0 ]] || fail "Stored, but read-back returned empty."
say "Read-back OK (${RESOLVED_LEN} characters resolved; value not shown)."
say ""

say "== Live gate — selftest against ${ACCOUNT}"
say "   Proving the mailbox is both send- and read-capable. This is the same"
say "   gate scripts/dispatch_rfqs_rbr766.sh enforces before it transmits."
say ""

set +e
COMPLIANCE_MAILBOX_ADDRESS="$ACCOUNT" \
COMPLIANCE_MAILBOX_PASSWORD_CMD="$CMD" \
  python3 scripts/compliance_mailbox.py selftest
RC=$?
set -e

say ""
if [[ $RC -ne 0 ]]; then
  say "== selftest FAILED (exit ${RC})"
  say ""
  say "The credential is stored but does not authenticate. Most likely causes,"
  say "in order:"
  say "  1. Typo in the paste — re-run this script."
  say "  2. 2-Step Verification is off, so the App Password was never valid."
  say "  3. ${ACCOUNT} is not actually a login-capable mailbox. Note that"
  say "     Google returns 'Invalid credentials' both for a real mailbox with a"
  say "     wrong password AND for an address that does not exist, so this"
  say "     failure alone does not distinguish the two. To settle it:"
  say "         python3 scripts/compliance_mailbox.py probe ${ACCOUNT}"
  say "     If it is not a real mailbox, that is a Workspace admin fix."
  say ""
  say "Nothing has been dispatched. Re-run this script after correcting."
  exit "$RC"
fi

say "== selftest PASSED — mailbox is send- and read-capable."
say ""
say "Dispatch is now unblocked. To send both RFQs:"
say ""
say "    export COMPLIANCE_MAILBOX_PASSWORD_CMD=\"${CMD}\""
say "    ./scripts/dispatch_rfqs_rbr766.sh"
say ""
say "That runs the full gate (tokens -> selftest -> roundtrip), sends the A-LIGN"
say "and Schellman RFQs, activates the inbound reply watch, and prints both"
say "Message-IDs."
say ""
say "Still worth doing for durability: store the same value as the Paperclip"
say "company secret COMPLIANCE_MAILBOX_PASSWORD and bind it onto the CTO"
say "agent's adapterConfig.env as a secret_ref, so unattended agent runs can"
say "resolve it too. The Keychain entry only covers this host."
