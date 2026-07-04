import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const TEARDOWN_JWT_ALGORITHM = "HS256";

/**
 * Canonical scopes that the teardown principal is allowed to exercise.
 *
 * SECURITY (Least Privilege, Foundational G3): the teardown principal is
 * scoped strictly to *destructive* teardown verbs. There is intentionally
 * no `data.read` here. Anyone holding this token cannot read tenant data;
 * they can only destroy/rotate/revoke what the registry of sinks already
 * exposes (see server/src/tenant-data-sinks/).
 */
export const TEARDOWN_SCOPES = [
  "keys.revoke",
  "index.purge",
  "cache.invalidate",
  "rows.delete",
  "chain.append",
] as const;

export type TeardownScope = (typeof TEARDOWN_SCOPES)[number];

export const TEARDOWN_OP = "teardown" as const;
export type TeardownOp = typeof TEARDOWN_OP;

export const TEARDOWN_ISSUER = "paperclip-teardown";
export const TEARDOWN_AUDIENCE = "paperclip-tenant-offboarding";

/** Hard upper bound on the lifetime of a teardown token (15 minutes). */
export const TEARDOWN_MAX_TTL_SECONDS = 15 * 60;

/** Default lifetime if the caller doesn't specify a smaller one. */
export const TEARDOWN_DEFAULT_TTL_SECONDS = 15 * 60;

/** Clock skew tolerance for `nbf` / `exp` checks. */
export const TEARDOWN_CLOCK_SKEW_SECONDS = 5;

export interface TeardownTokenClaims {
  /** Tenant / company id this token is bound to. */
  tenantId: string;
  /** Operation tag — must be `teardown` (stringly typed for forward compat). */
  op: TeardownOp | string;
  /** Scopes the operator is authorized to exercise with this token. */
  scope: readonly TeardownScope[];
  /** Not before (unix seconds). */
  nbf: number;
  /** Expiration (unix seconds). */
  exp: number;
  /** Issued at (unix seconds). */
  iat: number;
  /** Unique token id (single-use ledger key). */
  jti: string;
  /** Distinct approver subjects (SoD: initiator ≠ approver). */
  approvers: string[];
  /** Subject (initiator) — never equal to any approver or operator. */
  sub: string;
  /** Operator (caller redeeming the token) — never equal to any approver. */
  operator: string;
  /** Reason for the teardown — recorded for audit. */
  reason: string;
  /** Break-glass override flag (G2). Always audited; never suppresses dual-control silently. */
  breakGlass?: boolean;
  iss?: string;
  aud?: string;
}

export interface SignTeardownTokenInput {
  tenantId: string;
  approvers: string[];
  sub: string;
  operator: string;
  reason: string;
  /** Override the default 15min TTL. Must be > 0 and <= TEARDOWN_MAX_TTL_SECONDS. */
  ttlSeconds?: number;
  /** Override `nbf`. Defaults to "now". */
  nbf?: number;
  /** Optional explicit jti. Defaults to a v4 uuid. */
  jti?: string;
  /** Optional scope restriction. Defaults to the full TEARDOWN_SCOPES list. */
  scope?: readonly TeardownScope[];
  /** Mark as a break-glass override (must be explicit; audited; dual-control still required). */
  breakGlass?: boolean;
}

export interface TeardownJwtHeader {
  alg: "HS256";
  typ: "JWT";
}

/**
 * Derive a per-tenant signing key from the master secret and a tenantId.
 *
 * This is the same domain-separation pattern as `agent-auth-jwt.ts`: a
 * leaked teardown token cannot be replayed against a different tenant
 * because the signature would no longer verify under that tenant's
 * derived key. The instance-wide master secret is never used to sign
 * teardown tokens.
 */
export function deriveTeardownSigningKey(masterSecret: string, tenantId: string): string {
  if (!masterSecret) throw new Error("teardown: master secret is required");
  if (!tenantId) throw new Error("teardown: tenantId is required");
  return createHmac("sha256", masterSecret).update(`teardown:${tenantId}`).digest("hex");
}

