import { describe, it, expect } from "vitest";
import { redact, redactEvent, redactLogRecord } from "../../security/redact.js";

describe("redact() pure function contract (§3.4)", () => {
  it("is deterministic", () => {
    const input = { message: "User alice@example.com logged in", user: { email: "alice@example.com", phone: "+15551234567" } };
    const r1 = redact(input);
    const r2 = redact(JSON.parse(JSON.stringify(input)));
    expect(r1.redacted).toEqual(r2.redacted);
    expect(r1.redaction_report.classes).toEqual(r2.redaction_report.classes);
  });

  it("is idempotent — redact(redact(x)) == redact(x)", () => {
    const input = {
      message: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U sent",
      headers: { authorization: "Bearer eyJhbGciOiJSUzI1NiJ9.eyJ1c2VyIjoiYWxpY2UifQ.c2lnbmF0dXJl" },
    };
    const first = redact(input);
    const second = redact(first.redacted);
    expect(second.redacted).toEqual(first.redacted);
    const firstTotal = Object.values(first.redaction_report.classes).reduce((a, b) => a + b, 0);
    const secondTotal = Object.values(second.redaction_report.classes).reduce((a, b) => a + b, 0);
    expect(secondTotal).toBeLessThanOrEqual(firstTotal);
  });

  it("is non-throwing — malformed input returns sentinel", () => {
    expect(redact(undefined).redacted).toEqual({ redacted: true, reason: "undefined_input" });
    expect(redact(null).redacted).toEqual({ redacted: true, reason: "null_input" });
  });

  it("is fail-closed — circular refs do not throw", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular["self"] = circular;
    const result = redact(circular);
    expect(result).toBeDefined();
    expect(result.redaction_report).toBeDefined();
    expect(result.redaction_report.classes["depth_exceeded"] ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("records depth_exceeded when value exceeds MAX_DEPTH", () => {
    let deep: unknown = { leaf: "secret" };
    for (let i = 0; i < 25; i++) deep = { next: deep };
    const r = redact(deep);
    expect(r.redaction_report.classes["depth_exceeded"] ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("returns DENIED at depth_exceeded, not undefined", () => {
    let deep: unknown = { x: 1 };
    for (let i = 0; i < 25; i++) deep = { x: deep };
    const r = redact(deep);
    expect(JSON.stringify(r.redacted)).not.toContain('"x":null');
    expect(JSON.stringify(r.redacted)).toContain('"[REDACTED]"');
  });

  it("returns structured redaction_report", () => {
    const input = { message: "Contact alice@example.com or bob@example.org", body: "Bearer abcdef1234567890 sent", phone: "+15551234567" };
    const result = redact(input);
    expect(result.redaction_report.classes["email"] ?? 0).toBeGreaterThanOrEqual(2);
  });
});

describe("redactEvent() and redactLogRecord()", () => {
  it("are equivalent to redact", () => {
    const input = { message: "alice@example.com" };
    expect(redactEvent(input)).toEqual(redact(input));
    expect(redactLogRecord(input)).toEqual(redact(input));
  });
});