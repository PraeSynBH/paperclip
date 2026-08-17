-- Phase 2: Core Engine — memory_bindings, memory_records, memory_operations, memory_extraction_jobs (PRA-634)
--
-- 1. Enable pgvector extension
-- 2. Create memory_bindings table (binding definitions + targets)
-- 3. Create memory_records table with vector(1536) column and indexes
-- 4. Create memory_operations audit log table
-- 5. Create memory_extraction_jobs table

--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;

--> statement-breakpoint
CREATE TABLE "memory_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "key" text NOT NULL,
  "provider_type" text NOT NULL,
  "config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "capabilities_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE UNIQUE INDEX "memory_bindings_company_key_idx" ON "memory_bindings" ("company_id", "key");

--> statement-breakpoint
CREATE INDEX "memory_bindings_company_provider_idx" ON "memory_bindings" ("company_id", "provider_type");

--> statement-breakpoint
CREATE TABLE "memory_binding_targets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "target_type" text NOT NULL,
  "target_id" uuid NOT NULL,
  "binding_id" uuid NOT NULL REFERENCES "memory_bindings"("id") ON DELETE cascade,
  "priority" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE UNIQUE INDEX "memory_binding_targets_company_target_idx" ON "memory_binding_targets" ("company_id", "target_type", "target_id");

--> statement-breakpoint
CREATE INDEX "memory_binding_targets_binding_idx" ON "memory_binding_targets" ("binding_id");

--> statement-breakpoint
CREATE TABLE "memory_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "binding_id" uuid NOT NULL REFERENCES "memory_bindings"("id") ON DELETE cascade,
  "record_type" text NOT NULL,
  "text" text NOT NULL,
  "summary" text,
  "embedding" vector(1536),
  "scope_company_id" uuid,
  "scope_agent_id" uuid,
  "scope_project_id" uuid,
  "scope_issue_id" uuid,
  "scope_run_id" uuid,
  "scope_subject_id" text,
  "scope_session_key" text,
  "scope_namespace" text,
  "source_kind" text NOT NULL,
  "source_issue_id" uuid,
  "source_comment_id" uuid,
  "source_document_key" text,
  "source_run_id" uuid,
  "source_activity_id" uuid,
  "source_external_ref" text,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "importance" double precision,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone
);

--> statement-breakpoint
CREATE INDEX "memory_records_company_scope_idx" ON "memory_records" ("company_id", "scope_agent_id", "record_type");

--> statement-breakpoint
CREATE INDEX "memory_records_source_idx" ON "memory_records" ("company_id", "source_kind", "source_issue_id");

--> statement-breakpoint
CREATE INDEX "memory_records_created_at_idx" ON "memory_records" ("company_id", "created_at");

--> statement-breakpoint
CREATE TABLE "memory_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "binding_id" uuid NOT NULL REFERENCES "memory_bindings"("id") ON DELETE cascade,
  "operation_type" text NOT NULL,
  "scope_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "source_ref_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "actor_agent_id" uuid,
  "heartbeat_run_id" uuid,
  "success" boolean NOT NULL,
  "error_message" text,
  "latency_ms" integer NOT NULL,
  "usage_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "record_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE INDEX "memory_operations_company_binding_op_idx" ON "memory_operations" ("company_id", "binding_id", "operation_type");

--> statement-breakpoint
CREATE INDEX "memory_operations_company_created_idx" ON "memory_operations" ("company_id", "created_at");

--> statement-breakpoint
CREATE TABLE "memory_extraction_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "binding_id" uuid NOT NULL REFERENCES "memory_bindings"("id") ON DELETE cascade,
  "operation_id" uuid REFERENCES "memory_operations"("id") ON DELETE SET null,
  "provider_job_id" text NOT NULL,
  "hook_kind" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "error_message" text,
  "submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone
);

--> statement-breakpoint
CREATE INDEX "memory_extraction_jobs_company_binding_status_idx" ON "memory_extraction_jobs" ("company_id", "binding_id", "status");

--> statement-breakpoint
CREATE INDEX "memory_extraction_jobs_provider_job_idx" ON "memory_extraction_jobs" ("provider_job_id");