export function mintJti(): string {
  return randomUUID();
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function safeStringEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function parseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function normalizeTeardownScopes(input: readonly TeardownScope[] | undefined): TeardownScope[] {
  if (!input || input.length === 0) return [...TEARDOWN_SCOPES];
  const allowed = new Set<string>(TEARDOWN_SCOPES);
  for (const s of input) {
    if (!allowed.has(s)) {
      throw new Error(`teardown: scope ${s} is not a permitted teardown scope`);
    }
  }
  return [...input];
}

/**
 * Build the claim set for a teardown token. Performs *issuance-time* SoD
 * checks (initiator ≠ approver ≠ operator; at least two distinct approvers).
 *
 * Note: claim construction does NOT enforce the kill-switch interlock —
 * the caller (the issuance service) must check the kill-switch *before*
 * minting a token. This keeps the claim builder pure and testable.
 */
export function buildTeardownClaims(input: SignTeardownTokenInput, now: number): TeardownTokenClaims {
  if (!input.tenantId) throw new Error("teardown: tenantId is required");
  if (!input.sub) throw new Error("teardown: initiator sub is required");
  if (!input.operator) throw new Error("teardown: operator is required");
  if (!input.reason || input.reason.length < 4) throw new Error("teardown: reason is required (>= 4 chars)");
  if (!Array.isArray(input.approvers)) throw new Error("teardown: approvers array is required");
  if (input.approvers.length < 2) {
    throw new Error("teardown: dual-control requires at least 2 distinct approvers");
  }

  const distinctApprovers = new Set(input.approvers);
  if (distinctApprovers.size !== input.approvers.length) {
    throw new Error("teardown: approvers must be distinct (dual-control SoD)");
  }
  if (distinctApprovers.has(input.sub)) {
    throw new Error("teardown: initiator must not appear in approvers (SoD)");
  }
  if (distinctApprovers.has(input.operator)) {
    throw new Error("teardown: operator must not appear in approvers (SoD)");
  }
  if (input.sub === input.operator) {
    throw new Error("teardown: initiator and operator must be distinct (SoD)");
  }

  const ttl = input.ttlSeconds ?? TEARDOWN_DEFAULT_TTL_SECONDS;
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error("teardown: ttlSeconds must be > 0");
  if (ttl > TEARDOWN_MAX_TTL_SECONDS) {
    throw new Error(`teardown: ttlSeconds exceeds the ${TEARDOWN_MAX_TTL_SECONDS}s hard cap`);
  }

  const nbf = input.nbf ?? now;
  const exp = nbf + ttl;
  if (exp <= now) throw new Error("teardown: exp must be in the future");

  return {
    tenantId: input.tenantId,
    op: TEARDOWN_OP,
    scope: normalizeTeardownScopes(input.scope),
    nbf,
    exp,
    iat: now,
    jti: input.jti ?? mintJti(),
    approvers: [...input.approvers],
    sub: input.sub,
    operator: input.operator,
    reason: input.reason,
    breakGlass: input.breakGlass === true,
    iss: TEARDOWN_ISSUER,
    aud: TEARDOWN_AUDIENCE,
  };
}

/**
 * Serialize and sign a teardown token. Returns a compact JWS string.
 *
 * SECURITY: signs with `deriveTeardownSigningKey(masterSecret, tenantId)`
 * — never with the master secret directly. This is the same defense
 * `createLocalAgentJwt` uses against cross-tenant token replay.
 */
export function signTeardownToken(claims: TeardownTokenClaims, masterSecret: string): string {
  const header: TeardownJwtHeader = { alg: TEARDOWN_JWT_ALGORITHM, typ: "JWT" };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const claimsB64 = base64UrlEncode(JSON.stringify(claims));
  const signingInput = `${headerB64}.${claimsB64}`;
  const signingKey = deriveTeardownSigningKey(masterSecret, claims.tenantId);
  const signature = createHmac("sha256", signingKey).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  claims?: TeardownTokenClaims;
}

/**
 * Verify a teardown token's signature and standard claim shape.
 *
 * Does NOT check the single-use ledger (that's redeemTeardownToken in
 * service.ts). Does NOT check the kill-switch (that's the operator's
 * job before *issuing*; for in-flight teardowns the kill-switch is
 * checked in the work-loop).
 */
export function verifyTeardownToken(token: string, masterSecret: string, now: number): VerifyResult {
  if (!token) return { ok: false, reason: "empty token" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed token" };
  const [headerB64, claimsB64, signature] = parts;

  const header = parseJson(base64UrlDecode(headerB64));
  if (!header || header.alg !== TEARDOWN_JWT_ALGORITHM) {
    return { ok: false, reason: "unsupported alg" };
  }

  const rawClaims = parseJson(base64UrlDecode(claimsB64));
  if (!rawClaims) return { ok: false, reason: "malformed claims" };

  const tenantId = typeof rawClaims.tenantId === "string" ? rawClaims.tenantId : null;
  if (!tenantId) return { ok: false, reason: "missing tenantId" };

  const signingInput = `${headerB64}.${claimsB64}`;
  const expectedKey = deriveTeardownSigningKey(masterSecret, tenantId);
  const expectedSig = createHmac("sha256", expectedKey).update(signingInput).digest("base64url");
  if (!safeStringEqual(signature, expectedSig)) {
    return { ok: false, reason: "bad signature" };
  }

  if (rawClaims.op !== TEARDOWN_OP) {
    return { ok: false, reason: `op must be ${TEARDOWN_OP}` };
  }
  if (rawClaims.iss && rawClaims.iss !== TEARDOWN_ISSUER) {
    return { ok: false, reason: "bad issuer" };
  }
  if (rawClaims.aud && rawClaims.aud !== TEARDOWN_AUDIENCE) {
    return { ok: false, reason: "bad audience" };
  }

  const exp = typeof rawClaims.exp === "number" ? rawClaims.exp : null;
  const nbf = typeof rawClaims.nbf === "number" ? rawClaims.nbf : null;
  const iat = typeof rawClaims.iat === "number" ? rawClaims.iat : null;
  const jti = typeof rawClaims.jti === "string" ? rawClaims.jti : null;
  if (!exp || !nbf || !iat || !jti) {
    return { ok: false, reason: "missing time/jti claim" };
  }
  if (now > exp + TEARDOWN_CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "expired" };
  }
  if (now + TEARDOWN_CLOCK_SKEW_SECONDS < nbf) {
    return { ok: false, reason: "not yet valid" };
  }

  const scope = Array.isArray(rawClaims.scope) ? (rawClaims.scope as string[]) : [];
  const allowed = new Set<string>(TEARDOWN_SCOPES);
  for (const s of scope) {
    if (!allowed.has(s)) {
      return { ok: false, reason: `disallowed scope ${s}` };
    }
  }

  const approvers = Array.isArray(rawClaims.approvers) ? (rawClaims.approvers as unknown[]) : [];
  if (approvers.length < 2) {
    return { ok: false, reason: "dual-control requires >= 2 approvers" };
  }
  if (new Set(approvers).size !== approvers.length) {
    return { ok: false, reason: "approvers must be distinct" };
  }

  const sub = typeof rawClaims.sub === "string" ? rawClaims.sub : null;
  const operator = typeof rawClaims.operator === "string" ? rawClaims.operator : null;
  if (!sub || !operator) return { ok: false, reason: "missing sub/operator" };
  if (sub === operator) return { ok: false, reason: "initiator == operator" };
  if (approvers.includes(sub) || approvers.includes(operator)) {
    return { ok: false, reason: "SoD violation" };
  }

  const claims: TeardownTokenClaims = {
    tenantId,
    op: TEARDOWN_OP,
    scope: scope as TeardownScope[],
    nbf,
    exp,
    iat,
    jti,
    approvers: approvers as string[],
    sub,
    operator,
    reason: typeof rawClaims.reason === "string" ? rawClaims.reason : "",
    breakGlass: rawClaims.breakGlass === true,
    iss: typeof rawClaims.iss === "string" ? rawClaims.iss : TEARDOWN_ISSUER,
    aud: typeof rawClaims.aud === "string" ? rawClaims.aud : TEARDOWN_AUDIENCE,
  };
  return { ok: true, claims };
}
