import { describe, it, expect } from "vitest";
import { redact } from "../../security/redact.js";

describe("Email vs version: edge cases (§3.2)", () => {
  it("redacts valid emails", () => {
    const r = redact("Contact user@example.com");
    expect(r.redacted).not.toContain("user@example.com");
    expect(r.redacted).toContain("[REDACTED:email]");
    expect(r.redaction_report.classes["email"]).toBe(1);
  });
  it("does NOT redact without TLD (name@example)", () => {
    const r = redact("name@example is not valid");
    expect(r.redacted).toBe("name@example is not valid");
    expect(r.redaction_report.classes["email"] ?? 0).toBe(0);
  });
  it("redacts IPv4 (1.2.3.4)", () => {
    const r = redact("IP: 1.2.3.4 connected");
    expect(r.redacted).not.toContain("1.2.3.4");
    expect(r.redacted).toContain("[REDACTED:ipv4]");
  });
  it("does NOT redact ISO timestamp (2025-06-30T18:00:00Z)", () => {
    const r = redact("Timestamp 2025-06-30T18:00:00Z");
    expect((r.redacted as string)).not.toContain("[REDACTED:ipv4]");
    expect(r.redacted as string).toContain("2025-06-30T18:00:00Z");
  });
  it("redacts JWT tokens", () => {
    const r = redact('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
    expect(r.redaction_report.classes["jwt"] ?? 0).toBeGreaterThanOrEqual(1);
    expect(r.redacted as string).not.toMatch(/eyJ[A-Za-z0-9_-]+\.eyJ/);
  });
  it("redacts AWS access keys", () => {
    const r = redact("Key: AKIAIOSFODNN7EXAMPLE");
    expect(r.redaction_report.classes["aws_access_key"] ?? 0).toBeGreaterThanOrEqual(1);
    expect(r.redacted as string).toContain("[REDACTED:aws_access_key]");
  });
  it("redacts Stripe live keys", () => {
    const fakeKey = "sk_live_" + "A".repeat(24);
    const r = redact(`Stripe: ${fakeKey}`);
    expect(r.redaction_report.classes["stripe_live"] ?? 0).toBeGreaterThanOrEqual(1);
  });
  it("redacts GitHub PAT", () => {
    const r = redact("Token: ghp_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0");
    expect(r.redaction_report.classes["github_pat"] ?? 0).toBeGreaterThanOrEqual(1);
  });
  it("redacts private key PEM blocks", () => {
    const r = redact("Key: -----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA0Z3...\n-----END RSA PRIVATE KEY-----");
    expect(r.redaction_report.classes["private_key"] ?? 0).toBeGreaterThanOrEqual(1);
    expect(r.redacted as string).not.toContain("RSA PRIVATE KEY");
  });
});