CREATE TABLE "background_jobs" (
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

CREATE INDEX "background_jobs_company_status_idx" ON "background_jobs" ("company_id", "status");
CREATE INDEX "background_jobs_company_created_idx" ON "background_jobs" ("company_id", "created_at");
CREATE INDEX "background_jobs_job_type_idx" ON "background_jobs" ("job_type");