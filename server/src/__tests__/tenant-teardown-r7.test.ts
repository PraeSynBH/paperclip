import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  InMemoryApproverResolver,
  InMemoryKillSwitch,
  InMemoryTeardownLedger,
  TeardownService,
  deriveTeardownSigningKey,
  mintJti,
  TEARDOWN_AUDIENCE,
  TEARDOWN_ISSUER,
  TEARDOWN_OP,
  TEARDOWN_SCOPES,
  type TeardownTokenClaims,
} from "../tenant-teardown/index.js";

/**
 * R7 — token with `op != "teardown"` or wrong `tenantId` → 403.
 *
 * SecEng lense: Foundational Complete Mediation + OWASP API BOLA/IDOR.
 * A teardown token MUST be tightly bound to (a) the operation it's
 * authorized for and (b) the tenant it can act on. A token issued for
 * tenant A must be unusable against tenant B; a token issued for op
 * `read` (or any non-teardown op) must be unusable for teardown.
 *
 * This test fails on the old code (no op/tenant binding check) and
 * passes on the new code (verifyTeardownToken refuses non-`teardown`
 * ops; redeemTeardownToken refuses tenant mismatches; signature
 * derivation refuses cross-tenant token forgery).
 */

const APPROVER_GROUP = "teardown-approvers";
const TENANT_A = "company-acme";
const TENANT_B = "company-contoso";
const masterSecret = "unit-test-master-secret";

function baseResolver(): InMemoryApproverResolver {
  const r = new InMemoryApproverResolver();
  r.set({ subject: "approver-1", groups: [APPROVER_GROUP] });
  r.set({ subject: "approver-2", groups: [APPROVER_GROUP] });
  r.set({ subject: "initiator", groups: ["teardown-initiators"] });
  r.set({ subject: "operator", groups: ["teardown-operators"] });
  return r;
}

