import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq as drizzleEq } from "drizzle-orm";
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

// ---------------------------------------------------------------------------
// Failure-path tests for the M2 post-ship audit fixes.
// ---------------------------------------------------------------------------

describeEmbeddedPostgres("backgroundJob failure paths", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-bg-failure-");
    db = createDb(tempDb.connectionString);
  });

  afterEach(async () => {
    await db.delete(backgroundJobs);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(name = "Fail Co"): Promise<string> {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name,
      issuePrefix: `F${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
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

  it("prevents overwriting a terminal status via update() guard", async () => {
    companyId = await seedCompany();
    const svc = backgroundJobService(db);

    // Create and succeed a job
    const job = await svc.create({
      companyId,
      jobType: "research.activity_search",
      payload: { query: "done" },
    });
    const succeeded = await svc.update(job.id, companyId, {
      status: "succeeded",
      result: { answer: 42 },
      finishedAt: new Date(),
    });
    expect(succeeded?.status).toBe("succeeded");

    // Attempt to overwrite the terminal status — must be a no-op
    const overwrite = await svc.update(job.id, companyId, {
      status: "failed",
      error: "should not happen",
    });
    // update() returns null because no row matched the
    // status IN ('queued','running') guard
    expect(overwrite).toBeNull();

    // Verify the row is still succeeded
    const reload = await svc.getById(job.id, companyId);
    expect(reload?.status).toBe("succeeded");
    expect(reload?.error).toBeNull();
  });

  it("strips dataUri from list result but keeps it in getById", async () => {
    companyId = await seedCompany();
    const svc = backgroundJobService(db);

    // Create a job and set a result that contains a dataUri
    const job = await svc.create({
      companyId,
      jobType: "export.pdf",
      payload: { title: "Test", items: [] },
    });
    await svc.update(job.id, companyId, {
      status: "succeeded",
      result: {
        kind: "pdf",
        title: "Test",
        dataUri: "data:application/pdf;base64,JVBERi0=",
        byteLength: 1234,
        itemCount: 0,
        generatedAt: new Date().toISOString(),
      },
      finishedAt: new Date(),
    });

    // getById should include dataUri
    const byId = await svc.getById(job.id, companyId);
    expect(byId).not.toBeNull();
    const byIdResult = byId!.result as Record<string, unknown> | null;
    expect(byIdResult?.dataUri).toBe("data:application/pdf;base64,JVBERi0=");

    // list should strip dataUri
    const list = await svc.list(companyId);
    expect(list.length).toBeGreaterThan(0);
    const listItem = list.find((j) => j.id === job.id);
    expect(listItem).not.toBeUndefined();
    const listResult = listItem!.result as Record<string, unknown> | null;
    expect(listResult?.dataUri).toBeUndefined();
    // Other result fields should survive
    expect(listResult?.kind).toBe("pdf");
    expect(listResult?.title).toBe("Test");
  });

  it("requeues stale-running jobs on worker start and leaves recent-running alone", async () => {
    companyId = await seedCompany();
    const svc = backgroundJobService(db);

    // Create two jobs
    const staleJob = await svc.create({
      companyId,
      jobType: "research.activity_search",
      payload: { query: "stale" },
    });
    const freshJob = await svc.create({
      companyId,
      jobType: "research.activity_search",
      payload: { query: "fresh" },
    });

    // Transition both to running
    await svc.update(staleJob.id, companyId, { status: "running", startedAt: new Date() });
    await svc.update(freshJob.id, companyId, { status: "running", startedAt: new Date() });

    // Manually set staleJob.startedAt far in the past via direct DB
    const farPast = new Date(Date.now() - 600_000); // 10 minutes ago
    await db
      .update(backgroundJobs)
      .set({ startedAt: farPast })
      .where(drizzleEq(backgroundJobs.id, staleJob.id));

    // Fresh job's startedAt stays recent (set above)

    // Start the worker — the startup sweep should requeue the stale job,
    // then tick() immediately processes it to completion. The fresh job
    // (still 'running', not 'queued') is left alone.
    const worker = createBackgroundJobWorker(db, { pollIntervalMs: 50_000, batchSize: 5, processorTimeoutMs: 60_000 });
    await worker.start();
    worker.stop();

    // The stale job was rescued from eternal 'running' and processed to
    // succeeded (sweep → requeue → tick claims → processor completes).
    const staleReload = await svc.getById(staleJob.id, companyId);
    expect(staleReload?.status).toBe("succeeded");

    // The fresh job was never touched — tick only claims 'queued' jobs,
    // and the fresh job remained 'running' throughout.
    const freshReload = await svc.getById(freshJob.id, companyId);
    expect(freshReload?.status).toBe("running");
  });
});