-- Recreate memory_records indexes that were dropped by 0138_last_betty_ross.
-- These indexes are critical for query performance:
--   - HNSW vector index on embedding for cosine similarity search (pgvector >= 0.5.0)
--   - B-tree index on (company_id, binding_id) for binding-scoped lookups
--   - B-tree index on (company_id, created_at) for time-range queries
-- Each uses IF NOT EXISTS so the migration is idempotent.
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_records_embedding_hnsw_idx" ON "memory_records"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_records_company_binding_idx" ON "memory_records"
  USING btree ("company_id", "binding_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_records_created_at_idx" ON "memory_records"
  USING btree ("company_id", "created_at");
