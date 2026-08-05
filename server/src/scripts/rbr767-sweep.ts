/**
 * RBR-767 one-time sweep: route every unassigned non-terminal issue to a real, wakeable
 * owner.
 *
 * This calls `resolveIssueAssigneeFallback` -- the exact function the create path uses --
 * rather than reimplementing the ladder. A bash replica of the invokability predicate
 * silently drifted (it treated `error` agents as non-invokable when they are in fact
 * invokable), which is precisely the class of bug this issue exists to kill. One ladder,
 * one source of truth.
 *
 * Non-terminal = status NOT IN (done, cancelled). `backlog` IS included by design: an
 * unowned backlog item is still invisible work.
 *
 *   pnpm --filter @paperclipai/server exec tsx src/scripts/rbr767-sweep.ts --company <uuid> [--apply]
 */
import { issues, createDb } from "@paperclipai/db";
import { and, eq, isNull, notInArray } from "drizzle-orm";

import { loadConfig } from "../config.js";
import {
  loadCompanyAgentOrgRows,
  resolveIssueAssigneeFallback,
} from "../services/issue-assignee-fallback.js";

const TERMINAL = ["done", "cancelled"];

function parseFlag(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

async function main() {
  const companyId = parseFlag("--company");
  if (!companyId) throw new Error("--company <uuid> is required");
  const apply = process.argv.includes("--apply");

  const config = loadConfig();
  const db = createDb(
    process.env.DATABASE_URL?.trim()
    || config.databaseUrl
    || `postgres://paperclip:paperclip@127.0.0.1:${config.embeddedPostgresPort}/paperclip`,
  );

  const companyAgents = await loadCompanyAgentOrgRows(db, companyId);
  const agentName = new Map(companyAgents.map((a) => [a.id, a.name]));

  const orphans = await db
    .select({
      id: issues.id,
      identifier: issues.identifier,
      status: issues.status,
      priority: issues.priority,
      parentId: issues.parentId,
      createdByAgentId: issues.createdByAgentId,
    })
    .from(issues)
    .where(and(
      eq(issues.companyId, companyId),
      isNull(issues.assigneeAgentId),
      isNull(issues.assigneeUserId),
      notInArray(issues.status, TERMINAL),
    ));

  if (orphans.length === 0) {
    console.log(`SWEEP CLEAN: 0 unassigned non-terminal issues in ${companyId}`);
    return;
  }

  console.log(`${orphans.length} unassigned non-terminal issue(s)${apply ? "" : " (dry run)"}`);
  let failed = 0;

  for (const issue of orphans) {
    const parent = issue.parentId
      ? (await db.select({ assigneeAgentId: issues.assigneeAgentId })
        .from(issues).where(eq(issues.id, issue.parentId)).limit(1))[0]
      : null;

    const result = resolveIssueAssigneeFallback({
      companyId,
      parentAssigneeAgentId: parent?.assigneeAgentId ?? null,
      createdByAgentId: issue.createdByAgentId,
      companyAgents,
    });

    if (!result.applied) {
      failed += 1;
      console.log(`${issue.identifier} [${issue.status}/${issue.priority}] -> NO INVOKABLE OWNER (${result.reason})`);
      continue;
    }

    const owner = `${result.reason} = ${agentName.get(result.assigneeAgentId) ?? "?"} (${result.assigneeAgentId})`;
    console.log(`${issue.identifier} [${issue.status}/${issue.priority}] -> ${owner}`);

    if (apply) {
      // Guard the write against drift since the initial select: only land the fallback
      // owner if the issue is still unassigned and still non-terminal. Otherwise a
      // concurrent explicit assignment or a completion/cancellation between the SELECT and
      // this UPDATE would get silently overwritten.
      await db.update(issues)
        .set({ assigneeAgentId: result.assigneeAgentId, updatedAt: new Date() })
        .where(and(
          eq(issues.id, issue.id),
          isNull(issues.assigneeAgentId),
          isNull(issues.assigneeUserId),
          notInArray(issues.status, TERMINAL),
        ));
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} issue(s) have no invokable owner -- the company has no wakeable agent.`);
    process.exitCode = 1;
  }
}

// The pg pool keeps the event loop alive; exit explicitly once the sweep is done.
main().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
