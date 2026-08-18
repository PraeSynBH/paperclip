CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"notification_type" text NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"digest_frequency" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"notification_type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link_url" text,
	"metadata_json" jsonb DEFAULT '{}'::jsonb,
	"read_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"email_sent_at" timestamp with time zone,
	"push_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_prefs_company_user_type_channel_uq" ON "notification_preferences" USING btree ("company_id","user_id","notification_type","channel");
--> statement-breakpoint
CREATE INDEX "notification_prefs_company_user_idx" ON "notification_preferences" USING btree ("company_id","user_id");
--> statement-breakpoint
CREATE INDEX "notifications_company_user_idx" ON "notifications" USING btree ("company_id","user_id");
--> statement-breakpoint
CREATE INDEX "notifications_company_user_created_idx" ON "notifications" USING btree ("company_id","user_id","created_at");
--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","read_at","created_at");
--> statement-breakpoint
CREATE INDEX "push_subscriptions_company_user_idx" ON "push_subscriptions" USING btree ("company_id","user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_uq" ON "push_subscriptions" USING btree ("endpoint");