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
  TEARDOWN_SCOPES,
  type TeardownTokenClaims,
} from "../tenant-teardown/index.js";

/**
 * G5 — GameDay dual-control bypass rejected.
 *
 * SecEng lense: Foundational Complete Mediation + STRIDE Tampering +
 * STRIDE Elevation of Privilege. GameDay injects a hostile tenant
 * attempting every documented bypass:
 *
 *   G5.a — forge approvers claim in the JWT body without going
 *          through `mintTeardownToken` (signature must reject).
 *   G5.b — issue a token with one real approver + one self-asserted
 *          approver, then redeem it (issuance must reject on SoD).
 *   G5.c — issue with initiator == approver (issuance must reject).
 *   G5.d — issue with operator == approver (issuance must reject).
 *   G5.e — replay a token issued for a different tenant, claiming
 *          the same approver set (cross-tenant + same approvers is
 *          still a tenant_mismatch).
 *   G5.f — try to redeem a token whose approver set was hand-edited
 *          post-signature (signature must reject).
 *
 * Every G5.x case must be rejected; the test fails on the old code
 * (any of these would succeed without the dual-control gates) and
 * passes on the new code.
 */

const APPROVER_GROUP = "teardown-approvers";
const TENANT_ID = "company-acme";
const masterSecret = "unit-test-master-secret";

function baseResolver(): InMemoryApproverResolver {
  const r = new InMemoryApproverResolver();
  r.set({ subject: "approver-1", groups: [APPROVER_GROUP] });
  r.set({ subject: "approver-2", groups: [APPROVER_GROUP] });
  r.set({ subject: "initiator", groups: ["teardown-initiators"] });
  r.set({ subject: "operator", groups: ["teardown-operators"] });
  return r;
}

function makeService(): TeardownService {
  return new TeardownService({
    masterSecret,
    approverResolver: baseResolver(),
    killSwitchProbe: new InMemoryKillSwitch(),
    ledger: new InMemoryTeardownLedger(),
    approverGroup: APPROVER_GROUP,
  });
}

