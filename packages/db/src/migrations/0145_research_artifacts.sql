CREATE TABLE IF NOT EXISTS "trips" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "description" text,
  "start_date" timestamptz,
  "end_date" timestamptz,
  "destinations" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" text NOT NULL DEFAULT 'draft',
  "primary_research_query_id" uuid,
  "created_by_actor_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "trips_company_idx" ON "trips" ("company_id");
CREATE INDEX IF NOT EXISTS "trips_status_idx" ON "trips" ("status");

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "research_queries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "trip_id" uuid REFERENCES "trips"("id") ON DELETE CASCADE,
  "raw_query" text NOT NULL,
  "normalized_query" text,
  "entities" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" text NOT NULL DEFAULT 'pending',
  "job_id" uuid REFERENCES "background_jobs"("id"),
  "created_by_actor_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "research_queries_company_idx" ON "research_queries" ("company_id");
CREATE INDEX IF NOT EXISTS "research_queries_trip_idx" ON "research_queries" ("trip_id");
CREATE INDEX IF NOT EXISTS "research_queries_status_idx" ON "research_queries" ("status");

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "research_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "trip_id" uuid,
  "research_query_id" uuid,
  "entities" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "source_type" text NOT NULL,
  "source_url" text,
  "source_name" text,
  "title" text NOT NULL,
  "snippet" text,
  "body" text,
  "fetched_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz,
  "confidence" integer,
  "relevance_score" integer,
  "checksum" text,
  "status" text NOT NULL DEFAULT 'pending',
  "created_by_actor_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "research_artifacts_company_idx" ON "research_artifacts" ("company_id");
CREATE INDEX IF NOT EXISTS "research_artifacts_trip_idx" ON "research_artifacts" ("trip_id");
CREATE INDEX IF NOT EXISTS "research_artifacts_query_idx" ON "research_artifacts" ("research_query_id");
CREATE INDEX IF NOT EXISTS "research_artifacts_source_type_idx" ON "research_artifacts" ("source_type");
CREATE INDEX IF NOT EXISTS "research_artifacts_checksum_idx" ON "research_artifacts" ("checksum");

--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "research_queries" ADD CONSTRAINT "research_queries_status_check" CHECK ("status" IN ('pending', 'resolving', 'gathering', 'complete', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "research_artifacts" ADD CONSTRAINT "research_artifacts_status_check" CHECK ("status" IN ('pending', 'verified', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "trips" ADD CONSTRAINT "trips_status_check" CHECK ("status" IN ('draft', 'researching', 'planning', 'confirmed', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
