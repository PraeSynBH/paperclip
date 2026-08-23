// Sentry Express middleware helpers.
//
// In @sentry/node v8, the request handler and tracing handler are handled
// automatically by the expressIntegration() when passed during init(). No
// additional middleware wrappers are needed for request-scope data or
// performance tracing.
//
// The error handler is available as `expressErrorHandler` (or via
// `setupExpressErrorHandler(app)`). This module provides a no-op wrapper
// that delegates to the Sentry error handler when Sentry is initialised,
// and is a transparent pass-through when it is not.
//
// Usage in app.ts:
//   import { sentryRequestHandler, sentryTracingHandler, sentryErrorHandler }
//     from "./middleware/sentry.js";
//   app.use(sentryRequestHandler);    // early, before API routes
//   app.use(sentryTracingHandler);    // after request handler, for performance
//   app.use(sentryErrorHandler);      // last, before existing errorHandler
//
// Note: sentryRequestHandler and sentryTracingHandler are no-ops in v8
// (the expressIntegration handles this automatically) but are kept as
// named middleware positions so the middleware ordering contract in app.ts
// is self-documenting and migration-safe.

import type { Request, Response, NextFunction } from "express";
import { getSentry } from "../services/sentry.js";

/**
 * No-op in @sentry/node v8 — the expressIntegration() handles request-scope
 * data automatically. Kept as a documentation point in the middleware chain
 * so the ordering contract is visible in app.ts.
 */
export function sentryRequestHandler(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next();
}

/**
 * No-op in @sentry/node v8 — the expressIntegration() handles performance
 * tracing automatically. Kept as a documentation point in the middleware
 * chain so the ordering contract is visible in app.ts.
 */
export function sentryTracingHandler(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next();
}

/**
 * Sentry error handler — captures unhandled errors and forwards them
 * to Sentry. Must be registered before the application's own errorHandler.
 *
 * In @sentry/node v8, the error handler is available as
 * `expressErrorHandler` from "@sentry/node". This wrapper:
 * 1. Delegates to Sentry's expressErrorHandler when Sentry is initialised
 * 2. Falls through to the next error handler when Sentry is not initialised
 *
 * No-op when Sentry was not initialised.
 */
export function sentryErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const sentry = getSentry();
  if (!sentry?.expressErrorHandler) {
    next(err);
    return;
  }
  // Cast to Error — Sentry's expressErrorHandler expects MiddlewareError
  // (which extends Error). Express itself accepts unknown, so the
  // fallthrough next(err) is untyped.
  sentry.expressErrorHandler()(err as Error, req, res, next as NextFunction);
}
