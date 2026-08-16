-- Phase 1: Schema & Data Model for Deep Planning (VOY-1186 Workstream A)
--
-- 1. Add plan_metadata JSONB column to documents table
-- 2. Add plan_metadata JSONB column to document_revisions table
-- 3. Create plan_review_gates table
-- 4. Add milestoneId column to issue_plan_decompositions table

--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "plan_metadata" jsonb;
--> statement-breakpoint
ALTER TABLE "document_revisions" ADD COLUMN "plan_metadata" jsonb;
--> statement-breakpoint
CREATE TABLE "plan_review_gates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "document_id" uuid NOT NULL REFERENCES "documents"("id") ON DELETE cascade,
  "revision_id" uuid NOT NULL REFERENCES "document_revisions"("id") ON DELETE cascade,
  "milestone_id" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "acceptance_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "assigned_agent_id" uuid REFERENCES "agents"("id") ON DELETE set null,
  "created_by_agent_id" uuid REFERENCES "agents"("id") ON DELETE set null,
  "created_by_user_id" text,
  "resolved_by_agent_id" uuid REFERENCES "agents"("id") ON DELETE set null,
  "resolved_by_user_id" text,
  "resolved_at" timestamp with time zone,
  "resolution_comment" text,
  "superseded_by_gate_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "plan_review_gates_document_revision_idx" ON "plan_review_gates" ("company_id", "document_id", "revision_id");
--> statement-breakpoint
CREATE INDEX "plan_review_gates_pending_idx" ON "plan_review_gates" ("company_id", "document_id", "revision_id") WHERE "status" = 'pending';
--> statement-breakpoint
ALTER TABLE "issue_plan_decompositions" ADD COLUMN "milestone_id" text;