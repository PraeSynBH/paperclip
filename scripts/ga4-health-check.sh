#!/usr/bin/env bash
set -euo pipefail

# ── GA4 Analytics Health Check ─────────────────────────────────────────
# Monitors GA4 Measurement Protocol endpoint reachability and config
# validity.  Intended for cron-based periodic checks.
#
# Usage:
#   # Quick check (default output)
#   ./scripts/ga4-health-check.sh
#
#   # Verbose mode — show curl details and event response
#   VERBOSE=1 ./scripts/ga4-health-check.sh
#
#   # Send a test event to validate the full pipeline (requires valid keys)
#   SEND_TEST=1 ./scripts/ga4-health-check.sh
#
# Required env vars (read from environment or .env):
#   GA4_MEASUREMENT_ID     — GA4 measurement / stream ID (e.g. G-XXXXXXXXXX)
#   GA4_API_SECRET          — GA4 Measurement Protocol API secret
#   GA4_ENABLED             — set to "true" to enable
#
# Exit codes:
#   0 — healthy / disabled with valid config
#   1 — misconfigured (missing measurement ID or secret)
#   2 — unreachable (GA4 endpoint did not respond)
#   3 — test event failed (SEND_TEST mode)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ── Load .env if present ──────────────────────────────────────────────
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$REPO_ROOT/.env"
  set +a
fi

MEASUREMENT_ID="${GA4_MEASUREMENT_ID:-}"
API_SECRET="${GA4_API_SECRET:-}"
ENABLED="${GA4_ENABLED:-false}"

# ── Config validation ──────────────────────────────────────────────────
if [[ "$ENABLED" != "true" ]]; then
  echo "GA4 health-check: DISABLED (GA4_ENABLED != true)"
  exit 0
fi

if [[ -z "$MEASUREMENT_ID" || -z "$API_SECRET" ]]; then
  echo "GA4 health-check: MISCONFIGURED — missing GA4_MEASUREMENT_ID or GA4_API_SECRET"
  exit 1
fi

echo "GA4 health-check: configured (measurement ID: ${MEASUREMENT_ID})"

# ── Endpoint connectivity test ─────────────────────────────────────────
GA4_URL="https://www.google-analytics.com/debug/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}"

CURL_ARGS=(--silent --max-time 10 --output /tmp/ga4-health-check.$$.out --write-out "%{http_code}")
[[ "${VERBOSE:-0}" == "1" ]] && CURL_ARGS+=(--verbose)

HTTP_CODE=$(curl "${CURL_ARGS[@]}" \
  -H "Content-Type: application/json" \
  -d '{"client_id":"ga4-health-check","events":[{"name":"health_check","params":{"source":"cron","version":"1"}}]}' \
  "$GA4_URL" 2>/dev/null || echo "000")

RESP_BODY=""
if [[ -f "/tmp/ga4-health-check.$$.out" ]]; then
  RESP_BODY=$(cat "/tmp/ga4-health-check.$$.out")
  rm -f "/tmp/ga4-health-check.$$.out"
fi

if [[ "$HTTP_CODE" == "000" ]]; then
  echo "GA4 health-check: UNREACHABLE — curl failed (network issue or timeout)"
  exit 2
fi

if [[ "$HTTP_CODE" != "2"* ]]; then
  echo "GA4 health-check: ERROR — HTTP ${HTTP_CODE}"
  [[ -n "$RESP_BODY" ]] && echo "  response: ${RESP_BODY}"
  exit 2
fi

echo "GA4 health-check: REACHABLE (HTTP ${HTTP_CODE})"

# ── Optional test event (full pipeline validation) ────────────────────
if [[ "${SEND_TEST:-0}" == "1" ]]; then
  echo "GA4 health-check: sending test event to production endpoint..."

  PROD_URL="https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}"

  TEST_CODE=$(curl --silent --max-time 10 --output /dev/null --write-out "%{http_code}" \
    -H "Content-Type: application/json" \
    -d '{"client_id":"ga4-health-check","events":[{"name":"health_check_test","params":{"source":"cron","version":"1"}}]}' \
    "$PROD_URL" 2>/dev/null || echo "000")

  if [[ "$TEST_CODE" != "2"* ]]; then
    echo "GA4 health-check: TEST EVENT FAILED (HTTP ${TEST_CODE})"
    exit 3
  fi
  echo "GA4 health-check: TEST EVENT ACCEPTED (HTTP ${TEST_CODE})"
fi

echo "GA4 health-check: OK"
exit 0