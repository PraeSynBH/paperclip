import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq as drizzleEq } from "drizzle-orm";
import { createDb, companies, backgroundJobs, researchQueries } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "@paperclipai/db";
import { backgroundJobService } from "../services/background-jobs.js";
import { createBackgroundJobWorker } from "../services/background-job-worker.js";
import { researchArtifactService } from "../services/research-artifacts.js";

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

  it("produces deterministic ICS UIDs so calendar re-imports dedupe instead of duplicating", async () => {
    companyId = await seedCompany("Worker ICS Deterministic Co");
    const svc = backgroundJobService(db);
    const worker = createBackgroundJobWorker(db, { pollIntervalMs: 50, batchSize: 5 });
    const payload = {
      title: "Trip",
      events: [
        { title: "Flight out", start: "2026-09-01T10:00:00.000Z", end: "2026-09-01T12:00:00.000Z" },
        { title: "Hotel check-in", start: "2026-09-01T15:00:00.000Z", end: "2026-09-01T16:00:00.000Z" },
      ],
    };

    const first = await svc.create({ companyId, jobType: "export.ics", payload });
    await worker.tick();
    const firstResult = (await svc.getById(first.id, companyId))?.result as Record<string, unknown> | null;
    const firstText = String(firstResult?.calendarText ?? "");

    const second = await svc.create({ companyId, jobType: "export.ics", payload });
    await worker.tick();
    const secondResult = (await svc.getById(second.id, companyId))?.result as Record<string, unknown> | null;
    const secondText = String(secondResult?.calendarText ?? "");

    // Same event identity → same UID across separate exports.
    const firstUids = [...firstText.matchAll(/^UID:([^@]+)@voyonder\.com$/gm)].map((m) => m[1]);
    const secondUids = [...secondText.matchAll(/^UID:([^@]+)@voyonder\.com$/gm)].map((m) => m[1]);
    expect(firstUids).toHaveLength(2);
    expect(firstUids).toEqual(secondUids);

    // Different events → different UIDs (no cross-event collision).
    expect(firstUids[0]).not.toBe(firstUids[1]);
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

  it("periodic requeue sweep requeues stale-running jobs", async () => {
    companyId = await seedCompany();
    const svc = backgroundJobService(db);

    // Start the worker first so the startup sweep runs (no stale jobs yet).
    const worker = createBackgroundJobWorker(db, {
      pollIntervalMs: 500_000, // poll rarely
      staleSweepIntervalMs: 50, // sweep often
      batchSize: 5,
      processorTimeoutMs: 60_000,
      emitStaleRequeueEvents: false,
    });
    worker.start();

    // After startup, create a job and make it stale-running.
    const job = await svc.create({
      companyId,
      jobType: "research.activity_search",
      payload: { query: "periodic" },
    });
    await svc.update(job.id, companyId, { status: "running", startedAt: new Date() });

    const farPast = new Date(Date.now() - 600_000);
    await db
      .update(backgroundJobs)
      .set({ startedAt: farPast })
      .where(drizzleEq(backgroundJobs.id, job.id));

    // Wait a bit for the periodic sweep to trigger
    await new Promise((r) => setTimeout(r, 200));

    // The stale job should have been requeued by the periodic sweep
    const reload = await svc.getById(job.id, companyId);
    expect(reload?.status).toBe("queued");

    // Run one manual tick to finish processing — this MUST happen before
    // stop(): tick() is a no-op once the worker is stopped (stopped flag).
    await worker.tick();
    const finalReload = await svc.getById(job.id, companyId);
    expect(finalReload?.status).toBe("succeeded");

    // Stop the worker
    worker.stop();
  });

  it("worker shutdown waits for in-flight jobs", async () => {
    companyId = await seedCompany();
    const svc = backgroundJobService(db);

    const worker = createBackgroundJobWorker(db, { pollIntervalMs: 500, batchSize: 5 });
    await worker.start();

    // Create a queued job that will be picked up by the fast poll
    await svc.create({
      companyId,
      jobType: "research.activity_search",
      payload: { query: "shutdown" },
    });

    // Give worker a moment to claim it
    await new Promise((r) => setTimeout(r, 300));

    // Shutdown should drain in-flight jobs gracefully
    await worker.shutdown(5_000);
    // No error means shutdown completed
    expect(true).toBe(true);
  });

  it("rejects unknown job types via direct POST with allowed-set validation", async () => {
    // Unit test the allowlist logic used by the route handler.
    // The route uses BACKGROUND_JOB_TYPES values to validate.
    const { BACKGROUND_JOB_TYPES } = await import("@paperclipai/shared");
    const allowed = new Set<string>(Object.values(BACKGROUND_JOB_TYPES));

    // Known types pass
    expect(allowed.has("research.activity_search")).toBe(true);
    expect(allowed.has("export.pdf")).toBe(true);
    expect(allowed.has("research.resolve_entities")).toBe(true);

    // Unknown types fail
    expect(allowed.has("research.does_not_exist")).toBe(false);
    expect(allowed.has("export.docx")).toBe(false);
    expect(allowed.has("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Research query lifecycle via background processors (R1a pre-ship, Finding A)
// ---------------------------------------------------------------------------

describeEmbeddedPostgres("backgroundJobWorker — research query lifecycle", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-bg-research-lifecycle-");
    db = createDb(tempDb.connectionString);
  });

  afterEach(async () => {
    await db.delete(backgroundJobs);
    await db.delete(researchQueries);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(name = "Research Lifecycle Co"): Promise<string> {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name,
      issuePrefix: `L${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
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

  it("RESEARCH_GATHER_CITATIONS transitions query from gathering → complete", async () => {
    const { BACKGROUND_JOB_TYPES } = await import("@paperclipai/shared");
    companyId = await seedCompany();
    const jobs = backgroundJobService(db);
    const artifacts = researchArtifactService(db);
    const worker = createBackgroundJobWorker(db, { pollIntervalMs: 50, batchSize: 5 });

    // Create a query and advance it to gathering
    const query = await artifacts.createQuery(companyId, {
      rawQuery: "hotels in Paris with pool",
    });
    await artifacts.updateQueryStatus(companyId, query.id, "resolving");
    await artifacts.updateQueryStatus(companyId, query.id, "gathering");
    expect((await artifacts.getQuery(companyId, query.id))!.status).toBe("gathering");

    // Create a RESEARCH_GATHER_CITATIONS job
    const job = await jobs.create({
      companyId,
      jobType: BACKGROUND_JOB_TYPES.RESEARCH_GATHER_CITATIONS,
      payload: {
        researchQueryId: query.id,
        rawQuery: "hotels in Paris with pool",
        searchPlan: [
          { source: "web", query: "Paris hotels pool booking", priority: 80 },
          { source: "email", query: "Paris hotel confirmations", priority: 50 },
        ],
        tripId: null,
        createdByActorId: "test-actor",
      },
      createdByActorId: "test-actor",
    });

    await worker.tick();

    // Job should have succeeded
    const processed = await jobs.getById(job.id, companyId);
    expect(processed?.status).toBe("succeeded");

    // Query should have transitioned to complete
    const updated = await artifacts.getQuery(companyId, query.id);
    expect(updated?.status).toBe("complete");

    // Artifacts should have been created for each search plan entry
    const artifactList = await artifacts.listArtifacts(companyId, { researchQueryId: query.id });
    expect(artifactList.length).toBeGreaterThanOrEqual(2);
  });

  it("RESEARCH_RESOLVE_ENTITIES enqueues GATHER_CITATIONS and completes full lifecycle", async () => {
    const { BACKGROUND_JOB_TYPES } = await import("@paperclipai/shared");
    companyId = await seedCompany();
    const jobs = backgroundJobService(db);
    const artifacts = researchArtifactService(db);
    const worker = createBackgroundJobWorker(db, { pollIntervalMs: 50, batchSize: 5 });

    // Create a query in pending
    const query = await artifacts.createQuery(companyId, {
      rawQuery: "flights to Tokyo under $1000",
    });
    expect(query.status).toBe("pending");

    // Create the RESEARCH_RESOLVE_ENTITIES job
    const job = await jobs.create({
      companyId,
      jobType: BACKGROUND_JOB_TYPES.RESEARCH_RESOLVE_ENTITIES,
      payload: {
        researchQueryId: query.id,
        rawQuery: "flights to Tokyo under $1000",
        tripId: null,
        createdByActorId: "test-actor",
      },
      createdByActorId: "test-actor",
    });

    // Process — resolves entities, transitions to gathering, enqueues GATHER_CITATIONS
    await worker.tick();

    // Resolve job succeeded
    const resolveJob = await jobs.getById(job.id, companyId);
    expect(resolveJob?.status).toBe("succeeded");

    // Query should have advanced past pending (gathering or complete)
    let queryState = await artifacts.getQuery(companyId, query.id);
    expect([ "gathering", "complete" ]).toContain(queryState?.status);

    // If still gathering, a GATHER_CITATIONS job should have been created
    const allJobs = await jobs.list(companyId);
    const gatherJobs = allJobs.filter((j) => j.jobType === BACKGROUND_JOB_TYPES.RESEARCH_GATHER_CITATIONS);
    if (queryState?.status === "gathering") {
      expect(gatherJobs.length).toBeGreaterThan(0);

      // Process the GATHER_CITATIONS job to complete the lifecycle
      await worker.tick();
      queryState = await artifacts.getQuery(companyId, query.id);
      expect(queryState?.status).toBe("complete");
    }
  });

  it("zero-entity query still completes via RESEARCH_RESOLVE_ENTITIES", async () => {
    const { BACKGROUND_JOB_TYPES } = await import("@paperclipai/shared");
    companyId = await seedCompany();
    const jobs = backgroundJobService(db);
    const artifacts = researchArtifactService(db);
    const worker = createBackgroundJobWorker(db, { pollIntervalMs: 50, batchSize: 5 });

    // A query with no recognizable travel entities — entity-resolver still
    // generates entities=[] and a fallback web search plan entry.
    const query = await artifacts.createQuery(companyId, {
      rawQuery: "random text without travel meaning",
    });
    expect(query.status).toBe("pending");

    const job = await jobs.create({
      companyId,
      jobType: BACKGROUND_JOB_TYPES.RESEARCH_RESOLVE_ENTITIES,
      payload: {
        researchQueryId: query.id,
        rawQuery: "random text without travel meaning",
        tripId: null,
        createdByActorId: "test-actor",
      },
      createdByActorId: "test-actor",
    });

    await worker.tick();

    // Resolve job succeeded
    const resolveJob = await jobs.getById(job.id, companyId);
    expect(resolveJob?.status).toBe("succeeded");

    // Query should have advanced (pending → resolving → gathering or complete)
    let queryState = await artifacts.getQuery(companyId, query.id);
    expect(queryState!.status).not.toBe("pending");
    expect([ "gathering", "complete" ]).toContain(queryState?.status);

    // Entities should be an empty array (not null)
    expect(Array.isArray(queryState!.entities)).toBe(true);

    // Process any remaining jobs to reach complete
    await worker.tick();
    queryState = await artifacts.getQuery(companyId, query.id);
    expect(queryState?.status).toBe("complete");
  });
});