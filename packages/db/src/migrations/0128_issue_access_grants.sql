-- A-bridge grant primitive for CISO security gates (RAM-923 / C1).
--
-- Per RAM-294 §1: explicit per-issue grant table, action-typed capabilities,
-- materialized child grants with parent_grant_id + cascade soft-revoke,
-- append-only audit log with hash chain, separation-of-duties enforced at
-- service layer (CISO never self-grants; audited CTO never assigns the CISO
-- onto the CTO's own audited gate). decision_owner rows are product/UX
-- metadata only — real authority is in issue_access_grants.
--
-- This migration is also the durable answer to the CISO process fix
-- [RAM-267] / [RAM-294] / [RAM-142] / [RAM-266] — the CTO no longer scribes
-- CISO approvals; the CISO records its own verdicts on gates where it is
-- the named decision owner.

CREATE TABLE "issue_decision_owners" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "issue_id" uuid NOT NULL REFERENCES "issues"("id") ON DELETE CASCADE,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "decision_type" text NOT NULL DEFAULT 'security_gate_verdict',
  "assigned_by_type" text NOT NULL,
  "assigned_by_id" text NOT NULL,
  "assigned_at" timestamp with time zone NOT NULL DEFAULT now(),
  "revoked_at" timestamp with time zone,
  "revoked_by_type" text,
  "revoked_by_id" text,
  "revoke_reason" text
);
--> statement-breakpoint

CREATE INDEX "issue_decision_owners_company_issue_idx"
  ON "issue_decision_owners" USING btree ("company_id", "issue_id");
--> statement-breakpoint

CREATE INDEX "issue_decision_owners_agent_idx"
  ON "issue_decision_owners" USING btree ("company_id", "agent_id");
--> statement-breakpoint

CREATE UNIQUE INDEX "issue_decision_owners_active_unique_idx"
  ON "issue_decision_owners" USING btree ("issue_id", "agent_id", "decision_type")
  WHERE "revoked_at" IS NULL;
--> statement-breakpoint

CREATE TABLE "issue_access_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "issue_id" uuid NOT NULL REFERENCES "issues"("id") ON DELETE CASCADE,
  "scope_root_issue_id" uuid NOT NULL REFERENCES "issues"("id") ON DELETE CASCADE,
  "capabilities" text[] NOT NULL,
  "grant_source" text NOT NULL,
  "parent_grant_id" uuid,
  "granted_by_type" text NOT NULL,
  "granted_by_id" text NOT NULL,
  "metadata" jsonb,
  "granted_at" timestamp with time zone NOT NULL DEFAULT now(),
  "valid_until" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "revoked_by_type" text,
  "revoked_by_id" text,
  "revoke_reason" text
);
--> statement-breakpoint

CREATE INDEX "issue_access_grants_company_issue_idx"
  ON "issue_access_grants" USING btree ("company_id", "issue_id");
--> statement-breakpoint

CREATE INDEX "issue_access_grants_agent_idx"
  ON "issue_access_grants" USING btree ("company_id", "agent_id");
--> statement-breakpoint

CREATE INDEX "issue_access_grants_parent_idx"
  ON "issue_access_grants" USING btree ("parent_grant_id");
--> statement-breakpoint

CREATE INDEX "issue_access_grants_scope_root_idx"
  ON "issue_access_grants" USING btree ("company_id", "scope_root_issue_id");
--> statement-breakpoint

CREATE INDEX "issue_access_grants_active_by_agent_issue_idx"
  ON "issue_access_grants" USING btree ("company_id", "agent_id", "issue_id")
  WHERE "revoked_at" IS NULL;
--> statement-breakpoint

CREATE INDEX "issue_access_grants_active_by_scope_idx"
  ON "issue_access_grants" USING btree ("company_id", "agent_id", "scope_root_issue_id")
  WHERE "revoked_at" IS NULL;
--> statement-breakpoint

CREATE TABLE "issue_access_grant_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "seq" text NOT NULL,
  "event_type" text NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "grant_id" uuid REFERENCES "issue_access_grants"("id"),
  "parent_grant_id" uuid,
  "agent_id" uuid REFERENCES "agents"("id"),
  "issue_id" uuid REFERENCES "issues"("id") ON DELETE SET NULL,
  "scope_root_issue_id" uuid REFERENCES "issues"("id") ON DELETE SET NULL,
  "capabilities" text[],
  "granted_by_type" text,
  "granted_by_id" text,
  "revoked_by_type" text,
  "revoked_by_id" text,
  "reason" text,
  "details" jsonb,
  "prev_hash" text,
  "hash" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX "issue_access_grant_audit_company_seq_idx"
  ON "issue_access_grant_audit" USING btree ("company_id", "seq");
--> statement-breakpoint

CREATE INDEX "issue_access_grant_audit_company_created_idx"
  ON "issue_access_grant_audit" USING btree ("company_id", "created_at");
--> statement-breakpoint

CREATE INDEX "issue_access_grant_audit_grant_idx"
  ON "issue_access_grant_audit" USING btree ("grant_id");
--> statement-breakpoint

CREATE INDEX "issue_access_grant_audit_issue_idx"
  ON "issue_access_grant_audit" USING btree ("issue_id");
--> statement-breakpoint

REVOKE UPDATE, DELETE ON "issue_access_grant_audit" FROM PUBLIC;
