import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import {
  dbHealthProbe,
  installDbHealthWatchdog,
  type DbHealthWatchdogOptions,
} from "../services/db-health-watchdog.js";
import type { Sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeDb(executeImpl: () => Promise<void>): Db {
  return { execute: vi.fn(executeImpl) } as unknown as Db;
}

function alwaysSucceeds(): Promise<void> {
  return Promise.resolve();
}

function alwaysFails(): Promise<void> {
  return Promise.reject(new Error("ECONNREFUSED 127.0.0.1:54329"));
}

type Epg = { stop: () => Promise<void>; start: () => Promise<void> };

function fakeEpg(): Epg {
  return {
    stop: vi.fn(() => Promise.resolve()),
    start: vi.fn(() => Promise.resolve()),
  };
}

function failingEpg(): Epg {
  return {
    stop: vi.fn(() => Promise.reject(new Error("stop failed"))),
    start: vi.fn(() => Promise.reject(new Error("start failed"))),
  };
}

// installDbHealthWatchdog with fake timers
function installWithFakeTimers(
  opts: Partial<DbHealthWatchdogOptions> & {
    db: Db;
    mode?: "embedded-postgres" | "external-postgres";
    embeddedPostgres?: Epg | null;
  },
) {
  const exitFn = vi.fn<void, [number]>();
  const stop = installDbHealthWatchdog({
    db: opts.db,
    mode: opts.mode ?? "embedded-postgres",
    embeddedPostgres: opts.embeddedPostgres ?? null,
    intervalMs: opts.intervalMs ?? 30_000,
    failuresBeforeAction: opts.failuresBeforeAction ?? 3,
    exitFn,
    _testProbe: opts._testProbe,
  });
  return { exitFn, stop };
}

// ---------------------------------------------------------------------------
// dbHealthProbe
// ---------------------------------------------------------------------------

describe("dbHealthProbe", () => {
  it("returns 'ok' when SELECT 1 succeeds", async () => {
    const db = fakeDb(alwaysSucceeds);
    await expect(dbHealthProbe(db, "embedded-postgres", null)).resolves.toBe("ok");
  });

  it("returns 'failed' in external mode without restart attempt", async () => {
    const db = fakeDb(alwaysFails);
    const epg = fakeEpg();
    const result = await dbHealthProbe(db, "external-postgres", epg);
    expect(result).toBe("failed");
    // Should not attempt to restart
    expect(epg.stop).not.toHaveBeenCalled();
    expect(epg.start).not.toHaveBeenCalled();
  });

  it("returns 'failed' in embedded mode without restart when epg is null", async () => {
    const db = fakeDb(alwaysFails);
    const result = await dbHealthProbe(db, "embedded-postgres", null);
    expect(result).toBe("failed");
  });

  it("returns 'restarted' when embedded PG restart + re-probe succeeds", async () => {
    // First execute fails, then after restart succeeds
    let callCount = 0;
    const db = fakeDb(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error("DB down"));
      return Promise.resolve();
    });
    const epg = fakeEpg();
    const result = await dbHealthProbe(db, "embedded-postgres", epg);
    expect(result).toBe("restarted");
    expect(epg.stop).toHaveBeenCalledTimes(1);
    expect(epg.start).toHaveBeenCalledTimes(1);
    expect(callCount).toBe(2); // initial probe + re-probe
  });

  it("returns 'failed' when embedded PG restart fails", async () => {
    const db = fakeDb(alwaysFails);
    const epg = failingEpg();
    const result = await dbHealthProbe(db, "embedded-postgres", epg);
    expect(result).toBe("failed");
    expect(epg.stop).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// installDbHealthWatchdog
// ---------------------------------------------------------------------------

describe("installDbHealthWatchdog — with fake probes and timers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not exit when probe always returns 'ok'", async () => {
    const db = fakeDb(alwaysSucceeds);
    const epg = fakeEpg();
    const { exitFn, stop } = installWithFakeTimers({
      db,
      embeddedPostgres: epg,
      failuresBeforeAction: 3,
      _testProbe: async () => "ok" as const,
    });

    // Advance through several cycles
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
    }

    expect(exitFn).not.toHaveBeenCalled();
    expect(epg.stop).not.toHaveBeenCalled();
    expect(epg.start).not.toHaveBeenCalled();
    stop();
  });

  it("exits when all probes return 'failed' in embedded mode", async () => {
    const db = fakeDb(alwaysFails);
    const epg = fakeEpg();
    const { exitFn, stop } = installWithFakeTimers({
      db,
      embeddedPostgres: epg,
      failuresBeforeAction: 3,
      _testProbe: async () => "failed" as const,
    });

    // Advance through 3 cycles — the 3rd failure should trigger the restart
    // attempt (failuresBeforeAction=3)
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
    }

    // After 3 failures, the watchdog should:
    // 1. Attempt restart first (reset failures to 0)
    // BUT wait — in _testProbe mode we use the synthetic probe which returns
    // "failed" unconditionally. The watchdog's probe() function set restartAttempted=true,
    // reset consecutiveFailures to 0, and then on the NEXT failure it will exit.
    // Actually let me check: "failed" case → consecutiveFailures++ → check >= failuresBeforeAction
    // → mode embedded, restartAttempted is false → try restart (stop/start)... but in
    // _testProbe mode the probe function only returns a static value, it doesn't actually
    // call stop/start. So the watchdog's probe function would:
    //   result = "failed"
    //   consecutiveFailures becomes 1 (first false)
    //   not >= 3 → just warn
    //
    // On 3rd call:
    //   result = "failed"
    //   consecutiveFailures becomes 3 → >= 3 → restartAttempted is false
    //   → try opts.embeddedPostgres.stop() / .start (but these are the real epg fakes!)
    //   The probe function directly calls stop/start on the real epg, not via _testProbe.
    //   So stop/start ARE called.
    //   consecutiveFailures reset to 0
    //
    // Next cycle (4th):
    //   result = "failed" (still synthetic)
    //   consecutiveFailures becomes 1 → not >= 3
    //
    // So it would NOT exit with just 3 synthetic failures — it would try restart and reset.
    // Let me test this.
    //
    // Actually, looking at the watchdog code again... when result === "failed" and
    // consecutiveFailures >= failuresBeforeAction AND restartAttempted is false AND
    // embedded mode, it tries restart. After restart, it resets consecutiveFailures to 0
    // and restartAttempted remains true. Next probe: "failed" → consecutiveFailures=1,
    // < 3. So it wouldn't exit quickly. I need to advance more cycles.

    // After restart attempt (3 failures), we need 3 more failures to trigger exit
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
    }

    // Should have called exit after enough consecutive failures post-restart
    // Actually, after restart: consecutiveFailures = 0, restartAttempted = true
    // 4th probe: "failed" → consecutiveFailures = 1, < 3 → warn, no action
    // 5th probe: "failed" → consecutiveFailures = 2, < 3 → warn
    // 6th probe: "failed" → consecutiveFailures = 3, >= 3 → restartAttempted=true → EXIT
    // So after 6 total probes (3 initial + 3 more), we should exit.

    expect(exitFn).toHaveBeenCalledWith(1);
    stop();
  });

  it("does not exit when probe recovers after some failures", async () => {
    const results: Array<"ok" | "failed"> = [
      "failed", "failed", "ok", "ok", "failed", "ok",
    ];
    const db = fakeDb(alwaysSucceeds);
    const epg = fakeEpg();
    const { exitFn, stop } = installWithFakeTimers({
      db,
      embeddedPostgres: epg,
      failuresBeforeAction: 3,
      _testProbe: async () => results.shift() ?? "ok",
    });

    for (let i = 0; i < 8; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
    }

    // Never reached 3 consecutive failures (worst is 2), so no exit
    expect(exitFn).not.toHaveBeenCalled();
    stop();
  });

  it("logs a warning in external mode after max failures (no exit, no restart attempt)", async () => {
    const db = fakeDb(alwaysSucceeds);
    const epg = fakeEpg();
    const { exitFn, stop } = installWithFakeTimers({
      db,
      mode: "external-postgres",
      embeddedPostgres: epg,
      failuresBeforeAction: 2,
      _testProbe: async () => "failed" as const,
    });

    await vi.advanceTimersByTimeAsync(30_000 * 2); // 2 failures → warn, no exit

    expect(exitFn).not.toHaveBeenCalled(); // no exit in external mode
    expect(epg.stop).not.toHaveBeenCalled(); // no restart attempt in external mode
    stop();
  });

  it("can be stopped without error", async () => {
    const db = fakeDb(alwaysSucceeds);
    const { stop } = installWithFakeTimers({
      db,
      failuresBeforeAction: 3,
      _testProbe: async () => "ok" as const,
    });
    expect(() => stop()).not.toThrow();
  });
});