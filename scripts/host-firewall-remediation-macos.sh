#!/bin/bash
#
# host-firewall-remediation-macos.sh
# RBR-106 — Enable macOS application (host) firewall on non-compliant devices.
#
# Drata reports 92 macOS devices failing the "Host firewall enabled" control
# (A.8.1 endpoint protection, ISO 27001:2022). This script enables the OS-level
# Application Firewall (socketfilterfw) and writes a structured result record
# to the Aira evidence directory.
#
# Usage (run locally or via MDM as root):
#   sudo bash scripts/host-firewall-remediation-macos.sh
#
# Exit codes:
#   0  Firewall enabled (or already enabled) and verified.
#   1  Could not obtain root privileges.
#   2  socketfilterfw binary missing (unsupported macOS).
#   3  Firewall state could not be verified post-change.
#   4  socketfilterfw returned a non-zero exit code during remediation.
#
# Idempotent: safe to run multiple times. The script never disables a working
# firewall and never touches existing allow/block rules.
#
# Output: writes data/evidence/host-firewall-macos-<hostname>-<utc>.json

set -euo pipefail

readonly SCRIPT_NAME="host-firewall-remediation-macos"
readonly FW_BIN="/usr/libexec/ApplicationFirewall/socketfilterfw"
readonly EVIDENCE_DIR="${EVIDENCE_DIR:-data/evidence}"
readonly LOG_PREFIX="[${SCRIPT_NAME}]"

log()  { printf '%s %s\n' "${LOG_PREFIX}" "$*" >&2; }
fail() { log "ERROR: $*"; exit "${2:-1}"; }

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    fail "must run as root (use sudo)" 1
  fi
}

detect_macos() {
  if [ "$(uname -s)" != "Darwin" ]; then
    fail "this script targets macOS only; detected $(uname -s)" 2
  fi
  if [ ! -x "${FW_BIN}" ]; then
    fail "socketfilterfw not found at ${FW_BIN}" 2
  fi
}

read_fw_state() {
  local out
  out=$(${FW_BIN} --getglobalstate 2>/dev/null || true)
  if [ -z "${out}" ]; then echo "unknown"; return; fi
  if echo "${out}" | grep -qiE 'State = 1|is enabled\.|is on\.$'; then echo "on"
  elif echo "${out}" | grep -qiE 'State = 0|is disabled\.|is off\.$'; then echo "off"
  else echo "unknown"; fi
}

read_stealth_state() {
  local out
  out=$(${FW_BIN} --getstealthmode 2>/dev/null || true)
  if [ -z "${out}" ]; then echo "unknown"; return; fi
  if echo "${out}" | grep -qiE 'is on$|is enabled'; then echo "on"
  elif echo "${out}" | grep -qiE 'is off$|is disabled'; then echo "off"
  else echo "unknown"; fi
}

read_blockall_state() {
  local out
  out=$(${FW_BIN} --getblockall 2>/dev/null || true)
  if [ -z "${out}" ]; then echo "unknown"; return; fi
  if echo "${out}" | grep -qiE 'enabled'; then echo "on"
  elif echo "${out}" | grep -qiE 'disabled'; then echo "off"
  else echo "unknown"; fi
}

# Modern macOS exposes logging via --getloggingmode on 13.4+ only.
# We probe first and gracefully skip on older releases.
read_logging_state() {
  if ! ${FW_BIN} --getloggingmode >/dev/null 2>&1; then
    echo "unsupported"
    return
  fi
  local out
  out=$(${FW_BIN} --getloggingmode 2>/dev/null || true)
  if [ -z "${out}" ]; then echo "unknown"; return; fi
  if echo "${out}" | grep -qiE 'is on$|is enabled'; then echo "on"
  elif echo "${out}" | grep -qiE 'is off$|is disabled'; then echo "off"
  else echo "unknown"; fi
}

verify_enabled() {
  local state
  state=$(read_fw_state)
  if [ "${state}" != "on" ]; then
    fail "firewall global state is '${state}', expected 'on'" 3
  fi
}

main() {
  require_root
  detect_macos

  log "collecting pre-remediation firewall state"
  local before_global before_stealth before_blockall before_logging
  before_global=$(read_fw_state)
  before_stealth=$(read_stealth_state)
  before_blockall=$(read_blockall_state)
  before_logging=$(read_logging_state)
  log "global=${before_global} stealth=${before_stealth} blockall=${before_blockall} logging=${before_logging}"

  local changed=0

  if [ "${before_global}" != "on" ]; then
    log "enabling application firewall (global state)"
    if ! ${FW_BIN} --setglobalstate on >/dev/null 2>&1; then
      fail "socketfilterfw --setglobalstate on returned non-zero" 4
    fi
    changed=1
  else
    log "global state already enabled — no change"
  fi

  if [ "${before_stealth}" != "on" ]; then
    log "enabling stealth mode (drops unsolicited probes)"
    ${FW_BIN} --setstealthmode on >/dev/null 2>&1 || log "warning: stealth mode change failed (non-fatal)"
    changed=1
  fi

  if [ "${before_logging}" != "on" ] && [ "${before_logging}" != "enabled" ] && [ "${before_logging}" != "unsupported" ]; then
    log "enabling firewall logging (Drata evidence)"
    if ${FW_BIN} --setloggingmode on >/dev/null 2>&1; then
      changed=1
    else
      log "warning: logging mode change not supported on this macOS release (non-fatal)"
    fi
  elif [ "${before_logging}" = "unsupported" ]; then
    log "logging mode probe not supported on this macOS release — skipping"
  fi

  verify_enabled

  log "post-remediation verification"
  local after_global after_stealth after_blockall after_logging
  after_global=$(read_fw_state)
  after_stealth=$(read_stealth_state)
  after_blockall=$(read_blockall_state)
  after_logging=$(read_logging_state)
  log "global=${after_global} stealth=${after_stealth} blockall=${after_blockall} logging=${after_logging}"

  local hostname utc result compliant
  hostname=$(scutil --get ComputerName 2>/dev/null || hostname)
  utc=$(date -u +%Y%m%dT%H%M%SZ)
  mkdir -p "${EVIDENCE_DIR}"
  local out="${EVIDENCE_DIR}/host-firewall-macos-${hostname}-${utc}.json"

  if [ "${after_global}" = "on" ]; then compliant=true; else compliant=false; fi

  cat > "${out}" <<JSON
{
  "script": "${SCRIPT_NAME}",
  "host": "${hostname}",
  "completedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "ranAsRoot": true,
  "before": {
    "globalState": "${before_global}",
    "stealthMode": "${before_stealth}",
    "blockAll": "${before_blockall}",
    "loggingMode": "${before_logging}"
  },
  "after": {
    "globalState": "${after_global}",
    "stealthMode": "${after_stealth}",
    "blockAll": "${after_blockall}",
    "loggingMode": "${after_logging}"
  },
  "changed": ${changed},
  "compliant": ${compliant},
  "exitCode": 0
}
JSON

  log "wrote evidence: ${out}"
  if [ "${changed}" -eq 1 ]; then
    log "DONE — firewall enabled, agent will report new state to Drata within 24h"
  else
    log "DONE — firewall was already enabled (no change applied)"
  fi
}

main "$@"
