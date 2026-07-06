import { createHash } from "node:crypto";
import { and, eq, ne, inArray, notInArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  issues,
  heartbeatRuns,
  securityAuditLog,
  forceReassignIdempotency,
  agentApiKeys,
} from "@paperclipai/db";
import {
  getAgentWorkEligibility,
  type AgentEligibilityAgent,
} from "@paperclipai/shared";

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}

export function chainHash(prevHash: string | null, payload: Record<string, unknown>): string {
  const input = canonicalJson({ prevHash: prevHash ?? null, payload });
  return createHash("sha256").update(input).digest("hex");
}

export function verifyAuditChain(rows: (typeof securityAuditLog.$inferSelect)[]): {
  valid: boolean;
  errorIndex?: number;
  errorMessage?: string;
} {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const expectedPrev = i === 0 ? null : rows[i - 1]!.hash;
    if (row.prevHash !== expectedPrev) {
      return {
        valid: false,
        errorIndex: i,
        errorMessage: `prev_hash mismatch at row ${i}: expected ${expectedPrev ?? "null"}, got ${row.prevHash ?? "null"}`,
      };
    }
    const computed = chainHash(row.prevHash ?? null, row.payload);
    if (computed !== row.hash) {
      return {
        valid: false,
        errorIndex: i,
        errorMessage: `hash mismatch at row ${i}: expected ${computed}, got ${row.hash}`,
      };
    }
  }
  return { valid: true };
}

export type OrphanEvidence = {
  orphaned: boolean;
  matchedCondition: "assignee_terminated" | "assignee_missing_or_deleted" | "management_chain_broken" | "none";
  detail: string;
  fromChainSnapshot: Array<{ id: string; name: string; status: string }>;
};

function toEligibilityAgent(
  row: Pick<typeof agents.$inferSelect, "id" | "companyId" | "name" | "status" | "reportsTo">,
): AgentEligibilityAgent {
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    status: row.status,
    reportsTo: row.reportsTo,
  };
}

async function buildManagementChain(
  dbOrTx: Db,
  startAgentId: string,
  maxDepth = 50,
): Promise<typeof agents.$inferSelect[]> {
  const chain: typeof agents.$inferSelect[] = [];
  const visited = new Set<string>();
  let currentId: string | null = startAgentId;
  while (currentId && !visited.has(currentId) && chain.length < maxDepth) {
    visited.add(currentId);
    const rows = await dbOrTx.select().from(agents).where(eq(agents.id, currentId));
    const row = rows[0];
    if (!row) break;
    chain.push(row);
    currentId = row.reportsTo ?? null;
  }
  return chain;
}

export async function detectOrphan(
  db: Db,
  assigneeAgentId: string,
): Promise<OrphanEvidence> {
  const chain = await buildManagementChain(db, assigneeAgentId);

  const snapshot = chain.map((a) => ({
    id: a.id,
    name: a.name,
    status: a.status,
  }));

  const assignee = chain.find((a) => a.id === assigneeAgentId);
  if (!assignee) {
    return {
      orphaned: true,
      matchedCondition: "assignee_missing_or_deleted",
      detail: "Assignee agent not found in database",
      fromChainSnapshot: snapshot,
    };
  }

  if (assignee.status === "terminated") {
    return {
      orphaned: true,
      matchedCondition: "assignee_terminated",
      detail: "Assignee agent is terminated",
      fromChainSnapshot: snapshot,
    };
  }

  if (assignee.status === "pending_approval") {
    return {
      orphaned: true,
      matchedCondition: "assignee_terminated",
      detail: "Assignee agent is pending approval",
      fromChainSnapshot: snapshot,
    };
  }

  const allCompanyRows = await db.select().from(agents).where(eq(agents.companyId, assignee.companyId));
  const eligibility = getAgentWorkEligibility({
    agent: toEligibilityAgent(assignee),
    agents: allCompanyRows.map(toEligibilityAgent),
  });

  const chainInvalid =
    eligibility.orgChainHealth.status === "invalid_org_chain";

  if (chainInvalid && !eligibility.invokable) {
    return {
      orphaned: true,
      matchedCondition: "management_chain_broken",
      detail: `Management chain is broken: ${eligibility.orgChainHealth.repairGuidance ?? eligibility.orgChainHealth.reason ?? "invokable check failed"}`,
      fromChainSnapshot: snapshot,
    };
  }

  return {
    orphaned: false,
    matchedCondition: "none",
    detail: "Assignee and management chain are healthy",
    fromChainSnapshot: snapshot,
  };
}

