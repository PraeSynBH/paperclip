import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { buildMismatchDedupKey, MismatchDedupStore } from "../services/mismatch-dedup.js";

const FIXED_WINDOW = 15 * 60 * 1000;

describe("MismatchDedupStore", () => {
  let store: MismatchDedupStore;

  beforeEach(() => {
    store = new MismatchDedupStore(FIXED_WINDOW, 1000);
  });

  it("emits on first occurrence", () => {
    const result = store.shouldEmit("key-1");
    expect(result.emit).toBe(true);
    expect(result.count).toBe(1);
  });

  it("suppresses duplicate within window", () => {
    store.shouldEmit("key-1");
    const result = store.shouldEmit("key-1");
    expect(result.emit).toBe(false);
    expect(result.count).toBe(2);
  });

  it("suppresses third occurrence with count=3", () => {
    store.shouldEmit("key-1");
    store.shouldEmit("key-1");
    const result = store.shouldEmit("key-1");
    expect(result.emit).toBe(false);
    expect(result.count).toBe(3);
  });

  it("distinct keys emit independently", () => {
    const r1 = store.shouldEmit("key-1");
    const r2 = store.shouldEmit("key-2");
    expect(r1.emit).toBe(true);
    expect(r2.emit).toBe(true);
  });

  it("re-emits after TTL expiry", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    store.shouldEmit("key-1");

    vi.setSystemTime(now + FIXED_WINDOW + 1);
    const result = store.shouldEmit("key-1");
    expect(result.emit).toBe(true);
    expect(result.count).toBe(1);
  });

  it("global ceiling suppresses after threshold", () => {
    const storeCapped = new MismatchDedupStore(FIXED_WINDOW, 1000, 2);
    expect(storeCapped.shouldEmit("a").emit).toBe(true);
    expect(storeCapped.shouldEmit("b").emit).toBe(true);
    const result = storeCapped.shouldEmit("c");
    expect(result.emit).toBe(false);
  });

  it("global ceiling resets each second boundary", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    const storeCapped = new MismatchDedupStore(FIXED_WINDOW, 1000, 1);
    storeCapped.shouldEmit("a");

    vi.setSystemTime(now + 1000);
    const result = storeCapped.shouldEmit("b");
    expect(result.emit).toBe(true);
  });

  it("enforces capacity by evicting an entry when full", () => {
    const small = new MismatchDedupStore(FIXED_WINDOW, 3);
    small.shouldEmit("a");
    small.shouldEmit("b");
    small.shouldEmit("c");
    // Store at capacity (3). Adding "d" forces eviction of one entry.
    const r = small.shouldEmit("d");
    expect(r.emit).toBe(true);
  });

  it("re-emits a key that was evicted due to capacity", () => {
    const small = new MismatchDedupStore(FIXED_WINDOW, 2);
    small.shouldEmit("a");
    small.shouldEmit("b");
    // Force eviction by adding a third key
    small.shouldEmit("c");
    // Re-adding "a" should emit since it was evicted
    const result = small.shouldEmit("a");
    expect(result.emit).toBe(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

describe("buildMismatchDedupKey", () => {
  it("produces same key for same params in same window", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    const params = {
      tenantId: "t1", actorId: "a1", authRunId: "r1",
      clientCorrelationRunId: "c1", route: "GET /api/run",
      enforcement: "ignored" as const,
    };
    const k1 = buildMismatchDedupKey(params);
    vi.setSystemTime(now + 5000);
    const k2 = buildMismatchDedupKey(params);
    expect(k1).toBe(k2);
  });

  it("differs by enforcement", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    const base = { tenantId: "t1", actorId: "a1", authRunId: "r1", clientCorrelationRunId: null, route: "GET /api", enforcement: "ignored" as const };
    const k1 = buildMismatchDedupKey(base);
    const k2 = buildMismatchDedupKey({ ...base, enforcement: "rejected" as const });
    expect(k1).not.toBe(k2);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});