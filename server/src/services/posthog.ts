import { PostHog } from "posthog-node";
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
 * - Stack trace: redacted in place. PostHog's `captureException` auto-extracts
 *   `$exception_stack_trace` from the error object; preserving the trace
 *   (with redacted file paths and tokens) enables triage by throw site.
 * - Non-standard Error objects: returned as-is (the caller is responsible).
 */
function sanitizeErrorForTelemetry(error: unknown): Error | unknown {
  if (!(error instanceof Error)) return error;

  error.message = redactSensitiveText(error.message);

  if (typeof error.stack === "string") {
    error.stack = redactSensitiveText(error.stack);
  }

  // Recursively redact the cause chain (mutating in place preserves identity).
  if (error.cause instanceof Error) {
    sanitizeErrorForTelemetry(error.cause);
  }

  return error;
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

// ── Signup → First-Value Funnel Events ──────────────────────────────────────

/**
 * POSTHOG_EVENT_SIGNUP_COMPLETED — Fired when a self-serve user finishes
 * registration (company created + trial started).
 *
 * Properties:
 * - `source`: source of registration (e.g. "self_serve_registration")
 * - `trial_days`: number of trial days granted
 * - `company_id`: the created company ID
 */
export const POSTHOG_EVENT_SIGNUP_COMPLETED = "signup.completed";

/**
 * POSTHOG_EVENT_TRIAL_STARTED — Fired when a trial subscription is created.
 *
 * Properties:
 * - `trial_days`: number of trial days granted
 * - `tier_name`: the subscription tier name
 * - `company_id`: the company ID
 */
export const POSTHOG_EVENT_TRIAL_STARTED = "trial.started";

/**
 * POSTHOG_EVENT_ONBOARDING_SEED_APPLIED — Fired when the onboarding seed
 * (mission, agent, first task) is applied to a company.
 *
 * Properties:
 * - `company_id`: the company ID
 * - `revision`: the seed revision identifier
 * - `has_mission`: whether a mission was provided
 * - `has_agent`: whether a lead agent was created
 * - `has_first_task`: whether a first task was created
 */
export const POSTHOG_EVENT_ONBOARDING_SEED_APPLIED = "onboarding.seed_applied";

/**
 * Fire a signup.completed event.
 */
export function trackSignupCompleted(
  companyId: string,
  userId: string,
  trialDays: number,
): void {
  captureMetric(POSTHOG_EVENT_SIGNUP_COMPLETED, companyId, {
    source: "self_serve_registration",
    trial_days: trialDays,
    company_id: companyId,
    user_id: userId,
  });
}

/**
 * Fire a trial.started event.
 */
export function trackTrialStarted(
  companyId: string,
  trialDays: number,
  tierName: string,
): void {
  captureMetric(POSTHOG_EVENT_TRIAL_STARTED, companyId, {
    trial_days: trialDays,
    tier_name: tierName,
    company_id: companyId,
  });
}

/**
 * Fire an onboarding.seed_applied event.
 */
export function trackOnboardingSeedApplied(
  companyId: string,
  revision: string,
  hadMission: boolean,
  hadAgent: boolean,
  hadFirstTask: boolean,
): void {
  captureMetric(POSTHOG_EVENT_ONBOARDING_SEED_APPLIED, companyId, {
    company_id: companyId,
    revision,
    has_mission: hadMission,
    has_agent: hadAgent,
    has_first_task: hadFirstTask,
  });
}

/**
 * POSTHOG_EVENT_APPROVAL_CREATED — Fired when an approval is created (a "first
 * value" signal in the signup→first-value funnel).
 *
 * Properties:
 * - `company_id`: the company ID
 * - `approval_type`: the type of approval created
 * - `approval_id`: the approval ID
 */
export const POSTHOG_EVENT_APPROVAL_CREATED = "value_event.approval_created";

/**
 * POSTHOG_EVENT_DOCUMENT_CREATED — Fired when a document is created (a "first
 * value" signal in the signup→first-value funnel).
 *
 * Properties:
 * - `company_id`: the company ID
 * - `document_key`: the document key
 * - `document_id`: the document ID
 */
export const POSTHOG_EVENT_DOCUMENT_CREATED = "value_event.document_created";

/**
 * Fire a value_event.approval_created event.
 */
export function trackApprovalCreated(
  companyId: string,
  approvalId: string,
  approvalType: string,
): void {
  captureMetric(POSTHOG_EVENT_APPROVAL_CREATED, companyId, {
    company_id: companyId,
    approval_id: approvalId,
    approval_type: approvalType,
  });
}

/**
 * Fire a value_event.document_created event.
 */
export function trackDocumentCreated(
  companyId: string,
  documentId: string,
  documentKey: string,
): void {
  captureMetric(POSTHOG_EVENT_DOCUMENT_CREATED, companyId, {
    company_id: companyId,
    document_id: documentId,
    document_key: documentKey,
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