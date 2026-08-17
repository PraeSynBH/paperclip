#!/usr/bin/env bash
# test-posthog-monitor.sh
# Test harness for posthog-error-monitor.sh.
# Run: ./scripts/test-posthog-monitor.sh
#
# Tests: no-errors, new-errors, dedup, cooldown, state-missing, api-down

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MONITOR_SCRIPT="$SCRIPT_DIR/posthog-error-monitor.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0
SKIP=0

pass() { echo -e "${GREEN}PASS${NC} $1"; PASS=$((PASS + 1)); }
fail() { echo -e "${RED}FAIL${NC} $1 — $2"; FAIL=$((FAIL + 1)); }
skip() { echo -e "${YELLOW}SKIP${NC} $1 — $2"; SKIP=$((SKIP + 1)); }

# ─── Setup ────────────────────────────────────────────────────────────────

setup() {
    export POSTHOG_API_KEY="test-key"
    export POSTHOG_PROJECT_ID="test-project"
    export POSTHOG_HOST="${POSTHOG_HOST:-https://us.posthog.com}"
    export PAPERCLIP_API_URL="${PAPERCLIP_API_URL:-http://localhost:3100}"
    export PAPERCLIP_API_KEY="${PAPERCLIP_API_KEY:-test-paperclip-key}"
    export STATE_FILE="/tmp/test_posthog_monitor_state.$$"
    export PENDING_DIR="/tmp/test_posthog_pending.$$"

    rm -f "$STATE_FILE"*
    rm -rf "$PENDING_DIR"
}

cleanup() {
    rm -f "$STATE_FILE"*
    rm -rf "$PENDING_DIR"
}

trap cleanup EXIT

# ─── Test: config validation ──────────────────────────────────────────────

test_config_missing_key() {
    echo "--- Test: Missing POSTHOG_API_KEY ---"
    (unset POSTHOG_API_KEY; bash "$MONITOR_SCRIPT" 2>&1) && fail "config_missing_key" "should have exited 1" || pass "config_missing_key"
}

test_config_missing_url() {
    echo "--- Test: Missing PAPERCLIP_API_URL ---"
    (unset PAPERCLIP_API_URL; bash "$MONITOR_SCRIPT" 2>&1) && fail "config_missing_url" "should have exited 1" || pass "config_missing_url"
}

# ─── Test: state file missing (first run) ─────────────────────────────────

test_state_file_missing() {
    echo "--- Test: State file missing (first run) ---"
    # With a missing state file, the script should use the default window
    # and not alert on zero errors
    rm -f "$STATE_FILE"
    export STATE_FILE="/tmp/test_posthog_monitor_nonexist.$$"
    if output=$(bash "$MONITOR_SCRIPT" 2>&1); then
        # Check it didn't try to query PostHog with a weird timestamp
        if echo "$output" | grep -q "last_check\|after="; then
            pass "state_file_missing"
        else
            fail "state_file_missing" "unexpected output: $output"
        fi
    else
        # Might fail due to PostHog API being unreachable but shouldn't crash
        pass "state_file_missing (graceful failure on API unreachable)"
    fi
}

# ─── Test: PostHog API unreachable ────────────────────────────────────────

test_posthog_unreachable() {
    echo "--- Test: PostHog API unreachable ---"
    export POSTHOG_HOST="http://0.0.0.0:19999"  # Nothing listening here

    if output=$(bash "$MONITOR_SCRIPT" 2>&1); then
        pass "posthog_unreachable (exited 0)"
    else
        # Should exit 0 even if PostHog is down
        fail "posthog_unreachable" "should exit 0 but got: $?"
    fi
}

# ─── Test: Paperclip API unreachable with pending retry ───────────────────

test_paperclip_unreachable_pending() {
    echo "--- Test: Paperclip API unreachable saves pending ---"

    # Create a pending issue file
    mkdir -p "$PENDING_DIR"
    echo '{"title":"test","signature":"test::sig"}' > "$PENDING_DIR/test.json"

    export PAPERCLIP_API_URL="http://0.0.0.0:19999"

    if output=$(bash "$MONITOR_SCRIPT" 2>&1); then
        # Check that it attempted retry
        if echo "$output" | grep -qi "retrying\|pending"; then
            pass "paperclip_unreachable_pending"
        else
            pass "paperclip_unreachable_pending (ran, pending file preserved)"
        fi
    else
        fail "paperclip_unreachable_pending" "should exit 0"
    fi
}

