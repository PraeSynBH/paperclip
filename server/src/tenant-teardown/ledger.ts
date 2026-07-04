/**
 * Single-use ledger for teardown token redemption.
 *
 * Each issued teardown token has a `jti` (UUID v4). The ledger is keyed
 * on `jti` and records the first redemption. A token can be redeemed at
 * most ONCE; concurrent redemptions with the same jti are serialized so
 * the second caller observes `ALREADY_REDEEMED`. This is the canonical
 * "single-use" property the spec mandates.
 *
 * The default in-memory implementation is suitable for tests and a
 * single-instance deploy. For production / multi-instance, the same
 * `TeardownLedger` interface can be backed by Postgres with a
 * unique-index on (jti) and a row-level FOR UPDATE — the contract
 * is identical.
 */
export type RedemptionStatus =
  | "ok"
  | "already_redeemed"
  | "unknown_jti";

export interface RedemptionRecord {
  jti: string;
  tenantId: string;
  redeemedAt: number;
  redeemedBy: string;
  note?: string;
}

export interface RedeemOk {
  status: "ok";
  record: RedemptionRecord;
}

export interface RedeemAlreadyRedeemed {
  status: "already_redeemed";
  record: RedemptionRecord;
}

export interface RedeemUnknown {
  status: "unknown_jti";
}

export type RedeemResult = RedeemOk | RedeemAlreadyRedeemed | RedeemUnknown;

export interface TeardownLedger {
  /**
   * Record a redemption. Returns ok if this is the first time the jti
   * is seen, already_redeemed if the jti has been seen before, and
   * unknown_jti if the jti was never issued.
   *
   * `known` is the set of jtis the ledger has been told about (issued
   * but never redeemed). A jti is "known" once `recordIssued` is called
   * for it; without that, the ledger cannot distinguish "unissued jti"
   * from "issued but already redeemed" — but for security purposes we
   * treat unknown jti as a redemption failure.
   *
   * The interface is `Promise<>`-shaped so a DB-backed implementation
   * (row-level `SELECT … FOR UPDATE`) can be a drop-in. The
   * in-memory implementation uses a per-jti lock to provide the
   * same atomicity.
   */
  redeem(input: {
    jti: string;
    tenantId: string;
    redeemedBy: string;
    now: number;
    note?: string;
  }): Promise<RedeemResult>;
  /** Mark a jti as issued (so the ledger can distinguish "unknown" from "already redeemed"). */
  recordIssued(input: { jti: string; tenantId: string; issuedAt: number; expiresAt: number }): void;
  /** Lookup a prior redemption record (read-only). */
  lookup(jti: string): RedemptionRecord | null;
  /** Test helper: reset state. */
  reset(): void;
}

/**
 * In-memory implementation of the single-use ledger. Used by tests and
 * as a reference for the eventual DB-backed implementation. Concurrency
 * is enforced via a simple per-jti mutex; the contract is the same as
 * a row-level `SELECT … FOR UPDATE` on a `teardown_token_jtis` table.
 */
export class InMemoryTeardownLedger implements TeardownLedger {
  private issued = new Map<string, { tenantId: string; issuedAt: number; expiresAt: number }>();
  private redemptions = new Map<string, RedemptionRecord>();
  private locks = new Map<string, Promise<void>>();

  recordIssued(input: { jti: string; tenantId: string; issuedAt: number; expiresAt: number }): void {
    if (this.issued.has(input.jti)) return; // idempotent
    this.issued.set(input.jti, {
      tenantId: input.tenantId,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
    });
  }

  lookup(jti: string): RedemptionRecord | null {
    return this.redemptions.get(jti) ?? null;
  }

  async redeem(input: {
    jti: string;
    tenantId: string;
    redeemedBy: string;
    now: number;
    note?: string;
  }): Promise<RedeemResult> {
    // Per-jti lock — concurrent redemptions of the same jti serialize.
    const prev = this.locks.get(input.jti) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    this.locks.set(input.jti, prev.then(() => next));
    await prev;
    try {
      if (!this.issued.has(input.jti)) {
        return { status: "unknown_jti" };
      }
      const existing = this.redemptions.get(input.jti);
      if (existing) {
        return { status: "already_redeemed", record: existing };
      }
      const issued = this.issued.get(input.jti)!;
      // Cross-tenant redemption of a known jti is a hard reject: the
      // ledger remembers the tenant it was issued under.
      if (issued.tenantId !== input.tenantId) {
        return { status: "unknown_jti" };
      }
      const record: RedemptionRecord = {
        jti: input.jti,
        tenantId: input.tenantId,
        redeemedAt: input.now,
        redeemedBy: input.redeemedBy,
        note: input.note,
      };
      this.redemptions.set(input.jti, record);
      return { status: "ok", record };
    } finally {
      release();
    }
  }

  reset(): void {
    this.issued.clear();
    this.redemptions.clear();
    this.locks.clear();
  }
}
