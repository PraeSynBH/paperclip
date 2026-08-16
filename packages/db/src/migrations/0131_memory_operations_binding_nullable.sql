-- Make binding_id nullable in memory_operations and add provider_key text column
-- This allows audit logging when a binding UUID isn't available (e.g. get-not-found)
--> statement-breakpoint
ALTER TABLE "memory_operations" ALTER COLUMN "binding_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "memory_operations" ADD COLUMN "provider_key" text;
