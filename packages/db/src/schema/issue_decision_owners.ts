import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { agents } from "./agents.js";

export const issueDecisionOwners = pgTable(
  "issue_decision_owners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    decisionType: text("decision_type").notNull().default("security_gate_verdict"),
    assignedByType: text("assigned_by_type").notNull(),
    assignedById: text("assigned_by_id").notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByType: text("revoked_by_type"),
    revokedById: text("revoked_by_id"),
    revokeReason: text("revoke_reason"),
  },
  (table) => ({
    companyIssueIdx: index("issue_decision_owners_company_issue_idx").on(
      table.companyId,
      table.issueId,
    ),
    agentIdx: index("issue_decision_owners_agent_idx").on(table.companyId, table.agentId),
    activeUniqueIdx: uniqueIndex("issue_decision_owners_active_unique_idx")
      .on(table.issueId, table.agentId, table.decisionType)
      .where(sql`${table.revokedAt} is null`),
  }),
);
