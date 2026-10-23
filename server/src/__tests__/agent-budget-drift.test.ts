import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  approvals,
  budgetIncidents,
  budgetPolicies,
  companies,
  costEvents,
  createDb,
  projects,
} from "@paperclipai/db";
import { budgetService, listAgentBudgetDrift } from "../services/budgets.ts";
import { agentService } from "../services/agents.ts";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

/**
 * PRX-5589. `agents.budget_monthly_cents` and an agent-scope
 * `budget_policies.amount` describe one limit. Dispatch reads the policy; every
 * surface that shows the agent reads the column. These tests pin the three
 * facts the card asks for:
 *
 * 1. the divergent state is detectable in both directions, including the `0`
 *    shape that actually shipped ($0 on the row, $1,000 enforced),
 * 2. the product write paths keep the two in step, so the state is not
 *    reachable through them,
 * 3. the drift travels on an API read (`budgets/overview`) instead of `psql`.
 */

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("agent budget drift (PRX-5589)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-agent-budget-drift-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(budgetIncidents);
    await db.delete(approvals);
    await db.delete(budgetPolicies);
    await db.delete(costEvents);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(activityLog);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function createAgentFixture(options: { budgetMonthlyCents?: number } = {}) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Drift Co",
      issuePrefix: `D${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Release Engineer",
      role: "engineer",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
      budgetMonthlyCents: options.budgetMonthlyCents ?? 0,
    });
    return { companyId, agentId };
  }

  /** Write the policy row only — the out-of-band write this card is about. */
  async function insertAgentPolicy(input: {
    companyId: string;
    agentId: string;
    amount: number;
    isActive?: boolean;
    windowKind?: string;
    metric?: string;
  }) {
    const [policy] = await db
      .insert(budgetPolicies)
      .values({
        companyId: input.companyId,
        scopeType: "agent",
        scopeId: input.agentId,
        metric: input.metric ?? "billed_cents",
        windowKind: input.windowKind ?? "calendar_month_utc",
        amount: input.amount,
        isActive: input.isActive ?? true,
      })
      .returning();
    return policy!;
  }

  it("reports the PRX-5585 shape — agent row over the enforced policy", async () => {
    const { companyId, agentId } = await createAgentFixture({ budgetMonthlyCents: 10_000_000 });
    const policy = await insertAgentPolicy({ companyId, agentId, amount: 50_000 });

    const drift = await listAgentBudgetDrift(db, companyId);

    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({
      companyId,
      agentId,
      agentName: "Release Engineer",
      agentRowAmount: 10_000_000,
      policyId: policy.id,
      policyAmount: 50_000,
      policyEffectiveAmount: 50_000,
      direction: "agent_row_higher",
      difference: 9_950_000,
    });
  });

  it("reports the live 2026-10-23 shape — policy funded, agent row at zero", async () => {
    const { companyId, agentId } = await createAgentFixture({ budgetMonthlyCents: 0 });
    await insertAgentPolicy({ companyId, agentId, amount: 100_000 });

    const drift = await listAgentBudgetDrift(db, companyId);

    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({
      agentRowAmount: 0,
      policyEffectiveAmount: 100_000,
      direction: "policy_higher",
      difference: 100_000,
    });
  });

  it("does not report a disabled policy's saved amount as drift", async () => {
    const { companyId, agentId } = await createAgentFixture({ budgetMonthlyCents: 0 });
    await insertAgentPolicy({ companyId, agentId, amount: 100_000, isActive: false });

    await expect(listAgentBudgetDrift(db, companyId)).resolves.toEqual([]);
  });

  it("compares only the monthly billed-cents policy the agent column mirrors", async () => {
    const { companyId, agentId } = await createAgentFixture({ budgetMonthlyCents: 0 });
    await insertAgentPolicy({ companyId, agentId, amount: 500_000, windowKind: "lifetime" });
    await insertAgentPolicy({ companyId, agentId, amount: 900_000, metric: "tokens" });

    await expect(listAgentBudgetDrift(db, companyId)).resolves.toEqual([]);
  });

  it("patching the agent budget reconciles the policy in the same write", async () => {
    const { companyId, agentId } = await createAgentFixture({ budgetMonthlyCents: 0 });
    const policy = await insertAgentPolicy({ companyId, agentId, amount: 50_000 });
    expect(await listAgentBudgetDrift(db, companyId)).toHaveLength(1);

    await agentService(db).update(agentId, { budgetMonthlyCents: 80_000 });

    const [row] = await db.select().from(agents).where(eq(agents.id, agentId));
    const [policyAfter] = await db.select().from(budgetPolicies).where(eq(budgetPolicies.id, policy.id));
    expect(row?.budgetMonthlyCents).toBe(80_000);
    expect(policyAfter?.amount).toBe(80_000);
    await expect(listAgentBudgetDrift(db, companyId)).resolves.toEqual([]);
  });

  it("upserting the policy moves the agent row", async () => {
    const { companyId, agentId } = await createAgentFixture({ budgetMonthlyCents: 0 });
    await insertAgentPolicy({ companyId, agentId, amount: 50_000 });

    await budgetService(db).upsertPolicy(companyId, {
      scopeType: "agent",
      scopeId: agentId,
      amount: 70_000,
      windowKind: "calendar_month_utc",
    }, null);

    const [row] = await db.select().from(agents).where(eq(agents.id, agentId));
    expect(row?.budgetMonthlyCents).toBe(70_000);
    await expect(listAgentBudgetDrift(db, companyId)).resolves.toEqual([]);
  });

  it("carries the drift on the budgets overview API read", async () => {
    const { companyId, agentId } = await createAgentFixture({ budgetMonthlyCents: 0 });
    const policy = await insertAgentPolicy({ companyId, agentId, amount: 100_000 });

    const overview = await budgetService(db).overview(companyId);

    expect(overview.agentBudgetDrift).toHaveLength(1);
    expect(overview.agentBudgetDrift[0]).toMatchObject({
      policyId: policy.id,
      agentId,
      agentRowAmount: 0,
      policyEffectiveAmount: 100_000,
      direction: "policy_higher",
    });
  });
});
