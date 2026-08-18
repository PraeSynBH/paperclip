ALTER TABLE "notifications"
  ADD COLUMN "email_delivery_status" text,
  ADD COLUMN "email_delivery_error" text,
  ADD COLUMN "push_delivery_status" text,
  ADD COLUMN "push_delivery_error" text;

--> statement-breakpoint

-- Backfill existing rows: if email_sent_at is set, mark email as 'sent';
-- otherwise leave as NULL (pending/not-applicable). Same for push.
UPDATE "notifications" SET "email_delivery_status" = 'sent' WHERE "email_sent_at" IS NOT NULL;
UPDATE "notifications" SET "push_delivery_status" = 'sent' WHERE "push_sent_at" IS NOT NULL;
