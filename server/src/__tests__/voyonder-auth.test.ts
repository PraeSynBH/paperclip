import { createHmac } from "node:crypto";
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import type { Request } from "express";
import { assertVoyonderAuth } from "../services/auth.js";
import { errorHandler } from "../middleware/index.js";
import { HttpError } from "../errors.js";

// ─── helpers ───────────────────────────────────────────────────────────

const TEST_SECRET = "test-voyonder-secret-for-unit-tests";

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signPayload(secret: string, signingInput: string): string {
  return createHmac("sha256", secret).update(signingInput).digest("base64url");
}

/** Build an HS256 JWT string with the given claims. */
function buildJwt(claims: Record<string, unknown>, secret = TEST_SECRET): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(claims));
  const signingInput = `${header}.${body}`;
  const sig = signPayload(secret, signingInput);
  return `${signingInput}.${sig}`;
}

/** Create a minimal mock Express Request with just what assertVoyonderAuth reads. */
function mockRequest({
  token,
  companyId,
}: {
  token: string;
  companyId?: string;
}): Request {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
  };
  return {
    header: (name: string) => headers[name.toLowerCase()] ?? undefined,
    params: companyId ? { companyId } : {},
  } as unknown as Request;
}

// ─── env setup ─────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = TEST_SECRET;
});

afterAll(() => {
  delete process.env.BETTER_AUTH_SECRET;
});

// ─── unit tests ────────────────────────────────────────────────────────

