/**
 * RBR-767 / RBR-796 sweep: route every issue that lacks a real, wakeable owner.
 *
 * This calls `resolveIssueAssigneeFallback` -- the exact function the create path uses --
 * rather than reimplementing the ladder. A bash replica of the invokability predicate
 * silently drifted (it treated `error` agents as non-invokable when they are in fact
 * invokable), which is precisely the class of bug this issue exists to kill. One ladder,
 * one source of truth.
 *
 * Two populations are swept:
 *
 *   1. **Unassigned** issues (`assignee_agent_id IS NULL AND assignee_user_id IS NULL`) --
 *      legacy invisible work created before the create-path fallback shipped.
 *   2. **Degraded** issues (`assignee_fallback_reason IS NOT NULL`) -- issues the create
 *      path deliberately wrote while the roster had no invokable owner. Per RBR-796 the
 *      create path fails *visible*, never *closed*: it assigns the company root even when
 *      that root is paused, and flags the row. Those rows have a non-null assignee, so the
 *      unassigned query alone would never find them. This flag is the sweep input that
 *      closes the loop -- a degraded roster produces a worklist, not an outage.
 *
 * Once a degraded issue is re-routed to a genuinely invokable owner the flag is cleared,
 * so the worklist drains as the roster recovers.
 *
 * Non-terminal = status NOT IN (done, cancelled). `backlog` IS included by design: an
 * unowned backlog item is still invisible work.
 *
 *   pnpm --filter @paperclipai/server exec tsx src/scripts/rbr767-sweep.ts --company <uuid> [--apply]
 */
import { issues, agents, createDb } from "@paperclipai/db";
import { and, eq, isNull, isNotNull, notInArray, or } from "drizzle-orm";

import { loadConfig } from "../config.js";
import {
  loadCompanyAgentOrgRows,
  resolveIssueAssigneeFallback,
} from "../services/issue-assignee-fallback.js";
import { evaluateAgentInvokabilityFromDb, type AgentOrgRow } from "../services/agent-invokability.js";

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
      assigneeAgentId: issues.assigneeAgentId,
      assigneeFallbackReason: issues.assigneeFallbackReason,
    })
    .from(issues)
    .where(and(
      eq(issues.companyId, companyId),
      notInArray(issues.status, TERMINAL),
      or(
        // (1) Legacy invisible work: no owner at all.
        and(isNull(issues.assigneeAgentId), isNull(issues.assigneeUserId)),
        // (2) Degraded work: an owner was written, but off a degraded roster. These rows
        //     have a non-null assignee and would be missed by the unassigned query alone.
        isNotNull(issues.assigneeFallbackReason),
      ),
    ));

  if (orphans.length === 0) {
    console.log(`SWEEP CLEAN: 0 unassigned or degraded non-terminal issues in ${companyId}`);
    return;
  }

  const unassignedCount = orphans.filter((issue) => !issue.assigneeAgentId).length;
  const degradedCount = orphans.length - unassignedCount;
  console.log(
    `${orphans.length} issue(s) needing an owner `
    + `(${unassignedCount} unassigned, ${degradedCount} degraded)${apply ? "" : " (dry run)"}`,
  );
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

    // `applied: false` now means only `no_agents_in_company` -- the ladder always names an
    // owner otherwise. A still-degraded result means the roster has not recovered yet, so
    // the issue stays flagged and gets picked up on the next run.
    if (!result.applied) {
      failed += 1;
      console.log(`${issue.identifier} [${issue.status}/${issue.priority}] -> NO OWNER POSSIBLE (${result.reason})`);
      continue;
    }
    if (result.degraded) {
      failed += 1;
      console.log(
        `${issue.identifier} [${issue.status}/${issue.priority}] -> STILL DEGRADED `
        + `(${result.degradedReason}); leaving flagged for the next sweep`,
      );
      continue;
    }

    const owner = `${result.reason} = ${agentName.get(result.assigneeAgentId) ?? "?"} (${result.assigneeAgentId})`;
    console.log(`${issue.identifier} [${issue.status}/${issue.priority}] -> ${owner}`);

    if (apply) {
      // Guard the write in two ways against drift since the initial snapshots:
      //  1. Re-validate invokability of the chosen owner against a fresh roster read,
      //     right before writing. `companyAgents` was loaded once at the top of the
      //     sweep; an agent could have been paused/terminated/reparented into an invalid
      //     chain since then, and Greptile correctly flagged that a stale invokability
      //     verdict could land a non-wakeable owner on the repaired issue.
      //  2. The UPDATE's WHERE clause re-checks unassigned + non-terminal at write time
      //     (unchanged from before), so a concurrent explicit assignment or a
      //     completion/cancellation between the SELECT and this UPDATE is still safe.
      const [freshOwner] = await db
        .select({
          id: agents.id,
          companyId: agents.companyId,
          name: agents.name,
          reportsTo: agents.reportsTo,
          status: agents.status,
        })
        .from(agents)
        .where(eq(agents.id, result.assigneeAgentId))
        .limit(1);
      const freshInvokability = await evaluateAgentInvokabilityFromDb(
        db,
        (freshOwner as AgentOrgRow | undefined) ?? null,
      );
      if (!freshInvokability.invokable) {
        failed += 1;
        console.log(
          `${issue.identifier} [${issue.status}/${issue.priority}] -> SKIPPED: chosen owner `
          + `${result.assigneeAgentId} is no longer invokable (${freshInvokability.reason}); rerun the sweep`,
        );
        continue;
      }
      await db.update(issues)
        .set({
          assigneeAgentId: result.assigneeAgentId,
          // The row now has a genuinely invokable owner, so it is no longer degraded.
          // Clearing the flag is what drains the worklist as the roster recovers.
          assigneeFallbackReason: null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(issues.id, issue.id),
          notInArray(issues.status, TERMINAL),
          or(
            // Unchanged guard for the legacy unassigned population: do not clobber a
            // concurrent explicit assignment landed since the SELECT.
            and(isNull(issues.assigneeAgentId), isNull(issues.assigneeUserId)),
            // Degraded rows already have an assignee, so the unassigned guard would reject
            // every one of them. Gate on the flag instead: still-degraded means nobody has
            // claimed it since the SELECT, so re-routing is safe.
            isNotNull(issues.assigneeFallbackReason),
          ),
        ));
    }
  }

  if (failed > 0) {
    console.error(
      `\n${failed} issue(s) still lack an invokable owner -- the roster has not recovered. `
      + `They remain flagged and will be re-routed by the next sweep.`,
    );
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
