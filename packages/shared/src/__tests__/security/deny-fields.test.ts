import { describe, it, expect } from "vitest";
import { redact } from "../../security/redact.js";

describe("Default deny fields (§3.1)", () => {
  it("strips request.body entirely", () => {
    const r = redact({ request: { body: { password: "hunter2", api_key: "AKIAIOSFODNN7EXAMPLE" } } });
    const req = (r.redacted as Record<string, unknown>).request as Record<string, unknown>;
    expect(req.body).toBe("[REDACTED]");
  });
  it("strips request.headers.authorization, preserves content-type", () => {
    const r = redact({ request: { headers: { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc", "content-type": "application/json" } } });
    const headers = ((r.redacted as Record<string, unknown>).request as Record<string, unknown>).headers as Record<string, unknown>;
    expect(headers.authorization).toBe("[REDACTED]");
    expect(headers["content-type"]).toBe("application/json");
  });
  it("strips cookie header, allows user-agent (truncated)", () => {
    const r = redact({ request: { headers: { cookie: "session=abc123", "user-agent": "Mozilla/5.0" } } });
    const headers = ((r.redacted as Record<string, unknown>).request as Record<string, unknown>).headers as Record<string, unknown>;
    expect(headers.cookie).toBe("[REDACTED]");
    expect(headers["user-agent"]).toBe("Mozilla/5.0");
  });
  it("strips x-api-key and api-key headers", () => {
    const r = redact({ request: { headers: { "x-api-key": "secret", "api-key": "secret2" } } });
    const headers = ((r.redacted as Record<string, unknown>).request as Record<string, unknown>).headers as Record<string, unknown>;
    expect(headers["x-api-key"]).toBe("[REDACTED]");
    expect(headers["api-key"]).toBe("[REDACTED]");
  });
  it("strips process.env", () => {
    const r = redact({ process: { env: { DATABASE_URL: "postgres://user:s3cret@db.example/prod" } } });
    expect(((r.redacted as Record<string, unknown>).process as Record<string, unknown>).env).toBe("[REDACTED]");
  });
  it("strips user PII fields, preserves name", () => {
    const r = redact({ user: { email: "alice@example.com", phone: "+15551234567", ssn: "123-45-6789", password: "hunter2", credit_card: "4111111111111111", name: "Alice" } });
    const user = (r.redacted as Record<string, unknown>).user as Record<string, unknown>;
    expect(user.email).toBe("[REDACTED]");
    expect(user.phone).toBe("[REDACTED]");
    expect(user.ssn).toBe("[REDACTED]");
    expect(user.password).toBe("[REDACTED]");
    expect(user.credit_card).toBe("[REDACTED]");
    expect(user.name).toBe("Alice");
  });
  it("strips client_ip", () => {
    const r = redact({ client_ip: "10.0.0.1" });
    expect((r.redacted as Record<string, unknown>).client_ip).toBe("[REDACTED]");
  });
  it("preserves tenant_id (allowlist)", () => {
    const r = redact({ tenant_id: "550e8400-e29b-41d4-a716-446655440000" });
    expect((r.redacted as Record<string, unknown>).tenant_id).toBe("550e8400-e29b-41d4-a716-446655440000");
  });
  it("preserves numeric timing data", () => {
    const r = redact({ duration: 1500, ttfb: 200, response_time: 450 });
    const out = r.redacted as Record<string, unknown>;
    expect(out.duration).toBe(1500);
    expect(out.ttfb).toBe(200);
    expect(out.response_time).toBe(450);
  });
  it("strips breadcrumb request/response bodies by infix glob", () => {
    const r = redact({
      breadcrumbs: [
        { message: "POST /api/v1/login", data: { request: { body: { password: "hunter2" }, method: "POST" }, response: { body: { token: "secret" }, status_code: 200 } } },
        { message: "GET /health", data: { request: { body: null }, response: { body: { ok: true }, status_code: 200 } } },
      ],
    });
    const crumbs = (r.redacted as Record<string, unknown>).breadcrumbs as Array<Record<string, unknown>>;
    const firstData = (crumbs[0]!.data as Record<string, unknown>);
    expect(((firstData.request as Record<string, unknown>).body as string)).toBe("[REDACTED]");
    expect(((firstData.response as Record<string, unknown>).body as string)).toBe("[REDACTED]");
    expect(((firstData.request as Record<string, unknown>).method as string)).toBe("POST");
    expect(((firstData.response as Record<string, unknown>).status_code as number)).toBe(200);
    expect(crumbs[1]!.message).toBe("GET /health");
    expect((((crumbs[1]!.data as Record<string, unknown>).request as Record<string, unknown>).body as string)).toBe("[REDACTED]");
  });
  it("strips contexts.runtime.env", () => {
    const r = redact({ contexts: { runtime: { env: { STRIPE_LIVE: "sk_live_abc" } } } });
    expect(((r.redacted as any).contexts.runtime as Record<string, unknown>).env).toBe("[REDACTED]");
  });
});