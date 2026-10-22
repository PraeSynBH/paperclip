import { describe, expect, it } from "vitest";

import {
  computeInfraRetrySchedule,
  countConsecutiveInfraFailures,
  evaluateInfraRetryGate,
  INFRA_CONSECUTIVE_FAILURE_LIMIT,
  INFRA_FAILURE_ERROR_CODES,
  INFRA_RETRY_DEFERRAL_REASONS,
  INFRA_RETRY_DELAYS_MS,
  INFRA_RETRY_JITTER_RATIO,
  INFRA_RETRY_MAX_ATTEMPTS,
  isInfraCausedFailure,
  type InfraRetryGateDecision,
} from "./infra-retry-policy.js";

const HEALTHY_PROBE = { healthy: true } as const;
const UNHEALTHY_PROBE = { healthy: false, reason: "connect ECONNREFUSED 127.0.0.1:1" } as const;
const NOW = new Date("2026-10-17T05:00:00.000Z");
const NO_JITTER = () => 0.5; // jitterMultiplier === 1

function expectDisallowed(decision: InfraRetryGateDecision) {
  if (decision.allowed) throw new Error("expected the retry gate to disallow the attempt");
  return decision;
}

function infraFailureRun() {
  return { status: "failed", errorCode: "adapter_failed" };
}

describe("infra-retry-policy — classification", () => {
  it("treats the transient infrastructure codes as infrastructure-caused", () => {
    for (const code of INFRA_FAILURE_ERROR_CODES) {
      expect(isInfraCausedFailure(code)).toBe(true);
    }
  });

  it("does not treat product/agent failures as infrastructure-caused", () => {
    for (const code of ["workspace_validation_failed", "configuration_incomplete", "agent_not_invokable", null, undefined]) {
      expect(isInfraCausedFailure(code)).toBe(false);
    }
  });
});

describe("AC1 — automatic retries are bounded and spaced", () => {
  it("spaces attempt 1 by 30s and attempt 2 by 120s (unjittered)", () => {
    const first = computeInfraRetrySchedule(1, NOW, NO_JITTER);
    const second = computeInfraRetrySchedule(2, NOW, NO_JITTER);

    expect(first?.baseDelayMs).toBe(INFRA_RETRY_DELAYS_MS[0]);
    expect(first?.delayMs).toBe(30_000);
    expect(first?.dueAt.toISOString()).toBe("2026-10-17T05:00:30.000Z");

    expect(second?.baseDelayMs).toBe(INFRA_RETRY_DELAYS_MS[1]);
    expect(second?.delayMs).toBe(120_000);
    expect(second?.dueAt.toISOString()).toBe("2026-10-17T05:02:00.000Z");
  });

  it("applies bounded jitter and never collapses a step to 'immediately'", () => {
    const earliest = computeInfraRetrySchedule(1, NOW, () => 0);
    const latest = computeInfraRetrySchedule(1, NOW, () => 1);

    expect(earliest?.delayMs).toBe(Math.round(30_000 * (1 - INFRA_RETRY_JITTER_RATIO)));
    expect(latest?.delayMs).toBe(Math.round(30_000 * (1 + INFRA_RETRY_JITTER_RATIO)));
    expect(earliest!.delayMs).toBeGreaterThanOrEqual(1_000);
  });

  it(`allows at most ${INFRA_RETRY_MAX_ATTEMPTS} automatic attempts per failed run`, () => {
    expect(computeInfraRetrySchedule(INFRA_RETRY_MAX_ATTEMPTS, NOW, NO_JITTER)).not.toBeNull();
    expect(computeInfraRetrySchedule(INFRA_RETRY_MAX_ATTEMPTS + 1, NOW, NO_JITTER)).toBeNull();
    expect(computeInfraRetrySchedule(0, NOW, NO_JITTER)).toBeNull();
    expect(computeInfraRetrySchedule(-1, NOW, NO_JITTER)).toBeNull();
  });

  it("holds attempts beyond the ladder at the longest delay when the caller raises the cap", () => {
    const beyondLadder = computeInfraRetrySchedule(
      INFRA_RETRY_DELAYS_MS.length + 1,
      NOW,
      NO_JITTER,
      INFRA_RETRY_DELAYS_MS.length + 1,
    );
    expect(beyondLadder?.baseDelayMs).toBe(INFRA_RETRY_DELAYS_MS[INFRA_RETRY_DELAYS_MS.length - 1]);
    expect(beyondLadder?.maxAttempts).toBe(INFRA_RETRY_DELAYS_MS.length + 1);
  });

  it("makes a burst of 3 attempts inside 2 minutes impossible", () => {
    // The incident produced 3 full attempts in 101s. With the bound in place the
    // third attempt cannot exist at all, and the second cannot land before the
    // first jittered delay has elapsed.
    const thirdAttempt = computeInfraRetrySchedule(3, NOW, NO_JITTER);
    expect(thirdAttempt).toBeNull();

    const minFirstDelay = Math.round(INFRA_RETRY_DELAYS_MS[0] * (1 - INFRA_RETRY_JITTER_RATIO));
    expect(minFirstDelay).toBeGreaterThan(20_000);

    const gateAfterTwoAttempts = evaluateInfraRetryGate({
      errorCode: "adapter_failed",
      recentRuns: [infraFailureRun()],
      scheduledRetryAttempt: INFRA_RETRY_MAX_ATTEMPTS,
      gatewayProbe: HEALTHY_PROBE,
      now: NOW,
      random: NO_JITTER,
    });
    expect(gateAfterTwoAttempts.allowed).toBe(false);
    expect(expectDisallowed(gateAfterTwoAttempts).outcome).toBe("exhausted");
  });
});

