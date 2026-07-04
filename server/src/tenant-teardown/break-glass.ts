/**
 * Break-glass override path (G2).
 *
 * A break-glass override allows a teardown to proceed in an emergency
 * without the standard dual-control approver set. It is NEVER silent:
 *   1. The token carries an explicit `breakGlass: true` claim.
 *   2. Issuance emits an immediate notification to CISO, Compliance,
 *      and the requester.
 *   3. A 24h after-action record is required (operator must file it
 *      via `recordBreakGlassAfterAction` within 24h of issuance).
 *   4. The audit chain entry is tagged with `kind = "teardown_break_glass"`
 *      and references the token's jti.
 *
 * Even with break-glass, the operator and initiator are still distinct,
 * and the kill-switch is still respected (the spec only relaxes the
 * approver set, not the runtime guardrails).
 */
export type BreakGlassRole = "ciso" | "compliance" | "requester";

export interface BreakGlassNotification {
  jti: string;
  tenantId: string;
  recipients: readonly BreakGlassRole[];
  reason: string;
  requestedBy: string;
  issuedAt: number;
}

export interface BreakGlassNotifier {
  notify(input: BreakGlassNotification): Promise<void>;
}

/** Default notifier — records the call. Production wiring would call
 *  out to the paging/notification system (PagerDuty, Slack, etc.). */
export class RecordingBreakGlassNotifier implements BreakGlassNotifier {
  public sent: BreakGlassNotification[] = [];

  async notify(input: BreakGlassNotification): Promise<void> {
    this.sent.push(input);
  }
}

export interface BreakGlassAfterAction {
  jti: string;
  filedAt: number;
  filedBy: string;
  summary: string;
}

export interface BreakGlassAfterActionStore {
  record(input: BreakGlassAfterAction): void;
  lookup(jti: string): BreakGlassAfterAction | null;
}

/** In-memory store keyed by jti. A production deployment would back
 *  this with the audit chain so after-action records are tamper-evident. */
export class InMemoryBreakGlassAfterActionStore implements BreakGlassAfterActionStore {
  private byJti = new Map<string, BreakGlassAfterAction>();

  record(input: BreakGlassAfterAction): void {
    if (this.byJti.has(input.jti)) {
      throw new Error(`break-glass after-action already filed for jti ${input.jti}`);
    }
    this.byJti.set(input.jti, input);
  }

  lookup(jti: string): BreakGlassAfterAction | null {
    return this.byJti.get(jti) ?? null;
  }
}

export const BREAK_GLASS_AFTER_ACTION_WINDOW_SECONDS = 24 * 60 * 60;

export function isAfterActionOverdue(input: { jti: string; issuedAt: number; now: number; store: BreakGlassAfterActionStore }): boolean {
  if (input.store.lookup(input.jti)) return false;
  return input.now - input.issuedAt > BREAK_GLASS_AFTER_ACTION_WINDOW_SECONDS;
}
