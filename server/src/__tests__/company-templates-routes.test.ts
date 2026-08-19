import express from "express";
import request from "supertest";
import { beforeEach, beforeAll, describe, expect, it, vi } from "vitest";

const companyId = "33333333-3333-4333-8333-333333333333";
const agentId = "44444444-4444-4444-8444-444444444444";
const goalId = "55555555-5555-4555-8555-555555555555";
const projectId = "66666666-6666-4666-8666-666666666666";
const issueId = "77777777-7777-4777-8777-777777777777";
const userId = "88888888-8888-4888-8888-888888888888";

const mockCompanyService = vi.hoisted(() => ({
  create: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
}));

const mockAgentInstructionsService = vi.hoisted(() => ({
  materializeManagedBundle: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  ensureMembership: vi.fn(),
  ensureRoleDefaultGrants: vi.fn(),
}));

const mockBudgetService = vi.hoisted(() => ({
  upsertPolicy: vi.fn(),
}));

const mockGoalService = vi.hoisted(() => ({
  create: vi.fn(),
}));

const mockProjectService = vi.hoisted(() => ({
  create: vi.fn(),
}));

const mockIssueService = vi.hoisted(() => ({
  create: vi.fn(),
}));

const mockCompanySkillService = vi.hoisted(() => ({
  installFromCatalog: vi.fn(),
}));

