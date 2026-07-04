import {
  buildTeardownClaims,
  signTeardownToken,
  verifyTeardownToken,
  type SignTeardownTokenInput,
  type TeardownTokenClaims,
} from "./auth.js";
import { checkApprovers, type ApproverResolver } from "./approvers.js";
import { checkKillSwitch, type KillSwitchProbe } from "./kill-switch.js";
import {
  type BreakGlassAfterActionStore,
  type BreakGlassNotifier,
} from "./break-glass.js";
import type { TeardownLedger, RedeemResult } from "./ledger.js";

/**
 * Orchestration layer for the teardown principal + dual-control token.
 *
 * Encapsulates the issuance + redemption workflow:
 *   1. `mintTeardownToken`  — verify approvers, check kill-switch, mint
 *      a signed teardown token, record the jti in the single-use ledger,
 *      and (if break-glass) notify CISO/Compliance/requester.
 *   2. `redeemTeardownToken` — verify signature + claims, atomically
 *      claim the jti in the single-use ledger, return the resolved
 *      claims (or a structured error).
 *
 * The split between verify and ledger.redeem is intentional: signature
 * verification is cheap and pure; the ledger is the source of truth for
 * "has this token been spent?". A token is single-use REGARDLESS of
 * signature validity — a forged/replayed token fails at the ledger.
 */

export interface MintTeardownInput {
  tenantId: string;
  initiatorSubject: string;
  operatorSubject: string;
  approverSubjects: readonly string[];
  approverGroup: string;
  reason: string;
  /** Optional explicit TTL override (must be <= 15min). */
  ttlSeconds?: number;
  /** Optional scope restriction. */
  scope?: SignTeardownTokenInput["scope"];
  /** Mark as a break-glass override (G2). Audited. */
  breakGlass?: boolean;
  /** IdP approver resolver (see approvers.ts). */
  approverResolver: ApproverResolver;
  /** Kill-switch probe. */
  killSwitchProbe: KillSwitchProbe;
  /** Single-use ledger. */
  ledger: TeardownLedger;
  /** Notifier for break-glass overrides. Ignored unless breakGlass=true. */
  breakGlassNotifier?: BreakGlassNotifier;
  /** Master secret used for tenant-bound HMAC signing. */
  masterSecret: string;
  /** Wall-clock time for issuance. Caller-controlled for testability. */
  now: number;
}

export type MintTeardownResult =
  | {
      status: "ok";
      token: string;
      claims: TeardownTokenClaims;
    }
  | {
      status: "rejected";
      reason: string;
      code: MintRejectionCode;
    };

export type MintRejectionCode =
  | "approver_check_failed"
  | "kill_switch_held"
  | "claim_build_failed"
  | "ledger_record_failed";

export interface RedeemTeardownInput {
  token: string;
  expectedTenantId: string;
  redeemedBy: string;
  masterSecret: string;
  ledger: TeardownLedger;
  /** Wall-clock time. */
  now: number;
}

export type RedeemTeardownResult =
  | {
      status: "ok";
      claims: TeardownTokenClaims;
    }
  | {
      status: "rejected";
      reason: string;
      code: RedeemRejectionCode;
    };

export type RedeemRejectionCode =
  | "bad_token"
  | "tenant_mismatch"
  | "expired"
  | "already_redeemed"
  | "unknown_jti";

/**
 * Mint a teardown token. Performs, in order:
 *   1. Approver dual-control check (IdP group membership + SoD).
 *   2. Kill-switch check (tenant + fleet).
 *   3. Claim construction (SoD + TTL).
 *   4. Per-tenant HMAC signing.
 *   5. Single-use ledger `recordIssued` (idempotent).
 *   6. If break-glass: notify CISO + Compliance + requester.
 *
 * The function is `async` so the break-glass notifier can be a real
 * network call. The ledger write is synchronous (in-memory) but
 * typed via the same `Promise<>` to match the eventual DB-backed
 * implementation.
 */
