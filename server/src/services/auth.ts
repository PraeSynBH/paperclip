import type { Request } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { unauthorized } from "../errors.js";

export interface VoyonderAuth {
  userId: string;
  companyId: string;
}

const SUPPORTED_JWT_ALG = "HS256";

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function parseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function safeCompare(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function signPayload(secret: string, signingInput: string): string {
  return createHmac("sha256", secret).update(signingInput).digest("base64url");
}

/**
 * Return all configured JWT secrets in priority order.
 *
 * Both BETTER_AUTH_SECRET (used for user session JWTs) and
 * PAPERCLIP_AGENT_JWT_SECRET (used for Paperclip agent JWTs) are tried
 * during signature verification so that tokens signed with either secret
 * are accepted. This mirrors the dual-secret pattern in agent-auth-jwt.ts.
 *
 * In production both variables should be set to distinct, independent values
 * to maintain the trust boundary between user sessions and agent identities.
 */
function jwtSecrets(): string[] {
  const secrets: string[] = [];
  const betterAuth = process.env.BETTER_AUTH_SECRET?.trim();
  const agentJwt = process.env.PAPERCLIP_AGENT_JWT_SECRET?.trim();
  if (betterAuth) secrets.push(betterAuth);
  if (agentJwt) secrets.push(agentJwt);
  return secrets;
}

/**
 * Assert that the request carries a valid Voyonder JWT and return the
 * authenticated user's id and company id.
 *
 * Expects the JWT in the Authorization header as `Bearer <token>`.
 * The JWT is an HS256 JWT containing at minimum `sub` (userId) and
 * `company_id` claims, signed with the instance JWT secret
 * (BETTER_AUTH_SECRET or PAPERCLIP_AGENT_JWT_SECRET).
 *
 * Throws 401 Unauthorized when the token is missing, expired, or invalid.
 */
export function assertVoyonderAuth(req: Request): VoyonderAuth {
  const authHeader = req.header("authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    throw unauthorized("Missing or invalid authorization header");
  }

  const token = authHeader.slice("bearer ".length).trim();
  if (!token) {
    throw unauthorized("Missing authorization token");
  }

  const secrets = jwtSecrets();
  if (secrets.length === 0) {
    throw unauthorized("Auth secret not configured");
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw unauthorized("Invalid token format");
  }
  const [headerB64, claimsB64, signature] = parts;

  // Validate JWT header algorithm — reject tokens claiming non-HS256 alg.
  // Even though we always verify with HMAC-SHA256, validating the header alg
  // closes a standards-compliance gap and makes algorithm-related signing
  // failures easier to diagnose.
  const header = parseJson(base64UrlDecode(headerB64));
  if (!header || typeof header.alg !== "string" || header.alg !== SUPPORTED_JWT_ALG) {
    throw unauthorized("Unsupported JWT algorithm");
  }

  const signingInput = `${headerB64}.${claimsB64}`;

  // Try each configured secret — accept the token if ANY secret validates.
  // This ensures both user-session JWTs (signed with BETTER_AUTH_SECRET) and
  // Paperclip agent JWTs (signed with PAPERCLIP_AGENT_JWT_SECRET) are accepted.
  let signatureValid = false;
  for (const secret of secrets) {
    const expectedSig = signPayload(secret, signingInput);
    if (safeCompare(signature, expectedSig)) {
      signatureValid = true;
      break;
    }
  }
  if (!signatureValid) {
    throw unauthorized("Invalid token signature");
  }

  const claims = parseJson(base64UrlDecode(claimsB64));
  if (!claims) {
    throw unauthorized("Invalid token claims");
  }

  const userId = typeof claims.sub === "string" ? claims.sub : null;
  const companyId = typeof claims.company_id === "string" ? claims.company_id : null;
  if (!userId || !companyId) {
    throw unauthorized("Token missing userId or companyId");
  }

  // Validate URL param companyId matches JWT companyId — catches mismatches
  // without changing routing contracts. Routes without :companyId are unaffected
  // (req.params.companyId is undefined, so the check is a no-op).
  if (req.params.companyId && req.params.companyId !== companyId) {
    throw unauthorized("Token companyId does not match URL companyId");
  }

  // Require exp claim — tokens without expiration are rejected immediately.
  if (typeof claims.exp !== "number") {
    throw unauthorized("Token missing expiration (exp claim required)");
  }
  if (claims.exp < Math.floor(Date.now() / 1000)) {
    throw unauthorized("Token expired");
  }

  return { userId, companyId };
}
