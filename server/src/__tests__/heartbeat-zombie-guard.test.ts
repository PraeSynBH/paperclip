import { describe, expect, it } from "vitest";
import {
  isZombieRun,
  filterZombieCoalesceTarget,
} from "../services/heartbeat.ts";

// ---------------------------------------------------------------------------
// isZombieRun — the core predicate
// ---------------------------------------------------------------------------
describe("isZombieRun", () => {
  it("returns true for a running run not tracked in runningProcesses", async () => {
    const run = { status: "running", id: "run-1" };
    const tracked = new Map<string, unknown>();

    expect(await isZombieRun(run, tracked)).toBe(true);
  });

  it("returns false for a queued run not tracked in runningProcesses", async () => {
    const run = { status: "queued", id: "run-2" };
    const tracked = new Map<string, unknown>();

    expect(await isZombieRun(run, tracked)).toBe(false);
  });

  it("returns false for a running run that IS tracked in runningProcesses", async () => {
    const run = { status: "running", id: "run-3" };
    const tracked = new Map<string, unknown>([["run-3", { pid: 12345 }]]);

    expect(await isZombieRun(run, tracked)).toBe(false);
  });

  it("returns false for a failed run not tracked in runningProcesses", async () => {
    const run = { status: "failed", id: "run-4" };
    const tracked = new Map<string, unknown>();

    expect(await isZombieRun(run, tracked)).toBe(false);
  });

  it("returns false for a completed run not tracked in runningProcesses", async () => {
    const run = { status: "completed", id: "run-5" };
    const tracked = new Map<string, unknown>();

    expect(await isZombieRun(run, tracked)).toBe(false);
  });

  // ── DB-backed restart scenario ────────────────────────────────────────
  it("returns false after simulated restart when the run exists in DB (isZombieRun)", async () => {
    // After a restart, runningProcesses is empty, but the DB still has the
    // run with a non-terminal status. An async has() simulating a DB query
    // should return true, so the run is NOT considered a zombie.
    const run = { status: "running", id: "restart-run-1" };
    const dbTracked = {
      async has(id: string) {
        return id === "restart-run-1";
      },
    };

    expect(await isZombieRun(run, dbTracked)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// filterZombieCoalesceTarget — the coalescing guard used in both paths
//
// These tests exercise the BEHAVIOR described in spec AC2 and AC3:
// "Coalescing does not refresh updatedAt on zombie runs"
// When the target is a zombie, the filter returns null so the wakeup
// falls through to create a new queued run instead of merging into the dead one.
// ---------------------------------------------------------------------------
describe("filterZombieCoalesceTarget", () => {
  // Bug 1 scenario: a "running" run with no live process is a zombie.
  // Coalescing into it would refresh updatedAt, making it immortal.
  it("returns null for a zombie running run (the critical bug fix)", async () => {
    const zombieRun = { status: "running", id: "zombie-1" };
    const emptyTracked = new Map<string, unknown>();

    expect(await filterZombieCoalesceTarget(zombieRun, emptyTracked)).toBeNull();
  });

  // Legitimate running process — coalescing should proceed normally.
  it("passes through a legitimate running run that IS tracked", async () => {
    const liveRun = { status: "running", id: "live-1" };
    const tracked = new Map<string, unknown>([["live-1", { pid: 99 }]]);

    expect(await filterZombieCoalesceTarget(liveRun, tracked)).toBe(liveRun);
  });

  // Queued runs don't have processes yet — they must always pass through.
  // isZombieRun only flags "running" status, so queued runs are safe.
  it("passes through a queued run not tracked (queued runs are not zombies)", async () => {
    const queuedRun = { status: "queued", id: "queued-1" };
    const emptyTracked = new Map<string, unknown>();

    expect(await filterZombieCoalesceTarget(queuedRun, emptyTracked)).toBe(queuedRun);
  });

  // null target means no candidate to coalesce into — pass through.
  it("passes through null target unchanged", async () => {
    const tracked = new Map<string, unknown>();

    expect(await filterZombieCoalesceTarget(null, tracked)).toBeNull();
  });

  // Terminal states should never appear as coalesce targets, but if they do,
  // they should pass through (they're not zombies — they're done).
  it("passes through a failed run (terminal state, not a zombie)", async () => {
    const failedRun = { status: "failed", id: "failed-1" };
    const emptyTracked = new Map<string, unknown>();

    expect(await filterZombieCoalesceTarget(failedRun, emptyTracked)).toBe(failedRun);
  });

  it("passes through a completed run (terminal state, not a zombie)", async () => {
    const completedRun = { status: "completed", id: "done-1" };
    const emptyTracked = new Map<string, unknown>();

    expect(await filterZombieCoalesceTarget(completedRun, emptyTracked)).toBe(completedRun);
  });

  // Regression guard: after server restart, runningProcesses is empty.
  // Multiple zombie runs should all be filtered to null.
  it("filters multiple zombie runs independently (post-restart scenario)", async () => {
    const emptyTracked = new Map<string, unknown>();
    const zombie1 = { status: "running", id: "z1" };
    const zombie2 = { status: "running", id: "z2" };

    expect(await filterZombieCoalesceTarget(zombie1, emptyTracked)).toBeNull();
    expect(await filterZombieCoalesceTarget(zombie2, emptyTracked)).toBeNull();
  });

  // Mixed scenario: one zombie, one live. Only the zombie is filtered.
  it("correctly distinguishes zombie from live when multiple runs exist", async () => {
    const tracked = new Map<string, unknown>([["live-1", { pid: 42 }]]);
    const zombie = { status: "running", id: "zombie-1" };
    const live = { status: "running", id: "live-1" };

    expect(await filterZombieCoalesceTarget(zombie, tracked)).toBeNull();
    expect(await filterZombieCoalesceTarget(live, tracked)).toBe(live);
  });

  // ── DB-backed restart scenario ────────────────────────────────────────
  it("passes through a running run after simulated restart (DB has the run)", async () => {
    // After restart, runningProcesses is empty but the DB still has the run
    // with a non-terminal status. An async has() simulating a DB query
    // should return true, so the run passes through (not a zombie).
    const run = { status: "running", id: "restart-run" };
    const dbTracked = {
      async has(id: string) {
        return id === "restart-run";
      },
    };

    expect(await filterZombieCoalesceTarget(run, dbTracked)).toBe(run);
  });

  it("still filters a zombie when DB-backed has() returns false", async () => {
    // If the run ID is not found in the DB (e.g., it was cleaned up or never
    // existed), an async has() should return false, treating it as a zombie.
    const run = { status: "running", id: "unknown-run" };
    const dbTracked = {
      async has(_id: string) {
        return false;
      },
    };

    expect(await filterZombieCoalesceTarget(run, dbTracked)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cache semantics (VOY-1365 H-3 fix): verify the caching layer used by
// liveRunExecutions — cache only false results, never true; bounded eviction.
// These tests simulate the same caching logic that heartbeat.ts uses so the
// behavioral invariant is exercised in isolation.
// ---------------------------------------------------------------------------
describe("zombie-cache semantics (VOY-1365 H-3)", () => {
  const MAX = 10;
  const TTL = 30_000;

  /** Creates a cache object that mimics liveRunExecutions.has() semantics:
   *  - false results are cached (UUIDs never reused — stable)
   *  - true results are NEVER cached (run could go terminal)
   *  - evicts oldest entries at MAX capacity
   */
  function makeCache(backing: Map<string, boolean>) {
    const _cache = new Map<string, { result: boolean; cachedAt: number }>();
    return {
      _cache,
      async has(id: string): Promise<boolean> {
        const cached = _cache.get(id);
        if (cached && !cached.result && Date.now() - cached.cachedAt < TTL) {
          return cached.result;
        }
        const result = backing.has(id);
        if (!result) {
          if (_cache.size >= MAX) {
            const firstKey = _cache.keys().next().value;
            if (firstKey) _cache.delete(firstKey);
          }
          _cache.set(id, { result: false, cachedAt: Date.now() });
        }
        return result;
      },
    };
  }

  it("caches only false results — true results are re-queried each call", async () => {
    const backing = new Map<string, boolean>([["run-keep-alive", true]]);
    const cache = makeCache(backing);

    // First call: run is alive → true, NOT cached
    expect(await cache.has("run-keep-alive")).toBe(true);
    expect(cache._cache.has("run-keep-alive")).toBe(false);

    // Manually "transition" the run to terminal in backing store
    backing.delete("run-keep-alive");

    // Second call: because true was NOT cached, we re-query backing
    // and get false — the run is now properly detected as zombie
    expect(await cache.has("run-keep-alive")).toBe(false);
  });

  it("caches false results — subsequent calls skip backing store", async () => {
    const backing = new Map<string, boolean>();
    const cache = makeCache(backing);

    // First call: run not found → false, cached
    expect(await cache.has("missing-run")).toBe(false);
    expect(cache._cache.has("missing-run")).toBe(true);

    // Modify backing store (simulate run appearing) — cache should ignore it
    backing.set("missing-run", true);
    expect(await cache.has("missing-run")).toBe(false);
  });

  it("evicts oldest entry at MAX capacity when caching a false result", async () => {
    const backing = new Map<string, boolean>();
    const cache = makeCache(backing);
    const ids = Array.from({ length: MAX + 1 }, (_, i) => `r-${i}`);

    // Fill cache with MAX false results (ids 0..9)
    for (const id of ids.slice(0, MAX)) {
      expect(await cache.has(id)).toBe(false);
    }
    expect(cache._cache.size).toBe(MAX);

    // Oldest key should be the first one inserted
    const oldestKey = ids[0];
    expect(cache._cache.has(oldestKey)).toBe(true);

    // Add one more — triggers eviction of oldest
    expect(await cache.has(ids[MAX])).toBe(false);
    expect(cache._cache.size).toBe(MAX);
    // Oldest entry should have been evicted
    expect(cache._cache.has(oldestKey)).toBe(false);
    // Newest entry should be present
    expect(cache._cache.has(ids[MAX])).toBe(true);
  });

  it("implements filterZombieCoalesceTarget correctly with false-caching tracked object", async () => {
    const backing = new Map<string, boolean>();
    const cache = makeCache(backing);

    // A running run NOT tracked → zombie
    const zombieRun = { status: "running", id: "zombie" };
    expect(await filterZombieCoalesceTarget(zombieRun, cache)).toBeNull();

    // A running run IS tracked → live
    const liveRun = { status: "running", id: "live" };
    backing.set("live", true);
    expect(await filterZombieCoalesceTarget(liveRun, cache)).toBe(liveRun);
  });
});
