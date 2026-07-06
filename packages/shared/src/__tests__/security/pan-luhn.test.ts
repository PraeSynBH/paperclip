import { describe, it, expect } from "vitest";
import { luhnCheck, REDACTION_PATTERNS } from "../../security/patterns.js";

describe("PAN Luhn validation (§3.2)", () => {
  it("Luhn-valid PANs pass", () => {
    expect(luhnCheck("4111111111111111")).toBe(true);
    expect(luhnCheck("5555555555554444")).toBe(true);
    expect(luhnCheck("378282246310005")).toBe(true);
    expect(luhnCheck("6011111111111117")).toBe(true);
  });
  it("Luhn-invalid strings fail", () => {
    expect(luhnCheck("1234567890123456")).toBe(false);
    expect(luhnCheck("1111111111111111")).toBe(false);
    expect(luhnCheck("9999999999999999")).toBe(false);
  });
  it("too short/long fails", () => {
    expect(luhnCheck("411111111111")).toBe(false);
    expect(luhnCheck("12345678901234567890")).toBe(false);
  });
});

describe("REDACTION_PATTERNS", () => {
  it("all patterns have required fields", () => {
    for (const p of REDACTION_PATTERNS) {
      expect(p.class).toBeTruthy();
      expect(p.pattern).toBeInstanceOf(RegExp);
      expect(p.replacement).toMatch(/^\[REDACTED:/);
    }
  });
  it("pan has Luhn validator", () => {
    const pan = REDACTION_PATTERNS.find((p) => p.class === "pan");
    expect(pan?.validate).toBeTypeOf("function");
  });
  it("patterns do not match their own replacement tokens (idempotency guard)", () => {
    for (const p of REDACTION_PATTERNS) {
      p.pattern.lastIndex = 0;
      expect(p.pattern.test(p.replacement)).toBe(false);
    }
  });
});