-- TOCTOU race hardening: at most one execution_error notification per (company, user, runId).
-- The partial predicate keeps the constraint scoped to execution_error rows carrying a runId.
CREATE UNIQUE INDEX "notifications_execution_error_run_user_uq" ON "notifications" USING btree ("company_id","user_id",(metadata_json->>'runId')) WHERE "notifications"."notification_type" = 'execution_error' AND metadata_json ? 'runId';
--> statement-breakpoint
-- Schema drift cleanup: invites.invited_email and invites.invited_name were removed from
-- the schema but never migrated out of the DB. Drizzle-kit will keep generating DROP COLUMN
-- until applied. Both columns were added in 0140 and have no downstream references.
ALTER TABLE "invites" DROP COLUMN IF EXISTS "invited_email";
--> statement-breakpoint
ALTER TABLE "invites" DROP COLUMN IF EXISTS "invited_name";