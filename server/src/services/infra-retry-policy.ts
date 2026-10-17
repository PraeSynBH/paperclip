/**
 * Bounded automatic retry policy for infrastructure-caused heartbeat failures.
 *
 * Context: PRX-5350 (follow-up to PRX-5342). Automatic re-invocation of an
 * infrastructure-failed heartbeat used to fire immediately, unbounded, with no
 * backoff and no health gate. On 2026-10-17 that made the incident
 * self-reinforcing: three full run attempts in 101s, each dying in ~30s, each
 * adding load to an already-saturated local Hermes gateway, each billed against
 * agent budgets, none producing work product.
 *
 * This module is deliberately dependency-free and side-effect-free so the policy
 * can be unit-tested without a database, an adapter registry, or a live gateway.
 * Callers (the heartbeat service) own persistence and enqueueing.
 *
 * The policy, in evaluation order:
 *
 *   1. Only infrastructure-caused failures are eligible. Everything else keeps
 *      whatever behaviour it had before this module existed.
 *   2. Bounded: at most {@link INFRA_RETRY_MAX_ATTEMPTS} automatic attempts per
 *      failed run.
 *   3. Per-agent circuit breaker: an agent with
 *      {@link INFRA_CONSECUTIVE_FAILURE_LIMIT} consecutive infrastructure
 *      failures is not auto-retried until a gateway probe passes again.
 *   4. Gateway-health gate: a retry is not *spent* while the gateway probe
 *      fails. The attempt is deferred instead and the reason is recorded.
 *   5. Spaced backoff with jitter: {@link INFRA_RETRY_DELAYS_MS}, jittered by
 *      ±{@link INFRA_RETRY_JITTER_RATIO}, so a burst of attempts inside the
 *      failure window is impossible.
 *
 * The supervisor interval (3600s) remains the backstop: a deferred attempt is
 * never lost, it is only moved to a later, healthier moment.
 */

/** Terminal run statuses that mean "this run did not produce work". */
export const UNSUCCESSFUL_RUN_STATUSES = ["failed", "cancelled", "timed_out"] as const;

/**
 * Error codes that mean "the infrastructure failed", as opposed to "the agent
 * failed to do the work". Kept in sync with the continuation-recovery classifier
 * in `./recovery/service.ts` (`TRANSIENT_INFRA_CONTINUATION_ERROR_CODES`).
 */
export const INFRA_FAILURE_ERROR_CODES = [
  "adapter_failed",
  "codex_transient_upstream",
  "claude_transient_upstream",
  "timeout",
] as const;

/** At most this many automatic retries per failed run. */
export const INFRA_RETRY_MAX_ATTEMPTS = 2;

/** Spaced backoff ladder (ms). Index = attempt - 1. */
export const INFRA_RETRY_DELAYS_MS = [30_000, 120_000] as const;

/** Symmetric jitter applied to each backoff step. */
export const INFRA_RETRY_JITTER_RATIO = 0.25;

/** Consecutive infrastructure failures after which an agent's auto-retry stops. */
export const INFRA_CONSECUTIVE_FAILURE_LIMIT = 3;

/** Deferral reasons recorded on the run for observability. */
export const INFRA_RETRY_DEFERRAL_REASONS = {
  /** The gateway health probe failed; the attempt was not consumed. */
  GATEWAY_UNHEALTHY: "deferred_gateway_unhealthy",
  /** The per-agent circuit breaker is open. */
  CIRCUIT_OPEN: "circuit_open_agent_unhealthy",
} as const;

export type InfraRetryDeferralReason =
  (typeof INFRA_RETRY_DEFERRAL_REASONS)[keyof typeof INFRA_RETRY_DEFERRAL_REASONS];

export function isInfraCausedFailure(errorCode: string | null | undefined): boolean {
  if (!errorCode) return false;
  return (INFRA_FAILURE_ERROR_CODES as readonly string[]).includes(errorCode);
}

