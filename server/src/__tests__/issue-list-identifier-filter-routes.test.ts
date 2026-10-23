import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { actorMiddleware } from "../middleware/auth.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres issue list identifier filter tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

// PRA-6496: the company issue list silently dropped `identifier` filters, so a
// caller confirming "did my card land?" got an unfiltered page and concluded its
// own card was missing. These are the regression tests for that contract.
describeEmbeddedPostgres("issue list identifier filter routes", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-list-identifier-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function createApp() {
    const app = express();
    app.use(express.json());
    app.use(actorMiddleware(db, { deploymentMode: "local_trusted" }));
    app.use("/api", issueRoutes(db, {} as never));
    app.use(errorHandler);
    return app;
  }

  async function seedCompany() {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `I${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    return companyId;
  }

  async function createIssue(
    app: ReturnType<typeof createApp>,
    companyId: string,
    title: string,
  ) {
    const res = await request(app)
      .post(`/api/companies/${companyId}/issues`)
      .send({ title, status: "todo", priority: "medium" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.identifier).toMatch(/^[A-Z0-9]+-\d+$/);
    return res.body as { id: string; identifier: string };
  }

  it("returns a just-created issue in the default list and resolves it by identifier", async () => {
    const companyId = await seedCompany();
    const app = createApp();
    const created = await createIssue(app, companyId, "Just filed card");
    // A later card makes `created` the second-newest row, so a lookup that only
    // returns the head of the list cannot masquerade as a filtered result.
    await createIssue(app, companyId, "Later card");

    const list = await request(app).get(`/api/companies/${companyId}/issues`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.map((issue: { id: string }) => issue.id)).toContain(created.id);

    const byIdentifier = await request(app)
      .get(`/api/companies/${companyId}/issues`)
      .query({ identifier: created.identifier, limit: "1" });
    expect(byIdentifier.status, JSON.stringify(byIdentifier.body)).toBe(200);
    expect(byIdentifier.body.map((issue: { id: string }) => issue.id)).toEqual([created.id]);
  });

  it("matches identifiers case-insensitively and accepts several at once", async () => {
    const companyId = await seedCompany();
    const app = createApp();
    const first = await createIssue(app, companyId, "First card");
    const second = await createIssue(app, companyId, "Second card");
    await createIssue(app, companyId, "Unrelated card");

    const lowerCased = await request(app)
      .get(`/api/companies/${companyId}/issues`)
      .query({ identifier: first.identifier.toLowerCase() });
    expect(lowerCased.status, JSON.stringify(lowerCased.body)).toBe(200);
    expect(lowerCased.body.map((issue: { id: string }) => issue.id)).toEqual([first.id]);

    const both = await request(app)
      .get(`/api/companies/${companyId}/issues`)
      .query({ identifier: `${first.identifier},${second.identifier}` });
    expect(both.status, JSON.stringify(both.body)).toBe(200);
    expect(both.body.map((issue: { id: string }) => issue.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
  });

  it("returns an empty list for an identifier that does not exist", async () => {
    const companyId = await seedCompany();
    const app = createApp();
    await createIssue(app, companyId, "Only card");

    const res = await request(app)
      .get(`/api/companies/${companyId}/issues`)
      .query({ identifier: "PRA-999999" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("rejects a malformed identifier instead of ignoring it", async () => {
    const companyId = await seedCompany();
    const app = createApp();
    await createIssue(app, companyId, "Only card");

    const res = await request(app)
      .get(`/api/companies/${companyId}/issues`)
      .query({ identifier: "not-an-identifier" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: expect.stringContaining("identifier must look like"),
    });
  });

  it("rejects a limit above the maximum instead of silently clamping it", async () => {
    const companyId = await seedCompany();
    const app = createApp();
    await createIssue(app, companyId, "Only card");

    const res = await request(app)
      .get(`/api/companies/${companyId}/issues`)
      .query({ limit: "2000" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: expect.stringContaining("limit must be a positive integer up to"),
    });
  });
});