function signRaw(claims: TeardownTokenClaims): string {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = Buffer.from(JSON.stringify(header), "utf8").toString("base64url");
  const claimsB64 = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signingInput = `${headerB64}.${claimsB64}`;
  const signingKey = deriveTeardownSigningKey(masterSecret, claims.tenantId);
  const signature = createHmac("sha256", signingKey).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

describe("R7 — token rejected for wrong op or wrong tenant", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("redeems a valid token for the right tenant", async () => {
    const svc = new TeardownService({
      masterSecret,
      approverResolver: baseResolver(),
      killSwitchProbe: new InMemoryKillSwitch(),
      ledger: new InMemoryTeardownLedger(),
      approverGroup: APPROVER_GROUP,
    });
    const now = Math.floor(Date.now() / 1000);
    const mint = await svc.mint({
      tenantId: TENANT_A,
      initiatorSubject: "initiator",
      operatorSubject: "operator",
      approverSubjects: ["approver-1", "approver-2"],
      reason: "DSAR-R7-baseline",
      now,
    });
    expect(mint.status).toBe("ok");
    if (mint.status !== "ok") return;
    const redeem = await svc.redeem({
      token: mint.token,
      expectedTenantId: TENANT_A,
      redeemedBy: "operator",
      now,
    });
    expect(redeem.status).toBe("ok");
  });

  it("rejects a teardown token when redeemed against a different tenant (BOLA/IDOR)", async () => {
    const svc = new TeardownService({
      masterSecret,
      approverResolver: baseResolver(),
      killSwitchProbe: new InMemoryKillSwitch(),
      ledger: new InMemoryTeardownLedger(),
      approverGroup: APPROVER_GROUP,
    });
    const now = Math.floor(Date.now() / 1000);
    const mint = await svc.mint({
      tenantId: TENANT_A,
      initiatorSubject: "initiator",
      operatorSubject: "operator",
      approverSubjects: ["approver-1", "approver-2"],
      reason: "DSAR-R7-cross",
      now,
    });
    expect(mint.status).toBe("ok");
    if (mint.status !== "ok") return;

    const redeem = await svc.redeem({
      token: mint.token,
      expectedTenantId: TENANT_B, // <- cross-tenant attempt
      redeemedBy: "operator",
      now,
    });
    expect(redeem.status).toBe("rejected");
    if (redeem.status === "rejected") {
      expect(redeem.code).toBe("tenant_mismatch");
    }
  });

  it("rejects a token whose op is not `teardown` (e.g. op = `read`)", async () => {
    // Forge a token with op = "read" signed under tenant A's key.
    // The signature is valid; the verify path must reject by op.
    const now = Math.floor(Date.now() / 1000);
    const claims: TeardownTokenClaims = {
      tenantId: TENANT_A,
      op: "read", // NOT teardown
      scope: [...TEARDOWN_SCOPES],
      nbf: now,
      exp: now + 60,
      iat: now,
      jti: mintJti(),
      approvers: ["approver-1", "approver-2"],
      sub: "initiator",
      operator: "operator",
      reason: "forged-read",
      iss: TEARDOWN_ISSUER,
      aud: TEARDOWN_AUDIENCE,
    };
    const token = signRaw(claims);

    const svc = new TeardownService({
      masterSecret,
      approverResolver: baseResolver(),
      killSwitchProbe: new InMemoryKillSwitch(),
      ledger: new InMemoryTeardownLedger(),
      approverGroup: APPROVER_GROUP,
    });
    const redeem = await svc.redeem({
      token,
      expectedTenantId: TENANT_A,
      redeemedBy: "operator",
      now,
    });
    expect(redeem.status).toBe("rejected");
    if (redeem.status === "rejected") {
      expect(redeem.code).toBe("bad_token");
      expect(redeem.reason).toMatch(/op must be teardown/);
    }
  });

  it("rejects a token whose signature was minted under a different tenant's key (forgery)", async () => {
    // Hand-craft a token claiming tenant A but signed with tenant B's
    // signing key. The per-tenant HMAC derivation MUST make this fail
    // signature verification when the verifier resolves to tenant A.
    const now = Math.floor(Date.now() / 1000);
    const claims: TeardownTokenClaims = {
      tenantId: TENANT_A,
      op: TEARDOWN_OP,
      scope: [...TEARDOWN_SCOPES],
      nbf: now,
      exp: now + 60,
      iat: now,
      jti: mintJti(),
      approvers: ["approver-1", "approver-2"],
      sub: "initiator",
      operator: "operator",
      reason: "forged",
      iss: TEARDOWN_ISSUER,
      aud: TEARDOWN_AUDIENCE,
    };
    const headerB64 = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }), "utf8").toString("base64url");
    const claimsB64 = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    const signingInput = `${headerB64}.${claimsB64}`;
    const wrongKey = deriveTeardownSigningKey(masterSecret, TENANT_B); // <-- wrong key
    const signature = createHmac("sha256", wrongKey).update(signingInput).digest("base64url");
    const token = `${signingInput}.${signature}`;

    const svc = new TeardownService({
      masterSecret,
      approverResolver: baseResolver(),
      killSwitchProbe: new InMemoryKillSwitch(),
      ledger: new InMemoryTeardownLedger(),
      approverGroup: APPROVER_GROUP,
    });
    const redeem = await svc.redeem({
      token,
      expectedTenantId: TENANT_A,
      redeemedBy: "operator",
      now,
    });
    expect(redeem.status).toBe("rejected");
    if (redeem.status === "rejected") {
      expect(redeem.code).toBe("bad_token");
      expect(redeem.reason).toMatch(/bad signature/);
    }
  });

  it("rejects a token with the right signature but a scope outside the teardown allowlist", async () => {
    const now = Math.floor(Date.now() / 1000);
    const claims: TeardownTokenClaims = {
      tenantId: TENANT_A,
      op: TEARDOWN_OP,
      scope: ["data.read", "rows.delete"], // data.read is NOT a teardown scope
      nbf: now,
      exp: now + 60,
      iat: now,
      jti: mintJti(),
      approvers: ["approver-1", "approver-2"],
      sub: "initiator",
      operator: "operator",
      reason: "scope-leak",
      iss: TEARDOWN_ISSUER,
      aud: TEARDOWN_AUDIENCE,
    };
    const token = signRaw(claims);

    const svc = new TeardownService({
      masterSecret,
      approverResolver: baseResolver(),
      killSwitchProbe: new InMemoryKillSwitch(),
      ledger: new InMemoryTeardownLedger(),
      approverGroup: APPROVER_GROUP,
    });
    const redeem = await svc.redeem({
      token,
      expectedTenantId: TENANT_A,
      redeemedBy: "operator",
      now,
    });
    expect(redeem.status).toBe("rejected");
    if (redeem.status === "rejected") {
      expect(redeem.code).toBe("bad_token");
      expect(redeem.reason).toMatch(/disallowed scope/i);
    }
  });
});
