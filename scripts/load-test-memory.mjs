#!/usr/bin/env node
/**
 * Load test: concurrent agent memory access
 *
 * Exercises the memory system under concurrent agent heartbeat scenarios:
 * - Multiple agents simultaneously querying memory
 * - Concurrent capture operations
 * - Mixed read/write contention
 *
 * Usage:
 *   node scripts/load-test-memory.mjs [options]
 *
 * Options:
 *   --api-base     API base URL (default: http://localhost:3000/api)
 *   --api-key      API key for authentication
 *   --company-id   Company UUID
 *   --agents       Number of concurrent agents (default: 5)
 *   --iterations   Operations per agent (default: 10)
 *   --capture-pct  Percentage of operations that are captures (default: 30)
 *   --query-pct    Percentage that are queries (default: 50)
 *   --list-pct     Percentage that are list operations (default: 20)
 *   --wait-ms      Delay between operations per agent (default: 100)
 */

const API_BASE = process.env.API_BASE || "http://localhost:3000/api";
const API_KEY = process.env.API_KEY || "";
const COMPANY_ID = process.env.COMPANY_ID || "";
const NUM_AGENTS = parseInt(process.env.AGENTS || "5", 10);
const ITERATIONS = parseInt(process.env.ITERATIONS || "10", 10);
const CAPTURE_PCT = parseInt(process.env.CAPTURE_PCT || "30", 10);
const QUERY_PCT = parseInt(process.env.QUERY_PCT || "50", 10);
const WAIT_MS = parseInt(process.env.WAIT_MS || "100", 10);

