import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issues,
  projects,
} from "@paperclipai/db";
import { LOW_TRUST_REVIEW_PRESET } from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { firstResumeInstantNamedInAction, issueRoutes } from "../routes/issues.js";
import { countBlockerResumeSweep } from "../services/issues.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres resume sweep route tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

type Db = ReturnType<typeof createDb>;
type CompanyRow = typeof companies.$inferSelect;
type AgentRow = typeof agents.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type IssueRow = typeof issues.$inferSelect;

function createApp(db: Db, actor: Express.Request["actor"]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", issueRoutes(db, {} as any));
  app.use(errorHandler);
  return app;
}

function boardActor(company: CompanyRow): Express.Request["actor"] {
  return {
    type: "board",
    userId: "board-user",
    companyIds: [company.id],
    memberships: [{ companyId: company.id, membershipRole: "operator", status: "active" }],
    isInstanceAdmin: true,
    source: "local_implicit",
  };
}

function agentActor(company: CompanyRow, agent: AgentRow, runId: string): Express.Request["actor"] {
  return {
    type: "agent",
    agentId: agent.id,
    companyId: company.id,
    runId,
    source: "agent_jwt",
  };
}

async function seedCompany(db: Db, label = "Sweep") {
  const nonce = randomUUID().slice(0, 8);
  const [company] = await db.insert(companies).values({
    name: `${label} ${nonce}`,
    issuePrefix: `SW${nonce.slice(0, 4).toUpperCase()}`,
    defaultResponsibleUserId: "board-user",
  }).returning();
  return company!;
}

async function seedAgent(db: Db, companyId: string, permissions: Record<string, unknown> = {}) {
  const [agent] = await db.insert(agents).values({
    companyId,
    name: `Agent ${randomUUID().slice(0, 6)}`,
    role: "engineer",
    adapterType: "process",
    adapterConfig: {},
    runtimeConfig: {},
    permissions,
  }).returning();
  return agent!;
}

async function seedProject(db: Db, companyId: string, name: string) {
  const [project] = await db.insert(projects).values({
    companyId,
    name,
    status: "in_progress",
  }).returning();
  return project!;
}

async function seedIssue(
  db: Db,
  input: {
    companyId: string;
    projectId?: string | null;
    title: string;
    status?: string;
    assigneeAgentId?: string | null;
    assigneeUserId?: string | null;
    monitorNextCheckAt?: Date | null;
    executionPolicy?: Record<string, unknown> | null;
    unblockAction?: string | null;
  },
) {
  const [issue] = await db.insert(issues).values({
    companyId: input.companyId,
    projectId: input.projectId ?? null,
    title: input.title,
    status: input.status ?? "todo",
    priority: "medium",
    assigneeAgentId: input.assigneeAgentId ?? null,
    assigneeUserId: input.assigneeUserId ?? null,
    monitorNextCheckAt: input.monitorNextCheckAt ?? null,
    executionPolicy: input.executionPolicy ?? null,
    unblockDescriptor: input.unblockAction
      ? { owner: { agentId: input.assigneeAgentId ?? "" }, action: input.unblockAction }
      : null,
    responsibleUserId: "board-user",
  }).returning();
  return issue!;
}

async function attachLowTrustRun(db: Db, fixture: {
  company: CompanyRow;
  agent: AgentRow;
  allowedProject: ProjectRow;
  root: IssueRow;
  visibleIssue: IssueRow;
}) {
  const authorizationPolicy = {
    trustBoundary: {
      mode: LOW_TRUST_REVIEW_PRESET,
      companyId: fixture.company.id,
      projectIds: [fixture.allowedProject.id],
      rootIssueId: fixture.root.id,
      issueIds: [fixture.root.id, fixture.visibleIssue.id],
      allowedAgentIds: [],
    },
  };
  const executionPolicy = { authorizationPolicy };
  await db.update(agents).set({
    permissions: {
      trustPreset: LOW_TRUST_REVIEW_PRESET,
      authorizationPolicy,
    },
  }).where(eq(agents.id, fixture.agent.id));
  fixture.agent.permissions = {
    trustPreset: LOW_TRUST_REVIEW_PRESET,
    authorizationPolicy,
  } as AgentRow["permissions"];

  const [run] = await db.insert(heartbeatRuns).values({
    companyId: fixture.company.id,
    agentId: fixture.agent.id,
    status: "running",
    contextSnapshot: {
      issueId: fixture.root.id,
      executionPolicy,
    },
  }).returning();
  await db.update(issues).set({
    assigneeAgentId: fixture.agent.id,
    checkoutRunId: run!.id,
    executionRunId: run!.id,
    executionPolicy,
  }).where(eq(issues.id, fixture.root.id));
  return run!;
}

