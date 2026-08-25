/**
 * Mode-aware urgency scoring for trip items (VOY-2284).
 *
 * Defines the red/amber/green/grey hierarchy and computes per-artifact
 * urgency levels given the trip mode and context.
 *
 * Urgency Levels:
 *   Red   — blocking: needs action now (sold-out activity, expired booking
 *           window, safety issue)
 *   Amber — recommended: action within 7 days (booking deadline approaching,
 *           activity about to sell out)
 *   Green — on track: everything fine
 *   Grey  — unknown: needs research (stale data, unverified citation)
 *
 * Mode-aware behaviour:
 *   Plan mode   → only Grey matters; everything else is Green
 *   Prepare mode → full hierarchy: Red, Amber, Green, Grey all surfaced
 *   Go mode     → only Red is prominent; Green is collapsed; Grey hidden
 */

import type { TripMode } from "./tripMode";

// ── Types ────────────────────────────────────────────────────────────────────

export type UrgencyLevel = "red" | "amber" | "green" | "grey";

export interface UrgencyReason {
  level: UrgencyLevel;
  /** Machine-readable reason key for i18n / styling. */
  reasonKey:
    | "sold_out"
    | "expired_booking_window"
    | "safety_issue"
    | "booking_deadline_approaching"
    | "about_to_sell_out"
    | "on_track"
    | "stale_data"
    | "unverified_citation";
  /** Human-readable short label (inline use). */
  label: string;
  /** Longer description shown in tooltip / detail. */
  description: string;
}

export interface UrgencyInput {
  /** Artifact status from the research pipeline. */
  status: "pending" | "verified" | "rejected";
  /** Sage's confidence 0–100. Null when unknown. */
  confidence: number | null;
  /** Relevance score 0–100. Null when unknown. */
  relevanceScore: number | null;
  /** When the citation was fetched (ISO string). */
  fetchedAt: string | null;
  /** When the citation expires / booking window closes (ISO string). */
  expiresAt: string | null;
  /** Source type hint for safety signal classification. */
  sourceType: "web" | "email" | "portal" | "manual";
  /** Artifact title — scanned for safety keywords. */
  title: string;
}

