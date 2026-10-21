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
  issueRelations,
  issues,
  projects,
} from "@paperclipai/db";
import { LOW_TRUST_REVIEW_PRESET } from "@paperclipai/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres blocker diagnostic route tests on this host: ${
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

async function seedCompany(db: Db, label = "Diagnostics") {
  const nonce = randomUUID().slice(0, 8);
  const [company] = await db.insert(companies).values({
    name: `${label} ${nonce}`,
    issuePrefix: `DG${nonce.slice(0, 4).toUpperCase()}`,
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
    parentId?: string | null;
    monitorNextCheckAt?: Date | null;
    executionPolicy?: Record<string, unknown> | null;
    unblockDescriptor?: { owner: Record<string, string>; action: string } | null;
  },
) {
  const [issue] = await db.insert(issues).values({
    companyId: input.companyId,
    projectId: input.projectId ?? null,
    parentId: input.parentId ?? null,
    title: input.title,
    status: input.status ?? "todo",
    priority: "medium",
    assigneeAgentId: input.assigneeAgentId ?? null,
    assigneeUserId: input.assigneeUserId ?? null,
    monitorNextCheckAt: input.monitorNextCheckAt ?? null,
    executionPolicy: input.executionPolicy ?? null,
    unblockDescriptor: input.unblockDescriptor ?? null,
    responsibleUserId: "board-user",
  }).returning();
  return issue!;
}

async function blockIssue(db: Db, companyId: string, blockerIssueId: string, blockedIssueId: string) {
  await db.insert(issueRelations).values({
    companyId,
    issueId: blockerIssueId,
    relatedIssueId: blockedIssueId,
    type: "blocks",
  });
}

async function attachLowTrustRun(db: Db, fixture: {
  company: CompanyRow;
  agent: AgentRow;
  allowedProject: ProjectRow;
  root: IssueRow;
  visibleBlocker: IssueRow;
}) {
  const executionPolicy = {
    authorizationPolicy: {
      trustBoundary: {
        mode: LOW_TRUST_REVIEW_PRESET,
        companyId: fixture.company.id,
        projectIds: [fixture.allowedProject.id],
        rootIssueId: fixture.root.id,
        issueIds: [fixture.root.id, fixture.visibleBlocker.id],
        allowedAgentIds: [],
      },
    },
  };
  await db.update(agents).set({
    permissions: {
      trustPreset: LOW_TRUST_REVIEW_PRESET,
      authorizationPolicy: executionPolicy.authorizationPolicy,
    },
  }).where(eq(agents.id, fixture.agent.id));
  fixture.agent.permissions = {
    trustPreset: LOW_TRUST_REVIEW_PRESET,
    authorizationPolicy: executionPolicy.authorizationPolicy,
  };

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

describeEmbeddedPostgres("issue blocker diagnostics route", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-blocker-diagnostics-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueRelations);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(projects);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("returns stale-blocker diagnosis and anomaly flags for a done blocker on a blocked issue", async () => {
    const company = await seedCompany(db);
    const agent = await seedAgent(db, company.id);
    const project = await seedProject(db, company.id, "Core");
    const root = await seedIssue(db, {
      companyId: company.id,
      projectId: project.id,
      title: "Ship root",
      status: "blocked",
      assigneeAgentId: agent.id,
    });
    const blocker = await seedIssue(db, {
      companyId: company.id,
      projectId: project.id,
      title: "Finished blocker",
      status: "done",
    });
    await blockIssue(db, company.id, blocker.id, root.id);

    const res = await request(createApp(db, boardActor(company)))
      .get(`/api/issues/${root.id}/diagnostics/blockers`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      diagnosis: expect.stringContaining("stale blocker hold"),
      readiness: {
        allBlockersDone: true,
        isDependencyReady: true,
        unresolvedBlockerCount: 0,
        pendingFinalizeBlockerCount: 0,
      },
      omittedUnauthorizedBlockerCount: 0,
      truncated: false,
    });
    expect(res.body.blockers).toHaveLength(1);
    expect(res.body.blockers[0]).toMatchObject({
      id: blocker.id,
      status: "done",
      isDependencyReady: true,
      flags: ["done_but_blocking"],
    });
  });

  it("returns null diagnosis for an unblocked issue with no blocker relations", async () => {
    const company = await seedCompany(db);
    const project = await seedProject(db, company.id, "Core");
    const issue = await seedIssue(db, {
      companyId: company.id,
      projectId: project.id,
      title: "Ready work",
      status: "todo",
    });

    const res = await request(createApp(db, boardActor(company)))
      .get(`/api/issues/${issue.id}/diagnostics/blockers`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.diagnosis).toBeNull();
    expect(res.body.blockers).toEqual([]);
    expect(res.body.readiness).toMatchObject({
      allBlockersDone: true,
      isDependencyReady: true,
      unresolvedBlockerCount: 0,
      pendingFinalizeBlockerCount: 0,
    });
  });

  it("flags a blocked agent-owned issue with no armed monitor as will_not_resume_on_its_own", async () => {
    const company = await seedCompany(db);
    const agent = await seedAgent(db, company.id);
    const issue = await seedIssue(db, {
      companyId: company.id,
      title: "Nothing wakes this",
      status: "blocked",
      assigneeAgentId: agent.id,
      unblockDescriptor: {
        owner: { agentId: agent.id },
        action: "Wait for the upstream gate to open on 2099-01-01T00:00:00Z, then resume.",
      },
    });

    const res = await request(createApp(db, boardActor(company)))
      .get(`/api/issues/${issue.id}/diagnostics/blockers`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.resume).toMatchObject({
      code: "will_not_resume_on_its_own",
      resumeAt: "2099-01-01T00:00:00.000Z",
    });
    expect(res.body.resume.detail).toContain("nothing is scheduled to wake it then");

    // The same diagnosis has to reach readers that only look at `wakes`.
    const wakes = await request(createApp(db, boardActor(company)))
      .get(`/api/issues/${issue.id}/diagnostics/wakes`);
    expect(wakes.status, JSON.stringify(wakes.body)).toBe(200);
    expect(
      JSON.stringify(wakes.body).includes("will_not_resume_on_its_own"),
      JSON.stringify(wakes.body).slice(0, 600),
    ).toBe(true);
  });

  it("uses the earliest instant named in the unblock action as resumeAt", async () => {
    const company = await seedCompany(db);
    const agent = await seedAgent(db, company.id);
    const issue = await seedIssue(db, {
      companyId: company.id,
      title: "Two dated gates",
      status: "blocked",
      assigneeAgentId: agent.id,
      unblockDescriptor: {
        owner: { agentId: agent.id },
        action:
          "Repoint DNS by 2099-02-01T00:00:00Z; if it is still wrong, escalate on 2099-05-01T00:00:00Z.",
      },
    });

    const res = await request(createApp(db, boardActor(company)))
      .get(`/api/issues/${issue.id}/diagnostics/blockers`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.resume).toMatchObject({ resumeAt: "2099-02-01T00:00:00.000Z" });
  });

  it("reports a null resumeAt when the unblock action names no instant", async () => {
    const company = await seedCompany(db);
    const agent = await seedAgent(db, company.id);
    const issue = await seedIssue(db, {
      companyId: company.id,
      title: "Undated human gate",
      status: "blocked",
      assigneeAgentId: agent.id,
      unblockDescriptor: {
        owner: { agentId: agent.id },
        action: "Ben has to approve the spend before this moves.",
      },
    });

    const res = await request(createApp(db, boardActor(company)))
      .get(`/api/issues/${issue.id}/diagnostics/blockers`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.resume).toMatchObject({
      code: "will_not_resume_on_its_own",
      resumeAt: null,
    });
    expect(res.body.resume.detail).toContain("names no instant");
  });

  it("says an already-passed gate has passed instead of promising a future wake", async () => {
    const company = await seedCompany(db);
    const agent = await seedAgent(db, company.id);
    const issue = await seedIssue(db, {
      companyId: company.id,
      title: "Expired dated gate",
      status: "blocked",
      assigneeAgentId: agent.id,
      unblockDescriptor: {
        owner: { agentId: agent.id },
        action: "Re-check after 2020-01-01T00:00:00Z.",
      },
    });

    const res = await request(createApp(db, boardActor(company)))
      .get(`/api/issues/${issue.id}/diagnostics/blockers`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.resume).toMatchObject({ resumeAt: "2020-01-01T00:00:00.000Z" });
    expect(res.body.resume.detail).toContain("already passed");
  });

  it("does not flag the shape when a monitor is armed on either field", async () => {
    const company = await seedCompany(db);
    const agent = await seedAgent(db, company.id);
    const viaColumn = await seedIssue(db, {
      companyId: company.id,
      title: "Monitor armed on the column",
      status: "blocked",
      assigneeAgentId: agent.id,
      monitorNextCheckAt: new Date("2099-01-01T00:00:00Z"),
    });
    const viaPolicy = await seedIssue(db, {
      companyId: company.id,
      title: "Monitor armed inside the execution policy",
      status: "blocked",
      assigneeAgentId: agent.id,
      executionPolicy: { monitor: { nextCheckAt: "2099-01-01T00:00:00Z" } },
    });

    for (const issue of [viaColumn, viaPolicy]) {
      const res = await request(createApp(db, boardActor(company)))
        .get(`/api/issues/${issue.id}/diagnostics/blockers`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.resume, issue.title).toBeNull();
    }
  });

  it("does not flag a human-owned blocked issue or an unblocked agent-owned issue", async () => {
    const company = await seedCompany(db);
    const agent = await seedAgent(db, company.id);
    const humanOwned = await seedIssue(db, {
      companyId: company.id,
      title: "Human owns the unblock",
      status: "blocked",
      assigneeUserId: "board-user",
      unblockDescriptor: {
        owner: { userId: "board-user" },
        action: "Board decision on 2099-01-01T00:00:00Z.",
      },
    });
    const notBlocked = await seedIssue(db, {
      companyId: company.id,
      title: "Agent-owned but running",
      status: "in_progress",
      assigneeAgentId: agent.id,
    });

    for (const issue of [humanOwned, notBlocked]) {
      const res = await request(createApp(db, boardActor(company)))
        .get(`/api/issues/${issue.id}/diagnostics/blockers`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.resume, issue.title).toBeNull();
    }
  });

  it("omits unauthorized blocker nodes and derives diagnosis only from visible data", async () => {
    const company = await seedCompany(db);
    const agent = await seedAgent(db, company.id);
    const allowedProject = await seedProject(db, company.id, "Allowed");
    const hiddenProject = await seedProject(db, company.id, "Hidden");
    const hiddenMarker = `HIDDEN-BLOCKER-${randomUUID()}`;
    const root = await seedIssue(db, {
      companyId: company.id,
      projectId: allowedProject.id,
      title: "Scoped root",
      status: "blocked",
    });
    const visibleBlocker = await seedIssue(db, {
      companyId: company.id,
      projectId: allowedProject.id,
      title: "Visible blocker",
      status: "in_progress",
    });
    const hiddenBlocker = await seedIssue(db, {
      companyId: company.id,
      projectId: hiddenProject.id,
      title: hiddenMarker,
      status: "cancelled",
    });
    await blockIssue(db, company.id, visibleBlocker.id, root.id);
    await blockIssue(db, company.id, hiddenBlocker.id, root.id);
    const run = await attachLowTrustRun(db, { company, agent, allowedProject, root, visibleBlocker });

    const res = await request(createApp(db, agentActor(company, agent, run.id)))
      .get(`/api/issues/${root.id}/diagnostics/blockers`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.blockers).toHaveLength(1);
    expect(res.body.blockers[0]).toMatchObject({
      id: visibleBlocker.id,
      status: "in_progress",
      isUnresolved: true,
    });
    expect(res.body.readiness).toBeNull();
    expect(res.body.omittedUnauthorizedBlockerCount).toBe(1);
    expect(res.body.diagnosis).toContain("authorization boundary");
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(hiddenBlocker.id);
    expect(serialized).not.toContain(hiddenMarker);
    expect(serialized).not.toContain("cancelled");
    expect(serialized).not.toContain("payload");
    expect(serialized).not.toContain("details");
    expect(serialized).not.toContain("triggerDetail");
    expect(serialized).not.toContain("error");
  });

  it("denies cross-company issue reads", async () => {
    const companyA = await seedCompany(db, "Company A");
    const companyB = await seedCompany(db, "Company B");
    const agentB = await seedAgent(db, companyB.id);
    const projectA = await seedProject(db, companyA.id, "A");
    const issueA = await seedIssue(db, {
      companyId: companyA.id,
      projectId: projectA.id,
      title: "Company A issue",
      status: "blocked",
    });
    const [runB] = await db.insert(heartbeatRuns).values({
      companyId: companyB.id,
      agentId: agentB.id,
      status: "running",
      contextSnapshot: { issueId: issueA.id },
    }).returning();

    const res = await request(createApp(db, agentActor(companyB, agentB, runB!.id)))
      .get(`/api/issues/${issueA.id}/diagnostics/blockers`);

    // Uniform 404 so cross-tenant ids are indistinguishable from missing ones.
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.error).toBe("Issue not found");
  });

  it("caps blocker output and withholds readiness when truncated", async () => {
    const company = await seedCompany(db);
    const project = await seedProject(db, company.id, "Core");
    const root = await seedIssue(db, {
      companyId: company.id,
      projectId: project.id,
      title: "Wide blocked issue",
      status: "blocked",
    });
    const blockerRows = [];
    for (let index = 0; index < 101; index += 1) {
      blockerRows.push({
        companyId: company.id,
        projectId: project.id,
        title: `Blocker ${String(index).padStart(3, "0")}`,
        status: "done",
        priority: "medium",
        responsibleUserId: "board-user",
      });
    }
    const insertedBlockers = await db.insert(issues).values(blockerRows).returning();
    await db.insert(issueRelations).values(insertedBlockers.map((blocker) => ({
      companyId: company.id,
      issueId: blocker.id,
      relatedIssueId: root.id,
      type: "blocks" as const,
    })));

    const res = await request(createApp(db, boardActor(company)))
      .get(`/api/issues/${root.id}/diagnostics/blockers`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.blockers).toHaveLength(100);
    expect(res.body.truncated).toBe(true);
    expect(res.body.readiness).toBeNull();
    expect(res.body.omittedUnauthorizedBlockerCount).toBeNull();
    expect(res.body.diagnosis).toContain("truncated at 100 blockers");
    expect(res.body.caps).toEqual({ maxBlockers: 100 });
  });
});
