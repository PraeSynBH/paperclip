import express from "express";
import request from "supertest";
import { beforeEach, beforeAll, describe, expect, it, vi } from "vitest";

const companyId = "33333333-3333-4333-8333-333333333333";

const mockPackService = vi.hoisted(() => ({
  listPacks: vi.fn(),
  getPack: vi.fn(),
  installPack: vi.fn(),
}));

const mockPackData = {
  engineering: {
    key: "engineering",
    name: "Engineering",
    description: "Curated knowledge for engineering teams",
    industry: "Software Engineering",
    icon: "tools",
    documentCount: 7,
    documents: [
      { title: "Coding Standards", summary: "Code standards", body: "# Standards" },
    ],
  },
  "travel-industry": {
    key: "travel-industry",
    name: "Travel Industry",
    description: "Knowledge for travel companies",
    industry: "Travel",
    icon: "globe",
    documentCount: 6,
    documents: [
      { title: "Travel Guide", summary: "Guide", body: "# Guide" },
    ],
  },
};

function registerMocks() {
  vi.doMock("../services/knowledge-starter-packs.js", () => ({
    knowledgeStarterPackService: () => mockPackService,
  }));
}

let routeModule: typeof import("../routes/knowledge-starter-packs.js") | null = null;
let middlewareModule: typeof import("../middleware/index.js") | null = null;

beforeAll(async () => {
  registerMocks();
  [routeModule, middlewareModule] = await Promise.all([
    import("../routes/knowledge-starter-packs.js") as Promise<
      typeof import("../routes/knowledge-starter-packs.js")
    >,
    import("../middleware/index.js") as Promise<typeof import("../middleware/index.js")>,
  ]);
});

let appImportCounter = 0;

