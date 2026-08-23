import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { startTrialSchema, convertTrialSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { billingService } from "../services/billing.js";
import { assertCompanyAccess } from "./authz.js";

/**
 * Self-serve trial routes — mounted on the main API router.
 *
 * These endpoints are intentionally NOT behind requireBoardUser so that
 * any authenticated user with company access can start a trial.
 */
export function trialRoutes(db: Db) {
  const router = Router();
  const billing = billingService(db);

  /**
   * POST /api/companies/:companyId/trial/start
   * Start a self-serve trial. Idempotent — returns existing subscription
   * if the company already has one.
   */
  router.post(
    "/companies/:companyId/trial/start",
    validate(startTrialSchema),
    async (req, res, next) => {
      try {
        const companyId = req.params.companyId as string;
        assertCompanyAccess(req, companyId);

        const result = await billing.startTrial(companyId, {
          billingPeriod: req.body.billingPeriod ?? "monthly",
        });

        res.status(result.alreadyExisted ? 200 : 201).json({
          companyId,
          ...result,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * GET /api/companies/:companyId/trial/status
   * Get the current trial status for a company — trialing state,
   * trial end date, days remaining.
   */
  router.get(
    "/companies/:companyId/trial/status",
    async (req, res, next) => {
      try {
        const companyId = req.params.companyId as string;
        assertCompanyAccess(req, companyId);

        const status = await billing.getTrialStatus(companyId);
        res.json({
          companyId,
          ...status,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * POST /api/companies/:companyId/trial/convert
   * Create a Stripe Checkout Session to convert a trial to a paid subscription.
   * This is the self-serve conversion path from trial → paid.
   */
  router.post(
    "/companies/:companyId/trial/convert",
    validate(convertTrialSchema),
    async (req, res, next) => {
      try {
        const companyId = req.params.companyId as string;
        assertCompanyAccess(req, companyId);

        const result = await billing.createCheckoutSession(companyId, {
          tierId: req.body.tierId,
          billingPeriod: req.body.billingPeriod ?? "monthly",
          successUrl: req.body.successUrl,
          cancelUrl: req.body.cancelUrl,
        });

        res.json({
          companyId,
          url: result.url,
          sessionId: result.sessionId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}