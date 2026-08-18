import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAgentService = vi.hoisted(() => ({
  create: vi.fn(),
}));

const mockCompanySkillService = vi.hoisted(() => ({
  installFromCatalog: vi.fn(),
}));

vi.mock("../services/agents.js", () => ({
  agentService: () => mockAgentService,
}));

vi.mock("../services/company-skills.js", () => ({
  companySkillService: () => mockCompanySkillService,
}));

vi.mock("../services/skills-catalog.js", () => ({
  getCatalogSkillOrThrow: vi.fn((ref: string) => ({
    id: `paperclipai:bundled:test:${ref}`,
    key: `paperclipai/bundled/test/${ref}`,
    name: ref,
  })),
}));

const { agentMarketplaceService } = await import("../services/agents-marketplace.js");

describe("agentMarketplaceService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentService.create.mockResolvedValue({
      id: "agent-1",
      name: "Senior Engineer",
      role: "engineer",
      title: "Senior Engineer",
      icon: "code",
      urlKey: "senior-engineer",
      adapterType: "process",
      companyId: "company-1",
    });
    mockCompanySkillService.installFromCatalog.mockResolvedValue({
      action: "created",
      skill: { id: "skill-1" },
      catalogSkill: { id: "catalog-skill-1" },
      warnings: [],
    });
  });

  describe("listAgents", () => {
    it("returns all marketplace agents", () => {
      const svc = agentMarketplaceService({} as never);
      const agents = svc.listAgents();
      expect(agents.length).toBeGreaterThanOrEqual(6);
      expect(agents[0]).toHaveProperty("name");
      expect(agents[0]).toHaveProperty("slug");
      expect(agents[0]).toHaveProperty("role");
      expect(agents[0]).toHaveProperty("requiredSkills");
      // Internal config must not leak
      expect(agents[0]).not.toHaveProperty("defaultAdapterConfig");
      expect(agents[0]).not.toHaveProperty("defaultPermissions");
    });

    it("filters by category", () => {
      const svc = agentMarketplaceService({} as never);
      const agents = svc.listAgents({ category: "engineering" });
      expect(agents.length).toBeGreaterThanOrEqual(1);
      expect(agents.every((a) => a.category === "engineering")).toBe(true);
    });

    it("filters by role", () => {
      const svc = agentMarketplaceService({} as never);
      const agents = svc.listAgents({ role: "qa" });
      expect(agents.length).toBeGreaterThanOrEqual(1);
      expect(agents.every((a) => a.role === "qa")).toBe(true);
    });

    it("filters by free-text query", () => {
      const svc = agentMarketplaceService({} as never);
      const agents = svc.listAgents({ q: "engineer" });
      expect(agents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getAgent", () => {
    it("resolves by id, key, and slug", () => {
      const svc = agentMarketplaceService({} as never);
      const byId = svc.getAgent("paperclipai:marketplace:engineering:senior-engineer");
      const bySlug = svc.getAgent("senior-engineer");
      expect(byId?.name).toBe("Senior Engineer");
      expect(bySlug?.name).toBe("Senior Engineer");
    });

    it("returns null for unknown refs", () => {
      const svc = agentMarketplaceService({} as never);
      expect(svc.getAgent("does-not-exist")).toBeNull();
    });
  });

  describe("hire", () => {
    it("creates the agent with marketplace defaults and installs required skills", async () => {
      const svc = agentMarketplaceService({} as never);
      const result = await svc.hire("company-1", "senior-engineer");

      expect(result.agentId).toBe("agent-1");
      expect(result.agentName).toBe("Senior Engineer");

      // Agent created with defaults from the catalog entry
      const createCall = mockAgentService.create.mock.calls[0]!;
      expect(createCall[0]).toBe("company-1");
      expect(createCall[1]).toMatchObject({
        name: "Senior Engineer",
        role: "engineer",
        title: "Senior Engineer",
        icon: "code",
        adapterType: "process",
        budgetMonthlyCents: 50000,
        status: "idle",
      });

      // Required skills installed (github-pr-workflow + task-planning = 2 required)
      expect(mockCompanySkillService.installFromCatalog).toHaveBeenCalledTimes(2);
      expect(result.skillsInstalled).toBe(2);
      expect(result.warnings).toEqual([]);
    });

    it("honors a custom name", async () => {
      const svc = agentMarketplaceService({} as never);
      await svc.hire("company-1", "senior-engineer", { name: "Principal Engineer" });
      const createCall = mockAgentService.create.mock.calls[0]!;
      expect(createCall[1].name).toBe("Principal Engineer");
    });

    it("collects warnings when skill install fails", async () => {
      mockCompanySkillService.installFromCatalog.mockRejectedValue(new Error("skill source unreachable"));
      const svc = agentMarketplaceService({} as never);
      const result = await svc.hire("company-1", "senior-engineer");
      expect(result.skillsInstalled).toBe(0);
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
      expect(result.warnings[0]).toContain("skill source unreachable");
    });

    it("throws not found for unknown agent refs", async () => {
      const svc = agentMarketplaceService({} as never);
      await expect(svc.hire("company-1", "nope")).rejects.toThrow("Marketplace agent \"nope\" not found");
    });
  });
});