describe("AC2 — a retry is not spent while the gateway probe fails", () => {
  it("defers instead of consuming the attempt and records the reason", () => {
    const decision = evaluateInfraRetryGate({
      errorCode: "adapter_failed",
      recentRuns: [infraFailureRun()],
      scheduledRetryAttempt: 0,
      gatewayProbe: UNHEALTHY_PROBE,
      now: NOW,
      random: NO_JITTER,
    });

    expect(decision.allowed).toBe(false);
    const deferred = expectDisallowed(decision);
    expect(deferred.outcome).toBe("deferred");
    expect(deferred.deferralReason).toBe(INFRA_RETRY_DEFERRAL_REASONS.GATEWAY_UNHEALTHY);
    expect(deferred.reason).toContain(UNHEALTHY_PROBE.reason);
    // The same attempt number comes back once the probe recovers.
    expect(deferred.attempt).toBe(1);

    const retryOnceHealthy = evaluateInfraRetryGate({
      errorCode: "adapter_failed",
      recentRuns: [infraFailureRun()],
      scheduledRetryAttempt: 0,
      gatewayProbe: HEALTHY_PROBE,
      now: NOW,
      random: NO_JITTER,
    });
    expect(retryOnceHealthy.allowed).toBe(true);
    expect(retryOnceHealthy.attempt).toBe(1);
  });

  it("does not defer non-infrastructure failures through this path", () => {
    const decision = evaluateInfraRetryGate({
      errorCode: "workspace_validation_failed",
      recentRuns: [{ status: "failed", errorCode: "workspace_validation_failed" }],
      gatewayProbe: UNHEALTHY_PROBE,
      now: NOW,
      random: NO_JITTER,
    });
    expect(decision.allowed).toBe(false);
    const notInfra = expectDisallowed(decision);
    expect(notInfra.outcome).toBe("not_infra_caused");
    expect(notInfra.deferralReason).toBeNull();
  });
});