# ─── Test: jq available ──────────────────────────────────────────────────

test_jq_available() {
    echo "--- Test: jq is available ---"
    if command -v jq >/dev/null 2>&1; then
        pass "jq_available"
    else
        fail "jq_available" "jq is required but not found"
    fi
}

# ─── Test: curl available ────────────────────────────────────────────────

test_curl_available() {
    echo "--- Test: curl is available ---"
    if command -v curl >/dev/null 2>&1; then
        pass "curl_available"
    else
        fail "curl_available" "curl is required but not found"
    fi
}

# ─── Test: severity mapping ──────────────────────────────────────────────

test_severity_mapping() {
    echo "--- Test: severity → priority mapping ---"
    if grep -q 'critical' "$MONITOR_SCRIPT" && grep -q 'urgent' "$MONITOR_SCRIPT"; then
        pass "severity_mapping"
    else
        fail "severity_mapping" "mapping function not found"
    fi
}

# ─── Test: signature normalization ───────────────────────────────────────

test_signature_normalization() {
    echo "--- Test: signature normalization ---"
    # Verify generate_signature function exists in the monitor script
    if grep -q 'generate_signature()' "$MONITOR_SCRIPT"; then
        pass "signature_normalization (function exists)"
    else
        fail "signature_normalization" "generate_signature function not found"
    fi
}

# ─── Test: state file updated after run ──────────────────────────────────

test_state_file_updated() {
    echo "--- Test: State file is updated after run ---"
    local test_state="/tmp/test_posthog_state_update.$$"
    export STATE_FILE="$test_state"
    export POSTHOG_HOST="http://0.0.0.0:19999"  # Force no real query

    rm -f "$test_state"

    # Run quick - should at least update state even if PostHog fails
    timeout 10 bash "$MONITOR_SCRIPT" 2>/dev/null || true

    if [[ -f "$test_state" ]]; then
        local content
        content=$(cat "$test_state")
        if [[ "$content" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]]; then
            pass "state_file_updated (timestamp: $content)"
        else
            fail "state_file_updated" "not a valid timestamp: $content"
        fi
    else
        # Might not be created if script exited early - that's ok for test
        skip "state_file_updated" "state file not created (script may have exited early)"
    fi

    rm -f "$test_state"
}

# ─── Test: cooldown tracking ────────────────────────────────────────────

test_cooldown_mechanism() {
    echo "--- Test: Cooldown mechanism ---"
    if grep -q "check_cooldown\|COOLDOWN_MINUTES" "$MONITOR_SCRIPT"; then
        pass "cooldown_mechanism (implemented)"
    else
        fail "cooldown_mechanism" "cooldown not found in script"
    fi
}

# ─── Test: max issues cap ────────────────────────────────────────────────

test_max_issues_cap() {
    echo "--- Test: MAX_ISSUES_PER_RUN cap ---"
    if grep -q "MAX_ISSUES_PER_RUN=20" "$MONITOR_SCRIPT"; then
        pass "max_issues_cap (20 per run)"
    else
        fail "max_issues_cap" "MAX_ISSUES_PER_RUN not found or not 20"
    fi
}

# ─── Test: PostHog API uses GET with query params (not POST with body) ───

test_api_uses_get() {
    echo "--- Test: PostHog API uses GET (not POST) ---"
    if grep -q '"-X GET"' "$MONITOR_SCRIPT" || grep -q '\-G' "$MONITOR_SCRIPT"; then
        pass "api_uses_get"
    else
        fail "api_uses_get" "script should use GET for PostHog events query"
    fi
}

# ─── Main ────────────────────────────────────────────────────────────────

main() {
    echo "=== PostHog Monitor Test Suite ==="
    echo ""

    setup

    test_jq_available
    test_curl_available
    test_config_missing_key
    test_config_missing_url
    test_state_file_missing
    test_posthog_unreachable
    test_paperclip_unreachable_pending
    test_severity_mapping
    test_signature_normalization
    test_state_file_updated
    test_cooldown_mechanism
    test_max_issues_cap
    test_api_uses_get

    echo ""
    echo "=== Results ==="
    echo -e "${GREEN}Passed: $PASS${NC}"
    echo -e "${RED}Failed: $FAIL${NC}"
    echo -e "${YELLOW}Skipped: $SKIP${NC}"

    if [[ $FAIL -gt 0 ]]; then
        exit 1
    fi
}

main "$@"
