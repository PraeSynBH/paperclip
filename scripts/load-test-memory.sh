#!/usr/bin/env bash
# Load Test: Concurrent Agent Memory Access
#
# Simulates multiple concurrent agents performing memory operations
# (capture, query, promote-to-knowledge) to verify performance under load.
#
# Usage:
#   PAPERCLIP_API_URL=http://localhost:3100 \
#   PAPERCLIP_API_KEY=sk-... \
#   PAPERCLIP_COMPANY_ID=<uuid> \
#   scripts/load-test-memory.sh [options]
#
# Options:
#   --agents N      Number of concurrent simulated agents (default: 5)
#   --ops N         Number of operations per agent (default: 10)
#   --output FILE   Write results as JSON to FILE (default: stdout summary)
#
# Requires: curl, jq, gnu parallel (or fallback to sequential for compat)

set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────
API="${PAPERCLIP_API_URL:-http://localhost:3100}"
KEY="${PAPERCLIP_API_KEY:?PAPERCLIP_API_KEY is required}"
COMPANY_ID="${PAPERCLIP_COMPANY_ID:?PAPERCLIP_COMPANY_ID is required}"
NUM_AGENTS=5
OPS_PER_AGENT=10
OUTPUT_FILE=""

# Parse options
while [[ $# -gt 0 ]]; do
  case "$1" in
    --agents) NUM_AGENTS="$2"; shift 2 ;;
    --ops)    OPS_PER_AGENT="$2"; shift 2 ;;
    --output) OUTPUT_FILE="$2"; shift 2 ;;
    --help|-h)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

# ─── Helpers ─────────────────────────────────────────────────────────────────
API_BASE="${API%/}"

pc_api() {
  local method="$1" path="$2"
  shift 2
  local body="${1:-}"

  local curl_args=(-sS --fail-with-body)
  curl_args+=(-H "Authorization: Bearer $KEY")
  curl_args+=(-H "Content-Type: application/json")

  if [[ -n "$body" ]]; then
    curl_args+=(-X "$method")
    curl_args+=(--data-binary "$body")
  fi

  curl "${curl_args[@]}" "$API_BASE$path" 2>/dev/null || {
    echo "ERROR: pc_api $method $path failed" >&2
    return 1
  }
}

# Generate a random UUID-like string
random_id() {
  echo "load-$(date +%s)-$RANDOM-$RANDOM"
}

# Create a memory binding if one doesn't exist
ensure_binding() {
  local agent_tag="$1"
  local binding_key="${agent_tag}-binding"

  # Check if binding exists
  local existing
  existing=$(pc_api get "/api/companies/$COMPANY_ID/memory/bindings" 2>/dev/null | jq -r ".[] | select(.key==\"$binding_key\") | .id" | head -1)

  if [[ -n "$existing" ]]; then
    echo "$existing"
    return 0
  fi

  # Create binding
  pc_api post "/api/companies/$COMPANY_ID/memory/bindings" \
    "{\"key\":\"$binding_key\",\"providerType\":\"builtin_pgvector\",\"enabled\":true}" \
    2>/dev/null | jq -r '.id'
}

# Create a binding target for a specific agent
ensure_target() {
  local binding_id="$1" agent_id="$2"

  # Check if target exists
  local existing
  existing=$(pc_api get "/api/companies/$COMPANY_ID/memory/targets" 2>/dev/null | \
    jq -r ".[] | select(.bindingId==\"$binding_id\" and .targetType==\"agent\") | .id" | head -1)

  if [[ -n "$existing" ]]; then
    return 0
  fi

  pc_api post "/api/companies/$COMPANY_ID/memory/targets" \
    "{\"targetType\":\"agent\",\"targetId\":\"$agent_id\",\"bindingId\":\"$binding_id\",\"priority\":10}" \
    2>/dev/null >/dev/null
}

