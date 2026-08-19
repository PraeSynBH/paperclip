import { PostHog } from "posthog-node";
import type { FeatureFlagEvaluations } from "posthog-node";
import { logger } from "../middleware/logger.js";
import { redactSensitiveText } from "../redaction.js";

let client: PostHog | null = null;
let _initialized = false;

/**
 * Initialize (or re-initialize) the PostHog client from environment variables.
 *
 * Reads `POSTHOG_API_KEY` and `POSTHOG_HOST` from the environment.
 * No-op when either is absent — the server boots cleanly without PostHog.
 *
 * Safe to call multiple times — returns the existing singleton client.
 * Exported mainly for testing and explicit server-start sequencing.
 */
export function initPostHog(): PostHog | null {
  if (_initialized) return client;
  _initialized = true;

  const apiKey = process.env.POSTHOG_API_KEY;
  const host = process.env.POSTHOG_HOST;

  if (!apiKey || !host) {
    client = null;
    return null;
  }

  try {
    client = new PostHog(apiKey, {
      host,
      flushAt: 20,
      flushInterval: 10_000,
    });
    logger.info({ host }, "[paperclip] PostHog instrumentation enabled");
  } catch (err) {
    logger.warn(
      { err },
      "[paperclip] Failed to initialize PostHog client; continuing without PostHog",
    );
    client = null;
  }

  return client;
}

/** @returns the singleton PostHog client, or null if not configured. */
function getClient(): PostHog | null {
  if (!_initialized) return initPostHog();
  return client;
}

/**
 * Returns true when the PostHog client is active (env vars were present and
 * initialisation succeeded).
 */
export function isPostHogEnabled(): boolean {
  return getClient() !== null;
}

/**
 * Capture a server-side error event via PostHog's `captureException`.
 *
 * Automatically attaches the error's name, message, and stack trace as
 * `$exception_*` properties in PostHog. Any additional properties in `extra`
 * are merged into the event properties.
 *
 * **Security:** Error messages and stack traces are scrubbed through
 * `redactSensitiveText()` before being sent to PostHog to prevent PII
 * (file paths, SQL constraint values, connection strings) from egressing
 * to a third-party telemetry service. Only the error name/code is passed
 * through unchanged.
 *
 * No-op when PostHog is not configured.
 */
export function captureErrorEvent(
  error: unknown,
  distinctId?: string,
  extra?: Record<string | number, unknown>,
): void {
  const c = getClient();
  if (!c) return;

  // Strip PII before egress to third-party telemetry.
  // Keep the error name/code (low-risk identifiers) but redact message/stack.
  const sanitized = sanitizeErrorForTelemetry(error);
  c.captureException(sanitized, distinctId ?? "paperclip-server", extra);
}

/**
 * Strip PII from an error before sending to a third-party telemetry service.
 *
 * - Error name / constructor name: passed through (low-risk identifiers).
 * - Error message: redacted via `redactSensitiveText()` to catch secrets,
 *   file paths, emails, and connection strings that may appear in messages
 *   (e.g. SQL constraint violation messages containing user email).
 * - Stack trace: stripped entirely. PostHog's `captureException` auto-extracts
 *   `$exception_stack_trace` from the error object; removing the stack
 *   prevents file-path disclosure.
 * - Non-standard Error objects: returned as-is (the caller is responsible).
 */
function sanitizeErrorForTelemetry(error: unknown): Error | unknown {
  if (!(error instanceof Error)) return error;

  const redactedMessage = redactSensitiveText(error.message);

  // Create a minimal error with the redacted message and no stack.
  // The name/constructor name survives because it is a low-risk categorical
  // identifier (e.g. "ValidationError", "NotFoundError").
  const sanitized = new Error(redactedMessage);
  sanitized.name = error.name;

  // Preserve the cause chain if present, also redacted.
  if (error.cause instanceof Error) {
    sanitized.cause = sanitizeErrorForTelemetry(error.cause);
  } else if (error.cause !== undefined) {
    sanitized.cause = error.cause;
  }

  return sanitized;
}

/**
 * Capture a custom metric / business event in PostHog.
 *
 * **IMPORTANT:** Always pass a meaningful `distinctId` (typically `companyId`)
 * for business events. The default `"paperclip-server"` collapses all companies
 * and actors into a single anonymous user, making per-company analytics
 * impossible. Pass the actor identity in `properties` as well.
 *
 * @param eventName  The PostHog event name (e.g. `"agent.run.completed"`).
 * @param distinctId  User or actor identifier. **Do not rely on the default.**
 *   Pass `companyId` for business events.
 * @param properties  Arbitrary properties to attach (metric name, value, tags, …).
 *
 * No-op when PostHog is not configured.
 */
export function captureMetric(
  eventName: string,
  distinctId?: string,
  properties?: Record<string | number, unknown>,
): void {
  const c = getClient();
  if (!c) return;
  c.capture({
    distinctId: distinctId ?? "paperclip-server",
    event: eventName,
    properties: properties ?? {},
  });
}

/**
 * Flush pending PostHog events to the server.
 * Returns immediately when PostHog is not configured.
 */
export async function flush(): Promise<void> {
  const c = getClient();
  if (!c) return;
  await c.flush();
}

/**
 * Shut down the PostHog client — flushes pending events and releases resources.
 * No-op when PostHog is not configured. Idempotent.
 */
export async function shutdownPostHog(): Promise<void> {
  const c = getClient();
  if (!c) return;
  await c.shutdown();
  client = null;
  _initialized = false;
}