export interface ForceReassignInput {
  issueId: string;
  companyId: string;
  fromAssigneeAgentId?: string | null;
  newAssigneeAgentId?: string | null;
  newAssigneeUserId?: string | null;
  expectedVersion?: number | null;
  idempotencyKey?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  actor: {
    type: "board" | "agent";
    actorId: string;
    agentId?: string | null;
    userId?: string | null;
    runId?: string | null;
  };
}

export interface ForceReassignResult {
  issue: typeof issues.$inferSelect;
  auditRecordId: string;
  previousVersion: number;
  newVersion: number;
  fromAssigneeAgentId: string | null;
  fromAssigneeUserId: string | null;
  orphaned: boolean;
  orphanedReason: string;
  reassignedIdemKeyRecorded: boolean;
}

export function forceReassignService(db: Db) {
  async function getLatestAuditHash(companyId: string): Promise<string | null> {
    const rows = await db
      .select({ hash: securityAuditLog.hash })
      .from(securityAuditLog)
      .where(eq(securityAuditLog.companyId, companyId))
      .orderBy(sql`${securityAuditLog.createdAt} desc`)
      .limit(1);
    return rows[0]?.hash ?? null;
  }

  async function forceReassign(
    input: ForceReassignInput,
  ): Promise<ForceReassignResult> {
    const idpKey = input.idempotencyKey?.trim();
    const isIdempotent = typeof idpKey === "string" && idpKey.length > 0;

    return db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;

      if (isIdempotent) {
        await txDb.execute(
          sql`SELECT id FROM force_reassign_idempotency
              WHERE company_id = ${input.companyId}
                AND issue_id = ${input.issueId}::uuid
                AND idempotency_key = ${idpKey}
              FOR UPDATE`,
        );
        const existingIdem = await txDb
          .select()
          .from(forceReassignIdempotency)
          .where(
            and(
              eq(forceReassignIdempotency.companyId, input.companyId),
              eq(forceReassignIdempotency.issueId, input.issueId),
              eq(forceReassignIdempotency.idempotencyKey, idpKey),
            ),
          );
        if (existingIdem.length > 0) {
          const stored = existingIdem[0]!;
          throw Object.assign(new Error("IDEMPOTENT_REPLAY"), {
            status: stored.responseStatus,
            body: stored.responseBody,
          });
        }
      }

      await txDb.execute(
        sql`SELECT id FROM issues WHERE id = ${input.issueId}::uuid FOR UPDATE`,
      );
      const rows = await txDb
        .select()
        .from(issues)
        .where(and(eq(issues.id, input.issueId), eq(issues.companyId, input.companyId)));
      const issue = rows[0];
      if (!issue) {
        throw Object.assign(new Error("Issue not found"), { status: 404 });
      }

      if (input.expectedVersion !== undefined && input.expectedVersion !== null) {
        if (issue.version !== input.expectedVersion) {
          throw Object.assign(new Error("Version mismatch"), { status: 409, details: { expected: input.expectedVersion, actual: issue.version } });
        }
      }

      if (input.fromAssigneeAgentId && issue.assigneeAgentId !== input.fromAssigneeAgentId) {
        throw Object.assign(new Error("expected_from_mismatch"), {
          status: 409,
          details: { expected: input.fromAssigneeAgentId, actual: issue.assigneeAgentId },
        });
      }

      if (input.newAssigneeAgentId) {
        const targetRows = await txDb
          .select()
          .from(agents)
          .where(eq(agents.id, input.newAssigneeAgentId))
          .for("update");
        const targetAgent = targetRows[0];
        if (!targetAgent) {
          throw Object.assign(new Error("Target agent not found"), { status: 422 });
        }
        if (targetAgent.companyId !== input.companyId) {
          throw Object.assign(new Error("Target agent belongs to different company"), { status: 403 });
        }
        if (targetAgent.status === "terminated") {
          throw Object.assign(new Error("Target agent is terminated"), { status: 422 });
        }
        if (targetAgent.status === "pending_approval") {
          throw Object.assign(new Error("Target agent is not yet approved"), { status: 422 });
        }

        if (input.actor.agentId) {
          const actorAgent = (await txDb.select().from(agents).where(eq(agents.id, input.actor.agentId)).for("update"))[0];
          if (actorAgent && (actorAgent.status === "terminated" || actorAgent.status === "pending_approval")) {
            throw Object.assign(new Error("Actor agent is not active"), { status: 403 });
          }
        }
      }

      const currentAssigneeId = issue.assigneeAgentId;
      let orphanEvidence: OrphanEvidence = {
        orphaned: false,
        matchedCondition: "none",
        detail: "No current assignee to check",
        fromChainSnapshot: [],
      };

      if (currentAssigneeId) {
        orphanEvidence = await detectOrphan(txDb, currentAssigneeId);

        const chainRows = await buildManagementChain(txDb, currentAssigneeId);
        for (const chainAgent of chainRows) {
          await txDb.execute(
            sql`SELECT id FROM agents WHERE id = ${chainAgent.id}::uuid FOR UPDATE`,
          );
        }
      }

      const latestAuditHash = await getLatestAuditHash(input.companyId);
      const auditPayload = {
        companyId: input.companyId,
        issueId: input.issueId,
        previousAssigneeAgentId: issue.assigneeAgentId ?? null,
        previousAssigneeUserId: issue.assigneeUserId ?? null,
        newAssigneeAgentId: input.newAssigneeAgentId ?? null,
        newAssigneeUserId: input.newAssigneeUserId ?? null,
        reason: input.reason ?? null,
        fromVersion: issue.version,
        orphanEvidence: {
          orphaned: orphanEvidence.orphaned,
          matchedCondition: orphanEvidence.matchedCondition,
          detail: orphanEvidence.detail,
        },
        fromChainSnapshot: orphanEvidence.fromChainSnapshot,
        metadata: input.metadata ?? null,
      };

      const auditHash = chainHash(latestAuditHash, auditPayload);

      const [auditRow] = await txDb
        .insert(securityAuditLog)
        .values({
          companyId: input.companyId,
          eventType: "issue.force_reassign",
          actorType: input.actor.type,
          actorId: input.actor.actorId,
          entityType: "issue",
          entityId: input.issueId,
          prevHash: latestAuditHash,
          hash: auditHash,
          payload: auditPayload,
          runId: input.actor.runId ?? null,
        })
        .returning();
      if (!auditRow) {
        throw new Error("Failed to write audit record");
      }

      const nextVersion = issue.version + 1;
      const [updatedIssue] = await txDb
        .update(issues)
        .set({
          assigneeAgentId: input.newAssigneeAgentId ?? null,
          assigneeUserId: input.newAssigneeUserId ?? null,
          version: nextVersion,
          checkoutRunId: null,
          executionRunId: null,
          executionAgentNameKey: null,
          executionLockedAt: null,
          status: issue.status === "in_progress" ? "todo" : issue.status,
          updatedAt: new Date(),
        })
        .where(eq(issues.id, input.issueId))
        .returning();
      if (!updatedIssue) {
        throw new Error("Failed to update issue");
      }

      const responseStatus = 200;
      const responseBody = {
        issueId: updatedIssue.id,
        previousVersion: issue.version,
        newVersion: nextVersion,
        fromAssigneeAgentId: issue.assigneeAgentId,
        fromAssigneeUserId: issue.assigneeUserId,
        newAssigneeAgentId: input.newAssigneeAgentId ?? null,
        newAssigneeUserId: input.newAssigneeUserId ?? null,
        orphaned: orphanEvidence.orphaned,
        orphanedReason: orphanEvidence.detail,
        auditRecordId: auditRow.id,
      };

      if (isIdempotent) {
        await txDb.insert(forceReassignIdempotency).values({
          companyId: input.companyId,
          issueId: input.issueId,
          idempotencyKey: idpKey,
          responseStatus,
          responseBody,
          runId: input.actor.runId ?? null,
        });
      }

      if (issue.checkoutRunId) {
        await txDb
          .update(heartbeatRuns)
.set({ status: "cancelled", finishedAt: new Date() })
        .where(eq(heartbeatRuns.id, issue.checkoutRunId))
          .catch(() => null);
      }
      if (issue.executionRunId && issue.executionRunId !== issue.checkoutRunId) {
        await txDb
          .update(heartbeatRuns)
.set({ status: "cancelled", finishedAt: new Date() })
        .where(eq(heartbeatRuns.id, issue.executionRunId))
          .catch(() => null);
      }

      return {
        issue: updatedIssue,
        auditRecordId: auditRow.id,
        previousVersion: issue.version,
        newVersion: nextVersion,
        fromAssigneeAgentId: issue.assigneeAgentId,
        fromAssigneeUserId: issue.assigneeUserId,
        orphaned: orphanEvidence.orphaned,
        orphanedReason: orphanEvidence.detail,
        reassignedIdemKeyRecorded: isIdempotent,
      };
    });
  }

  return {
    forceReassign,
    getLatestAuditHash,
    verifyAuditChain,
    detectOrphan,
  };
}