if (!API_KEY || !COMPANY_ID) {
  console.error("API_KEY and COMPANY_ID environment variables required");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${API_KEY}`,
};

// ─── Fake agent IDs for the test ─────────────────────────────────────────────

const AGENT_IDS = Array.from({ length: NUM_AGENTS }, (_, i) => `agent-load-test-${i + 1}`);

// ─── Stats ───────────────────────────────────────────────────────────────────

const stats = {
  totalOperations: 0,
  successes: 0,
  failures: 0,
  totalLatencyMs: 0,
  maxLatencyMs: 0,
  minLatencyMs: Infinity,
  byOperation: {},
};

function recordOp(op, success, latencyMs) {
  const bucket = (stats.byOperation[op] ??= { count: 0, success: 0, fail: 0, totalMs: 0 });
  bucket.count++;
  if (success) bucket.success++;
  else bucket.fail++;
  bucket.totalMs += latencyMs;

  stats.totalOperations++;
  if (success) stats.successes++;
  else stats.failures++;
  stats.totalLatencyMs += latencyMs;
  if (latencyMs > stats.maxLatencyMs) stats.maxLatencyMs = latencyMs;
  if (latencyMs < stats.minLatencyMs) stats.minLatencyMs = latencyMs;
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiPost(path, body) {
  const start = Date.now();
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const latencyMs = Date.now() - start;
    return { ok: res.ok, status: res.status, latencyMs };
  } catch {
    return { ok: false, status: 0, latencyMs: Date.now() - start };
  }
}

async function apiGet(path) {
  const start = Date.now();
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers });
    const latencyMs = Date.now() - start;
    return { ok: res.ok, status: res.status, latencyMs };
  } catch {
    return { ok: false, status: 0, latencyMs: Date.now() - start };
  }
}

// ─── Operations ──────────────────────────────────────────────────────────────

const sampleTexts = [
  "Architecture decision: use pgvector for memory storage",
  "Customer reported issue with agent timeout",
  "Deployment pipeline updated to pnpm v10",
  "API rate limit increased to 1000 req/min",
  "Database migration completed successfully",
  "Memory warm-up timeout threshold adjusted to 5s",
  "New embedding model evaluated for production use",
  "Knowledge base document about deployment procedures",
  "Security review of memory binding config exposure",
  "Performance benchmark results from load testing",
];

let opCounter = 0;

async function captureOperation(agentId, bindingKey) {
  const text = sampleTexts[opCounter++ % sampleTexts.length];
  const result = await apiPost(`/companies/${COMPANY_ID}/memory/capture`, {
    bindingKey,
    scope: { companyId: COMPANY_ID, agentId },
    source: { kind: "manual_note", companyId: COMPANY_ID },
    payload: { text },
  });
  recordOp("capture", result.ok, result.latencyMs);
}

async function queryOperation(agentId, bindingKey) {
  const query = sampleTexts[opCounter++ % sampleTexts.length].split(" ").slice(0, 3).join(" ");
  const result = await apiGet(
    `/companies/${COMPANY_ID}/memory/query?bindingKey=${encodeURIComponent(bindingKey)}&scope=${encodeURIComponent(JSON.stringify({ companyId: COMPANY_ID, agentId }))}&q=${encodeURIComponent(query)}&topK=5`,
  );
  recordOp("query", result.ok, result.latencyMs);
}

async function listOperation(agentId, bindingKey) {
  const result = await apiGet(
    `/companies/${COMPANY_ID}/memory/records?bindingKey=${encodeURIComponent(bindingKey)}&scope=${encodeURIComponent(JSON.stringify({ companyId: COMPANY_ID, agentId }))}&limit=10`,
  );
  recordOp("list", result.ok, result.latencyMs);
}

// ─── Agent Simulation ────────────────────────────────────────────────────────

async function simulateAgent(agentId) {
  const bindingKey = "default";

  // Resolve binding first (warm-up)
  const resolveResult = await apiGet(
    `/companies/${COMPANY_ID}/memory/bindings/resolve?agentId=${agentId}`,
  );
  if (!resolveResult.ok) {
    console.warn(`  [${agentId}] No binding resolved, skipping`);
    return;
  }

  for (let i = 0; i < ITERATIONS; i++) {
    const roll = Math.random() * 100;

    if (roll < CAPTURE_PCT) {
      await captureOperation(agentId, bindingKey);
    } else if (roll < CAPTURE_PCT + QUERY_PCT) {
      await queryOperation(agentId, bindingKey);
    } else {
      await listOperation(agentId, bindingKey);
    }

    // Stagger operations to simulate realistic interleaving
    if (WAIT_MS > 0) {
      await new Promise((r) => setTimeout(r, Math.random() * WAIT_MS));
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔧 Memory Load Test Configuration:`);
  console.log(`   API Base:      ${API_BASE}`);
  console.log(`   Company ID:    ${COMPANY_ID}`);
  console.log(`   Agents:        ${NUM_AGENTS}`);
  console.log(`   Iterations:    ${ITERATIONS} per agent`);
  console.log(`   Total ops:     ${NUM_AGENTS * ITERATIONS}`);
  console.log(`   Capture:       ${CAPTURE_PCT}%`);
  console.log(`   Query:         ${QUERY_PCT}%`);
  console.log(`   List:          ${100 - CAPTURE_PCT - QUERY_PCT}%`);
  console.log(`   Wait between:  ${WAIT_MS}ms max`);
  console.log(``);

  const start = Date.now();

  const results = await Promise.allSettled(
    AGENT_IDS.map((id) => simulateAgent(id)),
  );

  const elapsed = Date.now() - start;

  // ─── Report ──────────────────────────────────────────────────────────────
  console.log(`\n📊 Results (${elapsed}ms total):`);
  console.log(`   Operations:    ${stats.totalOperations}`);
  console.log(`   Successes:     ${stats.successes}`);
  console.log(`   Failures:      ${stats.failures}`);
  console.log(`   Success rate:  ${((stats.successes / stats.totalOperations) * 100).toFixed(1)}%`);
  console.log(`   Avg latency:   ${(stats.totalLatencyMs / stats.totalOperations).toFixed(0)}ms`);
  console.log(`   Min latency:   ${stats.minLatencyMs}ms`);
  console.log(`   Max latency:   ${stats.maxLatencyMs}ms`);
  console.log(``);

  console.log(`   Per-operation:`);
  for (const [op, data] of Object.entries(stats.byOperation).sort()) {
    const avg = (data.totalMs / data.count).toFixed(0);
    console.log(`     ${op.padEnd(10)} ${data.count} ops, ${data.success} ok, ${data.fail} fail, avg ${avg}ms`);
  }

  console.log(``);

  const failedAgents = results.filter((r) => r.status === "rejected").length;
  if (failedAgents > 0) {
    console.log(`⚠️  ${failedAgents} agent(s) failed entirely`);
  }

  // Exit code: 0 if >90% success, 1 otherwise
  const successRate = stats.totalOperations > 0
    ? stats.successes / stats.totalOperations
    : 0;
  process.exit(successRate >= 0.9 ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
