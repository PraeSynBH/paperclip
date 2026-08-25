-- Replace the non-unique checksum index with a unique partial index on
-- (company_id, checksum) WHERE checksum IS NOT NULL. This enables atomic
-- deduplication via INSERT ... ON CONFLICT DO UPDATE in createArtifact(),
-- eliminating the read-then-write TOCTOU race that existed with the
-- application-level dedup check.
--
-- The WHERE clause ensures multiple artifacts with NULL checksum are allowed
-- (artifacts without a checksum should never conflict).

DROP INDEX IF EXISTS "research_artifacts_checksum_idx";

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "research_artifacts_checksum_company_unique"
  ON "research_artifacts" ("company_id", "checksum")
  WHERE "checksum" IS NOT NULL;
