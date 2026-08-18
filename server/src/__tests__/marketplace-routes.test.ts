import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const companyId = "33333333-3333-4333-8333-333333333333";

const mockMarketplaceService = vi.hoisted(() => ({
  listAgents: vi.fn(),
  getAgent: vi.fn(),
  hire: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  decide: vi.fn(),
}));

// Build a mock DB that returns a company row when queried by ID
function mockDbWithCompany(overrides: Record<string, unknown> = {}): any {
  const mockThen = vi.fn(
    async (resolve: (rows: Record<string, unknown>[]) => Record<string, unknown>) =>
      resolve([{ id: companyId, requireBoardApprovalForNewAgents: false, ...overrides }]),
  );
  const mockWhere = vi.fn(() => ({ then: mockThen }));
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return { select: mockSelect };
}

let appImportCounter = 0;

async function createApp(actor: Record<string, unknown>, db?: any) {
  appImportCounter += 1;
  const routeModulePath = `../routes/marketplace.js?marketplace-${appImportCounter}`;
  const middlewareModulePath = `../middleware/index.js?marketplace-${appImportCounter}`;
  const [{ marketplaceRoutes }, { errorHandler }] = await Promise.all([
    import(routeModulePath) as Promise<typeof import("../routes/marketplace.js")>,
    import(middlewareModulePath) as Promise<typeof import("../middleware/index.js")>,
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", marketplaceRoutes(db ?? ({} as any)));
  app.use(errorHandler);
  return app;
}

function boardActor() {
  return {
    type: "board",
    source: "local_implicit",
    userId: "user-1",
    companyIds: [companyId],
    isInstanceAdmin: false,
  };
}

function setupMocks() {
  vi.doMock("../services/agents-marketplace.js", () => ({
    agentMarketplaceService: () => mockMarketplaceService,
  }));
  vi.doMock("../services/access.js", () => ({
    accessService: () => mockAccessService,
  }));
}

describe("marketplace routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
    // Default: allow agents:create — individual tests override for denial cases
    mockAccessService.decide.mockResolvedValue({ allowed: true, explanation: "OK" });
  });

  describe("GET /marketplace/agents", () => {
    it("lists marketplace agents", async () => {
      mockMarketplaceService.listAgents.mockReturnValue([
        { id: "a1", name: "Senior Engineer", slug: "senior-engineer", role: "engineer", category: "engineering" },
      ]);
      const app = await createApp(boardActor());
      const res = await request(app).get("/api/marketplace/agents?category=engineering");
      expect(res.status).toBe(200);
      expect(res.body.agents).toHaveLength(1);
      expect(res.body.agents[0].name).toBe("Senior Engineer");
      expect(mockMarketplaceService.listAgents).toHaveBeenCalledWith({
        category: "engineering",
        role: undefined,
        q: undefined,
      });
    });
  });

  describe("GET /marketplace/agents/:ref", () => {
    it("returns a single agent", async () => {
      mockMarketplaceService.getAgent.mockReturnValue({
        id: "a1",
        name: "QA Engineer",
        slug: "qa-engineer",
        role: "qa",
      });
      const app = await createApp(boardActor());
      const res = await request(app).get("/api/marketplace/agents/qa-engineer");
      expect(res.status).toBe(200);
      expect(res.body.agent.name).toBe("QA Engineer");
    });

    it("returns 404 for unknown ref", async () => {
      mockMarketplaceService.getAgent.mockReturnValue(null);
      const app = await createApp(boardActor());
      const res = await request(app).get("/api/marketplace/agents/unknown");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /companies/:companyId/marketplace/agents/:ref/hire", () => {
    it("hires an agent into the company", async () => {
      mockMarketplaceService.hire.mockResolvedValue({
        agentId: "agent-1",
        agentName: "Senior Engineer",
        agentRole: "engineer",
        agentSlug: "senior-engineer",
        skillsInstalled: 2,
        warnings: [],
      });
      const db = mockDbWithCompany();
      const app = await createApp(boardActor(), db);
      const res = await request(app)
        .post(`/api/companies/${companyId}/marketplace/agents/senior-engineer/hire`)
        .send({});
      expect(res.status).toBe(201);
      expect(res.body.agentId).toBe("agent-1");
      expect(mockMarketplaceService.hire).toHaveBeenCalledWith(
        companyId,
        "senior-engineer",
        expect.objectContaining({}),
      );
    });

    it("forwards a custom name", async () => {
      mockMarketplaceService.hire.mockResolvedValue({
        agentId: "agent-1",
        agentName: "Principal Engineer",
        agentRole: "engineer",
        agentSlug: "senior-engineer",
        skillsInstalled: 1,
        warnings: [],
      });
      const db = mockDbWithCompany();
      const app = await createApp(boardActor(), db);
      const res = await request(app)
        .post(`/api/companies/${companyId}/marketplace/agents/senior-engineer/hire`)
        .send({ name: "Principal Engineer" });
      expect(res.status).toBe(201);
      const hireArgs = mockMarketplaceService.hire.mock.calls[0]!;
      expect(hireArgs[2].name).toBe("Principal Engineer");
    });

    it("forbids cross-company agent access", async () => {
      const app = await createApp({
        type: "agent",
        source: "agent_key",
        agentId: "agent-x",
        companyId: "other-company",
        runId: null,
      });
      const res = await request(app)
        .post(`/api/companies/${companyId}/marketplace/agents/senior-engineer/hire`)
        .send({});
      expect(res.status).toBe(403);
      expect(mockMarketplaceService.hire).not.toHaveBeenCalled();
    });

    it("rejects anonymous access", async () => {
      const app = await createApp({ type: "none", source: "none" });
      const res = await request(app)
        .post(`/api/companies/${companyId}/marketplace/agents/senior-engineer/hire`)
        .send({});
      expect(res.status).toBe(401);
      expect(mockMarketplaceService.hire).not.toHaveBeenCalled();
    });

    it("rejects hire when agents:create permission is denied", async () => {
      mockAccessService.decide.mockResolvedValue({
        allowed: false,
        explanation: "Missing permission: agents:create",
      });
      const app = await createApp(boardActor());
      const res = await request(app)
        .post(`/api/companies/${companyId}/marketplace/agents/senior-engineer/hire`)
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.error).toContain("agents:create");
      expect(mockMarketplaceService.hire).not.toHaveBeenCalled();
    });

    it("rejects hire when company requires board approval for new agents", async () => {
      mockAccessService.decide.mockResolvedValue({ allowed: true, explanation: "OK" });
      const db = mockDbWithCompany({ requireBoardApprovalForNewAgents: true });
      const app = await createApp(boardActor(), db);
      const res = await request(app)
        .post(`/api/companies/${companyId}/marketplace/agents/senior-engineer/hire`)
        .send({});
      expect(res.status).toBe(409);
      expect(res.body.error).toContain("board approval");
      expect(mockMarketplaceService.hire).not.toHaveBeenCalled();
    });

    it("returns 404 when company is not found", async () => {
      mockAccessService.decide.mockResolvedValue({ allowed: true, explanation: "OK" });
      // Mock db to return empty result (company not found)
      const mockEmptyThen = vi.fn(async (resolve: (rows: unknown[]) => unknown) => resolve([]));
      const mockEmptyWhere = vi.fn(() => ({ then: mockEmptyThen }));
      const mockEmptyFrom = vi.fn(() => ({ where: mockEmptyWhere }));
      const mockEmptySelect = vi.fn(() => ({ from: mockEmptyFrom }));
      const db = { select: mockEmptySelect };
      const app = await createApp(boardActor(), db);
      const res = await request(app)
        .post(`/api/companies/${companyId}/marketplace/agents/senior-engineer/hire`)
        .send({});
      expect(res.status).toBe(404);
      expect(mockMarketplaceService.hire).not.toHaveBeenCalled();
    });
  });
});
