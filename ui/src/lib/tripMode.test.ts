import { describe, expect, it } from "vitest";
import { detectTripMode, isTripMode, PREPARE_THRESHOLD_DAYS, TRIP_MODES } from "./tripMode";

// Fixed "now" for deterministic day-boundary math
const NOW = new Date("2026-08-25T12:00:00Z").getTime();

function iso(daysFromNow: number): string {
  return new Date(NOW + daysFromNow * 86_400_000).toISOString();
}

describe("detectTripMode", () => {
  it("returns plan mode by default when trip start is more than 7 days out", () => {
    const result = detectTripMode({ startDate: iso(14), now: NOW });
    expect(result.mode).toBe("plan");
    expect(result.signals.daysUntilStart).toBe(14);
  });

  it("returns prepare mode at exactly the 7-day threshold", () => {
    const result = detectTripMode({ startDate: iso(PREPARE_THRESHOLD_DAYS), now: NOW });
    expect(result.mode).toBe("prepare");
    expect(result.signals.daysUntilStart).toBe(7);
  });

  it("returns prepare mode in the 1-7 day window", () => {
    const result = detectTripMode({ startDate: iso(3), now: NOW });
    expect(result.mode).toBe("prepare");
  });

  it("returns go mode when the trip starts today", () => {
    const result = detectTripMode({ startDate: iso(0), now: NOW });
    expect(result.mode).toBe("go");
    expect(result.signals.daysUntilStart).toBe(0);
  });

  it("returns go mode when the trip has already started", () => {
    const result = detectTripMode({ startDate: iso(-2), now: NOW });
    expect(result.mode).toBe("go");
    expect(result.signals.daysUntilStart).toBe(-2);
  });

  it("returns plan mode when no start date is set and completion is low", () => {
    const result = detectTripMode({
      startDate: null,
      now: NOW,
      itineraryCompletionPct: 30,
      bookingCompletionPct: 10,
    });
    expect(result.mode).toBe("plan");
  });

  it("returns prepare mode when no start date but high completion suggests execution phase", () => {
    const result = detectTripMode({
      startDate: null,
      now: NOW,
      itineraryCompletionPct: 90,
      bookingCompletionPct: 85,
    });
    expect(result.mode).toBe("prepare");
  });

  it("clamps completion percentages into 0-100", () => {
    const result = detectTripMode({
      startDate: iso(14),
      now: NOW,
      itineraryCompletionPct: 150,
      bookingCompletionPct: -5,
    });
    expect(result.signals.itineraryCompletionPct).toBe(100);
    expect(result.signals.bookingCompletionPct).toBe(0);
    expect(result.mode).toBe("plan"); // still > 7 days out
  });

  it("treats NaN completion as 0", () => {
    const result = detectTripMode({
      startDate: null,
      now: NOW,
      itineraryCompletionPct: Number.NaN,
      bookingCompletionPct: Number.NaN,
    });
    expect(result.signals.itineraryCompletionPct).toBe(0);
    expect(result.mode).toBe("plan");
  });

  it("ignores malformed dates and falls through to plan mode", () => {
    const result = detectTripMode({ startDate: "not-a-date", now: NOW });
    expect(result.mode).toBe("plan");
    expect(result.signals.daysUntilStart).toBeNull();
  });
});

describe("isTripMode", () => {
  it("accepts all defined modes", () => {
    for (const mode of TRIP_MODES) {
      expect(isTripMode(mode)).toBe(true);
    }
  });

  it("rejects garbage values", () => {
    expect(isTripMode("fly")).toBe(false);
    expect(isTripMode(42)).toBe(false);
    expect(isTripMode(null)).toBe(false);
    expect(isTripMode(undefined)).toBe(false);
  });
});