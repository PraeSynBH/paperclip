-- C-2: Add memory_record_id column and unique index for promoteFromMemory dedup (VOY-1327)
-- Ensures promoting the same memory record twice is idempotent.
-- IF NOT EXISTS guards prevent re-run failure when the column/index
-- were already applied but the migration tracker was not updated.
--
--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN IF NOT EXISTS "memory_record_id" uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_documents_memory_record_unique_idx" ON "knowledge_documents" USING btree ("memory_record_id");
--> statement-breakpoint
-- P0-2: Clean up stale initial revisions for pre-existing draft/archived docs (VOY-1365)
-- Deployed v0.4.0-alpha created docs WITH an initial revision (version=1,
-- change_description='Initial version'). The hotfix removes initial revision
-- creation from create(), so new docs avoid collision. For pre-existing
-- draft/archived docs, we delete the stale initial revision so the first
-- submitForReview inserts version=1 without collision.
-- Idempotent: no-op when there are no matching rows.
DELETE FROM "knowledge_document_revisions"
WHERE "change_description" = 'Initial version'
  AND "document_id" IN (
    SELECT "id" FROM "knowledge_documents" WHERE "status" IN ('draft', 'archived')
  );
