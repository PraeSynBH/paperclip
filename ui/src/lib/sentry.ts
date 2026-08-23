// Optional Sentry error tracking for the frontend.
//
// Activated only when `VITE_SENTRY_DSN` (or `SENTRY_DSN`) is set during
// build or dev. When unset, Sentry is not loaded and the module is a no-op.
//
// Usage:
//   import { initSentry } from "./lib/sentry";
//   const sentry = initSentry();
//   if (sentry) { sentry.captureException(err); }

import * as Sentry from "@sentry/react";

let initialised = false;

export interface SentryFrontendConfig {
  dsn: string;
  environment?: string;
  release?: string;
  /** Default: 0.2 (sample 20% of transactions for performance) */
  tracesSampleRate?: number;
  /** Default: 1.0 (report 100% of errors) */
  sampleRate?: number;
}

function resolveSentryDsn(): string | undefined {
  return (
    import.meta.env.VITE_SENTRY_DSN?.trim()
    || import.meta.env.SENTRY_DSN?.trim()
    || undefined
  );
}

function resolveSentryEnvironment(): string {
  return (
    import.meta.env.VITE_SENTRY_ENVIRONMENT?.trim()
    || import.meta.env.MODE
    || "production"
  );
}

function resolveSentryRelease(): string | undefined {
  return (
    import.meta.env.VITE_SENTRY_RELEASE?.trim()
    || import.meta.env.SENTRY_RELEASE?.trim()
    || undefined
  );
}

/**
 * Initialise Sentry for the frontend.
 *
 * Safe to call multiple times — subsequent calls are no-ops.
 * When `VITE_SENTRY_DSN` is not set, the module stays no-op.
 */
export function initSentry(overrides?: Partial<SentryFrontendConfig>): typeof Sentry | null {
  if (initialised) return Sentry;
  initialised = true;

  const dsn = overrides?.dsn || resolveSentryDsn();
  if (!dsn) {
    return null;
  }

  try {
    const environment = overrides?.environment || resolveSentryEnvironment();
    const release = overrides?.release || resolveSentryRelease();

    Sentry.init({
      dsn,
      environment,
      release,
      tracesSampleRate: overrides?.tracesSampleRate ?? 0.2,
      sampleRate: overrides?.sampleRate ?? 1.0,
      attachStacktrace: true,
      // Integrations: browser default set + react router instrumentation
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({
          // Only capture replays when there's an error (privacy-friendly)
          maskAllText: true,
          blockAllMedia: true,
        }),
      ],
      // Replays sampling
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
      // Denylist fields
      beforeSend(event) {
        // Remove potentially sensitive attributes from URLs
        if (event.request?.url) {
          try {
            const url = new URL(event.request.url);
            if (url.searchParams.size > 0) {
              event.request.url = url.origin + url.pathname + "?[REDACTED]";
            }
          } catch {
            // ignore unparseable URLs
          }
        }
        return event;
      },
    });

    // Log that Sentry is active (but not the DSN itself)
    console.info(`[sentry] Frontend initialised (environment=${environment}, release=${release ?? "unknown"})`);
  } catch (err) {
    console.warn("[sentry] Failed to initialise; error tracking unavailable", err);
  }

  return Sentry;
}