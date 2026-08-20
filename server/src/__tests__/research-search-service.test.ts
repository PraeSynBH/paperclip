import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb, companies, issues, documents, activityLog, agents } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "@paperclipai/db";
import { researchSearchService } from "../services/research-search.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres research-search tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

// ─── Pure function tests (no DB needed) ─────────────────────────────────────

describe("researchSearchService — pure functions", () => {
  it("returns an object with the expected methods", () => {
    const svc = researchSearchService({} as never);
    expect(svc).toHaveProperty("searchKeywordFirst");
    expect(svc).toHaveProperty("upgradeSemanticResults");
    expect(svc).toHaveProperty("autoAssess");
  });
});

// ─── DB-backed integration tests ────────────────────────────────────────────

describeEmbeddedPostgres("researchSearchService — keyword search", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof researchSearchService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-research-search-");
    db = createDb(tempDb.connectionString);
    svc = researchSearchService(db);
  });

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(documents);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(name = "Test Company"): Promise<string> {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name,
      issuePrefix: `R${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
      hideAiCosts: false,
      disableAiCosts: false,
      disableAgentGoalCreation: false,
      onboarded: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  async function seedIssue(overrides: Partial<typeof issues.$inferInsert> = {}) {
    const id = randomUUID();
    const defaults = {
      id,
      companyId,
      title: "Test issue",
      description: null,
      status: "backlog",
      priority: "p3",
      workMode: "standard",
      boardVisibility: "normal",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(issues).values({ ...defaults, ...overrides });
    return id;
  }

  async function seedDocument(overrides: Partial<typeof documents.$inferInsert> = {}) {
    const id = randomUUID();
    const defaults = {
      id,
      companyId,
      title: "Test document",
      latestBody: "Test document body",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(documents).values({ ...defaults, ...overrides });
    return id;
  }

  it("returns empty results for an empty company", async () => {
    companyId = await seedCompany("Empty Co");
    const result = await svc.searchKeywordFirst(companyId, { query: "anything", scope: "all" });
    expect(result.results).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("finds issues by title keyword", async () => {
    companyId = await seedCompany("Searchable Co");
    await seedIssue({ title: "Fix login bug on mobile" });
    await seedIssue({ title: "Add dark mode support" });

    const result = await svc.searchKeywordFirst(companyId, { query: "login", scope: "issues" });
    expect(result.results.length).toBeGreaterThanOrEqual(1);
    expect(result.results.some((r) => r.title.includes("login"))).toBe(true);
  });

  it("finds documents by title keyword", async () => {
    companyId = await seedCompany("Doc Co");
    await seedDocument({ title: "Architecture overview" });
    await seedDocument({ title: "API reference" });

    const result = await svc.searchKeywordFirst(companyId, { query: "architecture", scope: "documents" });
    expect(result.results.length).toBeGreaterThanOrEqual(1);
    expect(result.results[0]?.title.toLowerCase()).toContain("architecture");
  });

  it("returns empty results for a query with no matches", async () => {
    companyId = await seedCompany("No Match Co");
    await seedIssue({ title: "Something completely unrelated" });

    const result = await svc.searchKeywordFirst(companyId, { query: "zzzzzzzzz", scope: "all" });
    expect(result.results).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("returns empty results for an empty query", async () => {
    companyId = await seedCompany("Empty Query Co");
    await seedIssue({ title: "Some issue" });

    const result = await svc.searchKeywordFirst(companyId, { query: "", scope: "all" });
    expect(result.results).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("clamps limit to max 50", async () => {
    companyId = await seedCompany("Limit Co");
    for (let i = 0; i < 10; i++) {
      await seedIssue({ title: `Searchable issue ${i}` });
    }

    const result = await svc.searchKeywordFirst(companyId, { query: "Searchable", scope: "issues", limit: 100 });
    expect(result.results.length).toBeLessThanOrEqual(50);
  });

  it("scopes search to issues only", async () => {
    companyId = await seedCompany("Scope Co");
    await seedIssue({ title: "Issue about flights" });
    await seedDocument({ title: "Document about flights" });

    const issuesResult = await svc.searchKeywordFirst(companyId, { query: "flights", scope: "issues" });
    expect(issuesResult.results.every((r) => r.type === "issue")).toBe(true);
  });

  it("scopes search to documents only", async () => {
    companyId = await seedCompany("Scope Doc Co");
    await seedIssue({ title: "Issue about trains" });
    await seedDocument({ title: "Document about trains" });

    const docsResult = await svc.searchKeywordFirst(companyId, { query: "trains", scope: "documents" });
    expect(docsResult.results.every((r) => r.type === "document")).toBe(true);
  });
});

describeEmbeddedPostgres("researchSearchService — autoAssess", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof researchSearchService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-research-autoassess-");
    db = createDb(tempDb.connectionString);
    svc = researchSearchService(db);
  });

  afterEach(async () => {
    await db.delete(issues);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(name = "Assess Co"): Promise<string> {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name,
      issuePrefix: `A${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
      hideAiCosts: false,
      disableAiCosts: false,
      disableAgentGoalCreation: false,
      onboarded: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  async function seedIssue(overrides: Partial<typeof issues.$inferInsert> = {}) {
    const id = randomUUID();
    const defaults = {
      id,
      companyId,
      title: "Assessable issue",
      description: null,
      status: "backlog",
      priority: "p3",
      workMode: "standard",
      boardVisibility: "normal",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(issues).values({ ...defaults, ...overrides });
    return id;
  }

  it("returns assessed items for issues with no filters", async () => {
    companyId = await seedCompany("AutoAssess Co");
    await seedIssue({ title: "Recent issue" });

    const result = await svc.autoAssess(companyId, {});
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    expect(result.items[0]).toHaveProperty("freshness");
    expect(result.items[0]).toHaveProperty("completeness");
    expect(result.items[0]).toHaveProperty("relevance");
    expect(result.items[0]).toHaveProperty("notes");
  });

  it("computes freshness correctly for recent items", async () => {
    companyId = await seedCompany("Fresh Co");
    await seedIssue({ title: "Just updated", updatedAt: new Date() });

    const result = await svc.autoAssess(companyId, {});
    const freshItems = result.items.filter((i) => i.freshness === "fresh");
    expect(freshItems.length).toBeGreaterThanOrEqual(1);
    expect(freshItems[0]?.freshness).toBe("fresh");
  });

  it("returns empty list when no issues exist", async () => {
    companyId = await seedCompany("Empty Assess Co");
    const result = await svc.autoAssess(companyId, {});
    expect(result.items).toEqual([]);
  });
});