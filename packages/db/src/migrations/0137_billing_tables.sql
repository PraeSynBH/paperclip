-- Billing feature tables for subscription management.
-- Extracted from the drift-reconciliation migration so that feature DDL
-- and schema-repair noise are in separate, reviewable files.
-- IF NOT EXISTS guards prevent re-run failure when tables/indexes
-- were already created but the migration tracker was not updated.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"stripe_customer_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"billing_period" text DEFAULT 'monthly' NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"stripe_subscription_id" text,
	"stripe_subscription_item_id" text,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"trial_end" timestamp with time zone,
	"metadata_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_subscriptions_company_unique_idx" UNIQUE("company_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stripe_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_subscription_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"stripe_invoice_id" text NOT NULL,
	"invoice_number" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"amount_paid_cents" integer DEFAULT 0 NOT NULL,
	"amount_remaining_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"invoice_pdf_url" text,
	"hosted_invoice_url" text,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_monthly_cents" integer DEFAULT 0 NOT NULL,
	"price_yearly_cents" integer DEFAULT 0 NOT NULL,
	"stripe_price_monthly_id" text,
	"stripe_price_yearly_id" text,
	"stripe_product_id" text,
	"included_seats" integer DEFAULT 0 NOT NULL,
	"extra_seat_price_cents" integer DEFAULT 0 NOT NULL,
	"included_agent_runs" integer DEFAULT 0 NOT NULL,
	"extra_agent_run_price_cents" integer DEFAULT 0 NOT NULL,
	"included_storage_gb" integer DEFAULT 0 NOT NULL,
	"extra_storage_gb_price_cents" integer DEFAULT 0 NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"usage" integer DEFAULT 0 NOT NULL,
	"included" integer DEFAULT 0 NOT NULL,
	"overage" integer DEFAULT 0 NOT NULL,
	"overage_cents" integer DEFAULT 0 NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"stripe_usage_record_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- DO blocks with pg_constraint checks make re-runs safe when the migration
-- tracker was not updated after the first successful application.
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_subscriptions_company_id_companies_id_fk') THEN ALTER TABLE "company_subscriptions" ADD CONSTRAINT "company_subscriptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_subscriptions_tier_id_subscription_tiers_id_fk') THEN ALTER TABLE "company_subscriptions" ADD CONSTRAINT "company_subscriptions_tier_id_subscription_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."subscription_tiers"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_subscriptions_stripe_customer_id_stripe_customers_id_fk') THEN ALTER TABLE "company_subscriptions" ADD CONSTRAINT "company_subscriptions_stripe_customer_id_stripe_customers_id_fk" FOREIGN KEY ("stripe_customer_id") REFERENCES "public"."stripe_customers"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stripe_customers_company_id_companies_id_fk') THEN ALTER TABLE "stripe_customers" ADD CONSTRAINT "stripe_customers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_invoices_company_id_companies_id_fk') THEN ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_invoices_subscription_id_company_subscriptions_id_fk') THEN ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_subscription_id_company_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."company_subscriptions"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_usage_company_id_companies_id_fk') THEN ALTER TABLE "subscription_usage" ADD CONSTRAINT "subscription_usage_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_usage_subscription_id_company_subscriptions_id_fk') THEN ALTER TABLE "subscription_usage" ADD CONSTRAINT "subscription_usage_subscription_id_company_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."company_subscriptions"("id") ON DELETE no action ON UPDATE no action; END IF; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_subscriptions_company_idx" ON "company_subscriptions" USING btree ("company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_subscriptions_stripe_subscription_idx" ON "company_subscriptions" USING btree ("stripe_subscription_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stripe_customers_company_idx" ON "stripe_customers" USING btree ("company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stripe_customers_stripe_customer_idx" ON "stripe_customers" USING btree ("stripe_customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_invoices_company_idx" ON "subscription_invoices" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_invoices_stripe_invoice_idx" ON "subscription_invoices" USING btree ("stripe_invoice_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_invoices_subscription_idx" ON "subscription_invoices" USING btree ("subscription_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_tiers_name_idx" ON "subscription_tiers" USING btree ("name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_usage_company_period_idx" ON "subscription_usage" USING btree ("company_id","period_start","period_end");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_usage_sub_metric_period_idx" ON "subscription_usage" USING btree ("subscription_id","metric","period_start","period_end");