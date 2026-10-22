/**
 * Capacity deferral classification for Hermes runs (PRX-5972 / PRX-5973).
 *
 * A Hermes turn that lands on a *settled ceiling deferral* — the per-profile
 * serve-slot ceiling is full — is not a failure. Hermes raises
 * `GatewayProfileDeferredError` with `reason_code=profile_deferred_capacity`,
 * `retryAfterS`, `retryable=true`, and exits with `TURN_NOT_ADMITTED_EXIT_CODE`
 * (75, EX_TEMPFAIL). Nothing was submitted, so re-dispatch is safe.
 *
 * The adapter must hand Paperclip a *deferral* classification instead of
 * letting the run book as `adapter_failed`, so the server can park the run as a
 * wait and re-admit it instead of flagging the agent's card with an error.
 */

/** Hermes reason code carried on stderr by `GatewayProfileDeferredError`. */
export const PROFILE_DEFERRED_CAPACITY_REASON_CODE = "profile_deferred_capacity";

/** Adapter-facing errorCode the server books as a deferral (never `adapter_failed`). */
export const PROFILE_DEFERRED_CAPACITY_ERROR_CODE = "hermes_profile_deferred_capacity";

/** EX_TEMPFAIL — the exit status Hermes uses for "turn was not admitted". */
export const TURN_NOT_ADMITTED_EXIT_CODE = 75;

/** Hermes' own suggested wait when the child does not report one. */
export const DEFAULT_PROFILE_DEFERRED_RETRY_AFTER_S = 300;
export const MAX_PROFILE_DEFERRED_RETRY_AFTER_S = 3600;

const REASON_CODE_REGEX = /profile_deferred_capacity/;
const RETRY_AFTER_REGEX = /retryAfterS=(\d+)/;
const PROFILE_NAME_REGEX = /\bprofile=([A-Za-z0-9_.:-]+)/;

export interface ProfileDeferral {
  errorCode: typeof PROFILE_DEFERRED_CAPACITY_ERROR_CODE;
  reasonCode: typeof PROFILE_DEFERRED_CAPACITY_REASON_CODE;
  retryAfterS: number;
  retryable: true;
  profile: string | null;
  exitCode: number;
  message: string;
}

function firstMatchingLine(text: string): string | null {
  const line = text
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0 && REASON_CODE_REGEX.test(entry));
  return line ? line.slice(0, 1_000) : null;
}

/**
 * Classify a finished child as a capacity deferral.
 *
 * Reads the exit status (75) and/or the `profile_deferred_capacity` token so a
 * deferral is never mistaken for an `adapter_failed` run, and pulls the
 * ceiling's own numbers (`retryAfterS=`, `profile=`) off the child's output.
 *
 * Returns `null` for anything that is not a deferral.
 */
export function readProfileDeferral(input: {
  exitCode: number | null;
  stdout?: string | null;
  stderr?: string | null;
}): ProfileDeferral | null {
  const exitCode = typeof input.exitCode === "number" ? input.exitCode : null;
  const stdout = typeof input.stdout === "string" ? input.stdout : "";
  const stderr = typeof input.stderr === "string" ? input.stderr : "";
  const text = `${stdout}\n${stderr}`;
  const hasReasonCode = REASON_CODE_REGEX.test(text);
  if (exitCode !== TURN_NOT_ADMITTED_EXIT_CODE && !hasReasonCode) return null;

  const retryMatch = text.match(RETRY_AFTER_REGEX);
  const parsedRetryAfter = retryMatch ? Number.parseInt(retryMatch[1], 10) : Number.NaN;
  const retryAfterS =
    Number.isFinite(parsedRetryAfter) && parsedRetryAfter > 0
      ? Math.min(MAX_PROFILE_DEFERRED_RETRY_AFTER_S, Math.max(1, parsedRetryAfter))
      : DEFAULT_PROFILE_DEFERRED_RETRY_AFTER_S;
  const profileMatch = text.match(PROFILE_NAME_REGEX);
  // Prefer the human-readable stderr line (it carries the ceiling's own
  // numbers); the stdout stream-json record is the fallback.
  const message =
    firstMatchingLine(stderr) ??
    firstMatchingLine(stdout) ??
    `Gateway deferred: ${PROFILE_DEFERRED_CAPACITY_REASON_CODE} (retryAfterS=${retryAfterS}, retryable=true)`;

  return {
    errorCode: PROFILE_DEFERRED_CAPACITY_ERROR_CODE,
    reasonCode: PROFILE_DEFERRED_CAPACITY_REASON_CODE,
    retryAfterS,
    retryable: true,
    profile: profileMatch ? profileMatch[1] : null,
    exitCode: exitCode ?? TURN_NOT_ADMITTED_EXIT_CODE,
    message,
  };
}
