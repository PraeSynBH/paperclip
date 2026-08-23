ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "onboarding_status" text NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "onboarding_selected_role" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "onboarding_completed_at" timestamp with time zone;