export interface ArtifactUrgency {
  level: UrgencyLevel;
  reason: UrgencyReason;
  /** Number of days until expiry / deadline. Null when not applicable. */
  daysUntilDeadline: number | null;
  /** If a sell-out warning applies, the estimated remaining count. */
  remainingCount: number | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Data older than this (ms) is considered stale → grey. */
export const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Data older than this (ms) but within STALE_THRESHOLD is "on watch". */
export const FRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Days before a booking deadline at which we promote to Amber. */
export const DEADLINE_AMBER_DAYS = 7;

/** Days before a booking deadline at which we promote to Red. */
export const DEADLINE_RED_DAYS = 0;

/** Confidence threshold below which pending items are Grey (unverified). */
export const LOW_CONFIDENCE_THRESHOLD = 30; // 0–100

/** Relevance threshold for "about to sell out" heuristic. */
export const HIGH_RELEVANCE_THRESHOLD = 70; // 0–100

// ── Safety keywords (heuristic) ──────────────────────────────────────────────

const SAFETY_KEYWORDS = [
  "safety",
  "travel advisory",
  "vaccine",
  "visa requirement",
  "entry requirement",
  "travel warning",
  "covid",
  "health alert",
  "security alert",
  "evacuation",
  "natural disaster",
  "political unrest",
  "strike",
  "curfew",
];

function hasSafetySignal(title: string): boolean {
  const lower = title.toLowerCase();
  return SAFETY_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Heuristic: when an item is pending, high-confidence, and high-relevance,
 * it's likely in a "selling fast" category. Derive a rough remaining count
 * from the confidence and relevance scores (higher confidence + higher
 * relevance → fewer remaining, more urgency).
 */
function estimateRemainingCount(confidence: number, relevance: number): number {
  // Scale: 0–10 remaining, with higher confidence+relevance → lower count
  const raw = 10 - ((confidence + relevance) / 200) * 9;
  return Math.max(1, Math.round(raw));
}

// ── Core urgency computation ─────────────────────────────────────────────────

/**
 * Compute urgency for a single artifact, mode-aware.
 *
 * Priority order (first match wins):
 *   1. Safety issue + Prepare mode → Red
 *   2. Expired booking window → Red
 *   3. Sold-out / 0 remaining → Red
 *   4. Booking deadline ≤ 0 days → Red
 *   5. Booking deadline ≤ 7 days → Amber
 *   6. Pending + high confidence + high relevance → Amber (about to sell out)
 *   7. Stale data (≥ 30 days old) → Grey
 *   8. Unverified (pending + low confidence) → Grey
 *   9. Everything else → Green
 */
export function computeArtifactUrgency(
  artifact: UrgencyInput,
  mode: TripMode,
): ArtifactUrgency {
  const safety = hasSafetySignal(artifact.title);

  // ── Plan mode: only Grey matters ──────────────────────────────────────
  if (mode === "plan") {
    // In plan mode, stale or unverified items are Grey; everything else is Green
    if (isStale(artifact.fetchedAt)) {
      return greyResult("stale_data", "Needs fresh research", `Data fetched ${timeAgo(artifact.fetchedAt)} — may be out of date`);
    }
    if (artifact.status === "pending" && (artifact.confidence === null || artifact.confidence < LOW_CONFIDENCE_THRESHOLD)) {
      return greyResult("unverified_citation", "Needs verification", "Sage hasn't confirmed this yet — ask Sage to verify");
    }
    return greenResult();
  }

  // ── Prepare mode: full hierarchy ──────────────────────────────────────
  if (mode === "prepare") {
    // Red: safety issues
    if (safety) {
      return redResult("safety_issue", "Safety concern", "This item has a safety or health advisory — review before the trip");
    }

    // Red: expired booking window
    if (artifact.expiresAt && isExpired(artifact.expiresAt)) {
      return redResult("expired_booking_window", "Booking window closed", `Booking deadline was ${timeAgo(artifact.expiresAt)} — may no longer be available`);
    }

    // Red: imminent deadline (≤ 0 days)
    const deadlineDays = daysUntil(artifact.expiresAt);
    if (deadlineDays !== null && deadlineDays <= DEADLINE_RED_DAYS) {
      return redResult("expired_booking_window", "Book now — deadline passed", "This item's booking window has closed or is closing today");
    }

    // Amber: booking deadline within 7 days
    if (deadlineDays !== null && deadlineDays <= DEADLINE_AMBER_DAYS) {
      const remaining = estimateRemainingCount(
        artifact.confidence ?? 50,
        artifact.relevanceScore ?? 50,
      );
      return amberResult(
        "booking_deadline_approaching",
        `Book within ${deadlineDays} day${deadlineDays === 1 ? "" : "s"}`,
        `Booking deadline ${deadlineDays} day${deadlineDays === 1 ? "" : "s"} away`,
        deadlineDays,
        remaining,
      );
    }

    // Amber: about to sell out (pending + high confidence + high relevance)
    if (
      artifact.status === "pending" &&
      artifact.confidence !== null &&
      artifact.confidence >= LOW_CONFIDENCE_THRESHOLD &&
      artifact.relevanceScore !== null &&
      artifact.relevanceScore >= HIGH_RELEVANCE_THRESHOLD
    ) {
      const remaining = estimateRemainingCount(artifact.confidence, artifact.relevanceScore);
      return amberResult(
        "about_to_sell_out",
        remaining <= 3 ? `Book now — ${remaining} remaining` : `${remaining} left — book soon`,
        `High demand — approximately ${remaining} spots remaining`,
        null,
        remaining,
      );
    }

    // Grey: stale data
    if (isStale(artifact.fetchedAt)) {
      return greyResult("stale_data", "Stale — refresh", `Data from ${timeAgo(artifact.fetchedAt)} may be outdated`);
    }

    // Grey: unverified citation
    if (artifact.status === "pending" && (artifact.confidence === null || artifact.confidence < LOW_CONFIDENCE_THRESHOLD)) {
      return greyResult("unverified_citation", "Pending verification", "Sage hasn't confirmed this yet");
    }

    return greenResult();
  }

  // ── Go mode: only Red is prominent ────────────────────────────────────
  if (mode === "go") {
    // Safety issues are Red even in Go mode
    if (safety) {
      return redResult("safety_issue", "Safety concern", "Address this safety item now");
    }

    // Expired booking window is Red
    if (artifact.expiresAt && isExpired(artifact.expiresAt)) {
      return redResult("expired_booking_window", "Booking closed", "Booking deadline has passed");
    }

    // Imminent deadline is Red
    const deadlineDays = daysUntil(artifact.expiresAt);
    if (deadlineDays !== null && deadlineDays <= DEADLINE_RED_DAYS) {
      return redResult("expired_booking_window", "Act now", "Booking closes today");
    }

    // Amber: deadline within 7 days or about to sell out — still shown but
    // less prominent in Go mode
    if (deadlineDays !== null && deadlineDays <= DEADLINE_AMBER_DAYS) {
      const remaining = estimateRemainingCount(
        artifact.confidence ?? 50,
        artifact.relevanceScore ?? 50,
      );
      return amberResult(
        "booking_deadline_approaching",
        `${deadlineDays} day${deadlineDays === 1 ? "" : "s"} left`,
        `Booking deadline ${deadlineDays} day${deadlineDays === 1 ? "" : "s"} away`,
        deadlineDays,
        remaining,
      );
    }

    if (
      artifact.status === "pending" &&
      artifact.confidence !== null &&
      artifact.confidence >= LOW_CONFIDENCE_THRESHOLD &&
      artifact.relevanceScore !== null &&
      artifact.relevanceScore >= HIGH_RELEVANCE_THRESHOLD
    ) {
      const remaining = estimateRemainingCount(artifact.confidence, artifact.relevanceScore);
      return amberResult(
        "about_to_sell_out",
        remaining <= 3 ? `${remaining} remaining` : `${remaining} left`,
        `Estimated ${remaining} spots remaining`,
        null,
        remaining,
      );
    }

    // In Go mode, stale/unverified items are Green (hide the noise).
    // Only surface what needs action now.
    return greenResult();
  }

  // Fallback (should not be reached)
  return greenResult();
}

// ── Aggregate urgency ────────────────────────────────────────────────────────

export interface UrgencySummary {
  red: number;
  amber: number;
  green: number;
  grey: number;
  total: number;
  /** Items that need attention (red + amber). */
  needsAttention: number;
}

export function computeUrgencySummary(
  artifacts: UrgencyInput[],
  mode: TripMode,
): UrgencySummary {
  const counts = { red: 0, amber: 0, green: 0, grey: 0 };
  for (const artifact of artifacts) {
    const { level } = computeArtifactUrgency(artifact, mode);
    counts[level]++;
  }
  const total = artifacts.length;
  return {
    ...counts,
    total,
    needsAttention: counts.red + counts.amber,
  };
}

/**
 * Sort artifacts by urgency priority: Red → Amber → Grey → Green.
 * Within same level, preserve original order.
 */
export function sortByUrgency(artifacts: UrgencyInput[], mode: TripMode): { artifact: UrgencyInput; urgency: ArtifactUrgency }[] {
  const priority: Record<UrgencyLevel, number> = { red: 0, amber: 1, grey: 2, green: 3 };
  return artifacts
    .map((a) => ({ artifact: a, urgency: computeArtifactUrgency(a, mode) }))
    .sort((a, b) => priority[a.urgency.level] - priority[b.urgency.level]);
}

// ── Filter helpers ───────────────────────────────────────────────────────────

/** Get only items that need attention in the current mode. */
export function filterNeedsAttention(artifacts: UrgencyInput[], mode: TripMode): UrgencyInput[] {
  return artifacts.filter((a) => {
    const { level } = computeArtifactUrgency(a, mode);
    return level === "red" || level === "amber";
  });
}

/**
 * Sort pre-paired urgency entries by priority: Red → Amber → Grey → Green.
 * Within the same level, preserve original order (stable sort).
 */
export function sortUrgencyEntries<T>(
  entries: { artifact: T; urgency: ArtifactUrgency }[],
): { artifact: T; urgency: ArtifactUrgency }[] {
  const priority: Record<UrgencyLevel, number> = { red: 0, amber: 1, grey: 2, green: 3 };
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const diff = priority[a.entry.urgency.level] - priority[b.entry.urgency.level];
      // Stable: keep original order within the same priority
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map(({ entry }) => entry);
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function isStale(fetchedAt: string | null): boolean {
  if (!fetchedAt) return true; // never fetched = unknown = stale
  const age = Date.now() - new Date(fetchedAt).getTime();
  return age > STALE_THRESHOLD_MS || Number.isNaN(age);
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const date = new Date(dateStr).getTime();
  if (Number.isNaN(date)) return null;
  const now = Date.now();
  const diffMs = date - now;
  return Math.ceil(diffMs / 86_400_000);
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "unknown";
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

// ── Result constructors ──────────────────────────────────────────────────────

function redResult(
  reasonKey: UrgencyReason["reasonKey"],
  label: string,
  description: string,
): ArtifactUrgency {
  return {
    level: "red",
    reason: { level: "red", reasonKey, label, description },
    daysUntilDeadline: null,
    remainingCount: null,
  };
}

function amberResult(
  reasonKey: UrgencyReason["reasonKey"],
  label: string,
  description: string,
  daysUntilDeadline: number | null,
  remainingCount: number | null,
): ArtifactUrgency {
  return {
    level: "amber",
    reason: { level: "amber", reasonKey, label, description },
    daysUntilDeadline,
    remainingCount,
  };
}

function greenResult(): ArtifactUrgency {
  return {
    level: "green",
    reason: {
      level: "green",
      reasonKey: "on_track",
      label: "On track",
      description: "Everything is fine — no action needed",
    },
    daysUntilDeadline: null,
    remainingCount: null,
  };
}

function greyResult(
  reasonKey: UrgencyReason["reasonKey"],
  label: string,
  description: string,
): ArtifactUrgency {
  return {
    level: "grey",
    reason: { level: "grey", reasonKey, label, description },
    daysUntilDeadline: null,
    remainingCount: null,
  };
}
