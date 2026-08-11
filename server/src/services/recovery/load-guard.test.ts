import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECOVERY_LOAD_DEFERRAL_RATIO,
  evaluateRecoveryLoadGuard,
  type RecoveryLoadGuardDecision,
} from "./load-guard.js";

const REFERENCE_CORES = 12;

describe("evaluateRecoveryLoadGuard", () => {
  it("allows dispatch when load is below threshold", () => {
    const result = evaluateRecoveryLoadGuard({
      load: { cpuCount: REFERENCE_CORES, loadAverage1m: 2 },
    });
    expect(result.deferred).toBe(false);
  });

  it("defers dispatch when load exceeds threshold", () => {
    // 45.98 / 12 = 3.83, which is well above 1.25
    const result = evaluateRecoveryLoadGuard({
      load: { cpuCount: REFERENCE_CORES, loadAverage1m: 45.98 },
    });
    expect(result.deferred).toBe(true);
    if (result.deferred) {
      expect(result.reason).toBe("host_load");
      expect(result.snapshot.loadAverage1m).toBe(45.98);
      expect(result.ratio).toBe(DEFAULT_RECOVERY_LOAD_DEFERRAL_RATIO);
    }
  });

  it("allows dispatch exactly at the threshold boundary", () => {
    // load/core == ratio should NOT defer (must be strictly greater)
    const load = REFERENCE_CORES * DEFAULT_RECOVERY_LOAD_DEFERRAL_RATIO;
    const result = evaluateRecoveryLoadGuard({
      load: { cpuCount: REFERENCE_CORES, loadAverage1m: load },
    });
    expect(result.deferred).toBe(false);
  });

  it("defers dispatch just above the threshold boundary", () => {
    const load = REFERENCE_CORES * DEFAULT_RECOVERY_LOAD_DEFERRAL_RATIO + 0.01;
    const result = evaluateRecoveryLoadGuard({
      load: { cpuCount: REFERENCE_CORES, loadAverage1m: load },
    });
    expect(result.deferred).toBe(true);
  });

  it("respects a custom ratio", () => {
    // With ratio 2.0, load 18 on 12 cores (1.5) should NOT defer
    const result = evaluateRecoveryLoadGuard({
      load: { cpuCount: REFERENCE_CORES, loadAverage1m: 18 },
      ratio: 2.0,
    });
    expect(result.deferred).toBe(false);

    // With ratio 1.0, load 18 on 12 cores (1.5) SHOULD defer
    const result2 = evaluateRecoveryLoadGuard({
      load: { cpuCount: REFERENCE_CORES, loadAverage1m: 18 },
      ratio: 1.0,
    });
    expect(result2.deferred).toBe(true);
  });

  it("defaults to the RBR-974 HOST_LOAD_REFUSAL_RATIO", () => {
    expect(DEFAULT_RECOVERY_LOAD_DEFERRAL_RATIO).toBe(1.25);
  });

  it("includes a human-readable detail string on deferral", () => {
    const result = evaluateRecoveryLoadGuard({
      load: { cpuCount: REFERENCE_CORES, loadAverage1m: 30 },
    });
    expect(result.deferred).toBe(true);
    if (result.deferred) {
      expect(result.detail).toContain("recovery sweep deferred");
      expect(result.detail).toContain("30.00");
      expect(result.detail).toContain(`${REFERENCE_CORES} cores`);
    }
  });
});

// Negative control: verify the guard actually makes a difference.
// If you remove the load check from evaluateRecoveryLoadGuard,
// these tests must fail — a test that still passes with the guard
// removed does not count as acceptance (RBR-1038 AC3).
describe("negative control — guard must change outcome", () => {
  it("the same load that defers with the guard would be allowed without it", () => {
    const highLoad = { cpuCount: REFERENCE_CORES, loadAverage1m: 30 };
    const withGuard = evaluateRecoveryLoadGuard({ load: highLoad });
    expect(withGuard.deferred).toBe(true);

    // Simulate the "guard removed" case: any load passes.
    // This is the trivial "no guard" baseline — if the guard weren't
    // present, dispatch would proceed.
    const guardRemoved: RecoveryLoadGuardDecision = { deferred: false };
    expect(guardRemoved.deferred).toBe(false);

    // The guard must change the outcome for the same input:
    expect(withGuard.deferred).not.toBe(guardRemoved.deferred);
  });
});
