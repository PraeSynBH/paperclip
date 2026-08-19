import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { knowledgeStarterPackService } from "../services/knowledge-starter-packs.js";
import { assertBoardOrAgent, assertCompanyAccess } from "./authz.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const installStarterPackSchema = z.object({
  /** Optional agent ID override to use as the document creator. */
  actorAgentId: z.string().optional(),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

export function knowledgeStarterPackRoutes(db: Db) {
  const router = Router();
  const svc = knowledgeStarterPackService(db);

  /**
   * GET /knowledge-starter-packs
   * List all available knowledge starter packs (metadata only — documents
   * excluded). Use the install endpoint to apply a pack to a company.
   */
  router.get("/knowledge-starter-packs", async (_req, res) => {
    const packs = await svc.listPacks();
    res.json(packs);
  });

  /**
   * GET /knowledge-starter-packs/:packKey
   * Get a single starter pack by key, including its full documents.
   */
  router.get("/knowledge-starter-packs/:packKey", async (req, res) => {
    const packKey = req.params.packKey as string;
    const pack = await svc.getPack(packKey);
    if (!pack) {
      res.status(404).json({ error: `Starter pack '${packKey}' not found` });
      return;
    }
    res.json(pack);
  });

  /**
   * POST /companies/:companyId/knowledge/starter-packs/:packKey/install
   * Install a starter pack into a company's knowledge base.
   *
   * Creates all documents from the pack as published (auto-approved starter
   * content). Skips documents whose title already exists in the company's
   * knowledge base to avoid duplicates.
   */
  router.post(
    "/companies/:companyId/knowledge/starter-packs/:packKey/install",
    validate(installStarterPackSchema),
    async (req, res) => {
      assertBoardOrAgent(req);

      const companyId = req.params.companyId as string;
      const packKey = req.params.packKey as string;

      assertCompanyAccess(req, companyId);

      // Verify the pack exists before attempting installation
      const pack = await svc.getPack(packKey);
      if (!pack) {
        res.status(404).json({ error: `Starter pack '${packKey}' not found` });
        return;
      }

      const actorAgentId =
        req.body.actorAgentId ?? (req as any).actor?.agentId ?? undefined;

      const result = await svc.installPack(companyId, packKey, actorAgentId);

      res.status(201).json(result);
    },
  );

  return router;
}