export async function mintTeardownToken(input: MintTeardownInput): Promise<MintTeardownResult> {
  // 1. Approver check.
  const approverCheck = checkApprovers({
    approverSubjects: input.approverSubjects,
    approverGroup: input.approverGroup,
    initiatorSubject: input.initiatorSubject,
    operatorSubject: input.operatorSubject,
    resolver: input.approverResolver,
  });
  if (!approverCheck.ok) {
    return { status: "rejected", reason: approverCheck.reason, code: "approver_check_failed" };
  }

  // 2. Kill-switch check.
  const killCheck = checkKillSwitch({
    probe: input.killSwitchProbe,
    tenantId: input.tenantId,
    now: input.now,
  });
  if (!killCheck.ok) {
    return { status: "rejected", reason: killCheck.reason, code: "kill_switch_held" };
  }

  // 3. Build claims (SoD + TTL).
  let claims: TeardownTokenClaims;
  try {
    claims = buildTeardownClaims(
      {
        tenantId: input.tenantId,
        sub: input.initiatorSubject,
        operator: input.operatorSubject,
        approvers: [...input.approverSubjects],
        reason: input.reason,
        ttlSeconds: input.ttlSeconds,
        scope: input.scope,
        breakGlass: input.breakGlass,
      },
      input.now,
    );
  } catch (err) {
    return {
      status: "rejected",
      reason: err instanceof Error ? err.message : String(err),
      code: "claim_build_failed",
    };
  }

  // 4. Sign with per-tenant derived HMAC.
  const token = signTeardownToken(claims, input.masterSecret);

  // 5. Record issuance in the single-use ledger (idempotent).
  input.ledger.recordIssued({
    jti: claims.jti,
    tenantId: claims.tenantId,
    issuedAt: claims.iat,
    expiresAt: claims.exp,
  });

  // 6. Break-glass notification.
  if (input.breakGlass && input.breakGlassNotifier) {
    await input.breakGlassNotifier.notify({
      jti: claims.jti,
      tenantId: claims.tenantId,
      recipients: ["ciso", "compliance", "requester"],
      reason: claims.reason,
      requestedBy: input.initiatorSubject,
      issuedAt: claims.iat,
    });
  }

  return { status: "ok", token, claims };
}

/**
 * Redeem a teardown token. Performs, in order:
 *   1. Signature + claim verification.
 *   2. Tenant binding (the token's `tenantId` MUST match the caller's).
 *   3. Single-use ledger `redeem` (atomic; refuses on already-redeemed).
 *
 * The verification is intentionally split out so a malformed token
 * fails before the ledger write. A valid-signature but already-spent
 * token still returns the structured "already_redeemed" rejection —
 * which the audit chain treats as a replay attempt.
 */
export async function redeemTeardownToken(input: RedeemTeardownInput): Promise<RedeemTeardownResult> {
  const verify = verifyTeardownToken(input.token, input.masterSecret, input.now);
  if (!verify.ok || !verify.claims) {
    return {
      status: "rejected",
      reason: verify.reason ?? "verify failed",
      code: "bad_token",
    };
  }
  const claims = verify.claims;

  // Tenant binding — even with a valid signature, a token bound to
  // a different tenant is rejected. This closes T12 (EoP cross-tenant
  // teardown token).
  if (claims.tenantId !== input.expectedTenantId) {
    return {
      status: "rejected",
      reason: `token tenant ${claims.tenantId} != expected ${input.expectedTenantId}`,
      code: "tenant_mismatch",
    };
  }

  // Single-use ledger.
  const redeem: RedeemResult = await input.ledger.redeem({
    jti: claims.jti,
    tenantId: claims.tenantId,
    redeemedBy: input.redeemedBy,
    now: input.now,
  });

  if (redeem.status === "already_redeemed") {
    return {
      status: "rejected",
      reason: `jti ${claims.jti} already redeemed at ${redeem.record.redeemedAt}`,
      code: "already_redeemed",
    };
  }
  if (redeem.status === "unknown_jti") {
    return {
      status: "rejected",
      reason: `jti ${claims.jti} not in ledger`,
      code: "unknown_jti",
    };
  }

  return { status: "ok", claims };
}

export interface TeardownServiceDeps {
  masterSecret: string;
  approverResolver: ApproverResolver;
  killSwitchProbe: KillSwitchProbe;
  ledger: TeardownLedger;
  breakGlassNotifier?: BreakGlassNotifier;
  approverGroup: string;
}

export class TeardownService {
  constructor(private readonly deps: TeardownServiceDeps) {}

  async mint(input: Omit<MintTeardownInput, keyof TeardownServiceDeps | "now" | "masterSecret" | "approverResolver" | "killSwitchProbe" | "ledger" | "breakGlassNotifier" | "approverGroup"> & { now: number }): Promise<MintTeardownResult> {
    return mintTeardownToken({
      ...input,
      masterSecret: this.deps.masterSecret,
      approverResolver: this.deps.approverResolver,
      killSwitchProbe: this.deps.killSwitchProbe,
      ledger: this.deps.ledger,
      breakGlassNotifier: this.deps.breakGlassNotifier,
      approverGroup: this.deps.approverGroup,
    });
  }

  async redeem(input: Omit<RedeemTeardownInput, "masterSecret" | "ledger" | "now"> & { now: number }): Promise<RedeemTeardownResult> {
    return redeemTeardownToken({
      ...input,
      masterSecret: this.deps.masterSecret,
      ledger: this.deps.ledger,
    });
  }
}
