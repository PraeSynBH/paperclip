#!/usr/bin/env bash
# posthog-error-monitor.sh
# Cron job: checks PostHog for new error events, creates Paperclip issues if found.
# Runs every 15 minutes on VPS-1. Zero AI compute if no errors.
#
# Requirements: bash 4+, jq, curl
# Setup: crontab -e → */15 * * * * /app/scripts/posthog-error-monitor.sh
#
# Env vars needed:
#   POSTHOG_API_KEY (or POSTHOG_PERSONAL_API_KEY) — PostHog personal API key
#   POSTHOG_PROJECT_ID — PostHog project ID
#   POSTHOG_HOST — PostHog host (default: https://us.posthog.com)
#   PAPERCLIP_API_URL — Paperclip API base URL
#   PAPERCLIP_API_KEY — Paperclip API key

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────

POSTHOG_API_KEY="${POSTHOG_API_KEY:-${POSTHOG_PERSONAL_API_KEY:-}}"
POSTHOG_PROJECT_ID="${POSTHOG_PROJECT_ID:-}"
POSTHOG_HOST="${POSTHOG_HOST:-https://us.posthog.com}"

PAPERCLIP_API_URL="${PAPERCLIP_API_URL:-}"
PAPERCLIP_API_KEY="${PAPERCLIP_API_KEY:-}"

SUPPORT_ENGINEER_ID="88b72065-5f95-4e2b-a6df-48d04363f0d9"
PARENT_ISSUE_ID="VOY-999"

STATE_FILE="/var/tmp/posthog_monitor_last_check"
PENDING_DIR="/var/tmp/posthog_pending"
ERROR_WINDOW_MINUTES=15
MAX_ISSUES_PER_RUN=20
COOLDOWN_MINUTES=60
REQUEST_TIMEOUT=10

LOG_TAG="posthog-monitor"

# ─── Portable Date Helpers ─────────────────────────────────────────────────
# macOS date doesn't support -d; Linux (GNU) date does.
# We detect the OS and provide compatible implementations.

if date -d "2026-01-01" +%s >/dev/null 2>&1; then
    # GNU date (Linux, VPS-1 production target)
    _date_to_epoch()   { date -d "$1" +%s; }
    _now_iso_utc()     { date -u +%Y-%m-%dT%H:%M:%SZ; }
    _minutes_ago_iso() { date -u -d "$1 minutes ago" +%Y-%m-%dT%H:%M:%SZ; }
else
    # BSD date (macOS testing)
    _date_to_epoch() {
        local ts="$1"
        # Strip trailing Z if present
        ts="${ts%Z}"
        # Convert YYYY-MM-DDTHH:MM:SS to YYYYMMDDHHMM.SS for -f
        local fmt="${ts:0:4}${ts:5:2}${ts:8:2}${ts:11:2}${ts:14:2}.${ts:17:2}"
        date -j -f "%Y%m%d%H%M.%S" "$fmt" +%s 2>/dev/null
    }
    _now_iso_utc()     { date -u +%Y-%m-%dT%H:%M:%SZ; }
    _minutes_ago_iso() { date -u -v-"$1"M +%Y-%m-%dT%H:%M:%SZ; }
fi

# ─── Logging ──────────────────────────────────────────────────────────────

log() {
    echo "[$(_now_iso_utc)] [$LOG_TAG] $*" >&2
}

# ─── Validation ───────────────────────────────────────────────────────────

