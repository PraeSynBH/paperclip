import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import {
  companies,
  createDb,
  issueAccessGrantAudit,
  issueAccessGrants,
  issueDecisionOwners,
  issues,
  ISSUE_ACCESS_GRANT_CAPABILITIES,
  type Db,
  type IssueAccessGrantCapability,
} from "@paperclipai/db";

export const SECURITY_GATE_GRANT_SOURCE = "security_gate_decision_owner" as const;
export const SECURITY_GATE_TITLE_PREFIX = "G-gate:" as const;

const SECURITY_GATE_DEFAULT_CAPABILITIES: ReadonlyArray<IssueAccessGrantCapability> = [
  "gate_decision.transition",
  "issue.add_comment",
  "issue.attach_evidence",
  "issue.read",
];

const TERMINAL_STATUSES = ["done", "cancelled"] as const;

export type SecurityGateBackfillOptions = {
  companyId?: string;
  dryRun?: boolean;
  actor: { type: "agent" | "user" | "system"; id: string };
};

export type SecurityGateBackfillGrantRecord = {
  companyId: string;
  issueId: string;
  issueIdentifier: string | null;
  issueTitle: string;
  agentId: string;
  grantId: string;
  capabilities: ReadonlyArray<IssueAccessGrantCapability>;
  grantSource: typeof SECURITY_GATE_GRANT_SOURCE;
};

export type SecurityGateBackfillSkippedRecord = {
  companyId: string;
  issueId: string;
  issueIdentifier: string | null;
  issueTitle: string;
  agentId: string;
  reason:
    | "decision_owner_revoked"
    | "agent_already_has_active_grant"
    | "non_security_gate_decision_owner";
};

export type SecurityGateBackfillResult = {
  scannedIssues: number;
  scannedDecisionOwners: number;
  mintedGrants: SecurityGateBackfillGrantRecord[];
  skipped: SecurityGateBackfillSkippedRecord[];
  dryRun: boolean;
  companyIds: string[];
};

function defaultCapabilities(): IssueAccessGrantCapability[] {
  return SECURITY_GATE_DEFAULT_CAPABILITIES.filter((capability) =>
    (ISSUE_ACCESS_GRANT_CAPABILITIES as readonly string[]).includes(capability),
  );
}

function buildHashChainInput(args: {
  prevHash: string | null;
  eventType: string;
  companyId: string;
  grantId: string | null;
  parentGrantId: string | null;
  agentId: string | null;
  issueId: string | null;
  scopeRootIssueId: string | null;
  capabilities: ReadonlyArray<string> | null;
  grantedByType: string | null;
  grantedById: string | null;
  revokedByType: string | null;
  revokedById: string | null;
  reason: string | null;
}): string {
  return JSON.stringify({
    prevHash: args.prevHash,
    eventType: args.eventType,
    companyId: args.companyId,
    grantId: args.grantId,
    parentGrantId: args.parentGrantId,
    agentId: args.agentId,
    issueId: args.issueId,
    scopeRootIssueId: args.scopeRootIssueId,
    capabilities: args.capabilities,
    grantedByType: args.grantedByType,
    grantedById: args.grantedById,
    revokedByType: args.revokedByType,
    revokedById: args.revokedById,
    reason: args.reason,
  });
}

function deriveAuditHash(payload: Parameters<typeof buildHashChainInput>[0]): string {
  return createHash("sha256").update(buildHashChainInput(payload)).digest("hex");
}

function isSecurityGateDecisionOwner(
  decisionType: string,
): boolean {
  return decisionType === "security_gate_verdict";
}

export async function findOpenSecurityGates(
  db: Db,
  companyIds: string[],
): Promise<Array<{
  companyId: string;
  issueId: string;
  issueIdentifier: string | null;
  issueTitle: string;
  status: string;
}>> {
  if (companyIds.length === 0) return [];
  const rows = await db
    .select({
      companyId: issues.companyId,
      issueId: issues.id,
      issueIdentifier: issues.identifier,
      issueTitle: issues.title,
      status: issues.status,
    })
    .from(issues)
    .where(
      and(
        inArray(issues.companyId, companyIds),
        sql`${issues.title} ILIKE ${SECURITY_GATE_TITLE_PREFIX + "%"}`,
        notInArray(issues.status, [...TERMINAL_STATUSES]),
      ),
    );
  return rows;
}

