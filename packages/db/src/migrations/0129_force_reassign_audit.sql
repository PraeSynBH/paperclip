CREATE TABLE "security_audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "event_type" text NOT NULL,
  "actor_type" text NOT NULL,
  "actor_id" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "prev_hash" text,
  "hash" text NOT NULL,
  "payload" jsonb NOT NULL,
  "run_id" uuid REFERENCES "heartbeat_runs"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "security_audit_log_company_id_idx" ON "security_audit_log" ("company_id");
CREATE INDEX "security_audit_log_entity_idx" ON "security_audit_log" ("entity_type", "entity_id");
CREATE UNIQUE INDEX "security_audit_log_hash_idx" ON "security_audit_log" ("hash");

REVOKE UPDATE, DELETE ON "security_audit_log" FROM PUBLIC;

CREATE TABLE "force_reassign_idempotency" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "issue_id" uuid NOT NULL REFERENCES "issues"("id"),
  "idempotency_key" text NOT NULL,
  "response_status" integer NOT NULL,
  "response_body" jsonb NOT NULL,
  "run_id" uuid REFERENCES "heartbeat_runs"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "force_reassign_idempotency_scope_key_idx"
  ON "force_reassign_idempotency" ("company_id", "issue_id", "idempotency_key");

ALTER TABLE "issues"
  ADD COLUMN "version" integer NOT NULL DEFAULT 0;