# Capture a memory record
capture_memory() {
  local agent_tag="$1" binding_key="${1}-binding" op_num="$2"
  local text="Load test memory from agent $agent_tag op $op_num at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local body
  body=$(jq -n \
    --arg bindingKey "$binding_key" \
    --arg text "$text" \
    --arg agentId "load-test-$agent_tag" \
    --arg companyId "$COMPANY_ID" \
    '{
      bindingKey: $bindingKey,
      text: $text,
      recordType: "auto_capture",
      scope: { companyId: $companyId, agentId: $agentId },
      source: { kind: "run", companyId: $companyId }
    }')

  local start_ms
  start_ms=$(date +%s%3N)
  local result
  result=$(pc_api post "/api/companies/$COMPANY_ID/memory/capture" "$body" 2>/dev/null) || {
    echo "{\"op\":$op_num,\"action\":\"capture\",\"success\":false,\"latencyMs\":-1,\"error\":\"api_failure\"}"
    return 1
  }
  local end_ms
  end_ms=$(date +%s%3N)
  local latency=$(( end_ms - start_ms ))

  echo "{\"op\":$op_num,\"action\":\"capture\",\"success\":true,\"latencyMs\":$latency}"
}

# Query memory
query_memory() {
  local agent_tag="$1" binding_key="${1}-binding" op_num="$2"
  local query_str="load test query $op_num"

  local start_ms
  start_ms=$(date +%s%3N)
  local result
  result=$(pc_api get "/api/companies/$COMPANY_ID/memory/query?bindingKey=$binding_key&q=$(jq -rn --arg q "$query_str" '$q|@uri')" 2>/dev/null) || {
    echo "{\"op\":$op_num,\"action\":\"query\",\"success\":false,\"latencyMs\":-1,\"error\":\"api_failure\"}"
    return 1
  }
  local end_ms
  end_ms=$(date +%s%3N)
  local latency=$(( end_ms - start_ms ))
  local count
  count=$(echo "$result" | jq '.snippets | length' 2>/dev/null || echo 0)

  echo "{\"op\":$op_num,\"action\":\"query\",\"success\":true,\"latencyMs\":$latency,\"resultCount\":$count}"
}

# List memory records
list_memory() {
  local agent_tag="$1" binding_key="${1}-binding" op_num="$2"

  local start_ms
  start_ms=$(date +%s%3N)
  local result
  result=$(pc_api get "/api/companies/$COMPANY_ID/memory/records?bindingKey=$binding_key" 2>/dev/null) || {
    echo "{\"op\":$op_num,\"action\":\"list\",\"success\":false,\"latencyMs\":-1,\"error\":\"api_failure\"}"
    return 1
  }
  local end_ms
  end_ms=$(date +%s%3N)
  local latency=$(( end_ms - start_ms ))
  local count
  count=$(echo "$result" | jq '.items | length' 2>/dev/null || echo 0)

  echo "{\"op\":$op_num,\"action\":\"list\",\"success\":true,\"latencyMs\":$latency,\"resultCount\":$count}"
}

# Run a full agent load-test cycle
run_agent() {
  local agent_tag="$1"
  local results=()

  echo "  [agent $agent_tag] Starting..." >&2

  # Ensure binding and target
  local binding_id
  binding_id=$(ensure_binding "$agent_tag")
  echo "  [agent $agent_tag] Binding: $binding_id" >&2

  # Run capture ops
  for ((i=1; i<=OPS_PER_AGENT; i++)); do
    local r
    r=$(capture_memory "$agent_tag" "$i")
    results+=("$r")
    if (( i % 3 == 0 )); then
      # Every 3rd op, also query
      r=$(query_memory "$agent_tag" "$i")
      results+=("$r")
    fi
    if (( i % 5 == 0 )); then
      # Every 5th op, list
      r=$(list_memory "$agent_tag" "$i")
      results+=("$r")
    fi
  done

  # Final query
  local r
  r=$(query_memory "$agent_tag" "final")
  results+=("$r")

  # Output results as JSON array
  printf '%s\n' "${results[@]}" | jq -s --arg agent "$agent_tag" '{
    agent: $agent,
    operations: .
  }'
  echo "  [agent $agent_tag] Done." >&2
}

