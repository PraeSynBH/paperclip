import type { NextFunction, Request, Response } from "express";
import { apiLatencyTracker } from "../services/recovery/load-guard.js";

/**
 * RBR-1013 — feeds the process-local API latency tracker used by the
 * load-aware recovery gate and the productivity monitor's degraded-window
 * suppression. Records wall-clock request duration (from receipt to
 * response finish), which is exactly the quantity RBR-977 measured as
 * degrading under load (`GET /api/agents/me` 53.2s, a single POST 101.4s).
 */
export function apiLatencySampler() {
  return function apiLatencySamplerMiddleware(req: Request, res: Response, next: NextFunction) {
    const startedAt = Date.now();
    res.on("finish", () => {
      apiLatencyTracker.record(Date.now() - startedAt);
    });
    next();
  };
}
