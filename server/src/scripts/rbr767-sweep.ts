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
 *      legacy invisible work created before the create-path fallback shipped, plus
 *      zero-agent-era work: rows the create path deliberately wrote with no assignee
 *      because the company had no agents at all (`no_agents_in_company`). Zero agents is
 *      the bootstrap state of every company, not an error, so the create path flags rather
 *      than refuses -- and those rows land here.
 *   2. **Degraded** issues (`assignee_fallback_reason IS NOT NULL`) -- issues the create
 *      path deliberately wrote while the roster had no invokable owner. Per RBR-796 the
 *      create path fails *visible*, never *closed*: it assigns the company root even when
 *      that root is paused, and flags the row. Those rows have a non-null assignee, so the
 *      unassigned query alone would never find them. This flag is the sweep input that
 *      closes the loop -- a degraded roster produces a worklist, not an outage.
 *
 * Both `no_invokable_owner` and `no_agents_in_company` drain through the identical path:
 * once a row lands on a genuinely invokable owner the flag is cleared. A zero-agent-era
 * issue is routed by the first sweep after the first hire. No new machinery.
 *
 * Once a degraded issue is re-routed to a genuinely invokable owner the flag is cleared,
 * so the worklist drains as the roster recovers.
 *
 * Non-terminal = status NOT IN (done, cancelled). `backlog` IS included by design: an
 * unowned backlog item is still invisible work.
 *
 *   pnpm --filter @paperclipai/server exec tsx src/scripts/rbr767-sweep.ts --company <uuid> [--apply]
 */
import type { Db } from "@paperclipai/db";
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

export type Rbr767SweepResult = {
  /** Rows the sweep considered: unassigned or flagged, non-terminal. */
  scanned: number;
  /** Rows that landed on a genuinely invokable owner (written when `apply`). */
  repaired: number;
  /** Rows that still lack an invokable owner and stay flagged for the next run. */
  failed: number;
  lines: string[];
};

/**
 * The sweep body, exported so it can be exercised against a real database rather than
 * only via the CLI. `log` is injected so tests can assert on the worklist without
 * capturing stdout.
 */
export async function runRbr767Sweep(
  db: Db,
  options: { companyId: string; apply?: boolean; log?: (line: string) => void },
): Promise<Rbr767SweepResult> {
  const { companyId } = options;
  const apply = options.apply ?? false;
  const lines: string[] = [];
  const log = (line: string) => {
    lines.push(line);
    options.log?.(line);
  };

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
        // (1) Legacy invisible work, plus zero-agent-era work: no owner at all.
        and(isNull(issues.assigneeAgentId), isNull(issues.assigneeUserId)),
        // (2) Degraded work: an owner was written, but off a degraded roster. These rows
        //     have a non-null assignee and would be missed by the unassigned query alone.
        isNotNull(issues.assigneeFallbackReason),
      ),
    ));

  if (orphans.length === 0) {
    log(`SWEEP CLEAN: 0 unassigned or degraded non-terminal issues in ${companyId}`);
    return { scanned: 0, repaired: 0, failed: 0, lines };
  }

  const unassignedCount = orphans.filter((issue) => !issue.assigneeAgentId).length;
  const degradedCount = orphans.length - unassignedCount;
  log(
    `${orphans.length} issue(s) needing an owner `
    + `(${unassignedCount} unassigned, ${degradedCount} degraded)${apply ? "" : " (dry run)"}`,
  );
  let failed = 0;
  let repaired = 0;

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

    // `applied: false` here means only `no_agents_in_company` -- the company still has no
    // agents, so the row keeps its flag and is re-routed by the first sweep after the
    // first hire. A still-degraded result means the roster has not recovered yet, same
    // outcome. Neither is an error in the row; both are "the roster is not ready."
    if (!result.applied) {
      failed += 1;
      log(`${issue.identifier} [${issue.status}/${issue.priority}] -> NO OWNER POSSIBLE (${result.reason})`);
      continue;
    }
    if (result.degraded) {
      failed += 1;
      log(
        `${issue.identifier} [${issue.status}/${issue.priority}] -> STILL DEGRADED `
        + `(${result.degradedReason}); leaving flagged for the next sweep`,
      );
      continue;
    }

    const owner = `${result.reason} = ${agentName.get(result.assigneeAgentId) ?? "?"} (${result.assigneeAgentId})`;
    log(`${issue.identifier} [${issue.status}/${issue.priority}] -> ${owner}`);
    repaired += 1;

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
        repaired -= 1;
        log(
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
            //
            // RBR-814: that premise used to be false, and this branch was silently
            // stealing explicit assignments. Nothing on the update/reassign path cleared
            // the flag, so a row a human deliberately took stayed flagged forever and
            // every subsequent sweep overwrote their owner with the ladder's pick. The
            // fix is to make the premise true rather than to weaken this predicate:
            // `issueService.update` and `issueService.checkout` now clear
            // `assigneeFallbackReason` whenever an explicit assignee lands, so a claimed
            // row is out of the worklist entirely and a row that reaches here really is
            // one nobody has accepted. Keep this branch -- deleting it would strand every
            // genuinely-degraded row, which all carry an assignee by construction.
            isNotNull(issues.assigneeFallbackReason),
          ),
        ));
    }
  }

  if (failed > 0) {
    log(
      `\n${failed} issue(s) still lack an invokable owner -- the roster has not recovered. `
      + `They remain flagged and will be re-routed by the next sweep.`,
    );
  }

  return { scanned: orphans.length, repaired, failed, lines };
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

  const result = await runRbr767Sweep(db, {
    companyId,
    apply,
    log: (line) => console.log(line),
  });
  if (result.failed > 0) process.exitCode = 1;
}

// Only run the CLI when this module is the process entrypoint. Importing it from a test
// must not start a sweep or call process.exit.
const invokedAsScript = process.argv[1]?.includes("rbr767-sweep") ?? false;
if (invokedAsScript) {
  // The pg pool keeps the event loop alive; exit explicitly once the sweep is done.
  main().then(
    () => process.exit(process.exitCode ?? 0),
    (error: unknown) => {
      console.error(error);
      process.exit(1);
    },
  );
}
