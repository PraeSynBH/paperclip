import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  companyMemberships,
  createDb,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { billingRoutes } from "../routes/billing.js";
import { errorHandler } from "../middleware/index.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres billing routes tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

function createApp(
  db: ReturnType<typeof createDb>,
  actor: Express.Request["actor"],
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", billingRoutes(db));
  app.use(errorHandler);
  return app;
}

function boardActor(companyId: string, role: "admin" | "operator" | "viewer" = "admin") {
  return {
    type: "board" as const,
    userId: "board-user-1",
    source: "session" as const,
    isInstanceAdmin: false,
    companyIds: [companyId],
    memberships: [{ companyId, membershipRole: role, status: "active" }],
  };
}

function agentActor(companyId: string, agentId: string) {
  return {
    type: "agent" as const,
    agentId,
    companyId,
    source: "agent_key" as const,
  };
}

describeEmbeddedPostgres("billing routes auth boundary", () => {
  let db: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-billing-routes-");
    db = createDb(tempDb.connectionString);

    // Seed a minimal company and agent
    const companyId = randomUUID();
    const agentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Billing Test Co",
      status: "active",
      issuePrefix: "BIL",
      updatedAt: new Date(),
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Test Agent",
      role: "engineer",
      adapterType: "process",
      status: "active",
      isManaged: false,
      instructions: "Test agent",
      modelProfileKey: "cheap",
    });

    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: "board-user-1",
      status: "active",
      membershipRole: "admin",
      updatedAt: new Date(),
    });

    // Store for test use
    (globalThis as unknown as Record<string, string>).__billingTestCompanyId = companyId;
    (globalThis as unknown as Record<string, string>).__billingTestAgentId = agentId;
  });

  afterAll(async () => {
    delete (globalThis as unknown as Record<string, string>).__billingTestCompanyId;
    delete (globalThis as unknown as Record<string, string>).__billingTestAgentId;
    await tempDb?.cleanup();
  });

  it("rejects agent API key on billing subscription create", async () => {
    const companyId = (globalThis as unknown as Record<string, string>).__billingTestCompanyId;
    const agentId = (globalThis as unknown as Record<string, string>).__billingTestAgentId;
    const app = createApp(db, agentActor(companyId, agentId));

    const res = await request(app)
      .post(`/api/companies/${companyId}/billing/subscription`)
      .send({
        tierId: randomUUID(),
        billingPeriod: "monthly",
      });

    expect(res.status).toBe(403);
  });

  it("rejects agent API key on billing subscription update (PATCH)", async () => {
    const companyId = (globalThis as unknown as Record<string, string>).__billingTestCompanyId;
    const agentId = (globalThis as unknown as Record<string, string>).__billingTestAgentId;
    const app = createApp(db, agentActor(companyId, agentId));

    const res = await request(app)
      .patch(`/api/companies/${companyId}/billing/subscription`)
      .send({
        tierId: randomUUID(),
      });

    expect(res.status).toBe(403);
  });

  it("rejects agent API key on billing subscription cancel", async () => {
    const companyId = (globalThis as unknown as Record<string, string>).__billingTestCompanyId;
    const agentId = (globalThis as unknown as Record<string, string>).__billingTestAgentId;
    const app = createApp(db, agentActor(companyId, agentId));

    const res = await request(app).post(`/api/companies/${companyId}/billing/subscription/cancel`);

    expect(res.status).toBe(403);
  });

  it("rejects agent API key on billing subscription reactivate", async () => {
    const companyId = (globalThis as unknown as Record<string, string>).__billingTestCompanyId;
    const agentId = (globalThis as unknown as Record<string, string>).__billingTestAgentId;
    const app = createApp(db, agentActor(companyId, agentId));

    const res = await request(app).post(`/api/companies/${companyId}/billing/subscription/reactivate`);

    expect(res.status).toBe(403);
  });

  it("rejects agent API key on billing usage report", async () => {
    const companyId = (globalThis as unknown as Record<string, string>).__billingTestCompanyId;
    const agentId = (globalThis as unknown as Record<string, string>).__billingTestAgentId;
    const app = createApp(db, agentActor(companyId, agentId));

    const res = await request(app)
      .post(`/api/companies/${companyId}/billing/usage`)
      .send({
        metric: "agent_runs",
        quantity: 1,
      });

    expect(res.status).toBe(403);
  });

  it("rejects agent API key on billing invoices sync", async () => {
    const companyId = (globalThis as unknown as Record<string, string>).__billingTestCompanyId;
    const agentId = (globalThis as unknown as Record<string, string>).__billingTestAgentId;
    const app = createApp(db, agentActor(companyId, agentId));

    const res = await request(app).post(`/api/companies/${companyId}/billing/invoices/sync`);

    expect(res.status).toBe(403);
  });

  it("allows board user on billing tier list (GET)", async () => {
    const companyId = (globalThis as unknown as Record<string, string>).__billingTestCompanyId;
    const app = createApp(db, boardActor(companyId));

    const res = await request(app).get(`/api/companies/${companyId}/billing/tiers`);

    // Board can access — shouldn't hit 403 but may return empty list (no tiers seeded)
    expect(res.status).not.toBe(403);
  });
});