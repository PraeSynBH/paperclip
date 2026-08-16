import { eq, and, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { memoryRecords, memoryBindings, memoryBindingTargets } from "@paperclipai/db";
import type { MemoryScope, MemorySnippet, MemoryContextBundle } from "@paperclipai/shared";
import { builtinPgvectorAdapter } from "./memory-adapter.js";
import { memoryBindingService } from "./memory-bindings.js";
import { embeddingService } from "./embedding.js";
import { logger } from "../middleware/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MemoryWarmUpResult {
  /** The formatted markdown preamble, or null if no memory was found/config not available. */
  preamble: string | null;
  /** Number of memory snippets injected. */
  snippetCount: number;
  /** Total latency of the warm-up in ms. */
  latencyMs: number;
  /** Whether the warm-up succeeded or was gracefully skipped. */
  status: "success" | "skipped_no_binding" | "skipped_no_config" | "error";
  /** Error message if status is "error". */
  error?: string;
}

export interface MemoryWarmUpConfig {
  /** Max top-K snippets to retrieve. Default: 5 */
  topK?: number;
  /** Timeout for the entire warm-up in ms. Default: 3000 */
  timeoutMs?: number;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_TOP_K = 5;
const DEFAULT_TIMEOUT_MS = 3_000;

// ─── Preamble Builder ───────────────────────────────────────────────────────

/**
 * Format an array of memory snippets into a markdown preamble string
 * suitable for injection into agent instructions.
 */
export function buildMemoryPreamble(snippets: MemorySnippet[]): string {
  if (!snippets || snippets.length === 0) return "";

  const lines: string[] = [];
  lines.push("");
  lines.push("=== Context from Past Work ===");
  lines.push("");

  for (let i = 0; i < snippets.length; i++) {
    const s = snippets[i];
    const scoreLine = s.score !== undefined ? ` [relevance: ${(s.score * 100).toFixed(0)}%]` : "";
    const sourceLine = s.source
      ? ` (source: ${s.source.kind}${s.source.issueId ? ` #${s.source.issueId.slice(0, 8)}` : ""})`
      : "";
    const summaryLine = s.summary ? `\n> ${s.summary}` : "";

    lines.push(`- **Memory ${i + 1}**${scoreLine}${sourceLine}:`);
    // Truncate the text to a reasonable length for preamble
    const truncatedText =
      s.text.length > 500 ? s.text.slice(0, 500).trimEnd() + "…" : s.text;
    lines.push(`  ${truncatedText}${summaryLine}`);
    lines.push("");
  }

  lines.push("=== End Context ===");
  lines.push("");

  return lines.join("\n");
}

// ─── Warm-Up Service ────────────────────────────────────────────────────────

/**
 * Warm up agent memory by fetching relevant context before a run starts.
 *
 * This function is designed to be called during the pre-run phase of the
 * heartbeat service, running in parallel with other startup I/O (skill sync,
 * secret resolution, workspace setup).
 *
 * Design principles:
 * - **Async, not deferred**: Runs concurrently with other pre-run I/O,
 *   but the result is awaited before the agent adapter is invoked.
 * - **Graceful degradation**: Never throws. On failure, logs the error
 *   and returns a null preamble. The heartbeat continues without memory.
 * - **Pre-fetched, not inline**: The agent does NOT call memory.search()
 *   during its run to get preamble context. Context is already in the
 *   prompt when it starts.
 * - **Agent-scoped first**: Queries scope to companyId + agentId.
 *   Cross-agent company-level knowledge comes in a later phase.
 */
export async function warmUpAgentMemory(
  db: Db,
  companyId: string,
  agentId: string,
  scope: Partial<MemoryScope> & { companyId: string },
  config?: MemoryWarmUpConfig,
): Promise<MemoryWarmUpResult> {
  const start = Date.now();
  const topK = config?.topK ?? DEFAULT_TOP_K;
  const timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Wrap everything in a timeout
  try {
    const result = await Promise.race([
      doWarmUp(db, companyId, agentId, scope, topK),
      timeout(timeoutMs),
    ]);

    const latencyMs = Date.now() - start;

    if (result === "timeout") {
      logger.warn(
        { companyId, agentId, latencyMs },
        "Memory warm-up timed out, continuing without context",
      );
      return {
        preamble: null,
        snippetCount: 0,
        latencyMs,
        status: "error",
        error: "timeout",
      };
    }

    if (!result) {
      return {
        preamble: null,
        snippetCount: 0,
        latencyMs,
        status: "skipped_no_binding",
      };
    }

    const { bundle, bindingKey } = result;

    if (!bundle || !bundle.snippets || bundle.snippets.length === 0) {
      return {
        preamble: null,
        snippetCount: 0,
        latencyMs,
        status: "skipped_no_config",
      };
    }

    const preamble = buildMemoryPreamble(bundle.snippets);

    logger.info(
      { companyId, agentId, snippetCount: bundle.snippets.length, latencyMs, bindingKey },
      "Memory warm-up complete",
    );

    return {
      preamble,
      snippetCount: bundle.snippets.length,
      latencyMs,
      status: "success",
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    logger.error({ err, companyId, agentId, latencyMs }, "Memory warm-up failed unexpectedly");
    return {
      preamble: null,
      snippetCount: 0,
      latencyMs,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Internal ───────────────────────────────────────────────────────────────

async function doWarmUp(
  db: Db,
  companyId: string,
  agentId: string,
  scope: Partial<MemoryScope> & { companyId: string },
  topK: number,
): Promise<{ bundle: MemoryContextBundle; bindingKey: string } | null> {
  // Resolve the active binding for the agent
  const bindingSvc = memoryBindingService(db);
  const resolved = await bindingSvc.findActiveBinding(companyId, agentId);

  if (!resolved || !resolved.binding.enabled) {
    return null;
  }

  const bindingKey = resolved.binding.key;

  // Check if the resolved binding uses the built-in pgvector adapter
  // (or could be a plugin — but for now we only have the built-in)
  if (resolved.binding.providerType !== "builtin_pgvector") {
    // For plugin providers, we would delegate to the plugin's memory adapter
    // For now, skip since only the built-in is available
    return null;
  }

  // Build the memory scope for the query
  const memoryScope: MemoryScope = {
    companyId,
    agentId,
    projectId: scope.projectId,
    issueId: scope.issueId,
    runId: scope.runId,
  };

  // Use the built-in adapter to query for relevant context
  const adapter = builtinPgvectorAdapter(db);

  // We need a query string to find relevant context.
  // For the preamble warm-up, we fetch recent high-importance memories
  // scoped to this agent. In a more advanced implementation, we could
  // use the issue title/description as the query.
  const bundle = await adapter.query({
    bindingKey,
    scope: memoryScope,
    query: "", // Empty query triggers full-text fallback with broad match
    topK,
    intent: "agent_preamble",
  });

  return { bundle, bindingKey };
}

/**
 * Create a promise that resolves to "timeout" after the given duration.
 * Used via Promise.race to enforce a timeout on the warm-up operation.
 */
function timeout(ms: number): Promise<"timeout"> {
  return new Promise((resolve) => {
    setTimeout(() => resolve("timeout"), ms);
  });
}
