CREATE TABLE IF NOT EXISTS "background_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "job_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "result" jsonb,
  "error" text,
  "duration_ms" integer,
  "progress" integer NOT NULL DEFAULT 0,
  "progress_message" text,
  "created_by_actor_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "background_jobs_company_status_idx" ON "background_jobs" ("company_id", "status");
CREATE INDEX IF NOT EXISTS "background_jobs_company_created_idx" ON "background_jobs" ("company_id", "created_at");
CREATE INDEX IF NOT EXISTS "background_jobs_job_type_idx" ON "background_jobs" ("job_type");
CREATE INDEX IF NOT EXISTS "background_jobs_queued_status_idx" ON "background_jobs" ("status") WHERE "status" = 'queued';

--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_status_check" CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_progress_check" CHECK ("progress" >= 0 AND "progress" <= 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_duration_check" CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;