export async function findActiveDecisionOwnersForIssues(
  db: Db,
  issueIds: string[],
): Promise<Array<{ companyId: string; issueId: string; agentId: string; decisionType: string }>> {
  if (issueIds.length === 0) return [];
  return db
    .select({
      companyId: issueDecisionOwners.companyId,
      issueId: issueDecisionOwners.issueId,
      agentId: issueDecisionOwners.agentId,
      decisionType: issueDecisionOwners.decisionType,
    })
    .from(issueDecisionOwners)
    .where(
      and(
        inArray(issueDecisionOwners.issueId, issueIds),
        isNull(issueDecisionOwners.revokedAt),
      ),
    );
}

export async function findActiveGrantsForAgentAndIssues(
  db: Db,
  agentId: string,
  issueIds: string[],
): Promise<Set<string>> {
  if (issueIds.length === 0) return new Set();
  const rows = await db
    .select({ issueId: issueAccessGrants.issueId })
    .from(issueAccessGrants)
    .where(
      and(
        eq(issueAccessGrants.agentId, agentId),
        inArray(issueAccessGrants.issueId, issueIds),
        isNull(issueAccessGrants.revokedAt),
      ),
    );
  return new Set(rows.map((row) => row.issueId));
}

export async function findLastAuditHash(
  db: Db,
  companyId: string,
): Promise<{ seq: string; hash: string } | null> {
  const rows = await db
    .select({ seq: issueAccessGrantAudit.seq, hash: issueAccessGrantAudit.hash })
    .from(issueAccessGrantAudit)
    .where(eq(issueAccessGrantAudit.companyId, companyId))
    .orderBy(sql`${issueAccessGrantAudit.createdAt} desc`)
    .limit(1);
  return rows[0] ?? null;
}

