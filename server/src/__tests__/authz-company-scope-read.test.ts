import { describe, expect, it, vi } from "vitest";
import { assertCompanyScopeReadAllowed } from "../routes/authz.js";

describe("assertCompanyScopeReadAllowed", () => {
  it("returns true when access service allows", async () => {
    const req = { actor: { type: "board", userId: "user-1" } } as never;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as never;
    const access = {
      decide: vi.fn().mockResolvedValue({ allowed: true }),
    };

    const result = await assertCompanyScopeReadAllowed(req, res, "company-1", access as never);

    expect(result).toBe(true);
    expect(access.decide).toHaveBeenCalledWith({
      actor: req.actor,
      action: "company_scope:read",
      resource: { type: "company", companyId: "company-1" },
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns false and sends 403 when access service denies", async () => {
    const req = { actor: { type: "board", userId: "user-1" } } as never;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as never;
    const access = {
      decide: vi.fn().mockResolvedValue({ allowed: false }),
    };

    const result = await assertCompanyScopeReadAllowed(req, res, "company-1", access as never);

    expect(result).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Access denied" });
  });

  it("uses custom error message when provided", async () => {
    const req = { actor: { type: "board", userId: "user-1" } } as never;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as never;
    const access = {
      decide: vi.fn().mockResolvedValue({ allowed: false }),
    };

    const result = await assertCompanyScopeReadAllowed(req, res, "company-1", access as never, {
      errorMessage: "Custom error",
    });

    expect(result).toBe(false);
    expect(res.json).toHaveBeenCalledWith({ error: "Custom error" });
  });
});