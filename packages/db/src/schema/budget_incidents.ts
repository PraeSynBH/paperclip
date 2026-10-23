import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { approvals } from "./approvals.js";
import { budgetPolicies } from "./budget_policies.js";
import { companies } from "./companies.js";

export const budgetIncidents = pgTable(
  "budget_incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    policyId: uuid("policy_id").notNull().references(() => budgetPolicies.id),
    scopeType: text("scope_type").notNull(),
    scopeId: uuid("scope_id").notNull(),
    metric: text("metric").notNull(),
    windowKind: text("window_kind").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    thresholdType: text("threshold_type").notNull(),
    amountLimit: integer("amount_limit").notNull(),
    amountObserved: integer("amount_observed").notNull(),
    // What triggered the evaluation that produced this incident (PRX-5485).
    // `cost_event`  — evaluateCostEvent, fired when a run reports its cost.
    // `policy_rearm` — upsertPolicy, evaluating already-accumulated spend at arm time.
    // `window_reset` — reserved for a window-roll evaluation; no path emits it today.
    // `unknown`     — pre-PRX-5485 rows; never inferred from timing (see issue backfill rule).
    trigger: text("trigger").notNull().default("unknown"),
    status: text("status").notNull().default("open"),
    approvalId: uuid("approval_id").references(() => approvals.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("budget_incidents_company_status_idx").on(table.companyId, table.status),
    companyScopeIdx: index("budget_incidents_company_scope_idx").on(
      table.companyId,
      table.scopeType,
      table.scopeId,
      table.status,
    ),
    triggerCheck: check(
      "budget_incidents_trigger_check",
      sql`${table.trigger} in ('cost_event', 'policy_rearm', 'window_reset', 'unknown')`,
    ),
    policyWindowIdx: uniqueIndex("budget_incidents_policy_window_threshold_idx").on(
      table.policyId,
      table.windowStart,
      table.thresholdType,
    ).where(sql`${table.status} <> 'dismissed'`),
  }),
);
