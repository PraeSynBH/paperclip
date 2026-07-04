import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

export const securityAuditLog = pgTable(
  "security_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    eventType: text("event_type").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    prevHash: text("prev_hash"),
    hash: text("hash").notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    runId: uuid("run_id").references(() => heartbeatRuns.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("security_audit_log_company_id_idx").on(table.companyId),
    index("security_audit_log_entity_idx").on(table.entityType, table.entityId),
    uniqueIndex("security_audit_log_hash_idx").on(table.hash),
  ],
);

export const forceReassignIdempotency = pgTable(
  "force_reassign_idempotency",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id),
    idempotencyKey: text("idempotency_key").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").notNull().$type<Record<string, unknown>>(),
    runId: uuid("run_id").references(() => heartbeatRuns.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("force_reassign_idempotency_scope_key_idx").on(
      table.companyId,
      table.issueId,
      table.idempotencyKey,
    ),
  ],
);