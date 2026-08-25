-- research_queries.job_id: add FK-column index + SET NULL delete action.
--
-- R1a pre-ship review (doc/review/2026-08-25-r1a-pre-ship-review.md):
-- - Finding D (P2): FKs without indexes force seq-scans on lookups that join
--   research_queries through job_id; the column has no index today.
-- - Finding E (P2): the FK had no ON DELETE action — deleting a background
--   job would either fail (default NO ACTION) or need a cascade. SET NULL
--   keeps the query row intact when its job is purged.
--
-- Migration 0145 created job_id via inline REFERENCES, so Postgres auto-named
-- the constraint `research_queries_job_id_fkey`. Drizzle's generator would
-- name it `research_queries_job_id_background_jobs_fk`. Drop both defensively
-- and re-create under the drizzle-conventional name with ON DELETE SET NULL.
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "research_queries_job_idx" ON "research_queries" ("job_id");
--> statement-breakpoint

ALTER TABLE "research_queries" DROP CONSTRAINT IF EXISTS "research_queries_job_id_fkey";
--> statement-breakpoint

ALTER TABLE "research_queries" DROP CONSTRAINT IF EXISTS "research_queries_job_id_background_jobs_fk";
--> statement-breakpoint

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'research_queries_job_id_background_jobs_fk') THEN ALTER TABLE "research_queries" ADD CONSTRAINT "research_queries_job_id_background_jobs_fk" FOREIGN KEY ("job_id") REFERENCES "public"."background_jobs"("id") ON DELETE set null ON UPDATE no action; END IF; END $$;