async function createApp(actor: Record<string, unknown>) {
  appImportCounter += 1;
  const routeModulePath = `../routes/knowledge-starter-packs.js?ksp-${appImportCounter}`;
  const middlewareModulePath = `../middleware/index.js?ksp-${appImportCounter}`;
  const [{ knowledgeStarterPackRoutes: freshRoutes }, { errorHandler: freshErrorHandler }] =
    await Promise.all([
      import(routeModulePath) as Promise<
        typeof import("../routes/knowledge-starter-packs.js")
      >,
      import(middlewareModulePath) as Promise<typeof import("../middleware/index.js")>,
    ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", freshRoutes({} as any));
  app.use(freshErrorHandler);
  return app;
}

function resetMockDefaults() {
  mockPackService.listPacks.mockImplementation(async () =>
    Object.values(mockPackData).map((p) => ({
      key: p.key,
      name: p.name,
      description: p.description,
      industry: p.industry,
      icon: p.icon,
      documentCount: p.documentCount,
    })),
  );
  mockPackService.getPack.mockImplementation(async (key: string) => {
    return (mockPackData as any)[key] ?? null;
  });
  mockPackService.installPack.mockImplementation(
    async (cid: string, key: string) => ({
      packKey: key,
      documentsCreated: (mockPackData as any)[key]?.documents?.length ?? 0,
      documentIds: ["doc-1", "doc-2"],
    }),
  );
}

const boardActor = {
  type: "board",
  userId: "88888888-8888-4888-8888-888888888888",
  userName: "Test User",
  userEmail: "user@example.com",
  companyIds: [companyId],
  isInstanceAdmin: false,
  source: "session",
};

const agentActor = {
  type: "agent",
  agentId: "44444444-4444-4444-8444-444444444444",
  companyId,
  source: "agent_key",
};

beforeEach(() => {
  vi.clearAllMocks();
  resetMockDefaults();
});

// ─── GET /knowledge-starter-packs ─────────────────────────────────────────────

describe("GET /api/knowledge-starter-packs", () => {
  it("lists all available starter packs with metadata", async () => {
    const app = await createApp(boardActor);
    const res = await request(app).get("/api/knowledge-starter-packs");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
    const keys = res.body.map((p: any) => p.key);
    expect(keys).toContain("engineering");
    expect(keys).toContain("travel-industry");
  });

  it("returns metadata without documents", async () => {
    const app = await createApp(boardActor);
    const res = await request(app).get("/api/knowledge-starter-packs");

    expect(res.status).toBe(200);
    for (const pack of res.body) {
      expect(pack.key).toBeDefined();
      expect(pack.name).toBeDefined();
      expect(pack.description).toBeDefined();
      expect(pack.industry).toBeDefined();
      expect(pack.icon).toBeDefined();
      expect(pack.documentCount).toBeDefined();
      expect(pack.documents).toBeUndefined();
    }
  });

  it("returns empty array when no packs exist", async () => {
    mockPackService.listPacks.mockResolvedValue([]);
    const app = await createApp(boardActor);
    const res = await request(app).get("/api/knowledge-starter-packs");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("is accessible without authentication", async () => {
    const app = await createApp({ type: "none", source: "none" });
    const res = await request(app).get("/api/knowledge-starter-packs");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ─── GET /knowledge-starter-packs/:packKey ────────────────────────────────────

describe("GET /api/knowledge-starter-packs/:packKey", () => {
  it("returns a single pack with full documents", async () => {
    const app = await createApp(boardActor);
    const res = await request(app).get("/api/knowledge-starter-packs/engineering");

    expect(res.status).toBe(200);
    expect(res.body.key).toBe("engineering");
    expect(res.body.name).toBe("Engineering");
    expect(res.body.documents).toBeDefined();
    expect(res.body.documents.length).toBeGreaterThanOrEqual(1);
  });

  it("returns 404 for unknown pack key", async () => {
    const app = await createApp(boardActor);
    const res = await request(app).get("/api/knowledge-starter-packs/unknown-pack");

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("unknown-pack");
  });
});

// ─── POST /companies/:companyId/knowledge/starter-packs/:packKey/install ──────

describe("POST /api/companies/:id/knowledge/starter-packs/:packKey/install", () => {
  it("installs a starter pack into a company knowledge base", async () => {
    const app = await createApp(boardActor);
    const res = await request(app)
      .post(`/api/companies/${companyId}/knowledge/starter-packs/engineering/install`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.packKey).toBe("engineering");
    expect(res.body.documentsCreated).toBeGreaterThanOrEqual(1);
    expect(res.body.documentIds).toBeDefined();
    expect(Array.isArray(res.body.documentIds)).toBe(true);

    expect(mockPackService.installPack).toHaveBeenCalledWith(
      companyId,
      "engineering",
      undefined,
    );
  });

  it("accepts actorAgentId override", async () => {
    const app = await createApp(boardActor);
    const res = await request(app)
      .post(`/api/companies/${companyId}/knowledge/starter-packs/engineering/install`)
      .send({ actorAgentId: "custom-agent-id" });

    expect(res.status).toBe(201);
    expect(mockPackService.installPack).toHaveBeenCalledWith(
      companyId,
      "engineering",
      "custom-agent-id",
    );
  });

  it("returns 404 for unknown pack key", async () => {
    const app = await createApp(boardActor);
    const res = await request(app)
      .post(`/api/companies/${companyId}/knowledge/starter-packs/unknown-pack/install`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("unknown-pack");
  });

  it("rejects unauthenticated actors", async () => {
    const app = await createApp({ type: "none", source: "none" });
    const res = await request(app)
      .post(`/api/companies/${companyId}/knowledge/starter-packs/engineering/install`)
      .send({});

    expect(res.status).toBe(403);
  });

  it("rejects actors without company access", async () => {
    const noAccessActor = {
      type: "board",
      userId: "88888888-8888-4888-8888-888888888888",
      source: "session",
      companyIds: ["other-company-id"],
      isInstanceAdmin: false,
    };
    const app = await createApp(noAccessActor);
    const res = await request(app)
      .post(`/api/companies/${companyId}/knowledge/starter-packs/engineering/install`)
      .send({});

    expect(res.status).toBe(403);
  });

  it("works for agent actors with matching company ID", async () => {
    const app = await createApp(agentActor);
    const res = await request(app)
      .post(`/api/companies/${companyId}/knowledge/starter-packs/engineering/install`)
      .send({});

    expect(res.status).toBe(201);
    expect(mockPackService.installPack).toHaveBeenCalledWith(
      companyId,
      "engineering",
      agentActor.agentId,
    );
  });

  it("rejects agent actors from a different company", async () => {
    const otherCompanyAgent = {
      ...agentActor,
      companyId: "other-company-id",
    };
    const app = await createApp(otherCompanyAgent);
    const res = await request(app)
      .post(`/api/companies/${companyId}/knowledge/starter-packs/engineering/install`)
      .send({});

    expect(res.status).toBe(403);
  });
});
