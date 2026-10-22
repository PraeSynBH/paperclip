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
// Both the human-readable line (`retryAfterS=300`) and a structured record
// (`"retryAfterS": 300`) carry the same numbers.
const RETRY_AFTER_REGEX = /retryAfterS["']?\s*[:=]\s*["']?(\d+)/;
const PROFILE_NAME_REGEX = /\bprofile["']?\s*[:=]\s*["']?([A-Za-z0-9_.:-]+)/;

/**
 * Shapes that only a real Hermes "turn not admitted" record produces (PRX-5995).
 *
 * The reason code alone is not evidence: a child that listed the board, read its
 * own issue, or quoted a log line emits `profile_deferred_capacity` as prose and
 * still exits 0 having finished its window. Matching that prose booked completed
 * runs as waits. Every pattern here is anchored to either Hermes' error class
 * name, a structured `reason_code` field, or Hermes' own terminal line — none of
 * them match a sentence that merely mentions the token.
 */
const TURN_NOT_ADMITTED_RECORD_PATTERNS: readonly RegExp[] = [
  // `GatewayProfileDeferredError: Gateway deferred: ...` / stack frames.
  /\bGatewayProfileDeferredError\b/,
  // Structured field: `reason_code=profile_deferred_capacity`,
  // `"reason_code": "profile_deferred_capacity"`, `reason_code: 'profile_deferred_capacity'`.
  /(?:^|[\s,{[(])["']?reason_code["']?\s*[:=]\s*["']?profile_deferred_capacity(?![\w])/,
  // Hermes' own terminal line, optionally behind a `[hermes]`/`ERROR` prefix.
  /^\s*(?:\[[^\]\n]{0,64}\]\s*)?(?:ERROR\s+|WARN\s+)?Gateway deferred:\s*profile_deferred_capacity(?![\w])/m,
];

function hasTurnNotAdmittedRecord(text: string): boolean {
  return TURN_NOT_ADMITTED_RECORD_PATTERNS.some((pattern) => pattern.test(text));
}

function firstAnchoredLine(text: string): string | null {
  const line = text
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0 && hasTurnNotAdmittedRecord(entry));
  return line ? line.slice(0, 1_000) : null;
}

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
 * A deferral needs evidence that the turn was *not admitted* (PRX-5995): exit 75,
 * or an anchored Hermes record (`GatewayProfileDeferredError`, a structured
 * `reason_code=profile_deferred_capacity`, or Hermes' own `Gateway deferred:`
 * line). A bare mention of the reason code anywhere in the transcript is not
 * evidence — a child that finished its window and exited 0 must stay a success.
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
  // A clean exit is a completed turn by definition: the child did whatever it
  // was asked, and any reason code in its transcript is something it printed.
  if (exitCode === 0) return null;
  if (exitCode !== TURN_NOT_ADMITTED_EXIT_CODE && !hasTurnNotAdmittedRecord(text)) return null;

  const retryMatch = text.match(RETRY_AFTER_REGEX);
  const parsedRetryAfter = retryMatch ? Number.parseInt(retryMatch[1], 10) : Number.NaN;
  const retryAfterS =
    Number.isFinite(parsedRetryAfter) && parsedRetryAfter > 0
      ? Math.min(MAX_PROFILE_DEFERRED_RETRY_AFTER_S, Math.max(1, parsedRetryAfter))
      : DEFAULT_PROFILE_DEFERRED_RETRY_AFTER_S;
  const profileMatch = text.match(PROFILE_NAME_REGEX);
  // Prefer the anchored record (it carries the ceiling's own numbers) on
  // stderr, then the stdout stream-json record; a plain reason-code line is the
  // last resort for an exit-75 child that only printed the token.
  const message =
    firstAnchoredLine(stderr) ??
    firstAnchoredLine(stdout) ??
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
