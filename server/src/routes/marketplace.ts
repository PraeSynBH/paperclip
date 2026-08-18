/**
 * Agent Marketplace Routes
 *
 * HAL for the agent-marketplace service — browse catalog entries (app-level)
 * and one-click hire marketplace agents into a company (company-scoped).
 *
 * Browse:
 *   GET /marketplace/agents
 *   GET /marketplace/agents/:ref
 *
 * Hire:
 *   POST /companies/:companyId/marketplace/agents/:ref/hire
 */
import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { companies } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { agentMarketplaceService } from "../services/agents-marketplace.js";
import { accessService } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { conflict, forbidden, notFound } from "../errors.js";

// ── Schemas ───────────────────────────────────────────────────────────────────

const marketplaceListQuerySchema = z.object({
  category: z.string().optional(),
  role: z.string().optional(),
  q: z.string().optional(),
});

const marketplaceHireSchema = z.object({
  name: z.string().min(1).optional(),
  adapterType: z.string().min(1).optional(),
  adapterConfig: z.record(z.string(), z.unknown()).optional(),
});

// ── Route ─────────────────────────────────────────────────────────────────────

export function marketplaceRoutes(db: Db) {
  const router = Router();
  const svc = agentMarketplaceService(db);
  const access = accessService(db);

  // ── Browse (app-level, no company context) ───────────────────────────────

  /**
   * GET /marketplace/agents — List all available marketplace agents.
   * Supports optional query filters: ?category=engineering&role=engineer&q=senior
   */
  router.get(
    "/marketplace/agents",
    async (req, res) => {
      const query = marketplaceListQuerySchema.parse(req.query);
      const agents = svc.listAgents({
        category: query.category,
        role: query.role,
        q: query.q,
      });
      res.json({ agents });
    },
  );

  /**
   * GET /marketplace/agents/:ref — Get a single marketplace agent by id, key, or slug.
   */
  router.get(
    "/marketplace/agents/:ref",
    async (req, res) => {
      const agent = svc.getAgent(req.params.ref);
      if (!agent) {
        throw notFound(`Marketplace agent "${req.params.ref}" not found`);
      }
      res.json({ agent });
    },
  );

  // ── Hire (company-scoped) ────────────────────────────────────────────────

  /**
   * POST /companies/:companyId/marketplace/agents/:ref/hire — One-click hire.
   * Creates the agent in the company with its default configuration and
   * installs all required catalog skills.
   */
  router.post(
    "/companies/:companyId/marketplace/agents/:ref/hire",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const ref = req.params.ref as string;

      // Require board/agent access to the company
      assertCompanyAccess(req, companyId);

      // Standard agent-creation permission gate — mirrors the agents:create
      // check on POST /companies/:companyId/agents. Any member (including
      // operator-role users) can otherwise create a process-adapter agent
      // with arbitrary command → server-side command execution.
      const decision = await access.decide({
        actor: req.actor,
        action: "agents:create",
        resource: { type: "company", companyId },
      });
      if (!decision.allowed) {
        throw forbidden(decision.explanation);
      }
      if (req.actor.type === "agent" && req.actor.companyId !== companyId) {
        throw forbidden("Agent key cannot access another company");
      }

      // Board approval gate — mirrors POST /companies/:companyId/agents
      const company = await db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .then((rows) => rows[0] ?? null);
      if (!company) {
        res.status(404).json({ error: "Company not found" });
        return;
      }
      if (company.requireBoardApprovalForNewAgents) {
        throw conflict(
          "Company requires board approval for new agents. Use POST /api/companies/:companyId/agent-hires to create a pending hire approval.",
        );
      }

      const body = marketplaceHireSchema.parse(req.body ?? {});
      const actor = getActorInfo(req);
      const result = await svc.hire(companyId, ref, {
        name: body.name,
        adapterType: body.adapterType,
        adapterConfig: body.adapterConfig,
        actorAgentId: actor.actorType === "agent" ? actor.actorId : undefined,
      });

      res.status(201).json(result);
    },
  );

  return router;
}