function signClaims(claims: TeardownTokenClaims): string {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = Buffer.from(JSON.stringify(header), "utf8").toString("base64url");
  const claimsB64 = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signingInput = `${headerB64}.${claimsB64}`;
  const signingKey = deriveTeardownSigningKey(masterSecret, claims.tenantId);
  const signature = createHmac("sha256", signingKey).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

function baseClaims(overrides: Partial<TeardownTokenClaims> = {}, now: number): TeardownTokenClaims {
  return {
    tenantId: TENANT_ID,
    op: "teardown",
    scope: [...TEARDOWN_SCOPES],
    nbf: now,
    exp: now + 60,
    iat: now,
    jti: mintJti(),
    approvers: ["approver-1", "approver-2"],
    sub: "initiator",
    operator: "operator",
    reason: "gameday",
    iss: TEARDOWN_ISSUER,
    aud: TEARDOWN_AUDIENCE,
    ...overrides,
  };
}

describe("G5 — GameDay dual-control bypass attempts are rejected", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("G5.a — forges a token with a self-asserted approver set (no IdP check) and is rejected at signature", async () => {
    const now = Math.floor(Date.now() / 1000);
    // Attacker forges a token with arbitrary approver subjects, signed
    // under a key they don't actually have. The signature must reject
    // because the attacker doesn't know the per-tenant signing key.
    const forged = baseClaims({
      approvers: ["attacker-1", "attacker-2"], // <-- attacker-controlled
      sub: "attacker",
      operator: "attacker",
    }, now);
    // Try to "sign" with the master secret directly (it should not work
    // because the verifier derives a per-tenant key and the forged
    // claims were never signed by the issuer).
    const headerB64 = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }), "utf8").toString("base64url");
    const claimsB64 = Buffer.from(JSON.stringify(forged), "utf8").toString("base64url");
    const signingInput = `${headerB64}.${claimsB64}`;
    // Attacker uses the master secret directly — verify path derives
    // the per-tenant key from claims.tenantId, so this signature does
    // not match the verifier's expected key.
    const attackerSig = createHmac("sha256", masterSecret).update(signingInput).digest("base64url");
    const token = `${signingInput}.${attackerSig}`;

    const svc = makeService();
    const redeem = await svc.redeem({
      token,
      expectedTenantId: TENANT_ID,
      redeemedBy: "operator",
      now,
    });
    expect(redeem.status).toBe("rejected");
    if (redeem.status === "rejected") {
      expect(redeem.code).toBe("bad_token");
      expect(redeem.reason).toMatch(/bad signature/);
    }
  });

  it("G5.b — issuance with one real approver + one self-asserted approver is rejected", async () => {
    const svc = makeService();
    const now = Math.floor(Date.now() / 1000);
    // approver-rogue is not in the resolver at all.
    const mint = await svc.mint({
      tenantId: TENANT_ID,
      initiatorSubject: "initiator",
      operatorSubject: "operator",
      approverSubjects: ["approver-1", "approver-rogue"],
      reason: "gameday-g5b",
      now,
    });
    expect(mint.status).toBe("rejected");
    if (mint.status === "rejected") {
      expect(mint.code).toBe("approver_check_failed");
      expect(mint.reason).toMatch(/not found in IdP/i);
    }
  });

  it("G5.c — issuance with initiator == approver is rejected (SoD)", async () => {
    const svc = makeService();
    const now = Math.floor(Date.now() / 1000);
    const mint = await svc.mint({
      tenantId: TENANT_ID,
      initiatorSubject: "approver-1",
      operatorSubject: "operator",
      approverSubjects: ["approver-1", "approver-2"],
      reason: "gameday-g5c",
      now,
    });
    expect(mint.status).toBe("rejected");
    if (mint.status === "rejected") {
      expect(mint.code).toBe("approver_check_failed");
    }
  });

  it("G5.d — issuance with operator == approver is rejected (SoD)", async () => {
    const svc = makeService();
    const now = Math.floor(Date.now() / 1000);
    const mint = await svc.mint({
      tenantId: TENANT_ID,
      initiatorSubject: "initiator",
      operatorSubject: "approver-1",
      approverSubjects: ["approver-1", "approver-2"],
      reason: "gameday-g5d",
      now,
    });
    expect(mint.status).toBe("rejected");
    if (mint.status === "rejected") {
      expect(mint.code).toBe("approver_check_failed");
    }
  });

  it("G5.e — token issued for tenant A is rejected when redeemed against tenant B, even with same approver set", async () => {
    const svc = makeService();
    const now = Math.floor(Date.now() / 1000);
    const mint = await svc.mint({
      tenantId: TENANT_ID,
      initiatorSubject: "initiator",
      operatorSubject: "operator",
      approverSubjects: ["approver-1", "approver-2"],
      reason: "gameday-g5e",
      now,
    });
    expect(mint.status).toBe("ok");
    if (mint.status !== "ok") return;

    const redeem = await svc.redeem({
      token: mint.token,
      expectedTenantId: "company-other",
      redeemedBy: "operator",
      now,
    });
    expect(redeem.status).toBe("rejected");
    if (redeem.status === "rejected") {
      expect(redeem.code).toBe("tenant_mismatch");
    }
  });

  it("G5.f — claims body is hand-edited after signature; signature must reject", async () => {
    const svc = makeService();
    const now = Math.floor(Date.now() / 1000);
    const mint = await svc.mint({
      tenantId: TENANT_ID,
      initiatorSubject: "initiator",
      operatorSubject: "operator",
      approverSubjects: ["approver-1", "approver-2"],
      reason: "gameday-g5f",
      now,
    });
    expect(mint.status).toBe("ok");
    if (mint.status !== "ok") return;

    // Attacker swaps the approvers list in the encoded body without
    // re-signing. The signature no longer matches the modified body.
    const [headerB64, claimsB64, signature] = mint.token.split(".");
    const raw = JSON.parse(Buffer.from(claimsB64, "base64url").toString("utf8"));
    raw.approvers = ["approver-rogue", "approver-other"];
    const tamperedClaimsB64 = Buffer.from(JSON.stringify(raw), "utf8").toString("base64url");
    const tamperedToken = `${headerB64}.${tamperedClaimsB64}.${signature}`;

    const redeem = await svc.redeem({
      token: tamperedToken,
      expectedTenantId: TENANT_ID,
      redeemedBy: "operator",
      now,
    });
    expect(redeem.status).toBe("rejected");
    if (redeem.status === "rejected") {
      expect(redeem.code).toBe("bad_token");
      expect(redeem.reason).toMatch(/bad signature/);
    }
  });

  it("G5.g — break-glass cannot suppress the SoD check; the approver set is still required", async () => {
    const svc = makeService();
    const now = Math.floor(Date.now() / 1000);
    // Even with break-glass=true, the issuance path still requires
    // two distinct approvers (break-glass relaxes the *who*, not the
    // *how many*).
    const mint = await svc.mint({
      tenantId: TENANT_ID,
      initiatorSubject: "initiator",
      operatorSubject: "operator",
      approverSubjects: ["approver-1"],
      reason: "gameday-g5g",
      breakGlass: true,
      now,
    });
    expect(mint.status).toBe("rejected");
    if (mint.status === "rejected") {
      expect(mint.code).toBe("approver_check_failed");
    }
  });
});
