# Sentence-Transformers Local Embedding Fallback — Evaluation

**Date**: 2026-08-17
**Author**: Founding Engineer
**Status**: Evaluation complete — deferred to post-v0.4.0

## Background

CTO Decision 7.3 in the Memory Workstream B plan deferred local embedding to Phase 5
with the rationale that `sentence-transformers` requires bundling a Python/ONNX runtime
which is not trivial for a Node.js deployment. This document evaluates the options.

## Requirements

- Generate 384-dim or 768-dim embedding vectors locally (no external API call)
- Sub-200ms inference on modern hardware (Apple Silicon, x86_64)
- No Python runtime dependency — pure Node.js/JS environment
- Memory footprint under 500MB RSS

## Evaluated Options

### Option 1: `transformers.js` (ONNX Runtime for Node.js)

**Model**: `Xenova/all-MiniLM-L6-v2` — 384-dim, ~23MB ONNX export

| Metric | Value |
|--------|-------|
| Package size | `@xenova/transformers` ~15MB (gzipped) + model download ~23MB |
| First-load latency | 2-5s (model download + ONNX warm-up) |
| Steady-state latency | 50-150ms on Apple Silicon M-series |
| Steady-state latency | 100-300ms on x86_64 (Node.js) |
| Memory (RSS) | ~200-350MB after warm-up |
| Output dimensions | 384 (not compatible with current 1536-dim `text-embedding-3-small`) |
| License | Apache 2.0 |
| Maintenance | Active — 10K+ GitHub stars, weekly releases |

**Schema compatibility**: The current `memory_records.embedding` column is declared as
`vector(1536)`. A second vector column (e.g., `embedding_384`) or a migration to
ALTER the column dimension would be needed. pgvector does not support ALTER COLUMN
TYPE for vector columns — requires a new column + backfill.

### Option 2: ONNX Direct (`onnxruntime-node`)

**Model**: `sentence-transformers/all-MiniLM-L6-v2` exported to ONNX

| Metric | Value |
|--------|-------|
| Package size | `onnxruntime-node` ~25MB + model ~25MB + tokenizer |
| First-load latency | 3-7s (model load + session creation) |
| Steady-state latency | 30-100ms on Apple Silicon |
| Memory (RSS) | ~300-500MB |
| Output dimensions | 384 |
| License | MIT |
| Maintenance | Microsoft-maintained, stable |

Same schema issue as Option 1.

### Option 3: WASM-Based Embedding (`fasttext` / `@anush008/tokenizers`)

Several WASM-based options exist but are experimental. Not recommended for production.

### Option 4: Current Fallback (Full-Text Only)

The current fallback uses GIN tsvector index on `memory_records.text`:

| Metric | Value |
|--------|-------|
| Query latency | 5-50ms |
| No additional dependencies | ✓ |
| Schema-compatible | ✓ |
| Semantic search | ✗ — keyword only |
| Cold-start | 0ms |
| Memory | 0 additional |

## Recommendation

### For v0.4.0 (current release)

**Use the existing full-text fallback** (GIN tsvector index). Rationale:
1. Schema incompatibility: 384-dim vs 1536-dim requires a schema migration
2. Package size: transformers.js adds ~40MB to deployment
3. Cold-start latency: first request after deploy pays 2-7s warm-up
4. The full-text fallback works well for the current agent memory volume
5. The CTO decision explicitly deferred this — no compelling reason to override

### For v0.5.0 or later

If local embedding becomes a priority:
1. Add a second vector column `embedding_384` to `memory_records`
2. Add `@xenova/transformers` as optional dependency
3. Create a `localTransformerEmbedding` provider that implements the same
   `EmbeddingService` interface
4. Configure via binding `configJson.embeddingModel: "local"` or
   `embeddingModel: "Xenova/all-MiniLM-L6-v2"`
5. Fall back to text-embedding-3-small when API key is available and
   local model when not

## Implementation Sketch (for future reference)

```typescript
// server/src/services/local-embedding.ts
import { pipeline } from "@xenova/transformers";

let extractor: Promise<any> | null = null;

export async function localEmbeddingService() {
  async function embed(text: string) {
    if (!extractor) {
      extractor = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    }
    const pipe = await extractor;
    const result = await pipe(text, { pooling: "mean", normalize: true });
    return {
      embedding: Array.from(result.data),
      model: "Xenova/all-MiniLM-L6-v2",
      dimensions: result.data.length,
      latencyMs: 0,
      inputTokens: text.length,
    };
  }
  return { embed, embedBatch, isConfigured: () => true };
}
```

## Conclusion

**Defer to post-v0.4.0.** The schema migration cost and package size overhead
don't justify the benefit given that the full-text fallback is adequate for
current volume. Re-evaluate when:
- Agent memory exceeds 100K records per company
- Users report poor recall quality with full-text search
- A customer explicitly requires air-gapped deployment with no external API calls
