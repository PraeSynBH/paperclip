// RBR-937 AC4 — distinguish "the change is UNVERIFIED" from "the change is BROKEN".
//
// A run that dies on the wall clock has proven nothing about the code in the
// working tree. RBR-912 burned four consecutive timed-out runs on a fix that was
// already correct: each run died *inside verification*, never inside the fix.
// The recovery notice nonetheless said the issue had "no live execution path",
// which reads as an engineering failure, so a healthy change was escalated as a
// failure and then "retried" — re-paying the same unaffordable cost each time.
//
// This module supplies the one sentence that breaks that loop: when the latest
// run timed out, say so explicitly, and point the reader at the detached
// verification harness instead of another doomed inline retry.

/** Run statuses that mean "ran out of wall clock", not "the work is wrong". */
const WALL_CLOCK_RUN_STATUSES = new Set(["timed_out"]);

/** Error codes that mean the same thing. */
const WALL_CLOCK_ERROR_CODES = new Set(["timeout", "timed_out", "wall_clock_exceeded"]);

export type RunTimeoutDispositionInput =
  | {
      status?: string | null;
      errorCode?: string | null;
    }
  | null
  | undefined;

export type RunVerificationDisposition = "unverified_timeout" | "indeterminate";

/**
 * True when the latest run ended because it exceeded its time budget rather than
 * because the work under it was wrong.
 */
export function isWallClockExhaustedRun(run: RunTimeoutDispositionInput): boolean {
  if (!run) return false;

  const status = typeof run.status === "string" ? run.status.trim().toLowerCase() : "";
  if (WALL_CLOCK_RUN_STATUSES.has(status)) return true;

  const errorCode = typeof run.errorCode === "string" ? run.errorCode.trim().toLowerCase() : "";
  return WALL_CLOCK_ERROR_CODES.has(errorCode);
}

export function classifyRunVerificationDisposition(
  run: RunTimeoutDispositionInput,
): RunVerificationDisposition {
  return isWallClockExhaustedRun(run) ? "unverified_timeout" : "indeterminate";
}

/**
 * The clarifying sentence appended to recovery notices when a run timed out.
 * Returns `null` for every other outcome so non-timeout messaging is unchanged.
 */
export function buildUnverifiedTimeoutNotice(run: RunTimeoutDispositionInput): string | null {
  if (!isWallClockExhaustedRun(run)) return null;

  return (
    " Note: the previous run exceeded its wall clock, so this change is UNVERIFIED, not known to be broken — " +
    "a timeout is not evidence of a defect. Before retrying inline, check whether the work is already complete " +
    "in the working tree, and if verification is what does not fit in one run, run it detached " +
    "(`bash scripts/detached-verify.sh start --name <job> -- <command>`) and read the durable result on the next " +
    "wake instead of re-paying the same cost."
  );
}

/**
 * Structured metadata companion to the notice, so the UI/board can render the
 * distinction rather than parsing prose.
 */
export function buildRunVerificationDispositionMetadata(run: RunTimeoutDispositionInput) {
  const disposition = classifyRunVerificationDisposition(run);
  return {
    verificationDisposition: disposition,
    changeKnownBroken: false,
    timedOut: disposition === "unverified_timeout",
  };
}
