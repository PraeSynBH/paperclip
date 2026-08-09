import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalAgentJwt, verifyLocalAgentJwt } from "../agent-auth-jwt.js";

describe("agent local JWT", () => {
  const secretEnv = "PAPERCLIP_AGENT_JWT_SECRET";
  const betterAuthSecretEnv = "BETTER_AUTH_SECRET";
  const ttlEnv = "PAPERCLIP_AGENT_JWT_TTL_SECONDS";
  const issuerEnv = "PAPERCLIP_AGENT_JWT_ISSUER";
  const audienceEnv = "PAPERCLIP_AGENT_JWT_AUDIENCE";
  const disableLegacyFallbackEnv = "PAPERCLIP_AGENT_JWT_DISABLE_LEGACY_FALLBACK";

  const originalEnv = {
    secret: process.env[secretEnv],
    betterAuthSecret: process.env[betterAuthSecretEnv],
    ttl: process.env[ttlEnv],
    issuer: process.env[issuerEnv],
    audience: process.env[audienceEnv],
    disableLegacyFallback: process.env[disableLegacyFallbackEnv],
  };

  beforeEach(() => {
    process.env[secretEnv] = "test-secret";
    delete process.env[betterAuthSecretEnv];
    process.env[ttlEnv] = "3600";
    delete process.env[issuerEnv];
    delete process.env[audienceEnv];
    delete process.env[disableLegacyFallbackEnv];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalEnv.secret === undefined) delete process.env[secretEnv];
    else process.env[secretEnv] = originalEnv.secret;
    if (originalEnv.betterAuthSecret === undefined) delete process.env[betterAuthSecretEnv];
    else process.env[betterAuthSecretEnv] = originalEnv.betterAuthSecret;
    if (originalEnv.ttl === undefined) delete process.env[ttlEnv];
    else process.env[ttlEnv] = originalEnv.ttl;
    if (originalEnv.issuer === undefined) delete process.env[issuerEnv];
    else process.env[issuerEnv] = originalEnv.issuer;
    if (originalEnv.audience === undefined) delete process.env[audienceEnv];
    else process.env[audienceEnv] = originalEnv.audience;
    if (originalEnv.disableLegacyFallback === undefined) delete process.env[disableLegacyFallbackEnv];
    else process.env[disableLegacyFallbackEnv] = originalEnv.disableLegacyFallback;
  });

  it("creates and verifies a token", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1");
    expect(typeof token).toBe("string");

    const claims = verifyLocalAgentJwt(token!);
    expect(claims).toMatchObject({
      sub: "agent-1",
      company_id: "company-1",
      adapter_type: "claude_local",
      run_id: "run-1",
      iss: "paperclip",
      aud: "paperclip-api",
    });
  });

  it("returns null when secret is missing", () => {
    process.env[secretEnv] = "";
    const token = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1");
    expect(token).toBeNull();
    expect(verifyLocalAgentJwt("abc.def.ghi")).toBeNull();
  });

  it("falls back to BETTER_AUTH_SECRET when PAPERCLIP_AGENT_JWT_SECRET is absent", () => {
    delete process.env[secretEnv];
    process.env[betterAuthSecretEnv] = "fallback-secret";
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1");
    expect(typeof token).toBe("string");

    const claims = verifyLocalAgentJwt(token!);
    expect(claims).toMatchObject({
      sub: "agent-1",
      company_id: "company-1",
      adapter_type: "claude_local",
      run_id: "run-1",
    });
  });

  it("rejects expired tokens", () => {
    process.env[ttlEnv] = "1";
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1");

    vi.setSystemTime(new Date("2026-01-01T00:00:05.000Z"));
    expect(verifyLocalAgentJwt(token!)).toBeNull();
  });

  it("rejects issuer/audience mismatch", () => {
    process.env[issuerEnv] = "custom-issuer";
    process.env[audienceEnv] = "custom-audience";
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = createLocalAgentJwt("agent-1", "company-1", "codex_local", "run-1");

    process.env[issuerEnv] = "paperclip";
    process.env[audienceEnv] = "paperclip-api";
    expect(verifyLocalAgentJwt(token!)).toBeNull();
  });

  it("does not verify a token across companies (per-company isolation)", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const tokenA = createLocalAgentJwt("agent-1", "company-A", "claude_local", "run-1");
    expect(tokenA).not.toBeNull();

    // A token whose body claims company-A must verify successfully under its
    // own company-A derived key.
    expect(verifyLocalAgentJwt(tokenA!)?.company_id).toBe("company-A");

    // Tamper: forge a token by copying tokenA's header+signature and swapping
    // the claim's company_id to company-B. The signature was bound to the
    // company-A derived key over the original claims; once we re-encode with a
    // different company_id (or rebind to company-B's key) verification must
    // fail because the signature is over the original signing input.
    const [headerB64, claimsB64, signature] = tokenA!.split(".");
    const claims = JSON.parse(Buffer.from(claimsB64, "base64url").toString("utf8"));
    claims.company_id = "company-B";
    const tamperedClaimsB64 = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    const tampered = `${headerB64}.${tamperedClaimsB64}.${signature}`;
    expect(verifyLocalAgentJwt(tampered)).toBeNull();
  });

  it("accepts legacy tokens signed with the master secret (backward compat)", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const masterSecret = process.env[secretEnv]!;

    // Hand-craft a token signed directly with the master secret, simulating a
    // JWT issued before per-company derivation existed.
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "HS256", typ: "JWT" };
    const claims = {
      sub: "agent-legacy",
      company_id: "company-legacy",
      adapter_type: "claude_local",
      run_id: "run-legacy",
      iat: now,
      exp: now + 3600,
      iss: "paperclip",
      aud: "paperclip-api",
    };
    const headerB64 = Buffer.from(JSON.stringify(header), "utf8").toString("base64url");
    const claimsB64 = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    const signingInput = `${headerB64}.${claimsB64}`;
    const legacySig = createHmac("sha256", masterSecret).update(signingInput).digest("base64url");
    const legacyToken = `${signingInput}.${legacySig}`;

    const verified = verifyLocalAgentJwt(legacyToken);
    expect(verified).toMatchObject({
      sub: "agent-legacy",
      company_id: "company-legacy",
      adapter_type: "claude_local",
      run_id: "run-legacy",
    });
  });

  it("defaults TTL to 1h when PAPERCLIP_AGENT_JWT_TTL_SECONDS is unset", () => {
    delete process.env[ttlEnv];
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1");
    const claims = verifyLocalAgentJwt(token!);
    expect(claims).not.toBeNull();
    expect(claims!.exp - claims!.iat).toBe(60 * 60);
  });

  // Helper: hand-craft a token signed with the raw master secret (legacy path).
  function craftLegacyMasterSecretToken(masterSecret: string, companyId: string) {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "HS256", typ: "JWT" };
    const claims = {
      sub: "agent-legacy",
      company_id: companyId,
      adapter_type: "claude_local",
      run_id: "run-legacy",
      iat: now,
      exp: now + 3600,
      iss: "paperclip",
      aud: "paperclip-api",
    };
    const headerB64 = Buffer.from(JSON.stringify(header), "utf8").toString("base64url");
    const claimsB64 = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    const signingInput = `${headerB64}.${claimsB64}`;
    const legacySig = createHmac("sha256", masterSecret).update(signingInput).digest("base64url");
    return `${signingInput}.${legacySig}`;
  }

  it("accepts master-secret-signed tokens when PAPERCLIP_AGENT_JWT_DISABLE_LEGACY_FALLBACK is unset", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    delete process.env[disableLegacyFallbackEnv];
    const legacyToken = craftLegacyMasterSecretToken(process.env[secretEnv]!, "company-legacy");
    const verified = verifyLocalAgentJwt(legacyToken);
    expect(verified).not.toBeNull();
    expect(verified!.company_id).toBe("company-legacy");
  });

  it("rejects master-secret-signed tokens when PAPERCLIP_AGENT_JWT_DISABLE_LEGACY_FALLBACK is enabled", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    process.env[disableLegacyFallbackEnv] = "true";
    const legacyToken = craftLegacyMasterSecretToken(process.env[secretEnv]!, "company-legacy");
    expect(verifyLocalAgentJwt(legacyToken)).toBeNull();
  });

  it("still verifies per-company-signed tokens when PAPERCLIP_AGENT_JWT_DISABLE_LEGACY_FALLBACK is enabled", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    process.env[disableLegacyFallbackEnv] = "true";
    const token = createLocalAgentJwt("agent-1", "company-1", "claude_local", "run-1");
    expect(token).not.toBeNull();
    const verified = verifyLocalAgentJwt(token!);
    expect(verified).toMatchObject({
      sub: "agent-1",
      company_id: "company-1",
      adapter_type: "claude_local",
      run_id: "run-1",
    });
  });

  // RBR-1035 AC1 + AC4 regression test: the JWT TTL must be sized to the
  // run's own configured max wall clock (+ margin, computed by the caller
  // in heartbeat.ts) instead of always trusting the flat instance-wide
  // default. This is the fix for RBR-1014: a hard 1h default TTL that agent
  // runs routinely outlive. Note this is distinct from RBR-1036's AC4
  // (which tests the client's fail-fast-on-401 behavior, not TTL sizing) —
  // this suite only asserts token-minting/expiry behavior. `minTtlSeconds`
  // is the 5th positional arg on this fork/master signature (no
  // responsibleUserId/keyScope params here yet).
  describe("run-derived TTL (RBR-1035 AC1)", () => {
    it("mints a token whose exp covers a long-budget run when minTtlSeconds exceeds the default TTL", () => {
      process.env[ttlEnv] = "3600"; // instance-wide default: 1h
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

      // Simulate a run configured with a wall-clock budget well beyond the
      // 1h default (e.g. timeoutSec 21600 + a 300s margin, as computed by
      // resolveHeartbeatRunTimeoutPolicy + AGENT_JWT_RUN_TIMEOUT_MARGIN_SECONDS
      // in heartbeat.ts) and assert the minted token's lifetime is sized to
      // that run budget, not clamped to the shorter instance default.
      const runBudgetSeconds = 21600 + 300; // 6h05m
      const token = createLocalAgentJwt(
        "agent-1",
        "company-1",
        "claude_local",
        "run-long",
        runBudgetSeconds,
      );
      expect(token).not.toBeNull();

      const claims = verifyLocalAgentJwt(token!);
      expect(claims).not.toBeNull();
      // exp - iat must equal the run's budget, not the 3600s instance default.
      expect(claims!.exp - claims!.iat).toBe(runBudgetSeconds);
      expect(claims!.exp - claims!.iat).toBeGreaterThan(3600);

      // Prove the token is actually alive at the moment the flat 1h default
      // would have already expired it — this is the exact RBR-1014 failure
      // mode (401 mid-run masquerading as a timeout) that this fix closes.
      vi.setSystemTime(new Date("2026-01-01T01:30:00.000Z")); // +90 minutes
      expect(verifyLocalAgentJwt(token!)).not.toBeNull();
    });

    it("keeps the tighter instance default TTL for a short-budget run (does not raise the floor for every run)", () => {
      process.env[ttlEnv] = "3600";
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

      // A short-budget run (e.g. timeoutSec 60 + margin = 360s) must NOT
      // widen the token lifetime beyond the instance default — only runs
      // whose own budget exceeds the default should get a longer-lived
      // token.
      const shortRunBudgetSeconds = 360;
      const token = createLocalAgentJwt(
        "agent-1",
        "company-1",
        "claude_local",
        "run-short",
        shortRunBudgetSeconds,
      );
      expect(token).not.toBeNull();

      const claims = verifyLocalAgentJwt(token!);
      expect(claims).not.toBeNull();
      expect(claims!.exp - claims!.iat).toBe(3600);
    });

    it("expires a short-budget-run token sooner than a long-budget-run token minted at the same instant", () => {
      process.env[ttlEnv] = "3600";
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

      const longToken = createLocalAgentJwt(
        "agent-1",
        "company-1",
        "claude_local",
        "run-long",
        14400,
      );
      const shortToken = createLocalAgentJwt(
        "agent-1",
        "company-1",
        "claude_local",
        "run-short",
        300,
      );

      const longClaims = verifyLocalAgentJwt(longToken!);
      const shortClaims = verifyLocalAgentJwt(shortToken!);
      expect(longClaims).not.toBeNull();
      expect(shortClaims).not.toBeNull();
      expect(longClaims!.exp).toBeGreaterThan(shortClaims!.exp);

      // Advance past the short run's ceiling (3600s default, since 300 <
      // default) but well before the long run's 14400s budget elapses: the
      // short-budget token must be dead while the long-budget token is
      // still alive.
      vi.setSystemTime(new Date("2026-01-01T02:00:00.000Z")); // +2h
      expect(verifyLocalAgentJwt(shortToken!)).toBeNull();
      expect(verifyLocalAgentJwt(longToken!)).not.toBeNull();
    });

    it("ignores a non-finite or non-positive minTtlSeconds and falls back to the instance default", () => {
      process.env[ttlEnv] = "3600";
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

      for (const invalid of [NaN, -100, 0]) {
        const token = createLocalAgentJwt(
          "agent-1",
          "company-1",
          "claude_local",
          "run-1",
          invalid,
        );
        const claims = verifyLocalAgentJwt(token!);
        expect(claims!.exp - claims!.iat).toBe(3600);
      }
    });
  });
});
