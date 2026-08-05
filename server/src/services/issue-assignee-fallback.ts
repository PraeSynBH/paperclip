import type { Db } from "@paperclipai/db";
import { agents } from "@paperclipai/db";
import { eq } from "drizzle-orm";

import { evaluateAgentInvokability, type AgentOrgRow } from "./agent-invokability.js";

/**
 * Deterministic fallback ownership for issues created without an assignee.
 *
 * An issue with `assigneeAgentId: null` and `assigneeUserId: null` is picked up by no
 * heartbeat, ever, regardless of priority. It is not in anyone's queue -- it is invisible.
 * The orphan detector keys on first-class blocker links, so an unassigned issue with no
 * blocker edge is invisible to it by construction: there is no edge to traverse.
 *
 * This module closes the creation path. The ladder below is evaluated in order and the
 * first *invokable* (wakeable) agent wins. "Invokable" is the same predicate the runtime
 * uses to decide whether an agent can be woken at all, so a fallback owner is guaranteed
 * to be a real, wakeable owner rather than a paused/terminated/broken-org-chain agent.
 *
 *   1. `parent`  -- the parent issue's assignee. Child work inherits its parent's owner.
 *   2. `creator_manager` -- the creating agent's nearest invokable manager, walking
 *      `reportsTo` upward. An agent that files work without naming an owner is escalating
 *      to their management chain, which is what a human would do.
 *   3. `creator` -- the creating agent itself, when it has no invokable manager.
 *   4. `company_root` -- the company root agent (`reportsTo IS NULL`), i.e. the CEO.
 *
 * If no rung yields an invokable agent the caller must reject the create loudly rather
 * than silently minting an invisible issue.
 *
 * Backlog is deliberately NOT excluded. A backlog issue still gets a deterministic owner;
 * it simply does not generate an assignment wake (existing behaviour for `status: backlog`).
 * Owning and waking are separate concerns -- an unowned backlog item is still invisible
 * work, it is just invisible work nobody has promised to do yet.
 */

export type IssueAssigneeFallbackReason =
  | "parent"
  | "creator_manager"
  | "creator"
  | "company_root";

export type IssueAssigneeFallbackResult =
  | { applied: false; reason: "explicit" }
  | { applied: true; assigneeAgentId: string; reason: IssueAssigneeFallbackReason }
  | { applied: false; reason: "no_invokable_owner"; candidatesConsidered: string[] };

export type IssueAssigneeFallbackInput = {
  companyId: string;
  /** Explicit agent assignee from the request, if any. */
  assigneeAgentId?: string | null;
  /** Explicit user assignee from the request, if any. A user assignee is a real owner. */
  assigneeUserId?: string | null;
  /** Assignee of the parent issue, when creating a child. */
  parentAssigneeAgentId?: string | null;
  /** The agent creating the issue, if the actor is an agent. */
  createdByAgentId?: string | null;
  /** Company agent roster, used to evaluate invokability and walk the org chain. */
  companyAgents: AgentOrgRow[];
};

const MAX_MANAGER_CHAIN_DEPTH = 32;

function isInvokable(agentId: string | null | undefined, companyAgents: AgentOrgRow[]): boolean {
  if (!agentId) return false;
  const agent = companyAgents.find((row) => row.id === agentId);
  if (!agent) return false;
  return evaluateAgentInvokability(agent, companyAgents).invokable;
}

/**
 * Walk `reportsTo` upward from `agentId` and return the first invokable manager.
 * Cycle-safe and depth-capped; returns null when the chain yields nothing wakeable.
 */
function findNearestInvokableManager(
  agentId: string,
  companyAgents: AgentOrgRow[],
): string | null {
  const byId = new Map(companyAgents.map((row) => [row.id, row]));
  const seen = new Set<string>([agentId]);
  let current = byId.get(agentId)?.reportsTo ?? null;
  let depth = 0;

  while (current && depth < MAX_MANAGER_CHAIN_DEPTH) {
    if (seen.has(current)) return null;
    seen.add(current);
    if (isInvokable(current, companyAgents)) return current;
    current = byId.get(current)?.reportsTo ?? null;
    depth += 1;
  }
  return null;
}

/**
 * The company root agent: the unique agent with no manager. When several exist (or the
 * roster is malformed) the ID sort keeps selection deterministic across calls.
 */
function findCompanyRootAgent(companyAgents: AgentOrgRow[]): string | null {
  const roots = companyAgents
    .filter((row) => !row.reportsTo)
    .map((row) => row.id)
    .sort();
  return roots.find((id) => isInvokable(id, companyAgents)) ?? null;
}

export function resolveIssueAssigneeFallback(
  input: IssueAssigneeFallbackInput,
): IssueAssigneeFallbackResult {
  const hasExplicitAgent = typeof input.assigneeAgentId === "string" && input.assigneeAgentId.length > 0;
  const hasExplicitUser = typeof input.assigneeUserId === "string" && input.assigneeUserId.length > 0;
  if (hasExplicitAgent || hasExplicitUser) {
    return { applied: false, reason: "explicit" };
  }

  const { companyAgents } = input;
  const candidatesConsidered: string[] = [];

  const rungs: Array<{ reason: IssueAssigneeFallbackReason; agentId: string | null }> = [
    { reason: "parent", agentId: input.parentAssigneeAgentId ?? null },
    {
      reason: "creator_manager",
      agentId: input.createdByAgentId
        ? findNearestInvokableManager(input.createdByAgentId, companyAgents)
        : null,
    },
    { reason: "creator", agentId: input.createdByAgentId ?? null },
    { reason: "company_root", agentId: findCompanyRootAgent(companyAgents) },
  ];

  for (const rung of rungs) {
    if (!rung.agentId) continue;
    candidatesConsidered.push(`${rung.reason}:${rung.agentId}`);
    if (isInvokable(rung.agentId, companyAgents)) {
      return { applied: true, assigneeAgentId: rung.agentId, reason: rung.reason };
    }
  }

  return { applied: false, reason: "no_invokable_owner", candidatesConsidered };
}

export async function loadCompanyAgentOrgRows(db: Db, companyId: string): Promise<AgentOrgRow[]> {
  return db
    .select({
      id: agents.id,
      companyId: agents.companyId,
      name: agents.name,
      reportsTo: agents.reportsTo,
      status: agents.status,
    })
    .from(agents)
    .where(eq(agents.companyId, companyId));
}

export async function resolveIssueAssigneeFallbackFromDb(
  db: Db,
  input: Omit<IssueAssigneeFallbackInput, "companyAgents">,
): Promise<IssueAssigneeFallbackResult> {
  const hasExplicitAgent = typeof input.assigneeAgentId === "string" && input.assigneeAgentId.length > 0;
  const hasExplicitUser = typeof input.assigneeUserId === "string" && input.assigneeUserId.length > 0;
  // Avoid the roster query entirely on the common explicit-assignee path.
  if (hasExplicitAgent || hasExplicitUser) {
    return { applied: false, reason: "explicit" };
  }
  const companyAgents = await loadCompanyAgentOrgRows(db, input.companyId);
  return resolveIssueAssigneeFallback({ ...input, companyAgents });
}
