/**
 * Sentry initialization for the Paperclip server.
 *
 * Activated when SENTRY_DSN (or PAPERCLIP_SENTRY_DSN) is set.
 * Follows the same pattern as instrumentation.ts — optional/opt-in,
 * fails open, does not crash the server on misconfiguration.
 *
 * Timing: initSentry() is called early in startServer() before any
 * routes or middleware are mounted. Then setupExpressSentry() is
 * called from createApp() to register the Express request/error handlers.
 */

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Express } from "express";

const SENTRY_DSN = process.env.SENTRY_DSN?.trim() || process.env.PAPERCLIP_SENTRY_DSN?.trim() || "";

let sentryInitialized = false;
let sentryInitFailed = false;

/**
 * Read the commit SHA from the build stamp.
 */
function readBuildStamp(): string | null {
  try {
    const stampUrl = new URL("./build-info.json", import.meta.url);
    const raw = readFileSync(stampUrl, "utf8");
    const parsed = JSON.parse(raw) as { commit?: unknown };
    if (typeof parsed.commit === "string" && parsed.commit.length > 0) {
      return parsed.commit;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read the current commit SHA with `git rev-parse --short HEAD`.
 */
function readGitCommit(): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: new URL("./", import.meta.url),
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the release string for Sentry.
 */
function resolveRelease(): string {
  return (
    readBuildStamp()
    || readGitCommit()
    || process.env.OTEL_SERVICE_VERSION?.trim()
    || "unknown"
  );
}

/**
 * Initialize Sentry for the server process.
 * Safe to call multiple times — subsequent calls are no-ops.
 * Does not throw on failure; logs a warning instead.
 */
export function initSentry(): void {
  if (sentryInitialized || sentryInitFailed) return;
  if (!SENTRY_DSN) return; // opt-in, silent skip

  try {
    const require = createRequire(import.meta.url);
    const Sentry = require("@sentry/node") as typeof import("@sentry/node");

    Sentry.init({
      dsn: SENTRY_DSN,
      release: resolveRelease(),
      environment: process.env.NODE_ENV || process.env.PAPERCLIP_DEPLOYMENT_MODE || "development",
      // Sample rate: 1.0 in production, lower in dev
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.25 : 0.0,
      // Profile rate (optional, Sentry profiling)
      profilesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0.0,
    });

    Sentry.setTag("paperclip.version", process.env.PAPERCLIP_VERSION || "unknown");

    sentryInitialized = true;
    // eslint-disable-next-line no-console
    console.log("[paperclip] Sentry initialized (server)");
  } catch (err) {
    sentryInitFailed = true;
    // eslint-disable-next-line no-console
    console.warn("[paperclip] Failed to initialize Sentry; continuing without it", err);
  }
}

/**
 * Register Sentry Express request handler and error handler on the app.
 * Must be called AFTER initSentry() and AFTER body parsers but BEFORE routes.
 * No-op when Sentry was not initialized.
 */
export function setupExpressSentry(app: Express): void {
  if (!sentryInitialized) return;
  try {
    const require = createRequire(import.meta.url);
    const Sentry = require("@sentry/node") as typeof import("@sentry/node");
    Sentry.setupExpressErrorHandler(app);
    // eslint-disable-next-line no-console
    console.log("[paperclip] Sentry Express handlers registered");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[paperclip] Failed to register Sentry Express handlers", err);
  }
}

/**
 * Returns true if Sentry has been successfully initialized on the server side.
 */
export function isSentryEnabled(): boolean {
  return sentryInitialized && !!SENTRY_DSN;
}

/**
 * Close the Sentry client, flushing pending events.
 * Call during shutdown.
 */
export async function closeSentry(): Promise<void> {
  if (!sentryInitialized) return;
  try {
    const require = createRequire(import.meta.url);
    const Sentry = require("@sentry/node") as typeof import("@sentry/node");
    await Sentry.close(2_000);
  } catch {
    // Best-effort
  }
}
