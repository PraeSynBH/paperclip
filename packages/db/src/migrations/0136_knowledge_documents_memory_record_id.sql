-- C-2: Add memory_record_id column and unique index for promoteFromMemory dedup (VOY-1327)
-- Ensures promoting the same memory record twice is idempotent.
--
--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "memory_record_id" uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_documents_memory_record_unique_idx" ON "knowledge_documents" USING btree ("memory_record_id");
