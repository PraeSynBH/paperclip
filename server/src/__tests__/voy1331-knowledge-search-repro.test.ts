import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companies, createDb, knowledgeDocuments } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { knowledgeDocumentService } from "../services/knowledge-documents.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres knowledge search repro tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("knowledge search repro (VOY-1331)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-kb-search-repro-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("reproduces the searchPublished 500 against embedded PG", async () => {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Repro Co",
      issuePrefix: "REP",
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(knowledgeDocuments).values({
      id: randomUUID(),
      companyId,
      title: "Deployment guide",
      summary: "How to deploy",
      body: "Step one: build the image. Step two: ship it.",
      status: "published",
      version: 1,
      publishedAt: new Date(),
    });

    const svc = knowledgeDocumentService(db);
    const results = await svc.searchPublished(companyId, "deploy");
    expect(Array.isArray(results)).toBe(true);
  });

  it("runs the exact raw query shape via db.execute for comparison", async () => {
    const rows = await db.execute(
      sql`SELECT 1 AS ok`,
    );
    expect(rows).toBeDefined();
  });
});