describe("AC3 — per-agent circuit breaker after repeated infrastructure failures", () => {
  it(`suppresses auto-retry at ${INFRA_CONSECUTIVE_FAILURE_LIMIT} consecutive infra failures`, () => {
    const decision = evaluateInfraRetryGate({
      errorCode: "adapter_failed",
      recentRuns: [infraFailureRun(), infraFailureRun(), infraFailureRun()],
      scheduledRetryAttempt: 0,
      gatewayProbe: HEALTHY_PROBE,
      now: NOW,
      random: NO_JITTER,
    });

    expect(decision.allowed).toBe(false);
    const suppressed = expectDisallowed(decision);
    expect(suppressed.outcome).toBe("suppressed");
    expect(suppressed.deferralReason).toBe(INFRA_RETRY_DEFERRAL_REASONS.CIRCUIT_OPEN);
    expect(suppressed.consecutiveInfraFailures).toBe(INFRA_CONSECUTIVE_FAILURE_LIMIT);
  });

  it("resumes automatically once the streak is broken by a non-infrastructure outcome", () => {
    const decision = evaluateInfraRetryGate({
      errorCode: "adapter_failed",
      recentRuns: [
        { status: "succeeded", errorCode: null },
        infraFailureRun(),
        infraFailureRun(),
        infraFailureRun(),
      ],
      scheduledRetryAttempt: 0,
      gatewayProbe: HEALTHY_PROBE,
      now: NOW,
      random: NO_JITTER,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.consecutiveInfraFailures).toBe(0);
  });

  it("counts a streak only across unsuccessful infra runs, newest first", () => {
    expect(
      countConsecutiveInfraFailures([
        { status: "failed", errorCode: "adapter_failed" },
        { status: "timed_out", errorCode: "timeout" },
        { status: "failed", errorCode: "workspace_validation_failed" },
      ]),
    ).toBe(2);

    expect(
      countConsecutiveInfraFailures([
        { status: "failed", errorCode: "adapter_failed" },
        { status: "succeeded", errorCode: null },
        { status: "failed", errorCode: "adapter_failed" },
        { status: "failed", errorCode: "adapter_failed" },
      ]),
    ).toBe(1);

    expect(countConsecutiveInfraFailures([{ status: "running", errorCode: null }])).toBe(0);
    expect(countConsecutiveInfraFailures([])).toBe(0);
  });
});

describe("AC4 — retry attempt, backoff delay and deferral reason are observable", () => {
  it("returns the attempt, the backoff delay and the due time for a spent retry", () => {
    const decision = evaluateInfraRetryGate({
      errorCode: "adapter_failed",
      recentRuns: [infraFailureRun()],
      scheduledRetryAttempt: 1,
      gatewayProbe: HEALTHY_PROBE,
      now: NOW,
      random: NO_JITTER,
    });

    expect(decision.allowed).toBe(true);
    if (!decision.allowed) throw new Error("expected an allowed decision");
    expect(decision.attempt).toBe(2);
    expect(decision.schedule.delayMs).toBe(120_000);
    expect(decision.schedule.dueAt.toISOString()).toBe("2026-10-17T05:02:00.000Z");
    expect(decision.schedule.maxAttempts).toBe(INFRA_RETRY_MAX_ATTEMPTS);
  });

  it("returns a deferral reason for every non-spent attempt", () => {
    const deferred = evaluateInfraRetryGate({
      errorCode: "adapter_failed",
      recentRuns: [infraFailureRun()],
      gatewayProbe: UNHEALTHY_PROBE,
      now: NOW,
      random: NO_JITTER,
    });
    expect(expectDisallowed(deferred).deferralReason).toBe("deferred_gateway_unhealthy");

    const suppressed = evaluateInfraRetryGate({
      errorCode: "adapter_failed",
      recentRuns: [infraFailureRun(), infraFailureRun(), infraFailureRun()],
      gatewayProbe: HEALTHY_PROBE,
      now: NOW,
      random: NO_JITTER,
    });
    expect(expectDisallowed(suppressed).deferralReason).toBe("circuit_open_agent_unhealthy");
  });
});
