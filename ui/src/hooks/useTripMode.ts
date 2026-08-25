import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { researchTripsApi, type ResearchArtifact, type Trip } from "../api/research-trips";
import { queryKeys } from "../lib/queryKeys";
import { detectTripMode, isTripMode, TRIP_MODES, type TripMode } from "../lib/tripMode";

const OVERRIDE_STORAGE_KEY = "voyonder.tripModeOverride";

export interface UseTripModeOptions {
  companyId: string;
  trip: Trip | undefined;
  /** Derive itinerary/booking completion from artifacts when available. */
  artifacts?: ResearchArtifact[] | undefined;
  /** If true, honor any persisted manual override. Default true. */
  allowManualOverride?: boolean;
}

/**
 * Resolve the effective trip mode: automatic detection overlaid with a
 * manual override persisted per trip in localStorage.
 *
 * Returns the mode, the detection signals, and setters/clearers for the
 * manual override.
 */
export function useTripMode({ companyId, trip, artifacts, allowManualOverride = true }: UseTripModeOptions) {
  const queryClient = useQueryClient();

  const [override, setOverride] = useState<TripMode | null>(() => readStoredOverride(trip?.id));

  // Auto-detection from trip timeline + completion signals
  const detected = useMemo(() => {
    if (!trip) return null;
    const itineraryCompletionPct = computeCompletionPct(artifacts, "itinerary");
    const bookingCompletionPct = computeCompletionPct(artifacts, "booking");
    return detectTripMode({
      startDate: trip.startDate,
      itineraryCompletionPct,
      bookingCompletionPct,
    });
  }, [trip, artifacts]);

  const effectiveMode: TripMode | null = useMemo(() => {
    if (!detected) return null;
    if (allowManualOverride && override) return override;
    return detected.mode;
  }, [detected, override, allowManualOverride]);

  const setManualOverride = useCallback(
    (mode: TripMode | null) => {
      // Persist per-trip in localStorage; clear on null
      const key = overrideKey(trip?.id);
      if (mode === null) {
        localStorage.removeItem(key);
      } else if (isTripMode(mode)) {
        localStorage.setItem(key, mode);
      }
      setOverride(mode);
      // Invalidate trip queries so dependent views re-render with the new mode.
      if (companyId && trip?.id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.researchTrips.detail(companyId, trip.id) });
      }
    },
    [companyId, trip?.id, queryClient],
  );

  return {
    detectedMode: detected?.mode ?? null,
    effectiveMode,
    signals: detected?.signals ?? null,
    override,
    setManualOverride,
    clearManualOverride: useCallback(() => setManualOverride(null), [setManualOverride]),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Completion proxy: when real itinerary/booking completion isn't stored yet,
 * derive it from artifact statuses. Verified artifacts count toward
 * completion; rejected ones don't. `kind` is a hint for future data, all
 * artifacts currently share the status field.
 */
function computeCompletionPct(artifacts: ResearchArtifact[] | undefined, _kind: "itinerary" | "booking"): number {
  if (!artifacts || artifacts.length === 0) return 0;
  const resolved = artifacts.filter((a) => a.status === "verified").length;
  return Math.round((resolved / artifacts.length) * 100);
}

function overrideKey(tripId: string | undefined): string {
  return tripId ? `${OVERRIDE_STORAGE_KEY}.${tripId}` : OVERRIDE_STORAGE_KEY;
}

function readStoredOverride(tripId: string | undefined): TripMode | null {
  try {
    const raw = localStorage.getItem(overrideKey(tripId));
    return isTripMode(raw) ? raw : null;
  } catch {
    return null; // localStorage unavailable (SSR/privacy mode)
  }
}