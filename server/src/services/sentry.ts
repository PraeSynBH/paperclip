// Optional Sentry error tracking for the server.
//
// Activated only when `SENTRY_DSN` (or `PAPERCLIP_SENTRY_DSN`) is set. When
// unset, no @sentry/node packages are loaded at all — the module is a no-op.
//
// The callers use `getSentryClient()` which returns null when Sentry is not
// initialised, so error-reporting call sites never need a null check on the
// import — they simply gate on the return value.
//
// Shutdown: `closeSentry()` flushes the event queue. The server shutdown
// path (index.ts) awaits it after OTel flush, so the last error events reach
// Sentry before process.exit.

import type * as SentryTypes from "@sentry/node";

let client: SentryTypes.NodeClient | null = null;
let sentryModule: typeof SentryTypes | null = null;
let initialised = false;

export interface SentryConfig {
  dsn: string;
  environment?: string;
  release?: string;
  /** Default: 0.2 (sample 20% of transactions for performance) */
  tracesSampleRate?: number;
  /** Enable profiling? (requires @sentry/profiling-node) */
  profilesSampleRate?: number;
  /** Server root directory for source maps */
  distDir?: string;
}

function resolveSentryDsn(): string | undefined {
  return process.env.SENTRY_DSN?.trim() || process.env.PAPERCLIP_SENTRY_DSN?.trim() || undefined;
}

function resolveSentryEnvironment(): string {
  return (
    process.env.SENTRY_ENVIRONMENT?.trim()
    || process.env.PAPERCLIP_SENTRY_ENVIRONMENT?.trim()
    || process.env.NODE_ENV?.trim()
    || "production"
  );
}

function resolveSentryRelease(): string | undefined {
  return process.env.SENTRY_RELEASE?.trim()
    || process.env.PAPERCLIP_SENTRY_RELEASE?.trim()
    || process.env.SOURCE_VERSION?.trim()
    || undefined;
}

/**
 * Initialise Sentry for the server process.
 *
 * Safe to call multiple times — subsequent calls are no-ops.
 * When `SENTRY_DSN` is not set, the module stays no-op.
 */
export async function initSentry(
  overrides?: Partial<SentryConfig>,
): Promise<SentryTypes.NodeClient | null> {
  if (initialised) return client;
  initialised = true;

  const dsn = overrides?.dsn || resolveSentryDsn();
  if (!dsn) {
    return null;
  }

  try {
    // Dynamic import so the module graph stays Sentry-free when unconfigured,
    // matching the OTel pattern in instrumentation.ts.
    sentryModule = await import("@sentry/node");

    const release = overrides?.release || resolveSentryRelease();
    const environment = overrides?.environment || resolveSentryEnvironment();

    client = sentryModule.init({
      dsn,
      environment,
      release,
      tracesSampleRate: overrides?.tracesSampleRate ?? 0.2,
      profilesSampleRate: overrides?.profilesSampleRate,
      // Attach stack traces to all logged errors automatically
      attachStacktrace: true,
      // Enable the Express integration for request error tracking
      integrations: [
        sentryModule.httpIntegration(),
        sentryModule.expressIntegration(),
        sentryModule.postgresIntegration(),
      ],
      // Default: only capture 10% of errors in dev to reduce noise
      sampleRate: environment === "development" ? 0.1 : 1.0,
      // Denylist fields that may contain sensitive data
      beforeSend(event) {
        // Remove request/response bodies from error events to avoid leaking
        // PII through Sentry
        if (event.request?.data) {
          event.request.data = "[REDACTED]";
        }
        return event;
      },
    }) as SentryTypes.NodeClient | null;

    if (client) {
      // Log that Sentry is active (but not the DSN itself)
      console.info(`[sentry] Initialised (environment=${environment}, release=${release ?? "unknown"})`);
    }
  } catch (err) {
    console.warn("[sentry] Failed to load @sentry/node; error tracking unavailable", err);
    client = null;
  }

  return client;
}

/**
 * Return the current Sentry client, or null if Sentry was not initialised
 * (either because the DSN is unset or init failed).
 */
export function getSentryClient(): SentryTypes.NodeClient | null {
  return client;
}

/**
 * Return the raw @sentry/node module for accessing helpers like
 * `captureException`, `setTag`, `addBreadcrumb`, etc.
 *
 * Returns null if Sentry was not initialised.
 */
export function getSentry(): typeof SentryTypes | null {
  return sentryModule;
}

/**
 * Flush pending events and close Sentry.
 *
 * Idempotent — safe to call even if Sentry was never initialised.
 * The server shutdown path calls this after OTel flush.
 */
export async function closeSentry(): Promise<void> {
  if (!client || !sentryModule) return;
  try {
    await sentryModule.close(2_000);
  } catch (err) {
    console.warn("[sentry] Error during close/flush", err);
  }
  client = null;
  sentryModule = null;
}
