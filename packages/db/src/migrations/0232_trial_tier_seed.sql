-- paperclip:migration-safety-ignore full-table-mutation-large-table:seed
-- Seed the Trial subscription tier. This is a config/data seed, not a schema change.
-- Voyonder assigns this tier to new self-serve signups for a 14-day trial.
INSERT INTO subscription_tiers (name, description, price_monthly_cents, price_yearly_cents,
  included_seats, included_agent_runs, included_storage_gb, features, is_active, sort_order)
VALUES ('Trial', '14-day free trial with full access to all features',
  0, 0, 5, 100, 1,
  '["custom_plugins", "advanced_agents", "audit_logs", "api_access"]',
  true, 0)
ON CONFLICT (name) DO NOTHING;