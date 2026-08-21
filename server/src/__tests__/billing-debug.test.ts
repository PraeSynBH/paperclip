import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { companies, createDb, getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "@paperclipai/db";
import { billingRoutes } from "../routes/billing.js";
import { errorHandler } from "../middleware/index.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbedded = embeddedPostgresSupport.supported ? describe : describe.skip;

function agentActor(companyId: string, agentId: string) {
  return { type: "agent" as const, agentId, companyId, source: "agent_key" as const };
}

describeEmbedded("debug billing 500", () => {
  let db: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId: string;
  let agentId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-billing-debug-");
    db = createDb(tempDb.connectionString);
    companyId = randomUUID();
    agentId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Debug Co", status: "active", issuePrefix: "DBG", updatedAt: new Date() });
  });

  afterAll(async () => { await tempDb?.cleanup(); });

  it("shows the 500 error body", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.actor = agentActor(companyId, agentId) as any; next(); });
    app.use("/api", billingRoutes(db));
    app.use(errorHandler);

    const res = await request(app).post(`/api/companies/${companyId}/billing/subscription`).send({ tierId: randomUUID(), billingPeriod: "monthly" });
    console.log("STATUS:", res.status);
    console.log("BODY:", JSON.stringify(res.body, null, 2));
    expect(res.status).toBe(200); // just to see the output
  });
});