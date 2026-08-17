-- HNSW index on embedding for efficient vector similarity search
-- Requires pgvector >= 0.5.0 for HNSW support
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_records_embedding_hnsw_idx" ON "memory_records"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

--> statement-breakpoint
-- GIN index on full-text search vector for keyword fallback
CREATE INDEX IF NOT EXISTS "memory_records_text_search_idx" ON "memory_records"
  USING gin (to_tsvector('english', "text"));