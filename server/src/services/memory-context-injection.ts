import { eq, and, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { knowledgeDocuments, memoryRecords, memoryBindings, memoryBindingTargets } from "@paperclipai/db";
import type { MemoryScope, MemorySnippet, MemoryContextBundle } from "@paperclipai/shared";
import { builtinPgvectorAdapter } from "./memory-adapter.js";
import { memoryBindingService } from "./memory-bindings.js";
import { embeddingService } from "./embedding.js";
import { knowledgeDocumentService } from "./knowledge-documents.js";
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

export interface KnowledgeWarmUpResult {
  /** The formatted knowledge preamble, or null if no knowledge was found. */
  preamble: string | null;
  /** Number of knowledge articles injected. */
  articleCount: number;
  /** Total latency in ms. */
  latencyMs: number;
  /** Whether the warm-up succeeded. */
  status: "success" | "skipped_no_knowledge" | "error";
  error?: string;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_TOP_K = 5;
const DEFAULT_TIMEOUT_MS = 3_000;

// ─── Preamble Builder (Memory) ──────────────────────────────────────────────

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

    // Handle missing/empty text gracefully
    const text =
      typeof s.text === "string" && s.text.length > 0
        ? s.text
        : s.summary && typeof s.summary === "string"
          ? s.summary
          : "(empty memory)";

    // Safely render score, guarding against NaN/Infinity
    let scoreLine = "";
    if (s.score !== undefined && s.score !== null) {
      const pct = Math.round(s.score * 100);
      if (Number.isFinite(pct)) {
        scoreLine = ` [relevance: ${pct}%]`;
      }
    }

    // Safely render source reference, truncating issueId to 8 chars
    const sourceLine = s.source
      ? ` (source: ${s.source.kind}${s.source.issueId ? ` #${s.source.issueId.slice(0, 8)}` : ""})`
      : "";

    // Safely render summary with blockquote formatting
    const summaryLine =
      s.summary && typeof s.summary === "string" && s.summary.trim().length > 0
        ? `\n> ${s.summary.trim()}`
        : "";

    lines.push(`- **Memory ${i + 1}**${scoreLine}${sourceLine}:`);
    // Truncate the text to a reasonable length for preamble
    const truncatedText =
      text.length > 500 ? text.slice(0, 500).trimEnd() + "…" : text;
    lines.push(`  ${truncatedText}${summaryLine}`);
    lines.push("");
  }

  lines.push("=== End Context ===");
  lines.push("");

  return lines.join("\n");
}

// ─── Knowledge Preamble Builder ─────────────────────────────────────────────

/**
 * Format published knowledge documents into a markdown preamble section.
 */
export function buildKnowledgePreamble(
  articles: Array<{ id: string; title: string; summary?: string; body: string; score?: number }>,
): string {
  if (!articles || articles.length === 0) return "";

  const lines: string[] = [];
  lines.push("");
  lines.push("=== Company Knowledge ===");
  lines.push("");

  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    const scoreLine = a.score !== undefined ? ` [relevance: ${(a.score * 100).toFixed(0)}%]` : "";

    lines.push(`- **${a.title}**${scoreLine}:`);
    if (a.summary) {
      lines.push(`  > ${a.summary}`);
    }
    // Truncate body to a reasonable preamble length
    if (a.body) {
      const truncatedBody =
        a.body.length > 800 ? a.body.slice(0, 800).trimEnd() + "…" : a.body;
      lines.push(`  ${truncatedBody}`);
    }
    lines.push("");
  }

  lines.push("=== End Company Knowledge ===");
  lines.push("");

  return lines.join("\n");
}

