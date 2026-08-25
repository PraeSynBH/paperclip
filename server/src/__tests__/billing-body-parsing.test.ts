import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorHandler } from "../middleware/index.js";

/**
 * Verify that billing POST routes receive a parsed JSON body (not a Buffer)
 * when express.json() runs before the billing routes.
 *
 * This tests the exact scenario described in VOY-2217: the Stripe webhook
 * route needs the raw body for signature verification, but other billing
 * POST routes must receive parsed JSON. The fix is to use express.json()
 * with a verify callback (to capture rawBody) rather than express.raw()
 * at the /api/billing mount point.
 */

// Simulate the captureRawBody function from app.ts
function captureRawBody(req: express.Request, _res: express.Response, buf: Buffer): void {
  (req as unknown as { rawBody: Buffer }).rawBody = buf;
}

describe("billing POST routes body parsing", () => {
  it("receives parsed JSON body when express.json() runs first (no express.raw())", async () => {
    const app = express();

    // express.json() with verify callback — same pattern as in app.ts
    app.use(express.json({ verify: captureRawBody }));

    // Mount a route that simulates a billing POST route (e.g., cancel/reactivate)
    app.post("/api/companies/:companyId/billing/subscription/cancel", (req, res) => {
      // req.body must be a parsed object, NOT a Buffer
      expect(req.body).not.toBeInstanceOf(Buffer);
      expect(typeof req.body).toBe("object");
      expect(req.body).not.toBeNull();
      res.json({ ok: true, bodyType: typeof req.body, isBuffer: req.body instanceof Buffer });
    });

    const res = await request(app)
      .post("/api/companies/company-1/billing/subscription/cancel")
      .set("Content-Type", "application/json")
      .send({ confirm: true });

    expect(res.status).toBe(200);
    expect(res.body.bodyType).toBe("object");
    expect(res.body.isBuffer).toBe(false);
  });

  it("captures rawBody via verify callback for webhook route", async () => {
    const app = express();

    // express.json() with verify callback — captures raw body
    app.use(express.json({ verify: captureRawBody }));

    // Mount a route that simulates the Stripe webhook
    app.post("/api/billing/webhook", (req, res) => {
      const rawBody = (req as unknown as { rawBody: Buffer }).rawBody;
      // rawBody must be a Buffer
      expect(rawBody).toBeInstanceOf(Buffer);
      expect(rawBody!.length).toBeGreaterThan(0);
      // req.body is still parsed JSON
      expect(req.body).not.toBeInstanceOf(Buffer);
      expect(typeof req.body).toBe("object");
      res.json({ ok: true, hasRawBody: !!rawBody });
    });

    const res = await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .send({ type: "invoice.paid" });

    expect(res.status).toBe(200);
    expect(res.body.hasRawBody).toBe(true);
  });

  it("rawBody is a Buffer and can be used for Stripe signature verification", async () => {
    const app = express();

    // express.json() with verify callback
    app.use(express.json({ verify: captureRawBody }));

    // Simulate Stripe webhook verification
    app.post("/api/billing/webhook", (req, res) => {
      const rawBody = (req as unknown as { rawBody: Buffer }).rawBody;
      if (!rawBody) {
        res.status(400).json({ error: "Missing raw body" });
        return;
      }
      // The raw body should be the exact string that was POSTed
      const bodyStr = rawBody.toString("utf8");
      const parsed = JSON.parse(bodyStr);
      expect(parsed.type).toBe("invoice.paid");
      res.json({ ok: true, rawBodyLength: rawBody.length });
    });

    const res = await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .send({ type: "invoice.paid", data: { id: "in_123" } });

    expect(res.status).toBe(200);
    expect(res.body.rawBodyLength).toBeGreaterThan(0);
  });

  it("returns 400 when rawBody is missing (would fail Stripe verification)", async () => {
    const app = express();

    // Intentionally do NOT use express.json() — simulate rawBody being missing
    // This mimics what would happen if express.raw() was used instead

    app.post("/api/billing/webhook", (req, res) => {
      const rawBody = (req as unknown as { rawBody: Buffer }).rawBody;
      if (!rawBody) {
        res.status(400).json({ error: "Missing raw body for webhook verification" });
        return;
      }
      res.json({ ok: true });
    });

    const res = await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .send({ type: "invoice.paid" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing raw body for webhook verification");
  });

  it("billing POST routes with validate middleware receive parsed JSON", async () => {
    const app = express();
    app.use(express.json({ verify: captureRawBody }));

    // Simulate the validate middleware pattern used in billing.ts
    function validate(schema: { parse: (body: unknown) => unknown }) {
      return (req: express.Request, _res: express.Response, next: express.NextFunction) => {
        try {
          req.body = schema.parse(req.body);
          next();
        } catch {
          res.status(400).json({ error: "Validation failed" });
        }
      };
    }

    const dummySchema = {
      parse: (body: unknown) => {
        if (Buffer.isBuffer(body)) {
          throw new Error("Body is a Buffer, not JSON");
        }
        return body;
      },
    };

    app.post(
      "/api/companies/:companyId/billing/subscription",
      validate(dummySchema),
      (req, res) => {
        res.json({ ok: true });
      },
    );

    const res = await request(app)
      .post("/api/companies/company-1/billing/subscription")
      .set("Content-Type", "application/json")
      .send({ tierId: "tier-1", billingPeriod: "monthly" });

    // Should pass validation because req.body is parsed JSON, not a Buffer
    expect(res.status).toBe(200);
  });
});
