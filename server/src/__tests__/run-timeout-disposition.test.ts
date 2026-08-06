import { describe, expect, it } from "vitest";

import {
  buildRunVerificationDispositionMetadata,
  buildUnverifiedTimeoutNotice,
  classifyRunVerificationDisposition,
  isWallClockExhaustedRun,
} from "../services/recovery/run-timeout-disposition.js";

// RBR-937 AC4 — a run that died on the wall clock proved nothing about the code.
// RBR-912 burned four consecutive timed-out runs on an already-correct fix
// because the recovery notice read as an engineering failure.

describe("run timeout disposition", () => {
  it("treats a timed_out run as wall-clock exhaustion", () => {
    expect(isWallClockExhaustedRun({ status: "timed_out" })).toBe(true);
  });

  it("recognizes timeout error codes even when the status does not say so", () => {
    expect(isWallClockExhaustedRun({ status: "failed", errorCode: "timeout" })).toBe(true);
    expect(isWallClockExhaustedRun({ status: "failed", errorCode: "wall_clock_exceeded" })).toBe(true);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(isWallClockExhaustedRun({ status: " TIMED_OUT " })).toBe(true);
    expect(isWallClockExhaustedRun({ status: "failed", errorCode: " Timeout " })).toBe(true);
  });

  it("does not claim wall-clock exhaustion for genuine failures", () => {
    expect(isWallClockExhaustedRun({ status: "failed" })).toBe(false);
    expect(isWallClockExhaustedRun({ status: "failed", errorCode: "assertion_failed" })).toBe(false);
    expect(isWallClockExhaustedRun({ status: "cancelled" })).toBe(false);
    expect(isWallClockExhaustedRun({ status: "succeeded" })).toBe(false);
    expect(isWallClockExhaustedRun(null)).toBe(false);
    expect(isWallClockExhaustedRun(undefined)).toBe(false);
    expect(isWallClockExhaustedRun({})).toBe(false);
  });

  it("classifies a timeout as unverified rather than indeterminate", () => {
    expect(classifyRunVerificationDisposition({ status: "timed_out" })).toBe("unverified_timeout");
    expect(classifyRunVerificationDisposition({ status: "failed" })).toBe("indeterminate");
  });

  describe("the clarifying notice", () => {
    it("says UNVERIFIED, not broken, and never asserts a defect", () => {
      const notice = buildUnverifiedTimeoutNotice({ status: "timed_out" });

      expect(notice).toBeTruthy();
      expect(notice).toContain("UNVERIFIED");
      expect(notice).toContain("not known to be broken");
      expect(notice).toContain("a timeout is not evidence of a defect");
    });

    it("tells the reader to check the working tree before re-paying the cost", () => {
      const notice = buildUnverifiedTimeoutNotice({ status: "timed_out" }) ?? "";

      // This is the specific loop RBR-912 fell into: retry, re-pay, die again.
      expect(notice).toContain("already complete");
      expect(notice).toContain("working tree");
    });

    it("points at the detached harness as the concrete alternative to an inline retry", () => {
      const notice = buildUnverifiedTimeoutNotice({ status: "timed_out" }) ?? "";

      expect(notice).toContain("scripts/detached-verify.sh");
      expect(notice).toContain("next");
    });

    it("leaves non-timeout messaging completely unchanged", () => {
      expect(buildUnverifiedTimeoutNotice({ status: "failed" })).toBeNull();
      expect(buildUnverifiedTimeoutNotice({ status: "cancelled" })).toBeNull();
      expect(buildUnverifiedTimeoutNotice({ status: "succeeded" })).toBeNull();
      expect(buildUnverifiedTimeoutNotice(null)).toBeNull();
    });
  });

  describe("structured metadata", () => {
    it("marks a timed-out run as timedOut and never as known-broken", () => {
      const metadata = buildRunVerificationDispositionMetadata({ status: "timed_out" });

      expect(metadata.verificationDisposition).toBe("unverified_timeout");
      expect(metadata.timedOut).toBe(true);
      expect(metadata.changeKnownBroken).toBe(false);
    });

    it("stays indeterminate for other outcomes, and still never asserts brokenness", () => {
      const metadata = buildRunVerificationDispositionMetadata({ status: "failed" });

      expect(metadata.verificationDisposition).toBe("indeterminate");
      expect(metadata.timedOut).toBe(false);
      // Recovery escalation is about a missing execution path, not a proven defect.
      expect(metadata.changeKnownBroken).toBe(false);
    });

    it("is safe on a missing run", () => {
      const metadata = buildRunVerificationDispositionMetadata(null);

      expect(metadata.verificationDisposition).toBe("indeterminate");
      expect(metadata.timedOut).toBe(false);
    });
  });
});