// ─── Warm-Up Service (Memory) ───────────────────────────────────────────────

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

  // Use AbortController to cancel the warm-up if timeout fires
  const controller = new AbortController();
  const signal = controller.signal;

  // Wrap everything in a timeout
  try {
    const result = await Promise.race([
      doWarmUp(db, companyId, agentId, scope, topK, signal),
      timeout(timeoutMs, controller),
    ]);

    const latencyMs = Date.now() - start;

    if (result === "timeout") {
      // doWarmUp was cancelled — signal is already aborted by timeout()
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

    // Signal may have been aborted by timeout during processing — double-check
    if (signal.aborted) {
      logger.warn(
        { companyId, agentId, latencyMs },
        "Memory warm-up completed after timeout, discarding result",
      );
      return {
        preamble: null,
        snippetCount: 0,
        latencyMs,
        status: "error",
        error: "timeout",
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

// ─── Knowledge Warm-Up ──────────────────────────────────────────────────────

/**
 * Warm up company knowledge by fetching published knowledge documents
 * relevant to the current context (issue, project).
 *
 * Runs in parallel with memory warm-up and other pre-run I/O.
 * Gracefully degrades on failure.
 */
export async function warmUpCompanyKnowledge(
  db: Db,
  companyId: string,
  contextScope: { issueId?: string; projectId?: string; query?: string },
  config?: { timeoutMs?: number; limit?: number },
): Promise<KnowledgeWarmUpResult> {
  const start = Date.now();
  const timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limit = config?.limit ?? 3;

  const controller = new AbortController();
  const signal = controller.signal;

  try {
    const result = await Promise.race([
      doKnowledgeWarmUp(db, companyId, contextScope, limit, signal),
      timeout(timeoutMs, controller),
    ]);

    const latencyMs = Date.now() - start;

    if (result === "timeout") {
      logger.warn(
        { companyId, latencyMs },
        "Knowledge warm-up timed out, continuing without company knowledge",
      );
      return {
        preamble: null,
        articleCount: 0,
        latencyMs,
        status: "error",
        error: "timeout",
      };
    }

    if (!result || result.length === 0) {
      return {
        preamble: null,
        articleCount: 0,
        latencyMs,
        status: "skipped_no_knowledge",
      };
    }

    if (signal.aborted) {
      logger.warn(
        { companyId, latencyMs },
        "Knowledge warm-up completed after timeout, discarding result",
      );
      return {
        preamble: null,
        articleCount: 0,
        latencyMs,
        status: "error",
        error: "timeout",
      };
    }

    const preamble = buildKnowledgePreamble(result);

    logger.info(
      { companyId, articleCount: result.length, latencyMs },
      "Knowledge warm-up complete",
    );

    return {
      preamble,
      articleCount: result.length,
      latencyMs,
      status: "success",
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    logger.error({ err, companyId, latencyMs }, "Knowledge warm-up failed unexpectedly");
    return {
      preamble: null,
      articleCount: 0,
      latencyMs,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Internal: Memory Warm-Up ───────────────────────────────────────────────

async function doWarmUp(
  db: Db,
  companyId: string,
  agentId: string,
  scope: Partial<MemoryScope> & { companyId: string },
  topK: number,
  signal: AbortSignal,
): Promise<{ bundle: MemoryContextBundle; bindingKey: string } | null> {
  // Check for cancellation before each async step
  if (signal.aborted) return null;

  // Resolve the active binding for the agent
  const bindingSvc = memoryBindingService(db);
  const resolved = await bindingSvc.findActiveBinding(companyId, agentId);

  if (!resolved || !resolved.binding.enabled) {
    return null;
  }

  if (signal.aborted) return null;

  const bindingKey = resolved.binding.key;

  // Check if the resolved binding uses the built-in pgvector adapter
  if (resolved.binding.providerType !== "builtin_pgvector") {
    return null;
  }

  if (signal.aborted) return null;

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

  const bundle = await adapter.query({
    bindingKey,
    scope: memoryScope,
    query: "", // Empty query returns most recent records (handled by adapter)
    topK,
    intent: "agent_preamble",
  });

  return { bundle, bindingKey };
}

// ─── Internal: Knowledge Warm-Up ────────────────────────────────────────────

async function doKnowledgeWarmUp(
  db: Db,
  companyId: string,
  contextScope: { issueId?: string; projectId?: string; query?: string },
  limit: number,
  signal: AbortSignal,
): Promise<Array<{ id: string; title: string; summary?: string; body: string; score?: number }>> {
  if (signal.aborted) return [];

  // Search published knowledge documents using full-text search
  const searchQuery = contextScope.query ?? "";

  if (searchQuery.trim().length === 0) {
    // If no query is provided, fetch the most recently published documents
    if (signal.aborted) return [];

    const rows = await db
      .select({
        id: knowledgeDocuments.id,
        title: knowledgeDocuments.title,
        summary: knowledgeDocuments.summary,
        body: knowledgeDocuments.body,
      })
      .from(knowledgeDocuments)
      .where(
        and(
          eq(knowledgeDocuments.companyId, companyId),
          eq(knowledgeDocuments.status, "published"),
        ),
      )
      .orderBy(sql`${knowledgeDocuments.publishedAt} DESC NULLS LAST`)
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      summary: r.summary ?? undefined,
      body: r.body,
      score: undefined,
    }));
  }

  // Use full-text search with plainto_tsquery which handles natural language
  // input safely — punctuation, operators, and special characters are stripped
  // rather than causing 400 errors as to_tsquery would with malformed lexemes.
  if (!searchQuery.trim()) {
    return [];
  }

  const rows = await db
    .select({
      id: knowledgeDocuments.id,
      title: knowledgeDocuments.title,
      summary: knowledgeDocuments.summary,
      body: knowledgeDocuments.body,
      score: sql<number>`ts_rank(
        to_tsvector('english', ${knowledgeDocuments.title} || ' ' || coalesce(${knowledgeDocuments.body}, '')),
        plainto_tsquery('english', ${searchQuery})
      )`,
    })
    .from(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.companyId, companyId),
        eq(knowledgeDocuments.status, "published"),
        sql`to_tsvector('english', ${knowledgeDocuments.title} || ' ' || coalesce(${knowledgeDocuments.body}, '')) @@ plainto_tsquery('english', ${searchQuery})`,
      ),
    )
    .orderBy(sql`score DESC`)
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary ?? undefined,
    body: r.body,
    score: r.score ?? 0,
  }));
}

// ─── Utility ────────────────────────────────────────────────────────────────

/**
 * Create a promise that resolves to "timeout" after the given duration.
 * Also aborts the given controller so in-flight work can check for cancellation.
 * Used via Promise.race to enforce a timeout on the warm-up operation.
 */
function timeout(ms: number, controller?: AbortController): Promise<"timeout"> {
  return new Promise((resolve) => {
    setTimeout(() => {
      controller?.abort();
      resolve("timeout");
    }, ms);
  });
}