describe("assertVoyonderAuth unit", () => {
  it("accepts a valid JWT with matching companyId", () => {
    const token = buildJwt({
      sub: "user-1",
      company_id: "company-1",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const req = mockRequest({ token, companyId: "company-1" });
    const result = assertVoyonderAuth(req);
    expect(result).toEqual({ userId: "user-1", companyId: "company-1" });
  });

  it("accepts a valid JWT when no :companyId param is present", () => {
    const token = buildJwt({
      sub: "user-1",
      company_id: "company-1",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const req = mockRequest({ token }); // no params.companyId
    const result = assertVoyonderAuth(req);
    expect(result).toEqual({ userId: "user-1", companyId: "company-1" });
  });

  it("rejects a JWT without exp claim", () => {
    const token = buildJwt({
      sub: "user-1",
      company_id: "company-1",
      // no exp
    });
    const req = mockRequest({ token, companyId: "company-1" });
    expect(() => assertVoyonderAuth(req)).toThrow(HttpError);
    expect(() => assertVoyonderAuth(req)).toThrow("Token missing expiration");
    try {
      assertVoyonderAuth(req);
    } catch (e) {
      expect((e as HttpError).status).toBe(401);
    }
  });

  it("rejects an expired JWT", () => {
    const token = buildJwt({
      sub: "user-1",
      company_id: "company-1",
      exp: Math.floor(Date.now() / 1000) - 10, // expired 10s ago
    });
    const req = mockRequest({ token, companyId: "company-1" });
    expect(() => assertVoyonderAuth(req)).toThrow(HttpError);
    expect(() => assertVoyonderAuth(req)).toThrow("Token expired");
    try {
      assertVoyonderAuth(req);
    } catch (e) {
      expect((e as HttpError).status).toBe(401);
    }
  });

  it("rejects a JWT whose companyId does not match the URL param", () => {
    const token = buildJwt({
      sub: "user-1",
      company_id: "company-1",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const req = mockRequest({ token, companyId: "company-2" }); // URL says company-2
    expect(() => assertVoyonderAuth(req)).toThrow(HttpError);
    expect(() => assertVoyonderAuth(req)).toThrow(
      "Token companyId does not match URL companyId",
    );
    try {
      assertVoyonderAuth(req);
    } catch (e) {
      expect((e as HttpError).status).toBe(401);
    }
  });

  it("rejects a missing authorization header", () => {
    const req = {
      header: () => undefined,
      params: {},
    } as unknown as Request;
    expect(() => assertVoyonderAuth(req)).toThrow("Missing or invalid authorization header");
  });

  it("rejects an invalid signature", () => {
    const token = buildJwt(
      {
        sub: "user-1",
        company_id: "company-1",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      "different-secret",
    );
    const req = mockRequest({ token, companyId: "company-1" });
    expect(() => assertVoyonderAuth(req)).toThrow("Invalid token signature");
  });
});

// ─── route integration tests ──────────────────────────────────────────

describe("background-jobs route auth integration", () => {
  it("returns 401 for mismatched companyId on GET /background-jobs", async () => {
    const token = buildJwt({
      sub: "user-1",
      company_id: "company-A",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    // Minimal app fragment that exercises the auth check directly
    const app = express();
    app.get("/api/companies/:companyId/background-jobs", (req, res, next) => {
      try {
        assertVoyonderAuth(req);
        res.json({ ok: true });
      } catch (e) {
        next(e);
      }
    });
    app.use(errorHandler);

    const res = await request(app)
      .get("/api/companies/company-B/background-jobs")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error", "Token companyId does not match URL companyId");
  });

  it("returns 200 for matched companyId on GET /background-jobs", async () => {
    const token = buildJwt({
      sub: "user-1",
      company_id: "company-A",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const app = express();
    app.get("/api/companies/:companyId/background-jobs", (req, res, next) => {
      try {
        assertVoyonderAuth(req);
        res.json({ ok: true });
      } catch (e) {
        next(e);
      }
    });
    app.use(errorHandler);

    const res = await request(app)
      .get("/api/companies/company-A/background-jobs")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});

describe("research route auth integration", () => {
  it("returns 401 for mismatched companyId on POST /research/activities", async () => {
    const token = buildJwt({
      sub: "user-1",
      company_id: "company-X",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const app = express();
    app.use(express.json());
    app.post("/api/companies/:companyId/research/activities", (req, res, next) => {
      try {
        assertVoyonderAuth(req);
        res.status(202).json({ jobId: "test-job-id" });
      } catch (e) {
        next(e);
      }
    });
    app.use(errorHandler);

    const res = await request(app)
      .post("/api/companies/company-Y/research/activities")
      .set("Authorization", `Bearer ${token}`)
      .send({ query: "test", scope: "all" });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error", "Token companyId does not match URL companyId");
  });

  it("returns 202 for matched companyId on POST /research/activities", async () => {
    const token = buildJwt({
      sub: "user-1",
      company_id: "company-X",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const app = express();
    app.use(express.json());
    app.post("/api/companies/:companyId/research/activities", (req, res, next) => {
      try {
        assertVoyonderAuth(req);
        res.status(202).json({ jobId: "test-job-id" });
      } catch (e) {
        next(e);
      }
    });
    app.use(errorHandler);

    const res = await request(app)
      .post("/api/companies/company-X/research/activities")
      .set("Authorization", `Bearer ${token}`)
      .send({ query: "test", scope: "all" });

    expect(res.status).toBe(202);
  });
});

describe("exports route auth integration", () => {
  it("returns 401 for mismatched companyId on POST /exports/pdf", async () => {
    const token = buildJwt({
      sub: "user-1",
      company_id: "company-M",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const app = express();
    app.use(express.json());
    app.post("/api/companies/:companyId/exports/pdf", (req, res, next) => {
      try {
        assertVoyonderAuth(req);
        res.status(202).json({ jobId: "test-job-id" });
      } catch (e) {
        next(e);
      }
    });
    app.use(errorHandler);

    const res = await request(app)
      .post("/api/companies/company-N/exports/pdf")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "test" });

    expect(res.status).toBe(401);
  });

  it("returns 202 for matched companyId on POST /exports/pdf", async () => {
    const token = buildJwt({
      sub: "user-1",
      company_id: "company-M",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const app = express();
    app.use(express.json());
    app.post("/api/companies/:companyId/exports/pdf", (req, res, next) => {
      try {
        assertVoyonderAuth(req);
        res.status(202).json({ jobId: "test-job-id" });
      } catch (e) {
        next(e);
      }
    });
    app.use(errorHandler);

    const res = await request(app)
      .post("/api/companies/company-M/exports/pdf")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "test" });

    expect(res.status).toBe(202);
  });
});
