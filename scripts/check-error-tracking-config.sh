#!/bin/bash
# CI guard: V8 Error Tracking configuration check per RAM-311 §4.4.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EXIT=0
fail() { echo "  FAIL: $1"; EXIT=1; }
pass() { echo "  PASS: $1"; }

echo "=== V8 Error Tracking Config Check ==="

echo "Sentry:"
if grep -rn "sendDefaultPii" "$ROOT_DIR/server/src" "$ROOT_DIR/packages" "$ROOT_DIR/cli/src" 2>/dev/null | grep -v "sendDefaultPii.*false" | grep -v "\.test\." | grep -v "__tests__" | grep -v "node_modules" | grep -v "check-error-tracking" | head -1; then
  fail "sendDefaultPii must be false"
else pass "sendDefaultPii is false or absent"; fi

echo "Bugsnag:"
if grep -rn "collectUserIp" "$ROOT_DIR/server/src" "$ROOT_DIR/packages" "$ROOT_DIR/cli/src" 2>/dev/null | grep -v "collectUserIp.*false" | grep -v "\.test\." | grep -v "__tests__" | grep -v "node_modules" | grep -v "check-error-tracking" | head -1; then
  fail "collectUserIp must be false"
else pass "collectUserIp is false or absent"; fi

echo "Datadog:"
if grep -rn "defaultPrivacyLevel" "$ROOT_DIR/server/src" "$ROOT_DIR/packages" "$ROOT_DIR/cli/src" 2>/dev/null | grep -v "mask-user-input" | grep -v "mask" | grep -v "\.test\." | grep -v "__tests__" | grep -v "node_modules" | grep -v "check-error-tracking" | head -1; then
  fail 'defaultPrivacyLevel must be mask-user-input'
else pass 'defaultPrivacyLevel is mask-user-input or absent'; fi

echo "Replay/session rates:"
if grep -rn "sessionSampleRate\|sessionReplaySampleRate" "$ROOT_DIR/server/src" "$ROOT_DIR/packages" "$ROOT_DIR/cli/src" 2>/dev/null | grep -v "SampleRate.*0" | grep -v "\.test\." | grep -v "__tests__" | grep -v "node_modules" | grep -v "check-error-tracking" | head -1; then
  fail "session sample rates must be 0"
else pass "replay/session rates are 0 or absent"; fi

echo "Breadcrumbs:"
if grep -rn "maxBreadcrumbs" "$ROOT_DIR/server/src" "$ROOT_DIR/packages" "$ROOT_DIR/cli/src" 2>/dev/null | grep -v "\.test\." | grep -v "__tests__" | grep -v "node_modules" | grep -v "check-error-tracking" | sed -E 's/^[^:]+:[0-9]+:[[:space:]]*//' | grep -E 'maxBreadcrumbs\s*:\s*([6-9][0-9]|[0-9]{3,})' | head -1; then
  fail "maxBreadcrumbs must be <= 50"
else pass "maxBreadcrumbs is <= 50 or absent"; fi

echo ""
if [ "$EXIT" -eq 0 ]; then echo "  V8 check passed"; else echo "  V8 check FAILED"; fi
exit $EXIT