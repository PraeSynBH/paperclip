import { describe, it, expect } from "vitest";
import { canonicalJson, chainHash, verifyAuditChain } from "../services/force-reassign.js";

describe("canonicalJson", () => {
  it("sorts top-level keys", () => {
    const result = canonicalJson({ b: 2, a: 1, c: 3 });
    expect(result).toBe('{"a":1,"b":2,"c":3}');
  });

  it("sorts nested object keys recursively", () => {
    const result = canonicalJson({
      z: { c: 3, a: 1, b: 2 },
      x: 1,
    });
    expect(result).toBe('{"x":1,"z":{"a":1,"b":2,"c":3}}');
  });

  it("preserves array order (does not sort arrays)", () => {
    const result = canonicalJson({ items: ["z", "a", "m"] });
    expect(result).toBe('{"items":["z","a","m"]}');
  });

  it("handles deeply nested structures", () => {
    const result = canonicalJson({
      level1: {
        b: { y: 3, x: 2 },
        a: 1,
      },
    });
    expect(result).toBe('{"level1":{"a":1,"b":{"x":2,"y":3}}}');
  });

  it("handles null and primitives", () => {
    const result = canonicalJson({ n: null, s: "hello", num: 42, b: true });
    expect(result).toBe('{"b":true,"n":null,"num":42,"s":"hello"}');
  });

  it("produces consistent output for Postgres JSONB compatibility", () => {
    const obj = { reason: "test", evidence: { agentId: "abc", status: "terminated" } };
    const r1 = canonicalJson(obj);
    const r2 = canonicalJson(JSON.parse(JSON.stringify(obj)));
    expect(r1).toBe(r2);
  });
});

describe("chainHash", () => {
  it("produces deterministic hashes", () => {
    const hash1 = chainHash("abc123", { action: "test", value: 1 });
    const hash2 = chainHash("abc123", { value: 1, action: "test" });
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different prev_hash values", () => {
    const hash1 = chainHash("abc", { action: "test" });
    const hash2 = chainHash("def", { action: "test" });
    expect(hash1).not.toBe(hash2);
  });

  it("produces different hashes for different payloads", () => {
    const hash1 = chainHash(null, { action: "a" });
    const hash2 = chainHash(null, { action: "b" });
    expect(hash1).not.toBe(hash2);
  });
});

describe("verifyAuditChain", () => {
  it("validates a correct chain", () => {
    const row1 = {
      prevHash: null,
      hash: chainHash(null, { seq: 1 }),
      payload: { seq: 1 },
    };
    const row2 = {
      prevHash: row1.hash,
      hash: chainHash(row1.hash, { seq: 2 }),
      payload: { seq: 2 },
    };
    const result = verifyAuditChain([row1 as any, row2 as any]);
    expect(result.valid).toBe(true);
  });

  it("detects prev_hash mismatch", () => {
    const row1 = {
      prevHash: null,
      hash: chainHash(null, { seq: 1 }),
      payload: { seq: 1 },
    };
    const row2 = {
      prevHash: "wrong-hash",
      hash: chainHash("wrong-hash", { seq: 2 }),
      payload: { seq: 2 },
    };
    const result = verifyAuditChain([row1 as any, row2 as any]);
    expect(result.valid).toBe(false);
    expect(result.errorMessage).toContain("prev_hash mismatch");
  });

  it("detects hash tampering", () => {
    const row1 = {
      prevHash: null,
      hash: chainHash(null, { seq: 1 }),
      payload: { seq: 1 },
    };
    const row2 = {
      prevHash: row1.hash,
      hash: "tampered-hash",
      payload: { seq: 2 },
    };
    const result = verifyAuditChain([row1 as any, row2 as any]);
    expect(result.valid).toBe(false);
    expect(result.errorMessage).toContain("hash mismatch");
  });

  it("handles empty chain", () => {
    const result = verifyAuditChain([]);
    expect(result.valid).toBe(true);
  });

  it("handles single row chain", () => {
    const row = {
      prevHash: null,
      hash: chainHash(null, { seq: 1 }),
      payload: { seq: 1 },
    };
    const result = verifyAuditChain([row as any]);
    expect(result.valid).toBe(true);
  });
});

describe("force-reassign service unit tests", () => {
  it("canonical JSON handles edge case: empty object", () => {
    expect(canonicalJson({})).toBe("{}");
  });

  it("canonical JSON handles edge case: nested empty objects", () => {
    expect(canonicalJson({ a: {}, b: {} })).toBe('{"a":{},"b":{}}');
  });

  it("canonical JSON handles arrays with 10+ elements correctly", () => {
    const items = Array.from({ length: 12 }, (_, i) => `item-${i}`);
    const result = canonicalJson({ items });
    const parsed = JSON.parse(result);
    expect(parsed.items).toEqual(items);
    expect(parsed.items[10]).toBe("item-10");
  });

  it("hash chain verification: sequence gaps detected via prev_hash", () => {
    const row1 = {
      prevHash: null,
      hash: chainHash(null, { seq: 1 }),
      payload: { seq: 1 },
    };
    const row2 = {
      prevHash: "skipped-hash",
      hash: chainHash("skipped-hash", { seq: 3 }),
      payload: { seq: 3 },
    };
    const result = verifyAuditChain([row1 as any, row2 as any]);
    expect(result.valid).toBe(false);
  });
});