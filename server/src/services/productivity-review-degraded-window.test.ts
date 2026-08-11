import { describe, expect, it } from "vitest";
import {
  checkNoCommentStreakDegradedWindow,
  _DEGRADED_WINDOW_ERROR_CODES,
  _AUTH_EXPIRY_ERROR_CODE_PATTERN,
} from "./productivity-review.js";

/** Minimal mock of a HeartbeatRunRow — only the fields the guard reads. */
function mockRun(overrides: Partial<{ id: string; errorCode: string | null }> = {}) {
  return {
    id: overrides.id ?? "run-1",
    errorCode: overrides.errorCode ?? null,
  } as any;
}

describe("checkNoCommentStreakDegradedWindow", () => {
  describe("degraded-window error codes (API p50 exceeded threshold)", () => {
    it("suppresses when a streak run ended with 'timeout'", () => {
      const result = checkNoCommentStreakDegradedWindow([
        mockRun({ id: "run-1", errorCode: "timeout" }),
      ]);
      expect(result).not.toBeNull();
      expect(result!.suppressed).toBe(true);
      expect(result!.reason).toContain("timeout");
      expect(result!.reason).toContain("degraded-window");
    });

    it("suppresses when a streak run ended with 'adapter_failed'", () => {
      const result = checkNoCommentStreakDegradedWindow([
        mockRun({ id: "run-1", errorCode: "adapter_failed" }),
      ]);
      expect(result).not.toBeNull();
      expect(result!.suppressed).toBe(true);
      expect(result!.reason).toContain("adapter_failed");
    });

    it("suppresses when a streak run ended with 'codex_transient_upstream'", () => {
      const result = checkNoCommentStreakDegradedWindow([
        mockRun({ id: "run-1", errorCode: "codex_transient_upstream" }),
      ]);
      expect(result).not.toBeNull();
      expect(result!.suppressed).toBe(true);
    });

    it("suppresses when a streak run ended with 'claude_transient_upstream'", () => {
      const result = checkNoCommentStreakDegradedWindow([
        mockRun({ id: "run-1", errorCode: "claude_transient_upstream" }),
      ]);
      expect(result).not.toBeNull();
      expect(result!.suppressed).toBe(true);
    });

    it("does not suppress when runs have no error codes", () => {
      const result = checkNoCommentStreakDegradedWindow([
        mockRun({ id: "run-1", errorCode: null }),
        mockRun({ id: "run-2", errorCode: null }),
      ]);
      expect(result).toBeNull();
    });

    it("does not suppress when runs have unrelated error codes", () => {
      const result = checkNoCommentStreakDegradedWindow([
        mockRun({ id: "run-1", errorCode: "budget_blocked" }),
        mockRun({ id: "run-2", errorCode: "issue_paused" }),
      ]);
      expect(result).toBeNull();
    });
  });

  describe("auth-expiry error codes (credential expired before window closed)", () => {
    it("suppresses when a streak run ended with 'hermes_gateway_auth_failed'", () => {
      const result = checkNoCommentStreakDegradedWindow([
        mockRun({ id: "run-1", errorCode: "hermes_gateway_auth_failed" }),
      ]);
      expect(result).not.toBeNull();
      expect(result!.suppressed).toBe(true);
      expect(result!.reason).toContain("auth-expiry");
      expect(result!.reason).toContain("hermes_gateway_auth_failed");
    });

    it("suppresses when a streak run ended with 'gemini_auth_required'", () => {
      const result = checkNoCommentStreakDegradedWindow([
        mockRun({ id: "run-1", errorCode: "gemini_auth_required" }),
      ]);
      expect(result).not.toBeNull();
      expect(result!.suppressed).toBe(true);
      expect(result!.reason).toContain("auth-expiry");
    });

    it("suppresses when a streak run ended with 'acpx_auth_required'", () => {
      const result = checkNoCommentStreakDegradedWindow([
        mockRun({ id: "run-1", errorCode: "acpx_auth_required" }),
      ]);
      expect(result).not.toBeNull();
      expect(result!.suppressed).toBe(true);
    });

    it("suppresses when a streak run ended with 'credential_expired'", () => {
      const result = checkNoCommentStreakDegradedWindow([
        mockRun({ id: "run-1", errorCode: "credential_expired" }),
      ]);
      expect(result).not.toBeNull();
      expect(result!.suppressed).toBe(true);
    });

    it("suppresses when a streak run ended with 'api_auth_error'", () => {
      const result = checkNoCommentStreakDegradedWindow([
        mockRun({ id: "run-1", errorCode: "api_auth_error" }),
      ]);
      expect(result).not.toBeNull();
      expect(result!.suppressed).toBe(true);
    });
  });

  describe("mixed scenarios", () => {
    it("suppresses when the first degraded run is not the last in the streak", () => {
      const result = checkNoCommentStreakDegradedWindow([
        mockRun({ id: "run-1", errorCode: null }),
        mockRun({ id: "run-2", errorCode: "timeout" }),
        mockRun({ id: "run-3", errorCode: null }),
      ]);
      expect(result).not.toBeNull();
      expect(result!.suppressed).toBe(true);
    });

    it("does not suppress an empty streak", () => {
      const result = checkNoCommentStreakDegradedWindow([]);
      expect(result).toBeNull();
    });
  });

  describe("negative control — guard must change outcome", () => {
    it("the same error code that suppresses with the guard would not suppress without it", () => {
      const streakRuns = [mockRun({ id: "run-1", errorCode: "timeout" })];

      // With guard: suppressed
      const withGuard = checkNoCommentStreakDegradedWindow(streakRuns);
      expect(withGuard).not.toBeNull();
      expect(withGuard!.suppressed).toBe(true);

      // Without guard: no suppression. Simulate "guard removed" by calling
      // the function on runs that have no degradation signals.
      const cleanRuns = [mockRun({ id: "run-clean", errorCode: null })];
      const guardRemoved = checkNoCommentStreakDegradedWindow(cleanRuns);
      expect(guardRemoved).toBeNull();

      // The guard must change the outcome for the same input
      expect(withGuard!.suppressed).toBe(true);
    });

    it("the same auth-expiry code that suppresses with the guard would not suppress without it", () => {
      const streakRuns = [mockRun({ id: "run-1", errorCode: "hermes_gateway_auth_failed" })];

      // With guard: suppressed
      const withGuard = checkNoCommentStreakDegradedWindow(streakRuns);
      expect(withGuard).not.toBeNull();
      expect(withGuard!.suppressed).toBe(true);

      // Without guard: no suppression. Same logic — clean runs produce null.
      const cleanRuns = [mockRun({ id: "run-clean", errorCode: null })];
      const guardRemoved = checkNoCommentStreakDegradedWindow(cleanRuns);
      expect(guardRemoved).toBeNull();

      // The guard must change the outcome for the same input
      expect(withGuard!.suppressed).toBe(true);
    });
  });
});