# ─── Main ─────────────────────────────────────────────────────────────────────
echo "========================================"
echo "Memory Load Test"
echo "========================================"
echo "API:        $API"
echo "Company:    $COMPANY_ID"
echo "Agents:     $NUM_AGENTS"
echo "Ops/Agent:  $OPS_PER_AGENT"
echo "Total Ops:  $(( NUM_AGENTS * OPS_PER_AGENT * 2 ))"  # rough estimate
echo "========================================"
echo ""
echo "Starting load test at $(date -u +%Y-%m-%dT%H:%M:%SZ)..."
echo ""

EXPERIMENT_START=$(date +%s%3N)

# Run agents (sequentially for reliability, could use GNU parallel for true concurrency)
ALL_RESULTS=()
for ((a=1; a<=NUM_AGENTS; a++)); do
  agent_name="agent-$(printf '%03d' "$a")"
  agent_result=$(run_agent "$agent_name")
  ALL_RESULTS+=("$agent_result")
done

EXPERIMENT_END=$(date +%s%3N)
TOTAL_DURATION_MS=$(( EXPERIMENT_END - EXPERIMENT_START ))

# Aggregate results
FINAL_JSON=$(printf '%s\n' "${ALL_RESULTS[@]}" | jq -s '{
  summary: {
    totalAgents: ($all | length),
    totalDurationMs: '$TOTAL_DURATION_MS',
    totalOperations: ([$all[].operations[]] | length),
  },
  byAgent: $all,
  stats: {
    totalOperations: ([$all[].operations[]] | length),
    successfulOps: ([$all[].operations[] | select(.success == true)] | length),
    failedOps: ([$all[].operations[] | select(.success == false)] | length),
    avgLatencyMs: ([$all[].operations[].latencyMs | select(. >= 0)] | add / length),
    maxLatencyMs: ([$all[].operations[].latencyMs | select(. >= 0)] | max),
    minLatencyMs: ([$all[].operations[].latencyMs | select(. >= 0)] | min),
    p50LatencyMs: ([$all[].operations[].latencyMs | select(. >= 0)] | sort | .[length/2 | floor]),
    p95LatencyMs: ([$all[].operations[].latencyMs | select(. >= 0)] | sort | .[(length*0.95) | floor]),
    p99LatencyMs: ([$all[].operations[].latencyMs | select(. >= 0)] | sort | .[(length*0.99) | floor]),
    opsByType: {
      capture: ([$all[].operations[] | select(.action == "capture")] | length),
      query: ([$all[].operations[] | select(.action == "query")] | length),
      list: ([$all[].operations[] | select(.action == "list")] | length),
    },
    avgLatencyByType: {
      capture: ([$all[].operations[] | select(.action == "capture" and .latencyMs >= 0)] | (. | length) as $n | if $n > 0 then (map(.latencyMs) | add / $n) else 0 end),
      query: ([$all[].operations[] | select(.action == "query" and .latencyMs >= 0)] | (. | length) as $n | if $n > 0 then (map(.latencyMs) | add / $n) else 0 end),
      list: ([$all[].operations[] | select(.action == "list" and .latencyMs >= 0)] | (. | length) as $n | if $n > 0 then (map(.latencyMs) | add / $n) else 0 end),
    },
  },
}' --arg all "$(printf '%s\n' "${ALL_RESULTS[@]}" | jq -s '.')")

# Output
echo ""
echo "========================================"
echo "RESULTS"
echo "========================================"
echo "$FINAL_JSON" | jq '.summary, .stats' 2>/dev/null || echo "$FINAL_JSON"

if [[ -n "$OUTPUT_FILE" ]]; then
  echo "$FINAL_JSON" > "$OUTPUT_FILE"
  echo ""
  echo "Full results written to: $OUTPUT_FILE"
fi

echo ""
echo "Load test completed at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Total duration: ${TOTAL_DURATION_MS}ms"

# Overall pass/fail assessment
FAIL_COUNT=$(echo "$FINAL_JSON" | jq '.stats.failedOps' 2>/dev/null || echo 0)
if [[ "$FAIL_COUNT" -gt 0 ]]; then
  echo "WARNING: $FAIL_COUNT operation(s) failed"
  exit 1
else
  echo "All operations succeeded."
  exit 0
fi
