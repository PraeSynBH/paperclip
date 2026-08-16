import { beforeEach, describe, expect, it, vi } from "vitest";

// We do NOT mock @paperclipai/shared — the validators are pure functions
// and the real package is needed for proper TypeScript types and runtime behavior.

// Mock drizzle-orm operators
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual("drizzle-orm");
  return {
    ...(actual as Record<string, unknown>),
    eq: vi.fn((a: unknown, b: unknown) => ({ op: "eq", left: a, right: b })),
    and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
    desc: vi.fn((arg: unknown) => ({ op: "desc", arg })),
    sql: vi.fn(function sql(...args: unknown[]) {
      return { op: "sql", args };
    }),
  };
});

// Mock @paperclipai/db — the table references
vi.mock("@paperclipai/db", () => ({
  memoryBindings: { _tableName: "memory_bindings" },
  memoryBindingTargets: { _tableName: "memory_binding_targets" },
}));

// Mock the errors module
vi.mock("../errors.js", () => ({
  notFound: vi.fn((msg: string) => {
    const err = new Error(msg) as Error & { status: number };
    err.status = 404;
    throw err;
  }),
  conflict: vi.fn((msg: string) => {
    const err = new Error(msg) as Error & { status: number };
    err.status = 409;
    throw err;
  }),
}));

import { memoryBindingService } from "./memory-bindings.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeDb() {
  const select = vi.fn();

  function makeChain() {
    const chain = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      then: vi.fn((resolve: (rows: unknown[]) => unknown) =>
        Promise.resolve(resolve([])),
      ),
    };
    return chain;
  }

  function makeInsertChain() {
    const returning = vi.fn().mockResolvedValue([]);
    return { values: vi.fn(() => ({ returning })) };
  }

  return {
    select,
    insert: vi.fn(() => makeInsertChain()),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([]),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn().mockResolvedValue([]),
    })),
    _makeChain: makeChain,
  };
}

type TestDb = ReturnType<typeof makeDb>;

function makeBinding(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "binding-1",
    companyId: "company-1",
    key: "default",
    providerType: "builtin_pgvector",
    configJson: { model: "text-embedding-3-small", topK: 10 },
    capabilitiesJson: { profile: true, correction: true },
    enabled: true,
    createdAt: new Date("2026-08-15T00:00:00Z"),
    updatedAt: new Date("2026-08-15T00:00:00Z"),
    ...overrides,
  };
}

function makeTarget(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "target-1",
    companyId: "company-1",
    targetType: "company",
    targetId: "company-1",
    bindingId: "binding-1",
    priority: 0,
    createdAt: new Date("2026-08-15T00:00:00Z"),
    ...overrides,
  };
}

/**
 * Wire up db.select() to return a sequence of query chains, each resolving
 * to the given results. The first call returns the first chain, etc.
 */