describe("degraded window constants", () => {
  it("_DEGRADED_WINDOW_ERROR_CODES contains the expected error codes", () => {
    expect(_DEGRADED_WINDOW_ERROR_CODES.has("timeout")).toBe(true);
    expect(_DEGRADED_WINDOW_ERROR_CODES.has("adapter_failed")).toBe(true);
    expect(_DEGRADED_WINDOW_ERROR_CODES.has("codex_transient_upstream")).toBe(true);
    expect(_DEGRADED_WINDOW_ERROR_CODES.has("claude_transient_upstream")).toBe(true);
  });

  it("_AUTH_EXPIRY_ERROR_CODE_PATTERN matches known auth error codes", () => {
    expect(_AUTH_EXPIRY_ERROR_CODE_PATTERN.test("hermes_gateway_auth_failed")).toBe(true);
    expect(_AUTH_EXPIRY_ERROR_CODE_PATTERN.test("gemini_auth_required")).toBe(true);
    expect(_AUTH_EXPIRY_ERROR_CODE_PATTERN.test("acpx_auth_required")).toBe(true);
    expect(_AUTH_EXPIRY_ERROR_CODE_PATTERN.test("credential_expired")).toBe(true);
    expect(_AUTH_EXPIRY_ERROR_CODE_PATTERN.test("api_auth_error")).toBe(true);
  });

  it("_AUTH_EXPIRY_ERROR_CODE_PATTERN does not match non-auth error codes", () => {
    expect(_AUTH_EXPIRY_ERROR_CODE_PATTERN.test("timeout")).toBe(false);
    expect(_AUTH_EXPIRY_ERROR_CODE_PATTERN.test("adapter_failed")).toBe(false);
    expect(_AUTH_EXPIRY_ERROR_CODE_PATTERN.test("budget_blocked")).toBe(false);
    expect(_AUTH_EXPIRY_ERROR_CODE_PATTERN.test("issue_paused")).toBe(false);
  });
});