/** Counts the SQL statements a service call issues, so the sweep cannot quietly fan out. */
function countStatements<T extends { execute: (...args: any[]) => Promise<unknown> }>(db: T) {
  const counter = { statements: 0 };
  const wrapped = Object.create(db) as T;
  wrapped.execute = ((...args: Parameters<T["execute"]>) => {
    counter.statements += 1;
    return db.execute(...args);
  }) as T["execute"];
  return { wrapped, counter };
}

type SweepFixture = {
  company: CompanyRow;
  agent: AgentRow;
  issues: IssueRow[];
};

/**
 * Mixed R4 fixture. Every row is deliberate, so the expected tallies below are
 * the three psql queries from PRA-6709 read against a known set:
 *
 *   blocked agent-owned                                    -> 7
 *   ... and no monitor                                     -> 5
 *   ... and its action names a Z-suffixed instant          -> 4
 *   ... and that instant (the earliest one) is future      -> 1
 */
async function seedSweepFixture(db: Db): Promise<SweepFixture> {
  const company = await seedCompany(db);
  const agent = await seedAgent(db, company.id);
  const project = await seedProject(db, company.id, "Core");
  const seeded = [
    // Undated gate: R4 shape, no instant named.
    await seedIssue(db, {
      companyId: company.id,
      projectId: project.id,
      title: "Undated agent gate",
      status: "blocked",
      assigneeAgentId: agent.id,
      unblockAction: "Ben has to approve the spend before this moves.",
    }),
    // Past instant, seconds precision.
    await seedIssue(db, {
      companyId: company.id,
      projectId: project.id,
      title: "Expired dated gate",
      status: "blocked",
      assigneeAgentId: agent.id,
      unblockAction: "Re-check after 2020-01-01T00:00:00Z.",
    }),
    // Past instant, minute precision.
    await seedIssue(db, {
      companyId: company.id,
      projectId: project.id,
      title: "Expired minute gate",
      status: "blocked",
      assigneeAgentId: agent.id,
      unblockAction: "Gate at 2020-06-01T12:00Z.",
    }),
    // Future instant, fractional seconds.
    await seedIssue(db, {
      companyId: company.id,
      projectId: project.id,
      title: "Future dated gate",
      status: "blocked",
      assigneeAgentId: agent.id,
      unblockAction: "Hold until 2099-01-01T00:00:00.500Z, then resume.",
    }),
    // Armed monitor: R4 base only.
    await seedIssue(db, {
      companyId: company.id,
      projectId: project.id,
      title: "Monitor armed",
      status: "blocked",
      assigneeAgentId: agent.id,
      monitorNextCheckAt: new Date("2099-01-01T00:00:00Z"),
      unblockAction: "Hold until 2099-01-01T00:00:00Z.",
    }),
    // Armed monitor inside the execution policy: R4 base only.
    await seedIssue(db, {
      companyId: company.id,
      projectId: project.id,
      title: "Policy monitor armed",
      status: "blocked",
      assigneeAgentId: agent.id,
      executionPolicy: { monitor: { nextCheckAt: "2099-01-01T00:00:00Z" } },
    }),
    // Human owns the unblock: not part of the shape.
    await seedIssue(db, {
      companyId: company.id,
      projectId: project.id,
      title: "Human gate",
      status: "blocked",
      assigneeUserId: "board-user",
      unblockAction: "Board decision on 2099-01-01T00:00:00Z.",
    }),
    // Not blocked: not part of the shape.
    await seedIssue(db, {
      companyId: company.id,
      projectId: project.id,
      title: "Still running",
      status: "in_progress",
      assigneeAgentId: agent.id,
      unblockAction: "Hold until 2099-01-01T00:00:00Z.",
    }),
    // Two gates named; the earliest (past) is the card's resume instant.
    await seedIssue(db, {
      companyId: company.id,
      projectId: project.id,
      title: "Past then future gate",
      status: "blocked",
      assigneeAgentId: agent.id,
      unblockAction:
        "First 2020-01-01T00:00:00Z, then escalate on 2099-05-01T00:00:00Z.",
    }),
  ];
  return { company, agent, issues: seeded };
}

