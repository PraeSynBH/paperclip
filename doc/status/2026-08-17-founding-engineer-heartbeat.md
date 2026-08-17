# Heartbeat: Founding Engineer — Phase 5 Deliverable Implementation

**Date**: 2026-08-17
**Agent**: Founding Engineer (57fa7e0e)
**Run**: 483b1b79
**Issue**: VOY-1205 — Phase 5: Company Knowledge Base + Polish
**Status**: Complete ✓

---

## Summary

Completed the remaining Phase 5 deliverables for the Company Knowledge Base + Polish workstream. The knowledge base core (service, routes, schema, tests) was already built by prior heartbeats; this run focused on the remaining gaps.

---

## What was built in this run

### 1. Promote agent-scoped memory records to company knowledge ✓

- **New service function**: `promoteFromMemory()` in `server/src/services/knowledge-documents.ts`
  - Looks up a memory record by ID within the company
  - Creates a draft knowledge document from the memory text
  - Auto-generates title from record type, or accepts explicit overrides
  - Creates originating backlink when the memory record references a source issue
  - Document enters the normal draft → review → publish lifecycle
- **New REST endpoint**: `POST /companies/:companyId/knowledge/promote-from-memory`
- **New shared types/validators**: `KnowledgePromoteFromMemoryRequest`, `knowledgePromoteFromMemorySchema`
- **OpenAPI doc entry** added

### 2. Provider capability negotiation ✓

- **New REST endpoint**: `GET /companies/:companyId/memory/bindings/:bindingId/capabilities`
  - Returns merged capabilities (built-in defaults + binding-level overrides)
  - Built-in adapter defaults are `false` for all advanced capabilities
  - Plugin adapters can declare capabilities via `capabilitiesJson` in binding config
- **OpenAPI doc entry** added
- The `MemoryCapabilities` type and `capabilitiesJson` field were already defined — this adds the runtime negotiation layer

### 3. Performance tuning ✓

- **Knowledge search result cache**: In-memory LRU cache for `searchPublished()` with 5-minute TTL, max 200 entries. Reduces repeated full-text search overhead for common queries during a session.
- **Index rebuild endpoint**: `POST /companies/:companyId/knowledge/maintenance/rebuild-index` runs `REINDEX INDEX memory_records_embedding_hnsw_idx` for pgvector HNSW index maintenance.
- Embedding cache (24h TTL, 1000 entries) was already implemented in Phase 1-4.

### 4. Evaluate sentence-transformers as local embedding fallback ✓

- Written to `doc/plans/2026-08-17-sentence-transformers-evaluation.md`
- Evaluation covers: transformers.js (ONNX), onnxruntime-node, WASM options, current full-text fallback
- **Recommendation**: Defer to post-v0.4.0 — schema incompatibility (384-dim vs 1536-dim), package size overhead (~40MB), and cold-start latency don't justify the benefit at current volume
- Full-text GIN tsvector index remains the recommended fallback

### 5. Load testing script ✓

- Created `scripts/load-test-memory.mjs`
- Simulates N concurrent agents performing mixed memory operations (capture, query, list)
- Reports per-operation latency, success rate, throughput
- Usage: `AGENTS=10 ITERATIONS=20 node scripts/load-test-memory.mjs`

---

## Files Created/Modified

| File | Change |
|------|--------|
| `packages/shared/src/types/knowledge.ts` | Added `KnowledgePromoteFromMemoryRequest` |
| `packages/shared/src/types/index.ts` | Re-exported new type |
| `packages/shared/src/validators/knowledge.ts` | Added `knowledgePromoteFromMemorySchema` |
| `packages/shared/src/validators/index.ts` | Re-exported new schema |
| `packages/shared/src/index.ts` | Re-exported new schema + type |
| `server/src/services/knowledge-documents.ts` | Added `promoteFromMemory()` + search cache |
| `server/src/routes/knowledge.ts` | Added promote-from-memory + index rebuild endpoints |
| `server/src/routes/memory.ts` | Added binding capabilities endpoint |
| `server/src/routes/openapi.ts` | Registered new routes in OpenAPI docs |
| `doc/plans/2026-08-17-sentence-transformers-evaluation.md` | New evaluation document |
| `scripts/load-test-memory.mjs` | New load testing script |

---

## Verification

- **Server typecheck**: ✅ passes
- **Memory/knowledge tests**: 74/74 passed across 5 test files
- **No regressions** in existing test suites

---

## Deliverable Checklist

| # | Deliverable | Status | Notes |
|---|-------------|--------|-------|
| 1 | Company-level knowledge base concept | ✅ Built | Curated, reviewed, versioned records with full API |
| 2 | Promote agent-scoped → company knowledge | ✅ Built | `promoteFromMemory()` + endpoint |
| 3 | Versioning for curated knowledge entries | ✅ Built | Revisions table, version field, diff API |
| 4 | Approval flow for knowledge base changes | ✅ Built | Review workflow (submit→approve/request changes→publish) |
| 5 | Performance tuning | ✅ Built | Search cache + REINDEX endpoint |
| 6 | Provider capability negotiation | ✅ Built | Capabilities endpoint + merged defaults |
| 7 | Evaluate sentence-transformers | ✅ Evaluated | Documented deferral recommendation |
| 8 | Load testing | ✅ Scripted | `scripts/load-test-memory.mjs` |

---

## Handoff to Staff Engineer

Ready for code review. Suggest reviewing:
1. `server/src/services/knowledge-documents.ts` — `promoteFromMemory` function and search cache
2. `server/src/routes/knowledge.ts` — new endpoints
3. `server/src/routes/memory.ts` — capabilities endpoint
