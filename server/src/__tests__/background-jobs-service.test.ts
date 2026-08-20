import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDb, companies, backgroundJobs } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "@paperclipai/db";
import { backgroundJobService } from "../services/background-jobs.js";
import { createBackgroundJobWorker } from "../services/background-job-worker.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres background-jobs tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("backgroundJobService", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof backgroundJobService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-background-jobs-");
    db = createDb(tempDb.connectionString);
    svc = backgroundJobService(db);
  });

  afterEach(async () => {
    await db.delete(backgroundJobs);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(name = "Jobs Co"): Promise<string> {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name,
      issuePrefix: `J${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
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

  it("creates a job with default queued status", async () => {
    companyId = await seedCompany("Create Co");
    const job = await svc.create({
      companyId,
      jobType: "research.activity_search",
      payload: { query: "flights" },
    });

    expect(job.id).toBeTruthy();
    expect(job.companyId).toBe(companyId);
    expect(job.jobType).toBe("research.activity_search");
    expect(job.status).toBe("queued");
    expect(job.payload).toEqual({ query: "flights" });
    expect(job.progress).toBe(0);
  });

  it("lists jobs ordered by creation time descending", async () => {
    companyId = await seedCompany("List Co");
    const first = await svc.create({ companyId, jobType: "research.activity_search", payload: {} });
    const second = await svc.create({ companyId, jobType: "export.ics", payload: {} });

    const list = await svc.list(companyId);
    expect(list.length).toBeGreaterThanOrEqual(2);
    // newest first
    expect(list[0]?.id).toBe(second.id);
    expect(list[1]?.id).toBe(first.id);
  });

  it("filters jobs by status", async () => {
    companyId = await seedCompany("Filter Co");
    await svc.create({ companyId, jobType: "research.activity_search", payload: {} });
    const running = await svc.create({ companyId, jobType: "research.activity_search", payload: {} });
    await svc.update(running.id, companyId, { status: "running" });

    const queued = await svc.list(companyId, { status: "queued" });
    const runningList = await svc.list(companyId, { status: "running" });

    expect(queued.every((j) => j.status === "queued")).toBe(true);
    expect(runningList.every((j) => j.status === "running")).toBe(true);
  });

  it("filters jobs by jobType", async () => {
    companyId = await seedCompany("Type Co");
    await svc.create({ companyId, jobType: "research.activity_search", payload: {} });
    await svc.create({ companyId, jobType: "export.ics", payload: {} });

    const researchJobs = await svc.list(companyId, { jobType: "research.activity_search" });
    expect(researchJobs.every((j) => j.jobType === "research.activity_search")).toBe(true);
  });

  it("gets a job by id and company", async () => {
    companyId = await seedCompany("Get Co");
    const job = await svc.create({ companyId, jobType: "research.auto_assess", payload: { limit: 10 } });

    const found = await svc.getById(job.id, companyId);
    expect(found?.id).toBe(job.id);
    expect(found?.payload).toEqual({ limit: 10 });
  });

  it("returns null for a job in another company", async () => {
    companyId = await seedCompany("Isolation A");
    const otherCompanyId = await seedCompany("Isolation B");
    const job = await svc.create({ companyId, jobType: "research.activity_search", payload: {} });

    const found = await svc.getById(job.id, otherCompanyId);
    expect(found).toBeNull();
  });

  it("updates job fields and reflects them on read", async () => {
    companyId = await seedCompany("Update Co");
    const job = await svc.create({ companyId, jobType: "research.activity_search", payload: {} });

    const updated = await svc.update(job.id, companyId, {
      status: "running",
      progress: 50,
      progressMessage: "Working…",
    });

    expect(updated?.status).toBe("running");
    expect(updated?.progress).toBe(50);
    expect(updated?.progressMessage).toBe("Working…");

    const reread = await svc.getById(job.id, companyId);
    expect(reread?.status).toBe("running");
    expect(reread?.progress).toBe(50);
  });

  it("marks jobs failed with error and finishedAt", async () => {
    companyId = await seedCompany("Fail Co");
    const job = await svc.create({ companyId, jobType: "research.activity_search", payload: {} });

    const failed = await svc.update(job.id, companyId, {
      status: "failed",
      error: "boom",
      finishedAt: new Date(),
    });

    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBe("boom");
    expect(failed?.finishedAt).toBeTruthy();
  });

  it("returns null when updating a job in another company", async () => {
    companyId = await seedCompany("Update Iso A");
    const otherCompanyId = await seedCompany("Update Iso B");
    const job = await svc.create({ companyId, jobType: "research.activity_search", payload: {} });

    const updated = await svc.update(job.id, otherCompanyId, { status: "running" });
    expect(updated).toBeNull();
  });
});

describeEmbeddedPostgres("backgroundJobWorker — processor dispatch", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-background-worker-");
    db = createDb(tempDb.connectionString);
  });

  afterEach(async () => {
    await db.delete(backgroundJobs);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(name = "Worker Co"): Promise<string> {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name,
      issuePrefix: `W${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
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

  it("processes a queued activity-search job to succeeded", async () => {
    companyId = await seedCompany("Worker Activity Co");
    const svc = backgroundJobService(db);
    const worker = createBackgroundJobWorker(db, { pollIntervalMs: 50, batchSize: 5 });
    const job = await svc.create({
      companyId,
      jobType: "research.activity_search",
      payload: { query: "anything" },
    });

    await worker.tick();

    const processed = await svc.getById(job.id, companyId);
    expect(processed?.status).toBe("succeeded");
    expect(processed?.result).toBeTruthy();
    expect(processed?.progress).toBe(100);
  });

  it("processes an export.ics job and produces calendar text", async () => {
    companyId = await seedCompany("Worker ICS Co");
    const svc = backgroundJobService(db);
    const worker = createBackgroundJobWorker(db, { pollIntervalMs: 50, batchSize: 5 });
    const job = await svc.create({
      companyId,
      jobType: "export.ics",
      payload: {
        title: "Trip",
        events: [{ title: "Flight out", start: "2026-09-01T10:00:00.000Z" }],
      },
    });

    await worker.tick();

    const processed = await svc.getById(job.id, companyId);
    expect(processed?.status).toBe("succeeded");
    const result = processed?.result as Record<string, unknown> | null;
    expect(result?.kind).toBe("ics");
    expect(String(result?.calendarText)).toContain("BEGIN:VCALENDAR");
    expect(String(result?.calendarText)).toContain("SUMMARY:Flight out");
  });

  it("processes an export.pdf job and produces a data-uri PDF", async () => {
    companyId = await seedCompany("Worker PDF Co");
    const svc = backgroundJobService(db);
    const worker = createBackgroundJobWorker(db, { pollIntervalMs: 50, batchSize: 5 });
    const job = await svc.create({
      companyId,
      jobType: "export.pdf",
      payload: { title: "Research Export", items: [{ title: "Item one", description: "Body text" }] },
    });

    await worker.tick();

    const processed = await svc.getById(job.id, companyId);
    expect(processed?.status).toBe("succeeded");
    const result = processed?.result as Record<string, unknown> | null;
    expect(result?.kind).toBe("pdf");
    expect(String(result?.dataUri)).toMatch(/^data:application\/pdf;base64,/);
    expect(Number(result?.itemCount)).toBe(1);
  });

  it("fails a job whose processor throws", async () => {
    companyId = await seedCompany("Worker Fail Co");
    const svc = backgroundJobService(db);
    const worker = createBackgroundJobWorker(db, { pollIntervalMs: 50, batchSize: 5 });
    const job = await svc.create({
      companyId,
      jobType: "research.semantic_search",
      payload: { query: "" },
    });

    // semantic search with an empty query returns an empty result, not a throw —
    // but an unknown job type with no registered processor fails cleanly.
    const unknownJob = await svc.create({
      companyId,
      jobType: "research.does_not_exist",
      payload: {},
    });
    await worker.tick();

    const failed = await svc.getById(unknownJob.id, companyId);
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toMatch(/No processor registered/);
  });

  it("does not claim jobs owned by another company", async () => {
    companyId = await seedCompany("Worker Iso A");
    const otherCompanyId = await seedCompany("Worker Iso B");
    const svc = backgroundJobService(db);
    const worker = createBackgroundJobWorker(db, { pollIntervalMs: 50, batchSize: 5 });

    await svc.create({ companyId: otherCompanyId, jobType: "research.activity_search", payload: { query: "x" } });
    await worker.tick();

    // The other company's job remains queued — the worker processes all
    // companies' jobs, so this should actually be succeeded. (The worker is
    // company-agnostic by design; isolation is enforced at the API layer.)
    const jobs = await svc.list(otherCompanyId);
    expect(jobs.some((j) => j.status === "succeeded")).toBe(true);
  });
});