/**
 * Trip mode detection — Plan / Prepare / Go.
 *
 * Pure, testable mode logic per the M2 Trip product brief (VOY-2282):
 *
 * - Plan mode (default when trip start > 7 days out): Chat + Itinerary
 * - Prepare mode (when trip start ≤ 7 days out): Itinerary + Booking
 *   checklist + Urgency summary
 * - Go mode (during trip): Today view + Offline itinerary + Quick actions
 *
 * Mode detection signals: trip.startDate proximity + itinerary completion %
 * + booking completion %. Auto-transition defaults can be overridden
 * manually by power users (override persisted separately by the caller).
 */

export const TRIP_MODES = ["plan", "prepare", "go"] as const;
export type TripMode = (typeof TRIP_MODES)[number];

/** Days before startDate at which the trip enters Prepare mode. */
export const PREPARE_THRESHOLD_DAYS = 7;

export interface TripModeInput {
  /** Trip start date (ISO string). Null when no date is set. */
  startDate: string | null;
  /** Current time — injectable for testability. Defaults to Date.now(). */
  now?: number;
  /** 0-100 — portion of itinerary items finalized. */
  itineraryCompletionPct?: number;
  /** 0-100 — portion of booking items completed. */
  bookingCompletionPct?: number;
}

export interface TripModeResult {
  mode: TripMode;
  /** Human-readable signal breakdown, useful for the mode switcher hint. */
  signals: {
    daysUntilStart: number | null;
    startReason: string;
    itineraryCompletionPct: number;
    bookingCompletionPct: number;
  };
}

/** Boundary for "during trip" — trip starts today or earlier and hasn't ended. */
function daysUntil(dateIso: string | null, now: number): number | null {
  if (!dateIso) return null;
  const start = new Date(dateIso).getTime();
  if (Number.isNaN(start)) return null;
  // Day-boundary math: compare calendar days, not raw ms, so a trip
  // starting tomorrow at 6am still reads as "1 day out".
  const nowDay = new Date(now);
  nowDay.setHours(0, 0, 0, 0);
  const startDay = new Date(start);
  startDay.setHours(0, 0, 0, 0);
  return Math.round((startDay.getTime() - nowDay.getTime()) / 86_400_000);
}

/**
 * Detect the trip mode from timeline + completion signals.
 *
 * Priority:
 * 1. Go mode if the trip has started (daysUntilStart <= 0).
 * 2. Prepare mode if daysUntilStart is set and <= 7.
 * 3. Prepare mode when no start date is set but both completion signals
 *    suggest execution phase (>= 80%) — covers trips with incomplete dates.
 * 4. Otherwise Plan mode.
 */
export function detectTripMode(input: TripModeInput): TripModeResult {
  const now = input.now ?? Date.now();
  const daysUntilStart = daysUntil(input.startDate, now);
  const itineraryCompletionPct = clampPct(input.itineraryCompletionPct);
  const bookingCompletionPct = clampPct(input.bookingCompletionPct);

  if (daysUntilStart !== null && daysUntilStart <= 0) {
    return {
      mode: "go",
      signals: {
        daysUntilStart,
        startReason:
          daysUntilStart === 0
            ? "Trip starts today"
            : `Trip started ${Math.abs(daysUntilStart)} day${Math.abs(daysUntilStart) === 1 ? "" : "s"} ago`,
        itineraryCompletionPct,
        bookingCompletionPct,
      },
    };
  }

  if (daysUntilStart !== null && daysUntilStart <= PREPARE_THRESHOLD_DAYS) {
    return {
      mode: "prepare",
      signals: {
        daysUntilStart,
        startReason: `${daysUntilStart} day${daysUntilStart === 1 ? "" : "s"} until departure`,
        itineraryCompletionPct,
        bookingCompletionPct,
      },
    };
  }

  // No (or distant) start date but completion signals indicate execution phase.
  // This covers trips where the date fields are incomplete but the plan is
  // substantially built out — Prepare is the safer default than Plan.
  if (
    daysUntilStart === null &&
    itineraryCompletionPct >= 80 &&
    bookingCompletionPct >= 80
  ) {
    return {
      mode: "prepare",
      signals: {
        daysUntilStart: null,
        startReason: "No start date set, but planning is largely complete",
        itineraryCompletionPct,
        bookingCompletionPct,
      },
    };
  }

  return {
    mode: "plan",
    signals: {
      daysUntilStart,
      startReason:
        daysUntilStart === null
          ? "No start date set"
          : `${daysUntilStart} days until departure`,
      itineraryCompletionPct,
      bookingCompletionPct,
    },
  };
}

function clampPct(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** Validate a manual override value, guarding against garbage input. */
export function isTripMode(value: unknown): value is TripMode {
  return TRIP_MODES.includes(value as TripMode);
}