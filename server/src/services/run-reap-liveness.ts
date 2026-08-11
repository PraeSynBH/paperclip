/**
 * Reap liveness predicate (RBR-979).
 *
 * Agent runs are separate OS processes (`hermes chat -q`, `codex`, ...) that are
 * *not* children of `paperclipai run`. They survive a server restart by design.
 * The startup reaper used to assume the opposite — that any run row still marked
 * `running` at boot must be dead, because a healthy server would have been
 * tracking it in `runningProcesses`. That assumption is false for out-of-process
 * runs, so a restart mass-marked every LIVE run `process_lost`.
 *
 * Observed 2026-08-06 09:26:41: a single restart reaped 31 runs; 14 of them were
 * still live OS processes 68 minutes later, including the CEO run that was
 * mid-`PATCH` and the CTO run that was working RBR-974.
 *
 * This module is the fix's core: a predicate that only reports "dead" on
 * *positive evidence* of death. It is the same defect shape as the agent start
 * lock (RBR-977) — inferring death from the absence of a registration rather
 * than checking whether the process is alive — so it takes the same stance:
 *
 *   Reaping is destructive. Absence of evidence is not evidence of death.
 *
 * Three independent liveness signals, in order of strength:
 *
 *   1. Recorded pid is alive AND its identity is confirmed (cmdline carries the
 *      runId, or its kernel start time matches the recorded one). Guards pid
 *      reuse: a recycled pid must not be mistaken for the original run.
 *   2. The run's id appears in some live process's cmdline. This recovers runs
 *      whose pid was never persisted at all — which was the entire 09:26:41
 *      population, because the deployed server predated the onSpawn PID
 *      persistence fix. Liveness *was* checkable; nothing looked.
 *   3. The recorded process group is alive (a descendant outlived the parent).
 *
 * Every verdict carries the evidence it acted on so a destructive sweep is
 * auditable per run (AC4), rather than logging a bare `{"reaped":31}`.
 */

/** How far a pid's kernel start time may drift from the recorded spawn time. */
export const PROCESS_START_TIME_TOLERANCE_MS = 10_000;

export type RunProcessIdentity = {
  runId: string;
  processPid: number | null | undefined;
  processGroupId: number | null | undefined;
  processStartedAt: Date | null | undefined;
  /**
   * Whether this run's adapter spawns a tracked local child process at all.
   * Gateway/HTTP adapters have no local pid to check, so a pid-based predicate
   * cannot speak to their liveness and must not claim they are dead.
   */
  tracksLocalChildProcess: boolean;
};

/**
 * OS-level probe. Injectable: the negative-control test has to be able to
 * present a genuinely live run and a genuinely dead one, and a test that cannot
 * control the probe cannot tell those two apart.
 */
export type ProcessTableProbe = {
  isPidAlive: (pid: number) => boolean;
  isProcessGroupAlive: (processGroupId: number) => boolean;
  /** Kernel start time for a pid in epoch ms, or null when unavailable. */
  startTimeForPid: (pid: number) => number | null;
  /** Live pids whose command line mentions this run id. */
  pidsMentioningRunId: (runId: string) => number[];
};

export type ReapLivenessReason =
  /** Alive: pid responds and we proved it is still the run's own process. */
  | "pid_alive_identity_confirmed"
  /** Alive: pid responds but we could not prove identity. Kept, conservatively. */
  | "pid_alive_identity_unverified"
  /** Alive: no usable pid, but a live process still carries this run id. */
  | "run_id_present_in_process_table"
  /** Alive: parent pid gone, but the recorded process group still has members. */
  | "process_group_alive"
  /** Alive: the probe itself failed. A destructive action needs proof, not a guess. */
  | "probe_failed_assumed_alive"
  /** Dead: pid does not resolve, and nothing else claims this run. */
  | "pid_dead_no_other_evidence"
  /** Dead: pid resolves to a *different* process; the original is gone. */
  | "pid_reused_original_gone"
  /** Dead: adapter has no local process, and nothing claims the run id. */
  | "no_local_process_and_run_id_absent"
  /** Unknown: nothing was ever recorded and nothing claims the run id. */
  | "no_identity_recorded";

/** Reasons that authorize the destructive reap. Everything else defers. */
const DEAD_REASONS: ReadonlySet<ReapLivenessReason> = new Set<ReapLivenessReason>([
  "pid_dead_no_other_evidence",
  "pid_reused_original_gone",
  "no_local_process_and_run_id_absent",
  "no_identity_recorded",
]);

export type ReapLivenessVerdict = {
  runId: string;
  /** True when the run must NOT be reaped. */
  alive: boolean;
  reason: ReapLivenessReason;
  evidence: {
    pidChecked: number | null;
    pidAlive: boolean | null;
    processGroupChecked: number | null;
    processGroupAlive: boolean | null;
    identityConfirmedBy: "cmdline_run_id" | "process_start_time" | null;
    recordedStartTimeMs: number | null;
    observedStartTimeMs: number | null;
    startTimeDeltaMs: number | null;
    runIdPidsObserved: number[];
    tracksLocalChildProcess: boolean;
    probeError: string | null;
  };
};

