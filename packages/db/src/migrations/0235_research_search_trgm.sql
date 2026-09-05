-- pg_trgm expression indexes for research search queries.
--
-- The research-search service uses `lower(coalesce(col, '')) LIKE %pattern%`
-- and `ilike(col, pattern)` for keyword search across issues, documents,
-- and activity log. The existing single-column trgm indexes (0051, 0079)
-- serve `ilike(col, pattern)` but cannot satisfy function-wrapped patterns.
-- These expression indexes match the query expressions exactly, enabling
-- index-scans instead of sequential scans on large tables.
--
-- pg_trgm extension is guaranteed to exist at this point (created in 0051).

--> statement-breakpoint

-- Issues: expression indexes for token-match and LIKE on wrapped columns
CREATE INDEX IF NOT EXISTS "issues_title_expr_search_idx"
  ON "issues" USING gin (lower(coalesce("title", '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "issues_description_expr_search_idx"
  ON "issues" USING gin (lower(coalesce("description", '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "issues_identifier_expr_search_idx"
  ON "issues" USING gin (lower(coalesce("identifier", '')) gin_trgm_ops);

--> statement-breakpoint

-- Documents: expression indexes for token-match and LIKE on wrapped columns
CREATE INDEX IF NOT EXISTS "documents_title_expr_search_idx"
  ON "documents" USING gin (lower(coalesce("title", '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "documents_latest_body_expr_search_idx"
  ON "documents" USING gin (lower(coalesce("latest_body", '')) gin_trgm_ops);

--> statement-breakpoint

-- Issue comments: expression index for body searches (subquery in issues search)
-- paperclip:migration-safety-ignore large-create-index-not-concurrently: Drizzle migrations run transactionally, so CONCURRENTLY is unavailable; this expression index is required to serve function-wrapped LIKE search patterns that the existing plain trgm indexes cannot satisfy.
CREATE INDEX IF NOT EXISTS "issue_comments_body_expr_search_idx"
  ON "issue_comments" USING gin (lower("body") gin_trgm_ops);

--> statement-breakpoint

-- Activity log: expression index for action token-match and LIKE
-- paperclip:migration-safety-ignore large-create-index-not-concurrently: Drizzle migrations run transactionally, so CONCURRENTLY is unavailable; this expression index is required to serve function-wrapped LIKE search patterns that the existing plain trgm indexes cannot satisfy.
CREATE INDEX IF NOT EXISTS "activity_log_action_expr_search_idx"
  ON "activity_log" USING gin (lower(coalesce("action", '')) gin_trgm_ops);