export async function backfillSecurityGateGrants(
  db: Db,
  options: SecurityGateBackfillOptions,
): Promise<SecurityGateBackfillResult> {
  const dryRun = options.dryRun ?? false;
  const companyIdFilter = options.companyId;

  const targetCompanies = companyIdFilter
    ? await db
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.id, companyIdFilter))
    : await db.select({ id: companies.id }).from(companies);

  const companyIds = targetCompanies.map((c) => c.id);
  const gates = await findOpenSecurityGates(db, companyIds);

  const result: SecurityGateBackfillResult = {
    scannedIssues: gates.length,
    scannedDecisionOwners: 0,
    mintedGrants: [],
    skipped: [],
    dryRun,
    companyIds,
  };

  if (gates.length === 0) {
    return result;
  }

  const issueIds = gates.map((g) => g.issueId);
  const decisionOwners = await findActiveDecisionOwnersForIssues(db, issueIds);
  result.scannedDecisionOwners = decisionOwners.length;

  const decisionOwnersByIssue = new Map<string, Array<{ agentId: string; decisionType: string }>>();
  for (const owner of decisionOwners) {
    const list = decisionOwnersByIssue.get(owner.issueId) ?? [];
    list.push({ agentId: owner.agentId, decisionType: owner.decisionType });
    decisionOwnersByIssue.set(owner.issueId, list);
  }

  const lastHashCache = new Map<string, string | null>();

  for (const gate of gates) {
    const owners = decisionOwnersByIssue.get(gate.issueId) ?? [];
    for (const owner of owners) {
      if (!isSecurityGateDecisionOwner(owner.decisionType)) {
        result.skipped.push({
          companyId: gate.companyId,
          issueId: gate.issueId,
          issueIdentifier: gate.issueIdentifier,
          issueTitle: gate.issueTitle,
          agentId: owner.agentId,
          reason: "non_security_gate_decision_owner",
        });
        continue;
      }

      const alreadyGranted = await findActiveGrantsForAgentAndIssues(
        db,
        owner.agentId,
        [gate.issueId],
      );
      if (alreadyGranted.has(gate.issueId)) {
        result.skipped.push({
          companyId: gate.companyId,
          issueId: gate.issueId,
          issueIdentifier: gate.issueIdentifier,
          issueTitle: gate.issueTitle,
          agentId: owner.agentId,
          reason: "agent_already_has_active_grant",
        });
        continue;
      }

      if (dryRun) {
        result.mintedGrants.push({
          companyId: gate.companyId,
          issueId: gate.issueId,
          issueIdentifier: gate.issueIdentifier,
          issueTitle: gate.issueTitle,
          agentId: owner.agentId,
          grantId: "dry-run",
          capabilities: defaultCapabilities(),
          grantSource: SECURITY_GATE_GRANT_SOURCE,
        });
        continue;
      }

      const capabilities = defaultCapabilities();
      const lastHash = lastHashCache.has(gate.companyId)
        ? lastHashCache.get(gate.companyId) ?? null
        : (await findLastAuditHash(db, gate.companyId))?.hash ?? null;
      if (!lastHashCache.has(gate.companyId)) {
        lastHashCache.set(gate.companyId, lastHash);
      }

      const grantId = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(issueAccessGrants)
          .values({
            companyId: gate.companyId,
            agentId: owner.agentId,
            issueId: gate.issueId,
            scopeRootIssueId: gate.issueId,
            capabilities,
            grantSource: SECURITY_GATE_GRANT_SOURCE,
            grantedByType: options.actor.type,
            grantedById: options.actor.id,
            metadata: { backfill: true, origin: "ram-931" },
          })
          .returning({ id: issueAccessGrants.id });
        if (!inserted) {
          throw new Error("Failed to insert security gate grant");
        }

        const prevHash = lastHash;
        const seq = `${gate.companyId}-${Date.now()}-${inserted.id}`;
        const hashInput = {
          prevHash,
          eventType: "grant_minted",
          companyId: gate.companyId,
          grantId: inserted.id,
          parentGrantId: null,
          agentId: owner.agentId,
          issueId: gate.issueId,
          scopeRootIssueId: gate.issueId,
          capabilities,
          grantedByType: options.actor.type,
          grantedById: options.actor.id,
          revokedByType: null,
          revokedById: null,
          reason: "security_gate_backfill",
        };
        const hash = deriveAuditHash(hashInput);

        await tx.insert(issueAccessGrantAudit).values({
          seq,
          eventType: "grant_minted",
          companyId: gate.companyId,
          grantId: inserted.id,
          parentGrantId: null,
          agentId: owner.agentId,
          issueId: gate.issueId,
          scopeRootIssueId: gate.issueId,
          capabilities,
          grantedByType: options.actor.type,
          grantedById: options.actor.id,
          reason: "security_gate_backfill",
          details: { backfill: true, origin: "ram-931" },
          prevHash,
          hash,
        });

        lastHashCache.set(gate.companyId, hash);
        return inserted.id;
      });

      result.mintedGrants.push({
        companyId: gate.companyId,
        issueId: gate.issueId,
        issueIdentifier: gate.issueIdentifier,
        issueTitle: gate.issueTitle,
        agentId: owner.agentId,
        grantId,
        capabilities,
        grantSource: SECURITY_GATE_GRANT_SOURCE,
      });
    }
  }

  return result;
}

export function createSecurityGateBackfillService(db: Db) {
  return {
    backfillSecurityGateGrants: (options: SecurityGateBackfillOptions) =>
      backfillSecurityGateGrants(db, options),
    findOpenSecurityGates: (companyIds: string[]) => findOpenSecurityGates(db, companyIds),
    findActiveDecisionOwnersForIssues: (issueIds: string[]) =>
      findActiveDecisionOwnersForIssues(db, issueIds),
    findActiveGrantsForAgentAndIssues: (agentId: string, issueIds: string[]) =>
      findActiveGrantsForAgentAndIssues(db, agentId, issueIds),
  };
}