function emptyEvidence(identity: RunProcessIdentity): ReapLivenessVerdict["evidence"] {
  return {
    pidChecked: null,
    pidAlive: null,
    processGroupChecked: null,
    processGroupAlive: null,
    identityConfirmedBy: null,
    recordedStartTimeMs: null,
    observedStartTimeMs: null,
    startTimeDeltaMs: null,
    runIdPidsObserved: [],
    tracksLocalChildProcess: identity.tracksLocalChildProcess,
    probeError: null,
  };
}

function usablePid(pid: number | null | undefined): number | null {
  return typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : null;
}

function recordedStartMs(startedAt: Date | null | undefined): number | null {
  if (!startedAt) return null;
  const ms = startedAt.getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Decide whether a run's process is still alive.
 *
 * Never throws: a probe failure resolves to `alive` so that an unreadable
 * process table cannot trigger a mass reap. This is the whole point of the
 * ticket — the failure mode being fixed is *false positives*.
 */
export function classifyRunProcessLiveness(
  identity: RunProcessIdentity,
  probe: ProcessTableProbe,
): ReapLivenessVerdict {
  const evidence = emptyEvidence(identity);
  const pid = usablePid(identity.processPid);
  const processGroupId = usablePid(identity.processGroupId);
  evidence.pidChecked = pid;
  evidence.processGroupChecked = processGroupId;
  evidence.recordedStartTimeMs = recordedStartMs(identity.processStartedAt);

  const verdict = (alive: boolean, reason: ReapLivenessReason): ReapLivenessVerdict => ({
    runId: identity.runId,
    alive,
    reason,
    evidence,
  });

  try {
    // Signal 2 is gathered first because it is the one that recovers runs with
    // no persisted pid, and it also serves as the identity oracle for signal 1.
    const runIdPids = probe.pidsMentioningRunId(identity.runId) ?? [];
    evidence.runIdPidsObserved = [...runIdPids];

    // ── Signal 1: recorded pid ────────────────────────────────────────────
    if (pid !== null) {
      const pidAlive = probe.isPidAlive(pid);
      evidence.pidAlive = pidAlive;

      if (pidAlive) {
        // Guard pid reuse. A live pid alone is not proof this is *our* process.
        if (runIdPids.includes(pid)) {
          evidence.identityConfirmedBy = "cmdline_run_id";
          return verdict(true, "pid_alive_identity_confirmed");
        }

        const observed = probe.startTimeForPid(pid);
        evidence.observedStartTimeMs = observed;
        const recorded = evidence.recordedStartTimeMs;
        if (observed !== null && recorded !== null) {
          const delta = Math.abs(observed - recorded);
          evidence.startTimeDeltaMs = delta;
          if (delta <= PROCESS_START_TIME_TOLERANCE_MS) {
            evidence.identityConfirmedBy = "process_start_time";
            return verdict(true, "pid_alive_identity_confirmed");
          }
          // Start times disagree: the pid was recycled by an unrelated process.
          // The original run really is gone — but only say so if nothing else
          // still claims the run id.
          if (runIdPids.length > 0) {
            return verdict(true, "run_id_present_in_process_table");
          }
          if (processGroupId !== null) {
            const groupAlive = probe.isProcessGroupAlive(processGroupId);
            evidence.processGroupAlive = groupAlive;
            if (groupAlive) return verdict(true, "process_group_alive");
          }
          return verdict(false, "pid_reused_original_gone");
        }

        // Pid is alive and we cannot disprove it is ours. Do not reap: an
        // unverifiable live pid is exactly the ambiguity that must not resolve
        // to a destructive action.
        return verdict(true, "pid_alive_identity_unverified");
      }
    }

    // ── Signal 2: run id still present in a live process ──────────────────
    if (runIdPids.length > 0) {
      return verdict(true, "run_id_present_in_process_table");
    }

    // ── Signal 3: surviving process group ────────────────────────────────
    if (processGroupId !== null) {
      const groupAlive = probe.isProcessGroupAlive(processGroupId);
      evidence.processGroupAlive = groupAlive;
      if (groupAlive) return verdict(true, "process_group_alive");
    }

    if (pid !== null || processGroupId !== null) {
      return verdict(false, "pid_dead_no_other_evidence");
    }
    if (!identity.tracksLocalChildProcess) {
      return verdict(false, "no_local_process_and_run_id_absent");
    }
    return verdict(false, "no_identity_recorded");
  } catch (error) {
    evidence.probeError = error instanceof Error ? error.message : String(error);
    return verdict(true, "probe_failed_assumed_alive");
  }
}

export function isReapAuthorizedReason(reason: ReapLivenessReason) {
  return DEAD_REASONS.has(reason);
}
