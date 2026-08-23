ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "pricing_experiment_variant" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "pricing_experiment_enrolled_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_companies_pricing_experiment_variant ON "companies" ("pricing_experiment_variant");