const mockStarterPackService = vi.hoisted(() => ({
  installPack: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

function registerMocks() {
  vi.doMock("../services/companies.js", () => ({
    companyService: () => mockCompanyService,
  }));
  vi.doMock("../services/agents.js", () => ({
    agentService: () => mockAgentService,
  }));
  vi.doMock("../services/agent-instructions.js", () => ({
    agentInstructionsService: () => mockAgentInstructionsService,
  }));
  vi.doMock("../services/access.js", () => ({
    accessService: () => mockAccessService,
  }));
  vi.doMock("../services/budgets.js", () => ({
    budgetService: () => mockBudgetService,
  }));
  vi.doMock("../services/goals.js", () => ({
    goalService: () => mockGoalService,
  }));
  vi.doMock("../services/projects.js", () => ({
    projectService: () => mockProjectService,
  }));
  vi.doMock("../services/issues.js", () => ({
    issueService: () => mockIssueService,
  }));
  vi.doMock("../services/company-skills.js", () => ({
    companySkillService: () => mockCompanySkillService,
  }));
  vi.doMock("../services/knowledge-starter-packs.js", () => ({
    knowledgeStarterPackService: () => mockStarterPackService,
  }));
  vi.doMock("../services/activity-log.js", () => ({
    logActivity: mockLogActivity,
  }));
}

let appImportCounter = 0;
let routeModule: typeof import("../routes/company-templates.js") | null = null;
let middlewareModule: typeof import("../middleware/index.js") | null = null;

/**
 * Minimal fake db for the route harness.  `transaction` runs the callback
 * inline (like a passthrough transaction) so mocked services execute inside
 * it, and re-throws on failure — mirroring real rollback semantics.
 */
function createFakeDb() {
  const fakeDb: Record<string, unknown> = {};
  fakeDb.transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(fakeDb));
  return fakeDb;
}

// The services graph (via ../services/index.js) is heavy to transform (~25s cold).
// Preload it once in beforeAll (120s hook budget) so per-test imports are cheap.
beforeAll(async () => {
  registerMocks();
  [routeModule, middlewareModule] = await Promise.all([
    import("../routes/company-templates.js") as Promise<typeof import("../routes/company-templates.js")>,
    import("../middleware/index.js") as Promise<typeof import("../middleware/index.js")>,
  ]);
});

async function createApp(actor: Record<string, unknown>) {
  appImportCounter += 1;
  // Re-import the route module per test (with a fresh query string) so the
  // mocked services/index.js chain is re-resolved; the transform cache makes
  // this cheap after beforeAll warmed it.
  const routeModulePath = `../routes/company-templates.js?ct-${appImportCounter}`;
  const middlewareModulePath = `../middleware/index.js?ct-${appImportCounter}`;
  const [{ companyTemplateRoutes: freshCompanyTemplateRoutes }, { errorHandler: freshErrorHandler }] =
    await Promise.all([
      import(routeModulePath) as Promise<typeof import("../routes/company-templates.js")>,
      import(middlewareModulePath) as Promise<typeof import("../middleware/index.js")>,
    ]);
  const fakeDb = createFakeDb();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api/company-templates", freshCompanyTemplateRoutes(fakeDb as any));
  app.use(freshErrorHandler);
  return { app, db: fakeDb };
}

function createCompany() {
  return {
    id: companyId,
    name: "Voyager Concierge",
    description: null,
    status: "active",
    issuePrefix: "VOY",
    issueCounter: 0,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    attachmentMaxBytes: 25_000_000,
    requireBoardApprovalForNewAgents: false,
    feedbackDataSharingEnabled: false,
    feedbackDataSharingConsentAt: null,
    feedbackDataSharingConsentByUserId: null,
    feedbackDataSharingTermsVersion: null,
    brandColor: null,
    logoAssetId: null,
    createdAt: new Date("2026-08-17T00:00:00.000Z"),
    updatedAt: new Date("2026-08-17T00:00:00.000Z"),
  };
}

function createAgent() {
  return {
    id: agentId,
    companyId,
    name: "Atlas",
    role: "ceo",
    title: "CEO & Head Concierge",
    icon: null,
    status: "idle",
    reportsTo: null,
    capabilities: null,
    adapterType: "process",
    adapterConfig: {},
    runtimeConfig: {},
    defaultEnvironmentId: null,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    errorReason: null,
    permissions: {},
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: new Date("2026-08-17T00:00:00.000Z"),
    updatedAt: new Date("2026-08-17T00:00:00.000Z"),
    urlKey: "atlas",
  };
}

function createGoal() {
  return {
    id: goalId,
    companyId,
    title: "Launch the Voyager Concierge service",
    description: "Build a leading AI-powered travel concierge.",
    level: "company",
    status: "active",
    parentId: null,
    ownerAgentId: null,
    createdAt: new Date("2026-08-17T00:00:00.000Z"),
    updatedAt: new Date("2026-08-17T00:00:00.000Z"),
  };
}

function createProject() {
  return {
    id: projectId,
    companyId,
    name: "Launch",
    status: "in_progress",
    goalIds: [goalId],
    goalId,
    createdAt: new Date("2026-08-17T00:00:00.000Z"),
    updatedAt: new Date("2026-08-17T00:00:00.000Z"),
  };
}

function createIssue() {
  return {
    id: issueId,
    companyId,
    title: "Stand up the booking intake workflow",
    description: "Define how client booking requests are received.",
    status: "todo",
    assigneeAgentId: agentId,
    projectId,
    goalId,
    identifier: "VOY-1",
  };
}

function resetMockDefaults() {
  mockCompanyService.create.mockImplementation(async (body: Record<string, unknown>) => ({
    ...createCompany(),
    ...body,
  }));
  mockAgentService.create.mockImplementation(async () => createAgent());
  mockAgentService.update.mockImplementation(async (id: string, body: Record<string, unknown>) => ({
    ...createAgent(),
    ...body,
  }));
  mockAgentInstructionsService.materializeManagedBundle.mockResolvedValue({
    bundle: {
      agentId,
      companyId,
      mode: "managed",
      rootPath: `/tmp/test-instructions/${agentId}`,
      managedRootPath: `/tmp/test-instructions/${agentId}`,
      entryFile: "AGENTS.md",
      resolvedEntryPath: `/tmp/test-instructions/${agentId}/AGENTS.md`,
      editable: true,
      warnings: [],
      legacyPromptTemplateActive: false,
    },
    adapterConfig: { instructions: { mode: "managed" } },
  });
  mockAccessService.ensureMembership.mockResolvedValue(undefined);
  mockAccessService.ensureRoleDefaultGrants.mockResolvedValue(undefined);
  mockBudgetService.upsertPolicy.mockResolvedValue(undefined);
  mockGoalService.create.mockImplementation(async () => createGoal());
  mockProjectService.create.mockImplementation(async () => createProject());
  mockIssueService.create.mockImplementation(async () => createIssue());
  mockCompanySkillService.installFromCatalog.mockResolvedValue({
    action: "created",
    skill: { id: "skill-1", slug: "task-planning" },
    catalogSkill: { id: "paperclipai:bundled:paperclip-operations:task-planning" },
    warnings: [],
  });
  mockStarterPackService.installPack.mockResolvedValue({
    packKey: "travel-industry",
    documentsCreated: 6,
    documentIds: ["doc-1"],
  });
  mockLogActivity.mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetMockDefaults();
});

const boardActor = {
  type: "board",
  userId,
  userName: "Test User",
  userEmail: "user@example.com",
  companyIds: [],
  isInstanceAdmin: false,
  source: "session",
};

describe("GET /api/company-templates", () => {
  it("lists available templates", async () => {
    const { app } = await createApp(boardActor);
    const res = await request(app).get("/api/company-templates");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(4);
    const keys = res.body.map((t: any) => t.key);
    expect(keys).toContain("travel-concierge");
    expect(keys).toContain("support-ops");
    expect(keys).toContain("engineering-team");
    expect(keys).toContain("cpa-firm");
  });

  it("returns metadata without agents or goal data", async () => {
    const { app } = await createApp(boardActor);
    const res = await request(app).get("/api/company-templates");

    expect(res.status).toBe(200);
    for (const tmpl of res.body) {
      expect(tmpl.key).toBeDefined();
      expect(tmpl.name).toBeDefined();
      expect(tmpl.description).toBeDefined();
      expect(tmpl.industry).toBeDefined();
      expect(tmpl.icon).toBeDefined();
      expect(tmpl.company).toBeDefined();
      expect(tmpl.agents).toBeUndefined();
    }
  });
});

describe("GET /api/company-templates/:key", () => {
  it("returns a single template with full details", async () => {
    const { app } = await createApp(boardActor);
    const res = await request(app).get("/api/company-templates/travel-concierge");

    expect(res.status).toBe(200);
    expect(res.body.key).toBe("travel-concierge");
    expect(res.body.agents).toBeDefined();
    expect(res.body.agents.length).toBeGreaterThanOrEqual(3);
    expect(res.body.company.name).toBe("Voyager Concierge");
    expect(res.body.starterPackKey).toBe("travel-industry");
  });

  it("returns 404 for unknown template key", async () => {
    const { app } = await createApp(boardActor);
    const res = await request(app).get("/api/company-templates/unknown-template");

    expect(res.status).toBe(404);
  });
});

describe("POST /api/company-templates/:key/deploy", () => {
  it("deploys a template and creates company + agents", async () => {
    const { app, db } = await createApp(boardActor);
    const res = await request(app)
      .post("/api/company-templates/travel-concierge/deploy")
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.company.id).toBe(companyId);
    expect(res.body.company.name).toBe("Voyager Concierge");
    expect(res.body.agents).toBeDefined();
    expect(res.body.agents.length).toBeGreaterThanOrEqual(3);
    expect(res.body.goal).toBeDefined();
    expect(res.body.project).toBeDefined();
    expect(res.body.issue).toBeDefined();
    expect(res.body.issue.assigneeAgentId).toBe(agentId);

    expect(mockAccessService.ensureMembership).toHaveBeenCalledWith(
      companyId,
      "user",
      userId,
      "owner",
      "active",
    );
    expect(mockAgentService.create).toHaveBeenCalledTimes(3);
    expect(mockGoalService.create).toHaveBeenCalledTimes(1);
    expect(mockProjectService.create).toHaveBeenCalledTimes(1);
    expect(mockIssueService.create).toHaveBeenCalledTimes(1);
    expect(mockCompanySkillService.installFromCatalog).toHaveBeenCalled();
    expect(mockStarterPackService.installPack).toHaveBeenCalledWith(companyId, "travel-industry");

    // Verify the deployment was wrapped in a database transaction
    expect(db.transaction).toHaveBeenCalled();
  });

  it("accepts custom company name override", async () => {
    const { app } = await createApp(boardActor);
    const res = await request(app)
      .post("/api/company-templates/travel-concierge/deploy")
      .send({ name: "My Custom Travel Co" });

    expect(res.status).toBe(201);
    expect(mockCompanyService.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "My Custom Travel Co" }),
    );
  });

  it("rejects unauthenticated actors", async () => {
    const { app } = await createApp({ type: "none", source: "none" });
    const res = await request(app)
      .post("/api/company-templates/travel-concierge/deploy")
      .send({});

    expect(res.status).toBe(403);
  });

  it("returns 404 for unknown template", async () => {
    const { app } = await createApp(boardActor);
    const res = await request(app)
      .post("/api/company-templates/unknown-template/deploy")
      .send({});

    expect(res.status).toBe(404);
  });

  // ── Transactional rollback failure tests ───────────────────
  // Each step failure triggers a full rollback via db.transaction.
  // With mocked services, "rollback" is verified by asserting that
  // (a) the request returns an error (500), and (b) steps after the
  // failing step were never attempted — no partial deployment state.

  it("rolls back when company creation fails", async () => {
    mockCompanyService.create.mockRejectedValue(new Error("db down"));

    const { app } = await createApp(boardActor);
    const res = await request(app)
      .post("/api/company-templates/travel-concierge/deploy")
      .send({});

    expect(res.status).toBe(500);
    expect(mockAgentService.create).not.toHaveBeenCalled();
    expect(mockGoalService.create).not.toHaveBeenCalled();
  });

  it("rolls back when membership setup fails", async () => {
    mockAccessService.ensureMembership.mockRejectedValue(new Error("no membership"));

    const { app } = await createApp(boardActor);
    const res = await request(app)
      .post("/api/company-templates/travel-concierge/deploy")
      .send({});

    expect(res.status).toBe(500);
    expect(mockAgentService.create).not.toHaveBeenCalled();
  });

  it("rolls back when role grant setup fails", async () => {
    mockAccessService.ensureRoleDefaultGrants.mockRejectedValue(new Error("no grants"));

    const { app } = await createApp(boardActor);
    const res = await request(app)
      .post("/api/company-templates/travel-concierge/deploy")
      .send({});

    expect(res.status).toBe(500);
    expect(mockAgentService.create).not.toHaveBeenCalled();
  });

  it("rolls back when skill install fails", async () => {
    mockCompanySkillService.installFromCatalog.mockRejectedValue(new Error("skill not found"));

    const { app } = await createApp(boardActor);
    const res = await request(app)
      .post("/api/company-templates/travel-concierge/deploy")
      .send({});

    expect(res.status).toBe(500);
    expect(mockAgentService.create).not.toHaveBeenCalled();
  });

  it("rolls back when agent creation fails mid-way (agent 2 of 3)", async () => {
    mockAgentService.create
      .mockResolvedValueOnce(createAgent())
      .mockRejectedValueOnce(new Error("agent create failed"));

    const { app } = await createApp(boardActor);
    const res = await request(app)
      .post("/api/company-templates/travel-concierge/deploy")
      .send({});

    expect(res.status).toBe(500);
    // Only first agent was attempted; second failure halts the loop
    expect(mockAgentService.create).toHaveBeenCalledTimes(2);
    // Steps after agent loop were never reached
    expect(mockStarterPackService.installPack).not.toHaveBeenCalled();
    expect(mockGoalService.create).not.toHaveBeenCalled();
    expect(mockProjectService.create).not.toHaveBeenCalled();
    expect(mockIssueService.create).not.toHaveBeenCalled();
  });

  it("rolls back when starter pack install fails", async () => {
    mockStarterPackService.installPack.mockRejectedValue(new Error("pack missing"));

    const { app } = await createApp(boardActor);
    const res = await request(app)
      .post("/api/company-templates/travel-concierge/deploy")
      .send({});

    expect(res.status).toBe(500);
    expect(mockGoalService.create).not.toHaveBeenCalled();
    expect(mockProjectService.create).not.toHaveBeenCalled();
    expect(mockIssueService.create).not.toHaveBeenCalled();
  });

  it("rolls back when goal creation fails", async () => {
    mockGoalService.create.mockRejectedValue(new Error("goal failed"));

    const { app } = await createApp(boardActor);
    const res = await request(app)
      .post("/api/company-templates/travel-concierge/deploy")
      .send({});

    expect(res.status).toBe(500);
    expect(mockProjectService.create).not.toHaveBeenCalled();
    expect(mockIssueService.create).not.toHaveBeenCalled();
  });

  it("rolls back when project creation fails", async () => {
    mockProjectService.create.mockRejectedValue(new Error("project failed"));

    const { app } = await createApp(boardActor);
    const res = await request(app)
      .post("/api/company-templates/travel-concierge/deploy")
      .send({});

    expect(res.status).toBe(500);
    expect(mockIssueService.create).not.toHaveBeenCalled();
  });

  it("rolls back when starter issue creation fails", async () => {
    mockIssueService.create.mockRejectedValue(new Error("issue failed"));

    const { app } = await createApp(boardActor);
    const res = await request(app)
      .post("/api/company-templates/travel-concierge/deploy")
      .send({});

    expect(res.status).toBe(500);
    // Previous steps (agents, starter pack, goal, project) still happened —
    // but the transaction rollback undoes them all.
    expect(mockAgentService.create).toHaveBeenCalled();
    expect(mockGoalService.create).toHaveBeenCalled();
    expect(mockProjectService.create).toHaveBeenCalled();
  });
});