describeEmbeddedPostgres("company-scope blocker resume sweep", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-resume-sweep-");
    db = createDb(tempDb.connectionString);
  }, 90_000);

  afterEach(async () => {
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(projects);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("returns the R4 sweep counts beside the unchanged blocked count", async () => {
    const fixture = await seedSweepFixture(db);

    const res = await request(createApp(db, boardActor(fixture.company)))
      .get(`/api/companies/${fixture.company.id}/issues/count`)
      .query({ attention: "blocked" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // Unchanged contract: attention=blocked still counts every non-terminal
    // blocked card, human-owned ones included.
    expect(res.body.count).toBe(8);
    expect(res.body.resumeSweep).toEqual({
      blockedAgentOwned: 7,
      withoutMonitor: 5,
      withNamedInstant: 4,
      withFutureInstant: 1,
    });
  });

  it("classifies each card the same way the per-card diagnosis does", async () => {
    const fixture = await seedSweepFixture(db);

    const sweep = await countBlockerResumeSweep(db as any, fixture.company.id, {
      attention: "blocked",
    });

    // Same fixture, classified in JS with the per-card helper instead of SQL.
    const rows = await db.select().from(issues).where(eq(issues.companyId, fixture.company.id));
    const r4 = rows.filter(
      (row) => row.status === "blocked" && row.assigneeAgentId && !row.assigneeUserId,
    );
    const withoutMonitor = r4.filter((row) => {
      const policyNextCheckAt = (row.executionPolicy as { monitor?: { nextCheckAt?: string } } | null)
        ?.monitor?.nextCheckAt ?? null;
      return row.monitorNextCheckAt === null && policyNextCheckAt === null;
    });
    const instants = withoutMonitor.map((row) => {
      const action = (row.unblockDescriptor as { action?: string } | null)?.action ?? null;
      return firstResumeInstantNamedInAction(action);
    });
    const now = Date.now();

    expect(sweep).toEqual({
      blockedAgentOwned: r4.length,
      withoutMonitor: withoutMonitor.length,
      withNamedInstant: instants.filter((value) => value !== null).length,
      withFutureInstant: instants.filter(
        (value) => value !== null && Date.parse(value) > now,
      ).length,
    });
    expect(sweep).toEqual({
      blockedAgentOwned: 7,
      withoutMonitor: 5,
      withNamedInstant: 4,
      withFutureInstant: 1,
    });
  });

  it("computes the sweep in a single statement, not a per-issue walk", async () => {
    const fixture = await seedSweepFixture(db);
    const { wrapped, counter } = countStatements(db as any);

    const sweep = await countBlockerResumeSweep(wrapped, fixture.company.id, {
      attention: "blocked",
    });

    expect(counter.statements).toBe(1);
    expect(sweep.blockedAgentOwned).toBe(7);
  });

  it("omits the sweep on a text-narrowed read so it never disagrees with count", async () => {
    const fixture = await seedSweepFixture(db);

    const res = await request(createApp(db, boardActor(fixture.company)))
      .get(`/api/companies/${fixture.company.id}/issues/count`)
      .query({ attention: "blocked", q: "Expired dated gate" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toHaveProperty("count");
    expect(res.body).not.toHaveProperty("resumeSweep");
  });

  it("scopes the sweep to the low-trust boundary instead of the whole company", async () => {
    const fixture = await seedSweepFixture(db);
    const allowedProject = await seedProject(db, fixture.company.id, "Allowed");
    const root = await seedIssue(db, {
      companyId: fixture.company.id,
      projectId: allowedProject.id,
      title: "In-boundary root",
      status: "blocked",
      assigneeAgentId: fixture.agent.id,
      unblockAction: "Undated in-boundary gate.",
    });
    const visible = await seedIssue(db, {
      companyId: fixture.company.id,
      projectId: allowedProject.id,
      title: "Visible sibling",
      status: "blocked",
      assigneeAgentId: fixture.agent.id,
      unblockAction: "Undated visible gate.",
    });
    const run = await attachLowTrustRun(db, {
      company: fixture.company,
      agent: fixture.agent,
      allowedProject,
      root,
      visibleIssue: visible,
    });

    const boardRes = await request(createApp(db, boardActor(fixture.company)))
      .get(`/api/companies/${fixture.company.id}/issues/count`)
      .query({ attention: "blocked" });
    expect(boardRes.status, JSON.stringify(boardRes.body)).toBe(200);
    expect(boardRes.body.resumeSweep.blockedAgentOwned).toBe(9);

    const lowTrustRes = await request(createApp(db, agentActor(fixture.company, fixture.agent, run.id)))
      .get(`/api/companies/${fixture.company.id}/issues/count`)
      .query({ attention: "blocked" });
    expect(lowTrustRes.status, JSON.stringify(lowTrustRes.body)).toBe(200);

    if (lowTrustRes.body.resumeSweep) {
      // Boundary-scoped: a subset of the company totals, never the totals.
      expect(lowTrustRes.body.resumeSweep.blockedAgentOwned).toBeLessThan(
        boardRes.body.resumeSweep.blockedAgentOwned,
      );
      expect(lowTrustRes.body.resumeSweep.blockedAgentOwned).toBe(2);
    } else {
      expect(lowTrustRes.body).not.toHaveProperty("resumeSweep");
    }
    expect(lowTrustRes.body.count).toBeLessThan(boardRes.body.count);
  });
});