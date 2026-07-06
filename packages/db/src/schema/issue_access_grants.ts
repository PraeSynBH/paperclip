import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { agents } from "./agents.js";

export const ISSUE_ACCESS_GRANT_CAPABILITIES = [
  "gate_decision.transition",
  "issue.add_comment",
  "issue.attach_evidence",
  "issue.read",
] as const;

export type IssueAccessGrantCapability = (typeof ISSUE_ACCESS_GRANT_CAPABILITIES)[number];

/**
 * A-bridge grant primitive (per RAM-294 §1).
 *
 * A row here is the *only* source of authority that lets an agent (typically
 * the CISO) read+comment+attach-evidence on a G-gate issue (or its sign-off
 * subtree) it does not otherwise own. Standing company/project write is
 * explicitly rejected — every grant is per-issue, action-typed, soft-revoked
 * only, and audited. The CISO never self-grants, and the audited CTO (the
 * agent on the gate's audited party) can never bind the CISO onto their own
 * gate (separation-of-duties).
 *
 * `capabilities` is an array of action-typed strings, NOT a coarse read/write
 * bit. The default contract below grants verdict + comment + evidence + read
 * — but explicitly NOT `issue.mutate`, which would let the grantee close,
 * status-change, edit plan, or reassign.
 */
export const issueAccessGrants = pgTable(
  "issue_access_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    scopeRootIssueId: uuid("scope_root_issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    capabilities: text("capabilities").array().notNull(),
    grantSource: text("grant_source").notNull(),
    parentGrantId: uuid("parent_grant_id"),
    grantedByType: text("granted_by_type").notNull(),
    grantedById: text("granted_by_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByType: text("revoked_by_type"),
    revokedById: text("revoked_by_id"),
    revokeReason: text("revoke_reason"),
  },
  (table) => ({
    companyIssueIdx: index("issue_access_grants_company_issue_idx").on(
      table.companyId,
      table.issueId,
    ),
    agentIdx: index("issue_access_grants_agent_idx").on(
      table.companyId,
      table.agentId,
    ),
    parentIdx: index("issue_access_grants_parent_idx").on(table.parentGrantId),
    scopeRootIdx: index("issue_access_grants_scope_root_idx").on(
      table.companyId,
      table.scopeRootIssueId,
    ),
    activeByAgentIssueIdx: index("issue_access_grants_active_by_agent_issue_idx")
      .on(table.companyId, table.agentId, table.issueId)
      .where(sql`${table.revokedAt} is null`),
    activeByScopeIdx: index("issue_access_grants_active_by_scope_idx")
      .on(table.companyId, table.agentId, table.scopeRootIssueId)
      .where(sql`${table.revokedAt} is null`),
  }),
);

/**
 * Append-only audit log for every grant mint / revoke / cascade / use event.
 * Hash-chained per company for tamper detection on read paths that need to
 * prove the grant history has not been silently rewritten. Phase-B (§5 of
 * RAM-294) reuses this chain for the verdict ledger; the columns reserved
 * here keep that migration a no-op.
 */
export const issueAccessGrantAudit = pgTable(
  "issue_access_grant_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: text("seq").notNull(),
    eventType: text("event_type").notNull(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    grantId: uuid("grant_id").references(() => issueAccessGrants.id),
    parentGrantId: uuid("parent_grant_id"),
    agentId: uuid("agent_id").references(() => agents.id),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    scopeRootIssueId: uuid("scope_root_issue_id").references(() => issues.id, {
      onDelete: "set null",
    }),
    capabilities: text("capabilities").array(),
    grantedByType: text("granted_by_type"),
    grantedById: text("granted_by_id"),
    revokedByType: text("revoked_by_type"),
    revokedById: text("revoked_by_id"),
    reason: text("reason"),
    details: jsonb("details").$type<Record<string, unknown> | null>(),
    prevHash: text("prev_hash"),
    hash: text("hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companySeqIdx: uniqueIndex("issue_access_grant_audit_company_seq_idx").on(
      table.companyId,
      table.seq,
    ),
    companyCreatedIdx: index("issue_access_grant_audit_company_created_idx").on(
      table.companyId,
      table.createdAt,
    ),
    grantIdx: index("issue_access_grant_audit_grant_idx").on(table.grantId),
    issueIdx: index("issue_access_grant_audit_issue_idx").on(table.issueId),
  }),
);