export type InfraRetrySchedule = {
  attempt: number;
  baseDelayMs: number;
  delayMs: number;
  dueAt: Date;
  maxAttempts: number;
};

/**
 * Backoff-with-jitter schedule for a single attempt.
 * Returns null once the bounded budget is exhausted.
 */
export function computeInfraRetrySchedule(
  attempt: number,
  now: Date = new Date(),
  random: () => number = Math.random,
  maxAttempts: number = INFRA_RETRY_MAX_ATTEMPTS,
): InfraRetrySchedule | null {
  if (!Number.isInteger(attempt) || attempt <= 0) return null;
  if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) return null;
  if (attempt > maxAttempts) return null;

  // Attempts beyond the ladder hold at the longest delay rather than falling off
  // the end: the ladder is the *shape* of the backoff, while `maxAttempts` is
  // what bounds it.
  const baseDelayMs = INFRA_RETRY_DELAYS_MS[Math.min(attempt, INFRA_RETRY_DELAYS_MS.length) - 1];
  if (typeof baseDelayMs !== "number") return null;

  const sample = Math.min(1, Math.max(0, random()));
  const jitterMultiplier = 1 + (sample * 2 - 1) * INFRA_RETRY_JITTER_RATIO;
  // Floor of 1s keeps a jittered step from collapsing to "immediately".
  const delayMs = Math.max(1_000, Math.round(baseDelayMs * jitterMultiplier));

  return {
    attempt,
    baseDelayMs,
    delayMs,
    dueAt: new Date(now.getTime() + delayMs),
    maxAttempts,
  };
}

/** Minimal shape needed to reason about an agent's recent run history. */
export type InfraRetryRunSample = {
  status: string | null | undefined;
  errorCode: string | null | undefined;
};

/**
 * Count consecutive infrastructure failures walking from the most recent run
 * backwards. The streak stops at the first run that is either successful or
 * failed for a non-infrastructure reason, because that means the agent is
 * demonstrably reachable again.
 *
 * @param runs newest-first
 */
export function countConsecutiveInfraFailures(runs: readonly InfraRetryRunSample[]): number {
  let streak = 0;
  for (const run of runs) {
    const unsuccessful =
      run.status != null && (UNSUCCESSFUL_RUN_STATUSES as readonly string[]).includes(run.status);
    if (!unsuccessful) break;
    if (!isInfraCausedFailure(run.errorCode)) break;
    streak += 1;
  }
  return streak;
}

export type GatewayProbeResult =
  | { healthy: true }
  | { healthy: false; reason: string };

/** Default timeout for the gateway health probe. */
export const GATEWAY_PROBE_TIMEOUT_MS = 2_000;

/**
 * Cheap gateway health probe: `GET <apiBaseUrl>/health`, the same liveness
 * signal the adapters' own environment test uses.
 *
 * Adapters without a gateway (`apiBaseUrl`/`baseUrl` absent from adapter config)
 * are never gated — this returns healthy — so the gate cannot suppress retries
 * for local adapters that have no such transport.
 */
