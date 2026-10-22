/**
 * Booking for Hermes capacity deferrals (PRX-5972 half 2 / PRX-5973).
 *
 * A run dispatched to a parked profile never reaches the model: Hermes raises
 * `GatewayProfileDeferredError` (`reason_code=profile_deferred_capacity`,
 * `retryAfterS`, `retryable=true`) and exits 75 (EX_TEMPFAIL). The hermes
 * adapter classifies that child as `hermes_profile_deferred_capacity`; this
 * module turns the classification into a *deferral* booking so a full serve-slot
 * ceiling shows up as a wait instead of `adapter_failed`, and the run is
 * re-admitted through the normal scheduled-retry promotion rather than the
 * recovery/park paths that key on `adapter_failed`.
 */

/** Canonical reason/error code recorded for a capacity deferral. */
export const PROFILE_DEFERRED_CAPACITY_CODE = "profile_deferred_capacity";

/** Adapter error codes that mean "the turn was not admitted; retry later". */
export const PROFILE_DEFERRED_CAPACITY_ERROR_CODES: ReadonlySet<string> = new Set([
  PROFILE_DEFERRED_CAPACITY_CODE,
  "hermes_profile_deferred_capacity",
  "hermes_gateway_profile_deferred_capacity",
  "profile_deferred",
]);

/** `scheduled_retry_reason` stamped on a deferred run. */
export const PROFILE_DEFERRED_CAPACITY_RETRY_REASON = PROFILE_DEFERRED_CAPACITY_CODE;

/** `result_json.stopReason` for a deferred run (never `adapter_failed`). */
export const PROFILE_DEFERRED_CAPACITY_STOP_REASON = PROFILE_DEFERRED_CAPACITY_CODE;

/** Hermes' own default wait when the adapter does not report one. */
export const DEFAULT_PROFILE_DEFERRED_RETRY_AFTER_S = 300;
export const MIN_PROFILE_DEFERRED_RETRY_AFTER_S = 5;
export const MAX_PROFILE_DEFERRED_RETRY_AFTER_S = 3_600;

/**
 * Successive deferrals back off so a permanently parked profile drains the
 * queue at a bounded rate instead of re-dispatching every `retryAfterS` forever.
 * The first wait is exactly the ceiling's `retryAfterS`.
 */
export const PROFILE_DEFERRED_BACKOFF_GROWTH = 4;

export interface ProfileDeferral {
  errorCode: typeof PROFILE_DEFERRED_CAPACITY_CODE;
  adapterErrorCode: string;
  retryAfterS: number;
  retryable: boolean;
  profile: string | null;
  message: string | null;
}

export interface ProfileDeferralBooking {
  status: "scheduled_retry";
  errorCode: typeof PROFILE_DEFERRED_CAPACITY_CODE;
  stopReason: typeof PROFILE_DEFERRED_CAPACITY_STOP_REASON;
  retryReason: typeof PROFILE_DEFERRED_CAPACITY_RETRY_REASON;
  retryAfterS: number;
  attempt: number;
  multiplier: number;
  delayMs: number;
  retryAt: Date;
}

function toPositiveNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Read a deferral classification off an adapter result.
 *
 * Returns `null` for every ordinary failure so the `adapter_failed` booking
 * path is untouched.
 */
export function readProfileDeferralFromAdapterResult(adapterResult: {
  errorCode?: string | null;
  retryAfterS?: number | null;
  retryable?: boolean;
  deferredProfile?: string | null;
  errorMessage?: string | null;
} | null | undefined): ProfileDeferral | null {
  const errorCode = readNonEmptyString(adapterResult?.errorCode);
  if (!errorCode || !PROFILE_DEFERRED_CAPACITY_ERROR_CODES.has(errorCode)) return null;
  const rawRetryAfter = toPositiveNumber(adapterResult?.retryAfterS);
  const retryAfterS = Math.min(
    MAX_PROFILE_DEFERRED_RETRY_AFTER_S,
    Math.max(
      MIN_PROFILE_DEFERRED_RETRY_AFTER_S,
      Math.round(rawRetryAfter ?? DEFAULT_PROFILE_DEFERRED_RETRY_AFTER_S),
    ),
  );
  return {
    errorCode: PROFILE_DEFERRED_CAPACITY_CODE,
    adapterErrorCode: errorCode,
    retryAfterS,
    retryable: adapterResult?.retryable !== false,
    profile: readNonEmptyString(adapterResult?.deferredProfile),
    message: readNonEmptyString(adapterResult?.errorMessage),
  };
}

/**
 * Resolve the deferral booking for a finished run.
 *
 * The run keeps its identity and is re-booked as `scheduled_retry` at `retryAt`;
 * `promoteDueScheduledRetries` then promotes it back into the queued pool when
 * the wait elapses, which is what makes the re-admission automatic (no manual
 * wake, no recovery escalation).
 */
export function resolveProfileDeferralBooking(input: {
  retryAfterS?: number | null;
  attempt?: number | null;
  now?: Date;
}): ProfileDeferralBooking {
  const retryAfterS = Math.min(
    MAX_PROFILE_DEFERRED_RETRY_AFTER_S,
    Math.max(
      MIN_PROFILE_DEFERRED_RETRY_AFTER_S,
      Math.round(toPositiveNumber(input?.retryAfterS) ?? DEFAULT_PROFILE_DEFERRED_RETRY_AFTER_S),
    ),
  );
  const attempt = Math.max(0, Math.floor(toPositiveNumber(input?.attempt) ?? 0));
  const multiplier = Math.min(PROFILE_DEFERRED_BACKOFF_GROWTH, attempt + 1);
  const delayMs = retryAfterS * 1_000 * multiplier;
  const now =
    input?.now instanceof Date && !Number.isNaN(input.now.getTime()) ? input.now : new Date();
  return {
    status: "scheduled_retry",
    errorCode: PROFILE_DEFERRED_CAPACITY_CODE,
    stopReason: PROFILE_DEFERRED_CAPACITY_STOP_REASON,
    retryReason: PROFILE_DEFERRED_CAPACITY_RETRY_REASON,
    retryAfterS,
    attempt,
    multiplier,
    delayMs,
    retryAt: new Date(now.getTime() + delayMs),
  };
}
