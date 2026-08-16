-- Phase 5: Company Knowledge Base — curated, reviewed, versioned knowledge (VOY-1232)
--
-- 1. Create knowledge_documents table (core document entity with lifecycle)
-- 2. Create knowledge_document_revisions table (versioned revisions)
-- 3. Create knowledge_document_reviews table (review/approval workflow)
-- 4. Create knowledge_source_backlinks table (backlinks to originating issues)
-- 5. Create indexes for efficient querying

--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "title" text NOT NULL,
  "summary" text,
  "body" text NOT NULL DEFAULT '',
  "status" text NOT NULL DEFAULT 'draft',
  "version" integer NOT NULL DEFAULT 1,
  "author_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET null,
  "source_issue_id" uuid REFERENCES "issues"("id") ON DELETE SET null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "published_at" timestamp with time zone
);

--> statement-breakpoint
CREATE INDEX "knowledge_documents_company_status_idx" ON "knowledge_documents" ("company_id", "status");
--> statement-breakpoint
CREATE INDEX "knowledge_documents_company_created_idx" ON "knowledge_documents" ("company_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "knowledge_documents_company_updated_idx" ON "knowledge_documents" ("company_id", "updated_at" DESC);

--> statement-breakpoint
CREATE TABLE "knowledge_document_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL REFERENCES "knowledge_documents"("id") ON DELETE cascade,
  "version" integer NOT NULL,
  "title" text NOT NULL,
  "summary" text,
  "body" text NOT NULL DEFAULT '',
  "change_description" text,
  "author_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE INDEX "knowledge_document_revisions_document_version_idx" ON "knowledge_document_revisions" ("document_id", "version" DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_document_revisions_doc_ver_unique_idx" ON "knowledge_document_revisions" ("document_id", "version");

--> statement-breakpoint
CREATE TABLE "knowledge_document_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL REFERENCES "knowledge_documents"("id") ON DELETE cascade,
  "revision_id" uuid NOT NULL REFERENCES "knowledge_document_revisions"("id") ON DELETE cascade,
  "reviewer_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET null,
  "status" text NOT NULL DEFAULT 'pending',
  "comment" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decided_at" timestamp with time zone
);

--> statement-breakpoint
CREATE INDEX "knowledge_document_reviews_document_idx" ON "knowledge_document_reviews" ("document_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "knowledge_document_reviews_revision_idx" ON "knowledge_document_reviews" ("revision_id");

--> statement-breakpoint
CREATE TABLE "knowledge_source_backlinks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL REFERENCES "knowledge_documents"("id") ON DELETE cascade,
  "source_issue_id" uuid NOT NULL REFERENCES "issues"("id") ON DELETE cascade,
  "source_type" text NOT NULL DEFAULT 'referenced_in_body',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_source_backlinks_doc_issue_unique_idx" ON "knowledge_source_backlinks" ("document_id", "source_issue_id");
--> statement-breakpoint
CREATE INDEX "knowledge_source_backlinks_issue_idx" ON "knowledge_source_backlinks" ("source_issue_id");