import { afterEach, describe, expect, it, vi } from "vitest";

describe("telemetry graceful degradation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("getTelemetryClient returns null before initTelemetry is called", async () => {
    vi.resetModules();
    const { getTelemetryClient } = await import("./telemetry.js");
    expect(getTelemetryClient()).toBeNull();
  });

  it("initTelemetry returns null when telemetry is disabled via fileConfig", async () => {
    vi.resetModules();
    const { initTelemetry, getTelemetryClient } = await import("./telemetry.js");
    const result = initTelemetry({ enabled: false });
    expect(result).toBeNull();
    expect(getTelemetryClient()).toBeNull();
  });

  it("initTelemetry returns null when PAPERCLIP_TELEMETRY_DISABLED=1", async () => {
    vi.stubEnv("PAPERCLIP_TELEMETRY_DISABLED", "1");
    vi.resetModules();
    const { initTelemetry, getTelemetryClient } = await import("./telemetry.js");
    const result = initTelemetry();
    expect(result).toBeNull();
    expect(getTelemetryClient()).toBeNull();
  });

  it("initTelemetry returns null when DO_NOT_TRACK=1", async () => {
    vi.stubEnv("DO_NOT_TRACK", "1");
    vi.resetModules();
    const { initTelemetry, getTelemetryClient } = await import("./telemetry.js");
    const result = initTelemetry();
    expect(result).toBeNull();
    expect(getTelemetryClient()).toBeNull();
  });

  it("getTelemetryClient returns null when initTelemetry was never called successfully", async () => {
    // Even after a failed init, getTelemetryClient should return null
    vi.resetModules();
    const { initTelemetry, getTelemetryClient } = await import("./telemetry.js");
    initTelemetry({ enabled: false });
    expect(getTelemetryClient()).toBeNull();

    // Also verify that a subsequent call to initTelemetry with disabled config
    // still returns null (client was never set)
    const result2 = initTelemetry({ enabled: false });
    expect(result2).toBeNull();
  });
});
