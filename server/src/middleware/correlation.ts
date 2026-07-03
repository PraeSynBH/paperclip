import type { RequestHandler } from "express";
import type { ClientCorrelationContext } from "../auth-context.js";

declare global {
  namespace Express {
    interface Request {
      correlation?: ClientCorrelationContext;
    }
  }
}

export function correlationMiddleware(): RequestHandler {
  return (req, _res, next) => {
    const runIdHeader = req.header("x-paperclip-run-id");
    req.correlation = {
      clientCorrelationRunId: runIdHeader?.trim() || undefined,
    };
    next();
  };
}