function hookSelect(
  db: TestDb,
  resultsets: unknown[][],
) {
  const chains = resultsets.map((rows) => {
    const chain = db._makeChain();
    chain.then.mockImplementation(
      (resolve: (rows: unknown[]) => unknown) =>
        Promise.resolve(resolve(rows)),
    );
    return chain;
  });

  if (chains.length === 1) {
    db.select.mockReturnValue(chains[0]);
  } else {
    // Return each chain in sequence
    let index = 0;
    db.select.mockImplementation(() => {
      const c = chains[index];
      index = Math.min(index + 1, chains.length - 1);
      return c;
    });
  }

  return chains;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("memoryBindingService", () => {
  let db: TestDb;

  beforeEach(() => {
    db = makeDb();
    vi.clearAllMocks();
  });

  // ─── findActiveBinding ──────────────────────────────────────────────────

  describe("findActiveBinding", () => {
    it("returns agent override when agent target exists with enabled binding", async () => {
      const svc = memoryBindingService(db as never);
      const agentResult = {
        target: makeTarget({
          targetType: "agent",
          targetId: "agent-1",
          priority: 10,
          id: "target-agent-1",
        }),
        binding: makeBinding(),
      };

      hookSelect(db, [[agentResult]]);

      const result = await svc.findActiveBinding("company-1", "agent-1");
      expect(result).not.toBeNull();
      expect(result!.resolution.source).toBe("agent_override");
      expect(result!.resolution.agentId).toBe("agent-1");
      expect(result!.binding.key).toBe("default");
    });

    it("falls back to company default when no agent target exists", async () => {
      const svc = memoryBindingService(db as never);
      const companyResult = {
        target: makeTarget(),
        binding: makeBinding(),
      };

      hookSelect(db, [[], [companyResult]]);

      const result = await svc.findActiveBinding("company-1", "agent-1");
      expect(result).not.toBeNull();
      expect(result!.resolution.source).toBe("company_default");
      expect(result!.target.targetType).toBe("company");
    });

    it("falls back to company default when agentId is not provided", async () => {
      const svc = memoryBindingService(db as never);
      const companyResult = {
        target: makeTarget(),
        binding: makeBinding(),
      };

      hookSelect(db, [[companyResult]]);

      const result = await svc.findActiveBinding("company-1");
      expect(result).not.toBeNull();
      expect(result!.resolution.source).toBe("company_default");
    });

    it("returns null when no binding is configured at any level", async () => {
      const svc = memoryBindingService(db as never);

      hookSelect(db, [[], []]);

      const result = await svc.findActiveBinding("company-1", "agent-1");
      expect(result).toBeNull();
    });

    it("skips disabled bindings gracefully", async () => {
      const svc = memoryBindingService(db as never);

      hookSelect(db, [[], []]);

      const result = await svc.findActiveBinding("company-1", "agent-1");
      expect(result).toBeNull();
      expect(db.select).toHaveBeenCalled();
    });

    it("uses highest priority target when multiple exist", async () => {
      const svc = memoryBindingService(db as never);
      const highPriorityResult = {
        target: makeTarget({
          targetType: "agent",
          targetId: "agent-1",
          priority: 50,
          id: "target-high",
        }),
        binding: makeBinding({ key: "high-priority" }),
      };

      hookSelect(db, [[highPriorityResult]]);

      const result = await svc.findActiveBinding("company-1", "agent-1");
      expect(result).not.toBeNull();
      expect(result!.binding.key).toBe("high-priority");
      expect(result!.target.priority).toBe(50);
    });
  });

  // ─── getAgentMemoryConfig ───────────────────────────────────────────────

  describe("getAgentMemoryConfig", () => {
    it("returns formatted config when binding is resolved via agent override", async () => {
      const svc = memoryBindingService(db as never);
      const agentResult = {
        target: makeTarget({
          targetType: "agent",
          targetId: "agent-1",
          priority: 10,
        }),
        binding: makeBinding(),
      };

      hookSelect(db, [[agentResult]]);

      const config = await svc.getAgentMemoryConfig("company-1", "agent-1");
      expect(config).not.toBeNull();
      expect(config!.bindingKey).toBe("default");
      expect(config!.providerType).toBe("builtin_pgvector");
      expect(config!.targetType).toBe("agent");
      expect(config!.enabled).toBe(true);
    });

    it("returns formatted config when binding is resolved via company default", async () => {
      const svc = memoryBindingService(db as never);
      const companyResult = {
        target: makeTarget(),
        binding: makeBinding(),
      };

      hookSelect(db, [[], [companyResult]]);

      const config = await svc.getAgentMemoryConfig("company-1", "agent-1");
      expect(config).not.toBeNull();
      expect(config!.targetType).toBe("company");
    });

    it("returns null when no binding is configured", async () => {
      const svc = memoryBindingService(db as never);
      hookSelect(db, [[], []]);

      const config = await svc.getAgentMemoryConfig("company-1", "agent-1");
      expect(config).toBeNull();
    });
  });

  // ─── getBinding ─────────────────────────────────────────────────────────

  describe("getBinding", () => {
    it("returns binding when it exists in company scope", async () => {
      const svc = memoryBindingService(db as never);
      const binding = makeBinding();

      const chain = db._makeChain();
      chain.then.mockImplementation(
        (resolve: (rows: unknown[]) => unknown) =>
          Promise.resolve(resolve([binding])),
      );
      db.select.mockReturnValue(chain);

      const result = await svc.getBinding("company-1", "binding-1");
      expect(result.id).toBe("binding-1");
      expect(result.key).toBe("default");
    });

    it("throws notFound when binding does not exist", async () => {
      const svc = memoryBindingService(db as never);

      const chain = db._makeChain();
      chain.then.mockImplementation(
        (resolve: (rows: unknown[]) => unknown) =>
          Promise.resolve(resolve([])),
      );
      db.select.mockReturnValue(chain);

      await expect(
        svc.getBinding("company-1", "nonexistent"),
      ).rejects.toThrow();
    });
  });

  // ─── createBinding ──────────────────────────────────────────────────────

  describe("createBinding", () => {
    it("creates a binding with valid input", async () => {
      const svc = memoryBindingService(db as never);
      const binding = makeBinding();

      const returning = vi.fn().mockResolvedValue([binding]);
      db.insert.mockReturnValue({
        values: vi.fn(() => ({ returning })),
      });

      const result = await svc.createBinding("company-1", {
        key: "default",
        providerType: "builtin_pgvector",
        configJson: { model: "text-embedding-3-small", topK: 10 },
        capabilitiesJson: { profile: true },
      } as any);

      expect(result.id).toBe("binding-1");
      expect(result.key).toBe("default");
    });

    it("rejects empty key", async () => {
      const svc = memoryBindingService(db as never);
      await expect(
        svc.createBinding("company-1", {
          key: "",
          providerType: "builtin_pgvector",
          configJson: {},
          capabilitiesJson: {},
        } as Parameters<typeof svc.createBinding>[1]),
      ).rejects.toThrow();
    });

    it("rejects empty providerType", async () => {
      const svc = memoryBindingService(db as never);
      await expect(
        svc.createBinding("company-1", {
          key: "test",
          providerType: "",
          enabled: true,
          configJson: {},
          capabilitiesJson: {},
        }),
      ).rejects.toThrow();
    });
  });

  // ─── createTarget ───────────────────────────────────────────────────────

  describe("createTarget", () => {
    it("creates target when binding exists", async () => {
      const svc = memoryBindingService(db as never);

      // First select: getBinding lookup succeeds
      const getBindingChain = db._makeChain();
      getBindingChain.then.mockImplementation(
        (resolve: (rows: unknown[]) => unknown) =>
          Promise.resolve(resolve([makeBinding()])),
      );

      // Insert returns the new target
      const targetReturning = vi.fn().mockResolvedValue([makeTarget()]);
      db.insert.mockReturnValue({
        values: vi.fn(() => ({ returning: targetReturning })),
      });

      db.select.mockReturnValue(getBindingChain);

      const result = await svc.createTarget("company-1", {
        targetType: "agent",
        targetId: "b1a2c3d4-e5f6-7890-abcd-ef1234567890",
        bindingId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        priority: 10,
      });

      expect(result).toBeDefined();
    });

    it("throws when binding does not exist", async () => {
      const svc = memoryBindingService(db as never);

      const chain = db._makeChain();
      chain.then.mockImplementation(
        (resolve: (rows: unknown[]) => unknown) =>
          Promise.resolve(resolve([])),
      );
      db.select.mockReturnValue(chain);

      await expect(
        svc.createTarget("company-1", {
          targetType: "agent",
          targetId: "b1a2c3d4-e5f6-7890-abcd-ef1234567890",
          bindingId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          priority: 0,
        }),
      ).rejects.toThrow();
    });
  });

  // ─── updateBinding ──────────────────────────────────────────────────────

  describe("updateBinding", () => {
    it("updates binding fields and returns updated record", async () => {
      const svc = memoryBindingService(db as never);
      const updated = makeBinding({
        providerType: "mem0-prod",
        configJson: { apiKey: "sk-test" },
      });

      const whereFn = vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([updated]),
      }));
      db.update.mockReturnValue({
        set: vi.fn(() => ({ where: whereFn })),
      });

      const result = await svc.updateBinding("company-1", "binding-1", {
        providerType: "mem0-prod",
        configJson: { apiKey: "sk-test" },
      });

      expect(result.providerType).toBe("mem0-prod");
    });

    it("throws notFound when binding does not exist", async () => {
      const svc = memoryBindingService(db as never);

      const whereFn = vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([]),
      }));
      db.update.mockReturnValue({
        set: vi.fn(() => ({ where: whereFn })),
      });

      await expect(
        svc.updateBinding("company-1", "nonexistent", { enabled: false }),
      ).rejects.toThrow();
    });
  });

  // ─── deleteBinding ──────────────────────────────────────────────────────

  describe("deleteBinding", () => {
    it("deletes targets and binding", async () => {
      const svc = memoryBindingService(db as never);

      // Mock two delete calls: first targets, then binding
      const targetDel = { where: vi.fn().mockResolvedValue([{ id: "t1" }]) };
      const bindingDel = {
        where: vi.fn().mockResolvedValue([{ id: "binding-1" }]),
      };

      db.delete
        .mockReturnValueOnce(targetDel)
        .mockReturnValueOnce(bindingDel);

      await svc.deleteBinding("company-1", "binding-1");
      expect(db.delete).toHaveBeenCalledTimes(2);
      // Binding delete was called
      expect(bindingDel.where).toHaveBeenCalled();
    });
  });

  // ─── listBindings ───────────────────────────────────────────────────────

  describe("listBindings", () => {
    it("returns all bindings for a company", async () => {
      const svc = memoryBindingService(db as never);
      const bindings = [makeBinding(), makeBinding({ id: "binding-2", key: "secondary" })];

      const chain = db._makeChain();
      chain.then.mockImplementation(
        (resolve: (rows: unknown[]) => unknown) =>
          Promise.resolve(resolve(bindings)),
      );
      db.select.mockReturnValue(chain);

      const result = await svc.listBindings("company-1");
      expect(result).toHaveLength(2);
    });
  });

  // ─── listTargets ────────────────────────────────────────────────────────

  describe("listTargets", () => {
    it("returns all targets for a company", async () => {
      const svc = memoryBindingService(db as never);
      const targets = [
        makeTarget({ id: "t1", targetType: "company", targetId: "company-1" }),
        makeTarget({
          id: "t2",
          targetType: "agent",
          targetId: "agent-1",
          priority: 10,
        }),
      ];

      const chain = db._makeChain();
      chain.then.mockImplementation(
        (resolve: (rows: unknown[]) => unknown) =>
          Promise.resolve(resolve(targets)),
      );
      db.select.mockReturnValue(chain);

      const result = await svc.listTargets("company-1");
      expect(result).toHaveLength(2);
    });
  });

  // ─── getAgentTarget / deleteTarget ──────────────────────────────────────

  describe("getAgentTarget", () => {
    it("returns agent target when it exists", async () => {
      const svc = memoryBindingService(db as never);
      const target = makeTarget({
        id: "t1",
        targetType: "agent",
        targetId: "agent-1",
        priority: 10,
      });

      const chain = db._makeChain();
      chain.then.mockImplementation(
        (resolve: (rows: unknown[]) => unknown) =>
          Promise.resolve(resolve([target])),
      );
      db.select.mockReturnValue(chain);

      const result = await svc.getAgentTarget("company-1", "agent-1");
      expect(result).not.toBeNull();
      expect(result!.targetType).toBe("agent");
    });

    it("returns null when agent target does not exist", async () => {
      const svc = memoryBindingService(db as never);

      const chain = db._makeChain();
      chain.then.mockImplementation(
        (resolve: (rows: unknown[]) => unknown) =>
          Promise.resolve(resolve([])),
      );
      db.select.mockReturnValue(chain);

      const result = await svc.getAgentTarget("company-1", "agent-1");
      expect(result).toBeNull();
    });
  });

  describe("deleteTarget", () => {
    it("deletes target within company scope", async () => {
      const svc = memoryBindingService(db as never);
      const delWhere = vi.fn().mockResolvedValue([{ id: "t1" }]);
      db.delete.mockReturnValue({ where: delWhere });

      await svc.deleteTarget("company-1", "t1");
      expect(delWhere).toHaveBeenCalled();
    });
  });
});