validate_config() {
    local missing=()
    [[ -n "$POSTHOG_API_KEY" ]] || missing+=("POSTHOG_API_KEY")
    [[ -n "$POSTHOG_PROJECT_ID" ]] || missing+=("POSTHOG_PROJECT_ID")
    [[ -n "$PAPERCLIP_API_URL" ]] || missing+=("PAPERCLIP_API_URL")
    [[ -n "$PAPERCLIP_API_KEY" ]] || missing+=("PAPERCLIP_API_KEY")

    if [[ ${#missing[@]} -gt 0 ]]; then
        log "ERROR: Missing required env vars: ${missing[*]}"
        exit 1
    fi
}

# ─── State Management ─────────────────────────────────────────────────────

get_last_check_time() {
    if [[ -f "$STATE_FILE" ]]; then
        cat "$STATE_FILE"
    else
        # Default: ERROR_WINDOW_MINUTES ago (prevent alert storm on first run)
        _minutes_ago_iso "$ERROR_WINDOW_MINUTES"
    fi
}

set_last_check_time() {
    local timestamp="$1"
    echo "$timestamp" > "$STATE_FILE"
}

# ─── Cooldown Tracking ────────────────────────────────────────────────────

check_cooldown() {
    local signature="$1"
    local cooldown_file="${STATE_FILE}.cooldown.${signature}"

    if [[ -f "$cooldown_file" ]]; then
        local last_alerted
        last_alerted=$(cat "$cooldown_file")
        local last_epoch current_epoch
        last_epoch=$(_date_to_epoch "$last_alerted" 2>/dev/null || echo 0)
        current_epoch=$(date +%s)
        local elapsed=$(( (current_epoch - last_epoch) / 60 ))

        if [[ $elapsed -lt $COOLDOWN_MINUTES ]]; then
            return 0  # In cooldown, skip
        fi
    fi
    return 1  # Not in cooldown
}

set_cooldown() {
    local signature="$1"
    local cooldown_file="${STATE_FILE}.cooldown.${signature}"
    _now_iso_utc > "$cooldown_file"
}

# ─── PostHog API ──────────────────────────────────────────────────────────

# Generates an error signature for deduplication:
#   event_name::component::message_prefix
# We take first 80 chars of message and normalize whitespace to avoid
# fingerprinting on dynamic data (timestamps, IDs, etc.)
generate_signature() {
    local event="$1"
    local component="$2"
    local message="$3"

    # Normalize: collapse whitespace, strip IDs/UUIDs/timestamps
    local normalized
    normalized=$(echo "$message" | \
        tr -s '[:space:]' ' ' | \
        sed -E 's/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<UUID>/g' | \
        sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}/<TS>/g' | \
        sed -E 's/[0-9]{10,13}/<UNIX_TS>/g' | \
        cut -c1-80)

    echo "${event}::${component}::${normalized}"
}

fetch_error_events() {
    local after="$1"
    local url="${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/events/"

    log "Fetching error events from PostHog (after=$after)..."

    # PostHog Events API: GET with query params for filtering
    # Reference: https://posthog.com/docs/api/events
    local response
    response=$(curl -sS --connect-timeout "$REQUEST_TIMEOUT" --max-time "$REQUEST_TIMEOUT" \
        -X GET "$url" \
        -H "Authorization: Bearer $POSTHOG_API_KEY" \
        --data-urlencode "event=error_" \
        --data-urlencode "after=$after" \
        --data-urlencode "limit=200" \
        -G 2>&1) || {
        log "WARNING: PostHog API request failed (exit code: $?)"
        echo "[]"
        return
    }

    # Validate it's valid JSON
    if ! echo "$response" | jq empty 2>/dev/null; then
        log "WARNING: PostHog returned invalid JSON"
        log "Raw response (first 500 chars): ${response:0:500}"
        echo "[]"
        return
    fi

    echo "$response"
}

# ─── Paperclip API ────────────────────────────────────────────────────────

create_paperclip_issue() {
    local title="$1"
    local description="$2"
    local priority="$3"
    local labels="$4"

    local body
    body=$(jq -n \
        --arg title "$title" \
        --arg description "$description" \
        --arg assigneeId "$SUPPORT_ENGINEER_ID" \
        --arg parentId "$PARENT_ISSUE_ID" \
        --arg priority "$priority" \
        --arg labels "$labels" \
        '{
            title: $title,
            description: $description,
            assigneeId: $assigneeId,
            parentId: $parentId,
            priority: $priority,
            labels: ($labels | split(","))
        }')

    local url="${PAPERCLIP_API_URL%/}/api/issues"

    local response
    response=$(curl -sS --connect-timeout "$REQUEST_TIMEOUT" --max-time "$REQUEST_TIMEOUT" \
        -X POST "$url" \
        -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
        -H "Content-Type: application/json" \
        -d "$body" 2>&1) || {
        log "ERROR: Paperclip API request failed: $?"
        return 1
    }

    local issue_id
    issue_id=$(echo "$response" | jq -r '.id // .issueId // empty' 2>/dev/null)

    if [[ -n "$issue_id" && "$issue_id" != "null" ]]; then
        log "Created Paperclip issue: $issue_id — $title"
        echo "$issue_id"
        return 0
    else
        log "ERROR: Failed to create Paperclip issue"
        log "Response: ${response:0:500}"
        return 1
    fi
}

save_pending_issue() {
    local signature="$1"
    local title="$2"
    local description="$3"
    local priority="$4"
    local labels="$5"

    mkdir -p "$PENDING_DIR"

    jq -n \
        --arg title "$title" \
        --arg description "$description" \
        --arg priority "$priority" \
        --arg labels "$labels" \
        --arg signature "$signature" \
        '{
            title: $title,
            description: $description,
            priority: $priority,
            labels: $labels,
            signature: $signature,
            saved_at: now | strftime("%Y-%m-%dT%H:%M:%SZ")
        }' > "${PENDING_DIR}/${signature}.json"

    log "Saved pending issue for signature: $signature"
}

retry_pending_issues() {
    if [[ ! -d "$PENDING_DIR" ]]; then
        return
    fi

    local retried=0
    for pending_file in "$PENDING_DIR"/*.json; do
        [[ -f "$pending_file" ]] || continue

        local title description priority labels signature
        title=$(jq -r '.title' "$pending_file")
        description=$(jq -r '.description' "$pending_file")
        priority=$(jq -r '.priority' "$pending_file")
        labels=$(jq -r '.labels' "$pending_file")
        signature=$(jq -r '.signature' "$pending_file")

        log "Retrying pending issue: $signature"
        if create_paperclip_issue "$title" "$description" "$priority" "$labels"; then
            rm -f "$pending_file"
            ((retried++)) || true
        fi
    done

    if [[ $retried -gt 0 ]]; then
        log "Successfully retried $retried pending issue(s)"
    fi
}

# ─── Severity Mapping ─────────────────────────────────────────────────────

map_severity_to_priority() {
    local severity="$1"
    case "${severity,,}" in
        critical) echo "urgent" ;;
        high)     echo "high" ;;
        medium)   echo "medium" ;;
        *)        echo "low" ;;
    esac
}

# ─── Main ─────────────────────────────────────────────────────────────────

main() {
    log "=== PostHog Error Monitor Run ==="

    validate_config

    # Determine time window
    local last_check
    last_check=$(get_last_check_time)
    local now
    now=$(_now_iso_utc)

    log "Checking for errors: $last_check → $now"

    # Fetch error events from PostHog
    local events
    events=$(fetch_error_events "$last_check")

    # Count events (PostHog returns {results: [...]} or {results: {data: [...]}})
    local event_count
    event_count=$(echo "$events" | jq '[.results[]?] | length' 2>/dev/null || echo 0)

    if [[ "$event_count" -eq 0 ]]; then
        log "No error events in window. Nothing to do."
        set_last_check_time "$now"
        # Retry any pending issues from previous failed runs
        retry_pending_issues
        log "=== Run Complete (no errors) ==="
        exit 0
    fi

    log "Found $event_count error event(s) in window"

    # Group by signature (event name + component + normalized message)
    # Use jq to extract and group
    local groups_json
    groups_json=$(echo "$events" | jq -c '
        [.results[]? | {
            event: .event,
            timestamp: .timestamp,
            component: (.properties.component // "unknown"),
            message: (.properties.message // "No message"),
            severity: (.properties.severity // "medium"),
            url: (.properties.url // "unknown"),
            user_id: (.properties.distinct_id // "anonymous"),
            error_type: (.properties.error_type // .event)
        }]
        | group_by([.event, .component, .message[:80] | gsub("\\s+"; " ")] | join("::"))
        | [.[] | {
            signature: (.[0].event + "::" + (.[0].message[:80] | gsub("\\s+"; " "))),
            event: .[0].event,
            component: .[0].component,
            message: .[0].message,
            severity: .[0].severity,
            url: .[0].url,
            user_ids: [.[].user_id] | unique,
            count: length,
            first_seen: (map(.timestamp) | min),
            last_seen: (map(.timestamp) | max)
        }]
    ' 2>/dev/null || echo '[]')

    # Process each unique error signature
    local issues_created=0
    local signatures_processed=0
    local signatures_skipped_cooldown=0

    while IFS= read -r group; do
        [[ -n "$group" ]] || continue
        ((signatures_processed++)) || true

        if [[ $issues_created -ge $MAX_ISSUES_PER_RUN ]]; then
            log "WARNING: Reached max issues per run ($MAX_ISSUES_PER_RUN). Deferring remaining ${signatures_processed} signature(s)."
            break
        fi

        local signature event component message severity url user_ids count first_seen
        signature=$(echo "$group" | jq -r '.signature')
        event=$(echo "$group" | jq -r '.event')
        component=$(echo "$group" | jq -r '.component')
        message=$(echo "$group" | jq -r '.message')
        severity=$(echo "$group" | jq -r '.severity')
        url=$(echo "$group" | jq -r '.url')
        user_ids=$(echo "$group" | jq -r '.user_ids | join(", ")')
        count=$(echo "$group" | jq -r '.count')
        first_seen=$(echo "$group" | jq -r '.first_seen')

        # Check cooldown
        if check_cooldown "$signature"; then
            log "SKIP (cooldown): $signature (count=$count)"
            ((signatures_skipped_cooldown++)) || true
            continue
        fi

        local priority
        priority=$(map_severity_to_priority "$severity")

        # Truncate message for title
        local truncated_msg="${message:0:100}"
        [[ ${#message} -gt 100 ]] && truncated_msg="${truncated_msg}..."

        local title="[PostHog] ${event}: ${component} — ${truncated_msg}"
        local description
        description=$(cat <<MD
**Error detected by PostHog Monitor**

- **Event**: \`${event}\`
- **Severity**: ${severity} (priority: ${priority})
- **Component**: ${component}
- **URL**: ${url}
- **Message**: ${message}
- **First Seen**: ${first_seen}
- **Last Seen**: ${now}
- **Occurrences (15 min window)**: ${count}
- **Affected Users**: ${user_ids:-anonymous}
MD
)
        local labels="posthog-monitor,auto-detected"

        log "Creating issue for: $title (severity=$severity, count=$count)"

        if create_paperclip_issue "$title" "$description" "$priority" "$labels"; then
            set_cooldown "$signature"
            ((issues_created++)) || true
        else
            log "WARNING: Failed to create issue, saving for retry"
            save_pending_issue "$signature" "$title" "$description" "$priority" "$labels"
        fi

    done < <(echo "$groups_json" | jq -c '.[]' 2>/dev/null)

    # Update state for next run
    set_last_check_time "$now"

    # Retry any pending issues from previous runs
    retry_pending_issues

    log "=== Run Complete ==="
    log "Signatures processed: $signatures_processed | Issues created: $issues_created | Skipped (cooldown): $signatures_skipped_cooldown"
}

main "$@"
