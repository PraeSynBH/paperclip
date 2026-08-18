import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { companyTemplateService } from "../services/index.js";
import { assertBoard, getActorInfo } from "./authz.js";
import { forbidden, notFound } from "../errors.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const deployTemplateSchema = z.object({
  /** Override the default company name from the template. */
  name: z.string().min(1).optional(),
  /** Monthly budget in cents. */
  budgetMonthlyCents: z.number().int().nonnegative().optional().default(0),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

export function companyTemplateRoutes(db: Db) {
  const router = Router();
  const svc = companyTemplateService(db);

  /**
   * GET /company-templates
   * List all available company templates (metadata only).
   */
  router.get("", async (_req, res) => {
    const templates = await svc.listTemplates();
    res.json(templates);
  });

  /**
   * GET /company-templates/:key
   * Get a single template by key, including full agent/goal/project data.
   */
  router.get("/:key", async (req, res) => {
    const tmpl = await svc.getTemplate(req.params.key as string);
    if (!tmpl) {
      res.status(404).json({ error: `Template '${req.params.key}' not found` });
      return;
    }
    res.json(tmpl);
  });

  /**
   * POST /company-templates/:key/deploy
   * One-click deploy a template: creates a new company with agents, skills,
   * knowledge base, goal, project, and starter issue.
   */
  router.post(
    "/:key/deploy",
    validate(deployTemplateSchema),
    async (req, res) => {
      assertBoard(req);

      // Require authenticated user session
      if (req.actor.source !== "local_implicit" && !req.actor.isInstanceAdmin) {
        if (!req.actor.userId) {
          throw forbidden("Authenticated user session required to deploy a company template");
        }
      }

      const key = req.params.key as string;
      const body = deployTemplateSchema.parse(req.body);
      const ownerUserId = req.actor.userId ?? "local-board";

      const result = await svc.deployTemplate(key, {
        companyName: body.name,
        budgetMonthlyCents: body.budgetMonthlyCents,
        ownerUserId,
      });

      res.status(201).json(result);
    },
  );

  return router;
}