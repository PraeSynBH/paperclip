CREATE INDEX IF NOT EXISTS "idx_company_subscriptions_trial_expiry"
ON "company_subscriptions" ("trial_end")
WHERE "status" = 'trialing' AND "trial_end" IS NOT NULL;