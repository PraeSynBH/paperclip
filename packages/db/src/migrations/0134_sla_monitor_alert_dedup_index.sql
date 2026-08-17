-- Partial unique index for SLA monitor alert deduplication (PRA-693).
-- Enforces at the DB level that only one ACTIVE sla_monitor issue exists per
-- (companyId, originFingerprint). The route-level check additionally suppresses
-- duplicates of recently-resolved incidents within the trailing window; this
-- index is the concurrency safety net for simultaneously-firing alerts.
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "issues_active_sla_monitor_alert_uq" ON "issues" (
  "company_id",
  "origin_kind",
  "origin_fingerprint"
) WHERE "origin_kind" = 'sla_monitor'
  AND "origin_fingerprint" <> 'default'
  AND "hidden_at" IS NULL
  AND "status" NOT IN ('done', 'cancelled');
