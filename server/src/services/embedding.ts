import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { logger } from "../middleware/logger.js";

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
  /** API key */
  apiKey: string;
  /** Request timeout in ms */
  timeoutMs?: number;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_DIMENSIONS = 1536;
const DEFAULT_TIMEOUT_MS = 10_000;

// Simple in-memory cache: key = hash of (text, model), value = embedding
const embeddingCache = new Map<string, { embedding: number[]; cachedAt: number }>();
const CACHE_MAX_SIZE = 1000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// ─── Embedding Service Factory ──────────────────────────────────────────────

export function embeddingService(config?: EmbeddingConfig) {
  const resolvedConfig: EmbeddingConfig = {
    apiBaseUrl: process.env.PAPERCLIP_EMBEDDING_API_BASE ?? "https://api.openai.com/v1",
    model: process.env.PAPERCLIP_EMBEDDING_MODEL ?? DEFAULT_MODEL,
    apiKey: config?.apiKey ?? process.env.PAPERCLIP_EMBEDDING_API_KEY ?? "",
    timeoutMs: config?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...config,
  };

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
    const cached = embeddingCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return {
        embedding: cached.embedding,
        model: resolvedConfig.model!,
        dimensions: cached.embedding.length,
        latencyMs: 0,
        inputTokens: 0,
      };
    }

    const start = Date.now();
    let embedding: number[];
    let inputTokens: number;

    try {
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
            input: text,
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

      const data = (await response.json()) as {
        data: Array<{ embedding: number[] }>;
        usage?: { prompt_tokens: number };
      };

      if (!data.data || data.data.length === 0) {
        throw new Error("Embedding API returned empty data");
      }

      embedding = data.data[0].embedding;
      inputTokens = data.usage?.prompt_tokens ?? 0;
    } catch (err) {
      logger.error({ err }, "Embedding generation failed");
      throw err;
    }

    const latencyMs = Date.now() - start;

    // Update cache
    if (embeddingCache.size >= CACHE_MAX_SIZE) {
      // Evict oldest entry
      const firstKey = embeddingCache.keys().next().value;
      if (firstKey) embeddingCache.delete(firstKey);
    }
    embeddingCache.set(cacheKey, { embedding, cachedAt: Date.now() });

    return {
      embedding,
      model: resolvedConfig.model!,
      dimensions: embedding.length,
      latencyMs,
      inputTokens,
    };
  }

  /**
   * Generate embeddings for multiple texts in batch.
   */
  async function embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    return Promise.all(texts.map((t) => embed(t)));
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