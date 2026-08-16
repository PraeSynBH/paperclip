-- Composite index on company_id + binding_id for common memory query patterns
-- Most memory queries filter by company_id and binding_id first, then apply scope and expiry filters.
-- Without this index, Postgres may seq-scan or use a partial index scan with poor selectivity.
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_records_company_binding_idx" ON "memory_records"
  USING btree ("company_id", "binding_id");
