import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const mockLogActivity = vi.hoisted(() => vi.fn());

const mockDefaultAgentInstructions = vi.hoisted(() => ({
  loadDefaultAgentInstructionsBundle: vi.fn(),
  resolveDefaultAgentInstructionsBundleRole: vi.fn(),
}));

const mockAdapters = vi.hoisted(() => ({
  findActiveServerAdapter: vi.fn(),
}));

function registerOnboardingRouteMocks() {
  vi.doMock("../services/index.js", () => ({
    companyService: () => mockCompanyService,
    agentService: () => mockAgentService,
    agentInstructionsService: () => mockAgentInstructionsService,
    accessService: () => mockAccessService,
    budgetService: () => mockBudgetService,
    goalService: () => mockGoalService,
    projectService: () => mockProjectService,
    issueService: () => mockIssueService,
    logActivity: mockLogActivity,
  }));
  vi.doMock("../services/default-agent-instructions.js", () => mockDefaultAgentInstructions);
  vi.doMock("../adapters/index.js", () => mockAdapters);
}

let appImportCounter = 0;

async function createApp(actor: Record<string, unknown>) {
  registerOnboardingRouteMocks();
  appImportCounter += 1;
  const routeModulePath = `../routes/onboarding.js?onboarding-${appImportCounter}`;
  const middlewareModulePath = `../middleware/index.js?onboarding-${appImportCounter}`;
  const [{ onboardingRoutes }, { errorHandler }] = await Promise.all([
    import(routeModulePath) as Promise<typeof import("../routes/onboarding.js")>,
    import(middlewareModulePath) as Promise<typeof import("../middleware/index.js")>,
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api/onboarding", onboardingRoutes({} as any));
  app.use(errorHandler);
  return app;
}

function createCompany() {
  return {
    id: companyId,
    name: "Acme Inc",
    description: "Industry: SaaS",
    status: "active",
    issuePrefix: "ACM",
    issueCounter: 0,
    budgetMonthlyCents: 100_00,
    spentMonthlyCents: 0,
    attachmentMaxBytes: 25_000_000,
    requireBoardApprovalForNewAgents: false,
    feedbackDataSharingEnabled: false,
    feedbackDataSharingConsentAt: null,
    feedbackDataSharingConsentByUserId: null,
    feedbackDataSharingTermsVersion: null,
    brandColor: null,
    logoAssetId: null,
    createdAt: new Date("2026-08-16T00:00:00.000Z"),
    updatedAt: new Date("2026-08-16T00:00:00.000Z"),
  };
}

function createAgent() {
  return {
    id: agentId,
    companyId,
    name: "CEO",
    role: "ceo",
    title: "CEO",
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
    createdAt: new Date("2026-08-16T00:00:00.000Z"),
    updatedAt: new Date("2026-08-16T00:00:00.000Z"),
    urlKey: "ceo",
  };
}

function createGoal() {
  return {
    id: goalId,
    companyId,
    title: "Scale Acme Inc",
    description: "Build a leading SaaS company.",
    level: "company",
    status: "active",
    parentId: null,
    ownerAgentId: null,
    createdAt: new Date("2026-08-16T00:00:00.000Z"),
    updatedAt: new Date("2026-08-16T00:00:00.000Z"),
  };
}

function createProject() {
  return {
    id: projectId,
    companyId,
    name: "Onboarding",
    status: "in_progress",
    goalIds: [goalId],
    goalId,
    createdAt: new Date("2026-08-16T00:00:00.000Z"),
    updatedAt: new Date("2026-08-16T00:00:00.000Z"),
  };
}

function createIssue() {
  return {
    id: issueId,
    companyId,
    title: "Hire your first engineer and create a hiring plan",
    description: "You are the CEO.",
    status: "todo",
    assigneeAgentId: agentId,
    projectId,
    goalId,
    identifier: "ACM-1",
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
  mockAccessService.ensureMembership.mockResolvedValue(undefined);
  mockAccessService.ensureRoleDefaultGrants.mockResolvedValue(undefined);
  mockBudgetService.upsertPolicy.mockResolvedValue(undefined);
  mockGoalService.create.mockImplementation(async () => createGoal());
  mockProjectService.create.mockImplementation(async () => createProject());
  mockIssueService.create.mockImplementation(async () => createIssue());
  mockLogActivity.mockResolvedValue(undefined);
  mockDefaultAgentInstructions.loadDefaultAgentInstructionsBundle.mockResolvedValue({
    "AGENTS.md": "# CEO",
  });
  mockDefaultAgentInstructions.resolveDefaultAgentInstructionsBundleRole.mockReturnValue("ceo");
  mockAdapters.findActiveServerAdapter.mockReturnValue({ supportsInstructionsBundle: false });
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

describe("POST /api/onboarding/start", () => {
  it("creates company + agents + goal + project + issue for a session user", async () => {
    const app = await createApp(boardActor);
    const res = await request(app)
      .post("/api/onboarding/start")
      .send({
        company: { name: "Acme Inc", industry: "SaaS", budgetMonthlyCents: 100_00 },
        agents: [{ role: "ceo" }, { role: "cto" }],
      });

    expect(res.status).toBe(201);
    expect(res.body.company.id).toBe(companyId);
    expect(res.body.company.issuePrefix).toBe("ACM");
    expect(res.body.company.description).toContain("SaaS");
    expect(res.body.agents).toHaveLength(2);
    expect(res.body.agents[0].role).toBe("ceo");
    expect(res.body.goal.title).toContain("Acme Inc");
    expect(res.body.project.name).toBe("Onboarding");
    expect(res.body.issue.identifier).toBe("ACM-1");
    expect(res.body.issue.assigneeAgentId).toBe(agentId);

    expect(mockAccessService.ensureMembership).toHaveBeenCalledWith(
      companyId,
      "user",
      userId,
      "owner",
      "active",
    );
    expect(mockAccessService.ensureRoleDefaultGrants).toHaveBeenCalledWith(
      companyId,
      userId,
      "owner",
      userId,
    );
    expect(mockBudgetService.upsertPolicy).toHaveBeenCalledTimes(1);
    expect(mockAgentService.create).toHaveBeenCalledTimes(2);
    expect(mockGoalService.create).toHaveBeenCalledTimes(1);
    expect(mockProjectService.create).toHaveBeenCalledTimes(1);
    expect(mockIssueService.create).toHaveBeenCalledTimes(1);
  });

  it("defaults to CEO + CTO + PM agents when none are supplied", async () => {
    const app = await createApp(boardActor);
    const res = await request(app)
      .post("/api/onboarding/start")
      .send({ company: { name: "Acme Inc" } });

    expect(res.status).toBe(201);
    expect(mockAgentService.create).toHaveBeenCalledTimes(3);
    const roles = mockAgentService.create.mock.calls.map((call) => call[1].role);
    expect(roles).toEqual(["ceo", "cto", "pm"]);
  });

  it("rejects unauthenticated actors", async () => {
    const app = await createApp({ type: "none", source: "none" });
    const res = await request(app)
      .post("/api/onboarding/start")
      .send({ company: { name: "Acme Inc" } });

    expect(res.status).toBe(403);
  });

  it("skips budget policy when budget is zero", async () => {
    const app = await createApp(boardActor);
    const res = await request(app)
      .post("/api/onboarding/start")
      .send({ company: { name: "Acme Inc", budgetMonthlyCents: 0 } });

    expect(res.status).toBe(201);
    expect(mockBudgetService.upsertPolicy).not.toHaveBeenCalled();
  });
});
