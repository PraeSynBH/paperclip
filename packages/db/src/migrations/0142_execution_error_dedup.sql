ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "push_subscriptions" DROP CONSTRAINT "push_subscriptions_user_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "issues_active_task_watchdog_uq";--> statement-breakpoint
DROP INDEX "issues_active_sla_monitor_alert_uq";--> statement-breakpoint
DROP INDEX "memory_records_embedding_hnsw_idx";--> statement-breakpoint
DROP INDEX "pipeline_cases_lease_expires_idx";--> statement-breakpoint
DROP INDEX "pipeline_cases_parent_request_key_uq";--> statement-breakpoint
ALTER TABLE "company_skills" ALTER COLUMN "star_count" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "company_skills" ALTER COLUMN "install_count" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "company_skills" ALTER COLUMN "fork_count" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "external_objects" ALTER COLUMN "is_terminal" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "issue_watchdogs" ALTER COLUMN "trigger_count" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ALTER COLUMN "version" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "memory_binding_targets" ALTER COLUMN "priority" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "memory_bindings" ALTER COLUMN "enabled" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "memory_operations" ALTER COLUMN "record_count" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "pipeline_automation_executions" ALTER COLUMN "generation" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "notification_preferences" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "notification_preferences" ALTER COLUMN "enabled" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "notification_preferences" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "notification_preferences" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "metadata_json" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "push_subscriptions" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "push_subscriptions" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_custom_image_setup_sessions" ADD CONSTRAINT "environment_custom_image_setup_sessions_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_custom_image_templates" ADD CONSTRAINT "environment_custom_image_templates_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_entities" ADD CONSTRAINT "plugin_entities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_job_runs" ADD CONSTRAINT "plugin_job_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_logs" ADD CONSTRAINT "plugin_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_webhook_deliveries" ADD CONSTRAINT "plugin_webhook_deliveries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_execution_error_run_user_uq" ON "notifications" USING btree ("company_id","user_id",(metadata_json->>'runId')) WHERE "notifications"."notification_type" = 'execution_error' AND metadata_json ? 'runId';--> statement-breakpoint
CREATE UNIQUE INDEX "issues_active_task_watchdog_uq" ON "issues" USING btree ("company_id","origin_kind","origin_id") WHERE "issues"."origin_kind" = 'task_watchdog'
          and "issues"."origin_id" is not null
          and "issues"."hidden_at" is null
          and "issues"."status" not in ('done', 'cancelled');--> statement-breakpoint
CREATE UNIQUE INDEX "issues_active_sla_monitor_alert_uq" ON "issues" USING btree ("company_id","origin_kind","origin_fingerprint") WHERE "issues"."origin_kind" = 'sla_monitor'
          and "issues"."origin_fingerprint" <> 'default'
          and "issues"."hidden_at" is null
          and "issues"."status" not in ('done', 'cancelled');--> statement-breakpoint
CREATE INDEX "memory_records_embedding_hnsw_idx" ON "memory_records" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "pipeline_cases_lease_expires_idx" ON "pipeline_cases" USING btree ("lease_expires_at") WHERE "pipeline_cases"."lease_expires_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_cases_parent_request_key_uq" ON "pipeline_cases" USING btree ("parent_case_id","request_key") WHERE "pipeline_cases"."request_key" is not null and "pipeline_cases"."retired_at" is null;--> statement-breakpoint
ALTER TABLE "invites" DROP COLUMN "invited_email";--> statement-breakpoint
ALTER TABLE "invites" DROP COLUMN "invited_name";