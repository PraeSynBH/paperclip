import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createMemoryBindingSchema,
  createMemoryBindingTargetSchema,
  resolveMemoryBindingQuerySchema,
  updateMemoryBindingSchema,
  memoryCaptureRequestSchema,
  memoryRecordWriteRequestSchema,
  memoryQueryRequestSchema,
  memoryListRequestSchema,
} from "@paperclipai/shared";
import { memoryOperations } from "@paperclipai/db";
import { eq, and, desc } from "drizzle-orm";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess, assertBoardOrAgent } from "./authz.js";
import { memoryBindingService } from "../services/index.js";
import { builtinPgvectorAdapter } from "../services/memory-adapter.js";
import { forbidden, notFound } from "../errors.js";

export function memoryRoutes(db: Db) {
  const router = Router();
  const svc = memoryBindingService(db);
  const adapter = builtinPgvectorAdapter(db);

  // ─── Agent Scope Enforcement ──────────────────────────────────────────────

  /**
   * For agent-authenticated requests, enforce that scope.agentId matches the
   * caller's own agentId.  If scope.agentId is absent, inject it so the agent
   * only sees records scoped to them or shared (scopeAgentId IS NULL).
   * Throws 403 Forbidden on mismatch.
   */
  function enforceAgentScope(
    scope: { agentId?: string },
    req: { actor: { type: string; agentId?: string } },
  ): void {
    if (req.actor.type === "agent" && req.actor.agentId) {
      if (scope.agentId && scope.agentId !== req.actor.agentId) {
        throw forbidden("Agent cannot access another agent's memory scope");
      }
      scope.agentId = req.actor.agentId;
    }
  }

  // ─── Binding Resolution ──────────────────────────────────────────────────

  /**
   * GET /companies/:companyId/memory/bindings/resolve
   * Resolve the active binding for a company, optionally per-agent.
   */
  router.get(
    "/companies/:companyId/memory/bindings/resolve",
    async (req, res) => {
      assertBoardOrAgent(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const query = resolveMemoryBindingQuerySchema.parse(req.query);

      // H3: Agent authentication enforcement — agents can only resolve
      // their own binding and must not see configJson (may hold secrets).
      if (req.actor.type === "agent") {
        if (query.agentId && query.agentId !== req.actor.agentId) {
          throw forbidden("Agent cannot resolve another agent's binding");
        }
      }

      const resolved = await svc.findActiveBinding(companyId, query.agentId);

      if (!resolved) {
        res.status(404).json({
          error: "No active memory binding found",
          companyId,
          agentId: query.agentId ?? null,
        });
        return;
      }

      // Strip configJson from agent-facing responses to avoid leaking secrets
      if (req.actor.type === "agent") {
        const { configJson, ...safeBinding } = resolved.binding;
        res.json({
          ...resolved,
          binding: safeBinding,
        });
        return;
      }

      res.json(resolved);
    },
  );

  // ─── Bindings CRUD ───────────────────────────────────────────────────────

  /** GET /companies/:companyId/memory/bindings — List all bindings */
  router.get("/companies/:companyId/memory/bindings", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.listBindings(companyId));
  });

  /** GET /companies/:companyId/memory/bindings/:bindingId — Get one binding */
  router.get(
    "/companies/:companyId/memory/bindings/:bindingId",
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      const bindingId = req.params.bindingId as string;
      assertCompanyAccess(req, companyId);
      res.json(await svc.getBinding(companyId, bindingId));
    },
  );

  /** POST /companies/:companyId/memory/bindings — Create a binding */
  router.post(
    "/companies/:companyId/memory/bindings",
    validate(createMemoryBindingSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      res.status(201).json(await svc.createBinding(companyId, req.body));
    },
  );

  /** PATCH /companies/:companyId/memory/bindings/:bindingId — Update a binding */
  router.patch(
    "/companies/:companyId/memory/bindings/:bindingId",
    validate(updateMemoryBindingSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      const bindingId = req.params.bindingId as string;
      assertCompanyAccess(req, companyId);
      res.json(await svc.updateBinding(companyId, bindingId, req.body));
    },
  );

  /** DELETE /companies/:companyId/memory/bindings/:bindingId — Delete a binding */
  router.delete(
    "/companies/:companyId/memory/bindings/:bindingId",
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      const bindingId = req.params.bindingId as string;
      assertCompanyAccess(req, companyId);
      await svc.deleteBinding(companyId, bindingId);
      res.status(204).end();
    },
  );

  // ─── Binding Targets CRUD ────────────────────────────────────────────────

  /** GET /companies/:companyId/memory/targets — List all targets */
  router.get("/companies/:companyId/memory/targets", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.listTargets(companyId));
  });

  /** POST /companies/:companyId/memory/targets — Create a target */
  router.post(
    "/companies/:companyId/memory/targets",
    validate(createMemoryBindingTargetSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      res.status(201).json(await svc.createTarget(companyId, req.body));
    },
  );

  /** DELETE /companies/:companyId/memory/targets/:targetId — Delete a target */
  router.delete(
    "/companies/:companyId/memory/targets/:targetId",
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      const targetId = req.params.targetId as string;
      assertCompanyAccess(req, companyId);
      await svc.deleteTarget(companyId, targetId);
      res.status(204).end();
    },
  );

  // ─── Agent Memory Config View ───────────────────────────────────────────

  /**
   * GET /companies/:companyId/memory/agents/:agentId/config
   * Get the resolved memory configuration for an agent.
   */
  router.get(
    "/companies/:companyId/memory/agents/:agentId/config",
    async (req, res) => {
      assertBoardOrAgent(req);
      const companyId = req.params.companyId as string;
      const agentId = req.params.agentId as string;
      assertCompanyAccess(req, companyId);

      const config = await svc.getAgentMemoryConfig(companyId, agentId);
      if (!config) {
        res.status(404).json({
          error: "No memory binding configured for this agent",
          companyId,
          agentId,
        });
        return;
      }

      res.json(config);
    },
  );

  // ─── Memory Records / Adapter Operations ────────────────────────────────

  /**
   * POST /companies/:companyId/memory/capture
   * Capture text into memory (auto-capture with 30d TTL).
   */
  router.post(
    "/companies/:companyId/memory/capture",
    validate(memoryCaptureRequestSchema),
    async (req, res) => {
      assertBoardOrAgent(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const scope = { ...req.body.scope, companyId };
      enforceAgentScope(scope, req);

      const result = await adapter.capture({
        ...req.body,
        scope,
        source: { ...req.body.source, companyId },
      });
      res.status(201).json(result);
    },
  );

  /**
   * POST /companies/:companyId/memory/records
   * Upsert curated records into memory.
   */
  router.post(
    "/companies/:companyId/memory/records",
    validate(memoryRecordWriteRequestSchema),
    async (req, res) => {
      assertBoardOrAgent(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const scope = { ...req.body.scope, companyId };
      enforceAgentScope(scope, req);

      const result = await adapter.upsertRecords({
        ...req.body,
        scope,
        source: req.body.source
          ? { ...req.body.source, companyId }
          : undefined,
      });
      res.status(201).json(result);
    },
  );

  /**
   * GET /companies/:companyId/memory/query
   * Search memory records (semantic + full-text hybrid).
   */
  router.get(
    "/companies/:companyId/memory/query",
    async (req, res) => {
      assertBoardOrAgent(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const scope = req.query.scope
        ? { ...JSON.parse(req.query.scope as string), companyId }
        : { companyId };
      enforceAgentScope(scope, req);

      const query = memoryQueryRequestSchema.parse({
        ...req.query,
        bindingKey: req.query.bindingKey,
        scope,
        query: req.query.q ?? req.query.query,
        topK: req.query.topK ? Number(req.query.topK) : undefined,
      });

      const result = await adapter.query(query);
      res.json(result);
    },
  );

  /**
   * GET /companies/:companyId/memory/records
   * List memory records with cursor-based pagination.
   */
  router.get(
    "/companies/:companyId/memory/records",
    async (req, res) => {
      assertBoardOrAgent(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const scope = req.query.scope
        ? { ...JSON.parse(req.query.scope as string), companyId }
        : { companyId };
      enforceAgentScope(scope, req);

      const listReq = memoryListRequestSchema.parse({
        bindingKey: req.query.bindingKey,
        scope,
        cursor: req.query.cursor,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });

      const result = await adapter.list(listReq);
      res.json(result);
    },
  );

  /**
   * GET /companies/:companyId/memory/records/:recordId
   * Get a single memory record by ID.
   */
  router.get(
    "/companies/:companyId/memory/records/:recordId",
    async (req, res) => {
      assertBoardOrAgent(req);
      const companyId = req.params.companyId as string;
      const recordId = req.params.recordId as string;
      assertCompanyAccess(req, companyId);

      const scope: { companyId: string; agentId?: string } = { companyId };
      enforceAgentScope(scope, req);

      const result = await adapter.get(
        { providerKey: "builtin_pgvector", providerRecordId: recordId },
        scope,
      );

      if (!result) {
        res.status(404).json({
          error: "Memory record not found",
          companyId,
          recordId,
        });
        return;
      }

      res.json(result);
    },
  );

  /**
   * DELETE /companies/:companyId/memory/records
   * Forget memory records by handle.
   * Body: { handles: [{ providerKey, providerRecordId }] }
   */
  router.delete(
    "/companies/:companyId/memory/records",
    async (req, res) => {
      assertBoardOrAgent(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const { handles } = req.body as {
        handles: Array<{ providerKey: string; providerRecordId: string }>;
      };

      if (!handles || !Array.isArray(handles) || handles.length === 0) {
        res.status(400).json({ error: "handles array is required" });
        return;
      }

      // C4: Enforce agent scope on forget operations
      const scope: { companyId: string; agentId?: string } = { companyId };
      enforceAgentScope(scope, req);

      await adapter.forget(handles, scope);
      res.status(204).end();
    },
  );

  // ─── Operations Audit Log ───────────────────────────────────────────────

  /**
   * GET /companies/:companyId/memory/operations
   * List recent memory operations (audit log).
   */
  router.get(
    "/companies/:companyId/memory/operations",
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const limit = Math.min(
        Number(req.query.limit) || 50,
        200,
      );

      const rows = await db
        .select()
        .from(memoryOperations)
        .where(eq(memoryOperations.companyId, companyId))
        .orderBy(desc(memoryOperations.createdAt))
        .limit(limit);

      res.json(rows);
    },
  );

  return router;
}