import { createHash } from "node:crypto";
import { logger } from "../middleware/logger.js";
import { EMBEDDING_TIMEOUT_MS, EMBEDDING_CACHE_TTL_MS } from "../timeout-constants.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimensions: number;
  latencyMs: number;
  inputTokens: number;
}

export interface EmbeddingConfig {
  /** OpenAI-compatible API endpoint */
  apiBaseUrl: string;
  /** Model name, defaults to text-embedding-3-small */
  model?: string;
  /** Expected embedding dimension count, defaults to 1536 */
  dimensions?: number;
  /** API key */
  apiKey: string;
  /** Request timeout in ms */
  timeoutMs?: number;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_DIMENSIONS = 1536;

// Simple in-memory cache: key = hash of (text, model), value = embedding
// LRU eviction: on access, the key is re-inserted (delete + set) to move it
// to the end of the Map's insertion-order iteration. The first-inserted key
// is evicted when size exceeds the limit.
const embeddingCache = new Map<string, { embedding: number[]; cachedAt: number }>();
const CACHE_MAX_SIZE = 1000;

// ─── LRU helpers ────────────────────────────────────────────────────────────

function cacheSet(
  cache: Map<string, { embedding: number[]; cachedAt: number }>,
  key: string,
  value: { embedding: number[]; cachedAt: number },
): void {
  if (cache.size >= CACHE_MAX_SIZE) {
    // Evict least-recently-used entry (first key in insertion order)
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, value);
}

function cacheGet(
  cache: Map<string, { embedding: number[]; cachedAt: number }>,
  key: string,
): { embedding: number[]; cachedAt: number } | undefined {
  const entry = cache.get(key);
  if (entry) {
    // Move to end (most-recently-used position) by re-inserting
    cache.delete(key);
    cache.set(key, entry);
  }
  return entry;
}

// ─── Embedding Service Factory ──────────────────────────────────────────────

export function embeddingService(config?: EmbeddingConfig) {
  const resolvedConfig: EmbeddingConfig = {
    apiBaseUrl: process.env.PAPERCLIP_EMBEDDING_API_BASE ?? "https://api.openai.com/v1",
    model: process.env.PAPERCLIP_EMBEDDING_MODEL ?? DEFAULT_MODEL,
    dimensions: DEFAULT_DIMENSIONS,
    apiKey: config?.apiKey ?? process.env.PAPERCLIP_EMBEDDING_API_KEY ?? "",
    timeoutMs: config?.timeoutMs ?? EMBEDDING_TIMEOUT_MS,
    ...config,
  };

  /**
   * Shared HTTP request helper for the embedding API.
   * Accepts a single string or an array of strings as `input`.
   * Returns the raw API response data array and usage.
   */
  async function embedRequest(
    input: string | string[],
  ): Promise<{ data: Array<{ embedding: number[]; index: number }>; usage?: { prompt_tokens: number } }> {
    if (!resolvedConfig.apiKey) {
      throw new Error("No embedding API key configured");
    }

    const response = await fetch(
      `${resolvedConfig.apiBaseUrl}/embeddings`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resolvedConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: resolvedConfig.model,
          input,
        }),
        signal: AbortSignal.timeout(resolvedConfig.timeoutMs!),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "unknown");
      throw new Error(
        `Embedding API returned ${response.status}: ${errorBody}`,
      );
    }

    const json = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
      usage?: { prompt_tokens: number };
    };

    if (!json.data || json.data.length === 0) {
      throw new Error("Embedding API returned empty data");
    }

    return { data: json.data, usage: json.usage };
  }

  /**
   * Generate an embedding vector for the given text.
   * Falls back to a zero-vector placeholder when no API key is configured
   * (caller should use full-text search in that case).
   */
  async function embed(text: string): Promise<EmbeddingResult> {
    if (!resolvedConfig.apiKey) {
      logger.warn("No embedding API key configured, returning zero-vector placeholder");
      return {
        embedding: new Array(DEFAULT_DIMENSIONS).fill(0),
        model: "none",
        dimensions: DEFAULT_DIMENSIONS,
        latencyMs: 0,
        inputTokens: 0,
      };
    }

    // Check cache
    const cacheKey = buildCacheKey(text, resolvedConfig.model!);
    const cached = cacheGet(embeddingCache, cacheKey);
    if (cached && Date.now() - cached.cachedAt < EMBEDDING_CACHE_TTL_MS) {
      return {
        embedding: cached.embedding,
        model: resolvedConfig.model!,
        dimensions: cached.embedding.length,
        latencyMs: 0,
        inputTokens: 0,
      };
    }

    const start = Date.now();

    try {
      const { data, usage } = await embedRequest(text);

      const embedding = data[0].embedding;

      // Validate embedding dimension matches expected model dimensions
      if (embedding.length !== resolvedConfig.dimensions && resolvedConfig.dimensions !== undefined) {
        throw new Error(
          `Embedding dimension mismatch: expected ${resolvedConfig.dimensions}, got ${embedding.length}`,
        );
      }

      const latencyMs = Date.now() - start;
      const inputTokens = usage?.prompt_tokens ?? 0;

      // Update cache
      cacheSet(embeddingCache, cacheKey, { embedding, cachedAt: Date.now() });

      return {
        embedding,
        model: resolvedConfig.model!,
        dimensions: embedding.length,
        latencyMs,
        inputTokens,
      };
    } catch (err) {
      logger.error({ err }, "Embedding generation failed");
      throw err;
    }
  }

  /**
   * Generate embeddings for multiple texts in a single batch API request.
   *
   * Uses OpenAI's native batch input format to avoid N individual HTTP
   * requests, reducing latency, rate-limit pressure, and connection-pool
   * contention. The response `data` array maintains input order via the
   * `index` field returned by the API.
   */
  async function embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) return [];
    if (!resolvedConfig.apiKey) {
      logger.warn("No embedding API key configured, returning zero-vector placeholders");
      return texts.map(() => ({
        embedding: new Array(DEFAULT_DIMENSIONS).fill(0),
        model: "none",
        dimensions: DEFAULT_DIMENSIONS,
        latencyMs: 0,
        inputTokens: 0,
      }));
    }

    const start = Date.now();

    try {
      const { data, usage } = await embedRequest(texts);

      // Build a map keyed by the response's `index` field so we can
      // reconstruct results in input order regardless of API ordering.
      const byIndex = new Map<number, { embedding: number[] }>();
      for (const item of data) {
        byIndex.set(item.index, item);
      }

      const totalTokens = usage?.prompt_tokens ?? 0;
      // Approximate per-text token count (the API returns total across all inputs)
      const tokensPerText = texts.length > 0 ? Math.round(totalTokens / texts.length) : 0;
      const latencyMs = Date.now() - start;

      const results: EmbeddingResult[] = [];
      for (let i = 0; i < texts.length; i++) {
        const item = byIndex.get(i);
        if (!item) {
          // Should not happen — API guarantees one result per input in order
          throw new Error(`Embedding batch missing result at index ${i}`);
        }

        const embedding = item.embedding;

        // Validate embedding dimension
        if (embedding.length !== resolvedConfig.dimensions && resolvedConfig.dimensions !== undefined) {
          throw new Error(
            `Embedding dimension mismatch at index ${i}: expected ${resolvedConfig.dimensions}, got ${embedding.length}`,
          );
        }

        results.push({
          embedding,
          model: resolvedConfig.model!,
          dimensions: embedding.length,
          latencyMs,
          inputTokens: tokensPerText,
        });
      }

      return results;
    } catch (err) {
      logger.error({ err, textCount: texts.length }, "Embedding batch generation failed");
      throw err;
    }
  }

  /**
   * Check whether the embedding service is configured (has an API key).
   */
  function isConfigured(): boolean {
    return resolvedConfig.apiKey.length > 0;
  }

  return {
    embed,
    embedBatch,
    isConfigured,
    getConfig: () => ({ ...resolvedConfig }),
  };
}

export type EmbeddingService = ReturnType<typeof embeddingService>;

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildCacheKey(text: string, model: string): string {
  return createHash("sha256").update(`${model}:${text}`).digest("hex");
}