export async function probeGatewayHealth(
  adapterConfig: unknown,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<GatewayProbeResult> {
  const config =
    adapterConfig && typeof adapterConfig === "object"
      ? (adapterConfig as Record<string, unknown>)
      : {};
  const readString = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

  const baseUrl = readString(config.apiBaseUrl) ?? readString(config.baseUrl);
  if (!baseUrl) return { healthy: true };

  const apiKey = readString(config.apiKey) ?? readString(config.apiServerKey);

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { healthy: false, reason: `adapter apiBaseUrl is not a valid URL: ${baseUrl}` };
  }

  const healthUrl = new URL("/health", parsed).toString();
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const response = await doFetch(healthUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? GATEWAY_PROBE_TIMEOUT_MS),
    });
    return response.ok
      ? { healthy: true }
      : { healthy: false, reason: `gateway /health returned HTTP ${response.status}` };
  } catch (err) {
    return { healthy: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export type InfraRetryGateDecision =
  | {
      allowed: true;
      /** The attempt this retry spends. */
      attempt: number;
      schedule: InfraRetrySchedule;
      consecutiveInfraFailures: number;
    }
  | {
      allowed: false;
      outcome: "not_infra_caused" | "exhausted" | "suppressed" | "deferred";
      reason: string;
      /** Present for `suppressed` and `deferred`. */
      deferralReason: InfraRetryDeferralReason | null;
      /** The attempt that would have been spent, for observability. */
      attempt: number;
      consecutiveInfraFailures: number;
    };

export type EvaluateInfraRetryGateInput = {
  errorCode: string | null | undefined;
  /** Newest-first run history for the agent, including the failed run itself. */
  recentRuns: readonly InfraRetryRunSample[];
  /** Attempts already spent by the failed run (`scheduledRetryAttempt`). */
  scheduledRetryAttempt?: number | null;
  gatewayProbe: GatewayProbeResult;
  now?: Date;
  random?: () => number;
  maxAttempts?: number;
  consecutiveLimit?: number;
};

/**
 * Decide whether an infrastructure-caused failure may spend an automatic retry,
 * and if so when it should fire.
 *
 * Evaluation order is load-bearing: the circuit breaker and the gateway gate are
 * checked *before* the schedule is built, so a deferred attempt is never counted
 * against the run's bounded budget.
 */
export function evaluateInfraRetryGate(input: EvaluateInfraRetryGateInput): InfraRetryGateDecision {
  const maxAttempts = input.maxAttempts ?? INFRA_RETRY_MAX_ATTEMPTS;
  const consecutiveLimit = input.consecutiveLimit ?? INFRA_CONSECUTIVE_FAILURE_LIMIT;
  const attempt = Math.max(0, Math.floor(input.scheduledRetryAttempt ?? 0)) + 1;
  const consecutiveInfraFailures = countConsecutiveInfraFailures(input.recentRuns);

  if (!isInfraCausedFailure(input.errorCode)) {
    return {
      allowed: false,
      outcome: "not_infra_caused",
      reason: "Automatic retry policy does not apply to non-infrastructure failures",
      deferralReason: null,
      attempt,
      consecutiveInfraFailures,
    };
  }

  if (attempt > maxAttempts) {
    return {
      allowed: false,
      outcome: "exhausted",
      reason: `Bounded retry exhausted after ${input.scheduledRetryAttempt ?? 0} automatic attempts`,
      deferralReason: null,
      attempt,
      consecutiveInfraFailures,
    };
  }

  if (consecutiveInfraFailures >= consecutiveLimit) {
    return {
      allowed: false,
      outcome: "suppressed",
      reason:
        `Automatic retry suppressed: ${consecutiveInfraFailures} consecutive infrastructure failures ` +
        `for this agent (limit ${consecutiveLimit}); retries resume once a gateway probe passes`,
      deferralReason: INFRA_RETRY_DEFERRAL_REASONS.CIRCUIT_OPEN,
      attempt,
      consecutiveInfraFailures,
    };
  }

  if (!input.gatewayProbe.healthy) {
    return {
      allowed: false,
      outcome: "deferred",
      reason:
        `Automatic retry deferred: gateway health probe failed (${input.gatewayProbe.reason}); ` +
        "the attempt was not consumed and will be retried at the next healthy interval",
      deferralReason: INFRA_RETRY_DEFERRAL_REASONS.GATEWAY_UNHEALTHY,
      attempt,
      consecutiveInfraFailures,
    };
  }

  const schedule = computeInfraRetrySchedule(
    attempt,
    input.now ?? new Date(),
    input.random ?? Math.random,
    maxAttempts,
  );
  if (!schedule) {
    return {
      allowed: false,
      outcome: "exhausted",
      reason: `Bounded retry exhausted after ${input.scheduledRetryAttempt ?? 0} automatic attempts`,
      deferralReason: null,
      attempt,
      consecutiveInfraFailures,
    };
  }

  return { allowed: true, attempt, schedule, consecutiveInfraFailures };
}
