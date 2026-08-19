import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * VOY-1435 — the VAPID expired-endpoint warn dedup cache must stay bounded.
 * Regression tests for the FIFO-evicting Map that replaced the unbounded
 * module-level Set (memory leak: one ~300-char endpoint URL retained forever
 * per unique expired subscription).
 */
describe("VAPID expired-endpoint warn dedup (bounded)", () => {
  beforeEach(() => {
    // Fresh module instance per test so the module-level dedup cache does
    // not leak state between tests.
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function freshNotificationsModule() {
    return await import("./notifications.js");
  }

  it("warns once per endpoint (dedup) and re-warns for a different endpoint", async () => {
    const { shouldWarnExpiredEndpoint } = await freshNotificationsModule();

    expect(shouldWarnExpiredEndpoint("https://push.example.com/a")).toBe(true);
    // Same endpoint sighting again → suppressed
    expect(shouldWarnExpiredEndpoint("https://push.example.com/a")).toBe(false);
    // Different endpoint → new warn
    expect(shouldWarnExpiredEndpoint("https://push.example.com/b")).toBe(true);
  });

  it("keeps size bounded at the cap and evicts the oldest endpoint (FIFO)", async () => {
    const { shouldWarnExpiredEndpoint } = await freshNotificationsModule();
    const MAX = 10_000;

    // Fill the cache to capacity with unique endpoints.
    for (let i = 0; i < MAX; i++) {
      expect(shouldWarnExpiredEndpoint(`https://push.example.com/${i}`)).toBe(true);
    }

    // Oldest entry still resident → suppressed.
    expect(shouldWarnExpiredEndpoint("https://push.example.com/0")).toBe(false);

    // A brand-new endpoint at capacity evicts the oldest (FIFO)...
    expect(shouldWarnExpiredEndpoint("https://push.example.com/never-seen")).toBe(true);

    // ...so the previously-evicted endpoint warns again, while a still-resident
    // endpoint is still suppressed.
    expect(shouldWarnExpiredEndpoint("https://push.example.com/0")).toBe(true);
    expect(shouldWarnExpiredEndpoint("https://push.example.com/2")).toBe(false);
  });
});
