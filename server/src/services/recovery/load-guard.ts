/**
 * RBR-1038 item 3 — load-aware recovery deferral.
 *
 * The recovery sweep (`reconcileStrandedAssignedIssues`) must defer (not
 * dispatch) when the host load average or API p50 exceeds a configurable
 * threshold. Deferred wakes queue; they do not spawn. The test must assert
 * deferral occurred (e.g. no run created / wake requeued), not just a log
 * line.
 *
 * This module reuses the `HostLoadSnapshot` sensor from `run-admission.ts`
 * (RBR-974) rather than duplicating the measurement path, as directed by
 * the issue: "don't duplicate the sensor". The threshold itself is a
 * separate control — recovery has its own configurable backoff ratio that
 * defaults to the same value as RBR-974's `HOST_LOAD_REFUSAL_RATIO` but
 * can be tuned independently.
 */

import {
  type HostLoadSnapshot,
  readHostLoadSnapshot,
  isHostOverloaded,
  HOST_LOAD_REFUSAL_RATIO,
} from "../run-admission.js";

/**
 * Fraction of host cores above which the recovery sweep should defer all
 * dispatches. Defaults to RBR-974's measured ratio (1.25) but is a
 * separate control — recovery backoff and run-admission concurrency are
 * different mechanisms.
 */
export const DEFAULT_RECOVERY_LOAD_DEFERRAL_RATIO = HOST_LOAD_REFUSAL_RATIO;

export type RecoveryLoadGuardDecision =
  | {
      /** Dispatch may proceed. */
      deferred: false;
    }
  | {
      /** Dispatch must be deferred — host is too loaded. */
      deferred: true;
      reason: "host_load";
      detail: string;
      snapshot: HostLoadSnapshot;
      ratio: number;
    };

/**
 * Evaluate whether the recovery sweep should defer dispatch based on host
 * load. Pure function — all inputs are explicit so it can be unit-tested
 * without a database or synthetic host load.
 *
 * @param load  - Host load snapshot. When omitted, reads from the live
 *                system via `readHostLoadSnapshot()`.
 * @param ratio - Load/core ratio above which dispatch is deferred.
 *                Defaults to `DEFAULT_RECOVERY_LOAD_DEFERRAL_RATIO`.
 */
export function evaluateRecoveryLoadGuard(input?: {
  load?: HostLoadSnapshot;
  ratio?: number;
}): RecoveryLoadGuardDecision {
  const load = input?.load ?? readHostLoadSnapshot();
  const ratio = input?.ratio ?? DEFAULT_RECOVERY_LOAD_DEFERRAL_RATIO;
  const cores = Math.max(1, load.cpuCount);

  if (load.loadAverage1m / cores > ratio) {
    return {
      deferred: true,
      reason: "host_load",
      detail:
        `recovery sweep deferred: 1m load ${load.loadAverage1m.toFixed(2)} on ${load.cpuCount} cores ` +
        `exceeds recovery deferral ratio ${ratio}x`,
      snapshot: load,
      ratio,
    };
  }

  return { deferred: false };
}
