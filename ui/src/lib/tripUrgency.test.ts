import { describe, expect, it } from "vitest";
import {
  computeArtifactUrgency,
  computeUrgencySummary,
  filterNeedsAttention,
  sortByUrgency,
  type UrgencyInput,
} from "./tripUrgency";
import type { TripMode } from "./tripMode";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeArtifact(overrides: Partial<UrgencyInput> = {}): UrgencyInput {
  return {
    status: "pending",
    confidence: null,
    relevanceScore: null,
    fetchedAt: new Date().toISOString(),
    expiresAt: null,
    sourceType: "web",
    title: "Florence walking tour",
    ...overrides,
  };
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString();
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("computeArtifactUrgency", () => {
  describe("Plan mode", () => {
    const mode: TripMode = "plan";

    it("returns green for fresh verified items", () => {
      const result = computeArtifactUrgency(
        makeArtifact({ status: "verified", confidence: 90, fetchedAt: daysAgo(1) }),
        mode,
      );
      expect(result.level).toBe("green");
    });

    it("returns grey for stale data", () => {
      const result = computeArtifactUrgency(
        makeArtifact({ status: "verified", confidence: 90, fetchedAt: daysAgo(31) }),
        mode,
      );
      expect(result.level).toBe("grey");
      expect(result.reason.reasonKey).toBe("stale_data");
    });

    it("returns grey for unverified citation (pending + low confidence)", () => {
      const result = computeArtifactUrgency(
        makeArtifact({ status: "pending", confidence: 20, fetchedAt: daysAgo(1) }),
        mode,
      );
      expect(result.level).toBe("grey");
      expect(result.reason.reasonKey).toBe("unverified_citation");
    });

    it("returns grey for pending with null confidence", () => {
      const result = computeArtifactUrgency(
        makeArtifact({ status: "pending", confidence: null, fetchedAt: daysAgo(1) }),
        mode,
      );
      expect(result.level).toBe("grey");
    });

    it("returns green for pending with high confidence (no urgency in plan mode)", () => {
      const result = computeArtifactUrgency(
        makeArtifact({ status: "pending", confidence: 85, relevanceScore: 80, fetchedAt: daysAgo(1) }),
        mode,
      );
      expect(result.level).toBe("green");
    });

    it("does not surface safety issues in plan mode", () => {
      const result = computeArtifactUrgency(
        makeArtifact({ status: "pending", title: "Travel advisory for Florence", fetchedAt: daysAgo(1) }),
        mode,
      );
      expect(result.level).toBe("grey"); // pending + null confidence = grey
    });
  });

  describe("Prepare mode", () => {
    const mode: TripMode = "prepare";

    it("returns red for safety issues", () => {
      const result = computeArtifactUrgency(
        makeArtifact({ status: "verified", title: "Travel advisory: Florence flood warning", fetchedAt: daysAgo(1) }),
        mode,
      );
      expect(result.level).toBe("red");
      expect(result.reason.reasonKey).toBe("safety_issue");
    });

    it("returns red for expired booking window", () => {
      const result = computeArtifactUrgency(
        makeArtifact({ status: "pending", expiresAt: daysAgo(1), fetchedAt: daysAgo(5) }),
        mode,
      );
      expect(result.level).toBe("red");
      expect(result.reason.reasonKey).toBe("expired_booking_window");
    });

    it("returns amber for deadline within 7 days", () => {
      const result = computeArtifactUrgency(
        makeArtifact({ status: "pending", expiresAt: daysFromNow(3), fetchedAt: daysAgo(1) }),
        mode,
      );
      expect(result.level).toBe("amber");
      expect(result.reason.reasonKey).toBe("booking_deadline_approaching");
      expect(result.daysUntilDeadline).toBe(3);
    });

    it("returns amber for high-confidence pending items about to sell out", () => {
      const result = computeArtifactUrgency(
        makeArtifact({ status: "pending", confidence: 85, relevanceScore: 90, fetchedAt: daysAgo(1) }),
        mode,
      );
      expect(result.level).toBe("amber");
      expect(result.reason.reasonKey).toBe("about_to_sell_out");
      expect(result.remainingCount).not.toBeNull();
    });

    it("returns grey for stale data", () => {
      const result = computeArtifactUrgency(
        makeArtifact({ status: "verified", fetchedAt: daysAgo(31) }),
        mode,
      );
      expect(result.level).toBe("grey");
      expect(result.reason.reasonKey).toBe("stale_data");
    });

    it("returns grey for unverified citation", () => {
      const result = computeArtifactUrgency(
        makeArtifact({ status: "pending", confidence: 10, fetchedAt: daysAgo(1) }),
        mode,
      );
      expect(result.level).toBe("grey");
    });

    it("returns green for fresh verified items with no deadlines", () => {
      const result = computeArtifactUrgency(
        makeArtifact({ status: "verified", confidence: 90, fetchedAt: daysAgo(1) }),
        mode,
      );
      expect(result.level).toBe("green");
    });

    it("safety beats other signals in prepare mode", () => {
      const result = computeArtifactUrgency(
        makeArtifact({
          status: "pending",
          title: "Travel advisory — Florence flood warning",
          expiresAt: daysFromNow(10), // not urgent by deadline
          confidence: 85,
          relevanceScore: 90,
          fetchedAt: daysAgo(1),
        }),
        mode,
      );
      expect(result.level).toBe("red");
      expect(result.reason.reasonKey).toBe("safety_issue");
    });
  });

  describe("Go mode", () => {
    const mode: TripMode = "go";

    it("returns red for safety issues", () => {
      const result = computeArtifactUrgency(
        makeArtifact({ status: "verified", title: "Visa requirement for Italy", fetchedAt: daysAgo(1) }),
        mode,
      );
      expect(result.level).toBe("red");
    });

    it("returns red for expired booking window", () => {
      const result = computeArtifactUrgency(
        makeArtifact({ status: "pending", expiresAt: daysAgo(2), fetchedAt: daysAgo(5) }),
        mode,
      );
      expect(result.level).toBe("red");
    });

    it("returns amber for deadline within 7 days", () => {
      const result = computeArtifactUrgency(
        makeArtifact({ status: "pending", expiresAt: daysFromNow(3), fetchedAt: daysAgo(1) }),
        mode,
      );
      expect(result.level).toBe("amber");
    });

    it("returns amber for about-to-sell-out items", () => {
      const result = computeArtifactUrgency(
        makeArtifact({ status: "pending", confidence: 85, relevanceScore: 90, fetchedAt: daysAgo(1) }),
        mode,
      );
      expect(result.level).toBe("amber");
    });

    it("returns green for stale data (hide noise in go mode)", () => {
      const result = computeArtifactUrgency(
        makeArtifact({ status: "verified", fetchedAt: daysAgo(31) }),
        mode,
      );
      expect(result.level).toBe("green");
    });

    it("returns green for unverified items (hide noise in go mode)", () => {
      const result = computeArtifactUrgency(
        makeArtifact({ status: "pending", confidence: null, fetchedAt: daysAgo(1) }),
        mode,
      );
      expect(result.level).toBe("green");
    });

    it("returns green for everything on track", () => {
      const result = computeArtifactUrgency(
        makeArtifact({ status: "verified", confidence: 90, fetchedAt: daysAgo(1) }),
        mode,
      );
      expect(result.level).toBe("green");
    });
  });
});

describe("computeUrgencySummary", () => {
  it("counts urgency levels correctly", () => {
    const artifacts: UrgencyInput[] = [
      makeArtifact({ status: "verified", fetchedAt: daysAgo(1) }), // green
      makeArtifact({ status: "pending", confidence: 85, relevanceScore: 90, fetchedAt: daysAgo(1) }), // amber
      makeArtifact({ status: "pending", title: "Safety: flood warning", fetchedAt: daysAgo(1) }), // red (safety)
      makeArtifact({ status: "pending", confidence: null, fetchedAt: daysAgo(1) }), // grey (plan) or depends on mode
    ];

    const summary = computeUrgencySummary(artifacts, "prepare");
    expect(summary.red).toBe(1);
    expect(summary.amber).toBe(1);
    // grey or green for the last one: pending + null confidence = grey
    expect(summary.grey).toBe(1);
    expect(summary.green).toBe(1);
    expect(summary.total).toBe(4);
    expect(summary.needsAttention).toBe(2);
  });

  it("returns zeros for empty input", () => {
    const summary = computeUrgencySummary([], "prepare");
    expect(summary).toEqual({ red: 0, amber: 0, green: 0, grey: 0, total: 0, needsAttention: 0 });
  });
});

describe("filterNeedsAttention", () => {
  it("returns only red and amber items", () => {
    const artifacts: UrgencyInput[] = [
      makeArtifact({ status: "verified", fetchedAt: daysAgo(1) }), // green
      makeArtifact({ status: "pending", confidence: 85, relevanceScore: 90, fetchedAt: daysAgo(1) }), // amber
      makeArtifact({ status: "pending", title: "Safety: flood warning", fetchedAt: daysAgo(1) }), // red
      makeArtifact({ status: "pending", confidence: null, fetchedAt: daysAgo(1) }), // grey
    ];

    const attention = filterNeedsAttention(artifacts, "prepare");
    expect(attention).toHaveLength(2);
  });

  it("returns empty when nothing needs attention", () => {
    const artifacts: UrgencyInput[] = [
      makeArtifact({ status: "verified", fetchedAt: daysAgo(1) }),
      makeArtifact({ status: "verified", fetchedAt: daysAgo(1) }),
    ];
    expect(filterNeedsAttention(artifacts, "prepare")).toHaveLength(0);
  });
});

describe("sortByUrgency", () => {
  it("sorts red → amber → grey → green", () => {
    const artifacts: UrgencyInput[] = [
      makeArtifact({ status: "verified", fetchedAt: daysAgo(1) }), // green
      makeArtifact({ status: "pending", confidence: 85, relevanceScore: 90, fetchedAt: daysAgo(1) }), // amber
      makeArtifact({ status: "pending", title: "Safety: flood warning", fetchedAt: daysAgo(1) }), // red
      makeArtifact({ status: "pending", confidence: null, fetchedAt: daysAgo(1) }), // grey
    ];

    const sorted = sortByUrgency(artifacts, "prepare");
    expect(sorted[0].urgency.level).toBe("red");
    expect(sorted[1].urgency.level).toBe("amber");
    expect(sorted[2].urgency.level).toBe("grey");
    expect(sorted[3].urgency.level).toBe("green");
  });
});
