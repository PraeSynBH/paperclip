import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { selectOnboardingRoleSchema, skipOnboardingSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { onboardingService } from "../services/onboarding.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function onboardingRoutes(db: Db) {
  const router = Router();
  const svc = onboardingService(db);

  /**
   * GET /api/companies/:companyId/onboarding/status
   * Check the current onboarding state for a company.
   */
  router.get(
    "/companies/:companyId/onboarding/status",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const status = await svc.getStatus(companyId);
      res.json(status);
    },
  );

  /**
   * POST /api/companies/:companyId/onboarding/role
   * Select a role during onboarding. Creates initial agent, project,
   * goal, and first task.
   */
  router.post(
    "/companies/:companyId/onboarding/role",
    validate(selectOnboardingRoleSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const { role } = req.body;
      const result = await svc.selectRole(companyId, role, getActorInfo(req));
      res.status(200).json({
        companyId,
        role,
        applied: true,
        agentId: result.agentId,
        projectId: result.projectId,
        goalId: result.goalId,
        issueId: result.issueId,
      });
    },
  );

  /**
   * POST /api/companies/:companyId/onboarding/skip
   * Skip onboarding and land on the empty dashboard.
   */
  router.post(
    "/companies/:companyId/onboarding/skip",
    validate(skipOnboardingSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await svc.skip(companyId, getActorInfo(req));
      res.status(200).json({
        companyId,
        skipped: true,
      });
    },
  );

  return router;
}