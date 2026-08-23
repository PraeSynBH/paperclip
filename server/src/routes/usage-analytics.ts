import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { usageAnalyticsService } from "../services/usage-analytics.js";
import { assertBoardOrgAccess } from "./authz.js";
import type { UsageAnalyticsWindow } from "@paperclipai/shared";

const VALID_WINDOWS = new Set<UsageAnalyticsWindow>(["7d", "30d", "90d"]);

export function usageAnalyticsRoutes(db: Db) {
  const router = Router();
  const svc = usageAnalyticsService(db);

  router.get("/instance/usage-analytics", async (req, res) => {
    // Instance-admin-level access: anyone with board org access can view
    assertBoardOrgAccess(req);

    const rawWindow = (req.query.window as string) ?? "30d";
    const window: UsageAnalyticsWindow = VALID_WINDOWS.has(rawWindow as UsageAnalyticsWindow)
      ? (rawWindow as UsageAnalyticsWindow)
      : "30d";

    const report = await svc.report(window);
    res.json(report);
  });

  return router;
}
