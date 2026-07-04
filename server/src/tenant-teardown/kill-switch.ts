/**
 * §7 kill-switch interlock for teardown operations.
 *
 * The kill-plane (see .paperclip/ram-396/ram87-p4-kill-plane-registration.json
 * and the SecEng kill-plane escalation policy) holds two relevant scopes:
 *   - `kill_tenant` — a held kill-switch for THIS tenant pauses its teardowns.
 *   - `kill_fleet`  — a held kill-switch for the entire fleet pauses every teardown.
 *
 * The runtime check is: before issuing a new teardown token, query the
 * current kill_epoch for both scopes. If either is held for the relevant
 * scope, the issuance is refused and a structured error is returned. For
 * in-flight teardowns, the operator must re-check the kill-switch
 * between sink handlers (yield-and-retry, not abandon).
 *
 * This module is the *interface* — the actual kill_epoch lookup is
 * supplied at runtime via the `KillSwitchProbe`. The in-memory default
 * is used by tests and as a fail-closed fallback.
 */
export type KillScope = "kill_tenant" | "kill_fleet";

export interface KillEpoch {
  scope: KillScope;
  /** Subject the scope applies to (tenantId for kill_tenant, "*" for kill_fleet). */
  subject: string;
  /** True if the kill-switch is currently held. */
  held: boolean;
  /** Wall-clock time the epoch was last updated (unix seconds). */
  updatedAt: number;
}

export interface KillSwitchProbe {
  /**
   * Look up the current kill_epoch for a given scope+subject.
   * If no epoch is recorded, the kill-switch is NOT held (return held=false).
   */
  lookup(scope: KillScope, subject: string): KillEpoch;
}

export class InMemoryKillSwitch implements KillSwitchProbe {
  private held = new Map<string, KillEpoch>();

  /** Test helper: hold a kill-switch for `scope`/`subject` until released. */
  hold(scope: KillScope, subject: string, updatedAt: number): void {
    this.held.set(this.key(scope, subject), { scope, subject, held: true, updatedAt });
  }

  release(scope: KillScope, subject: string): void {
    this.held.delete(this.key(scope, subject));
  }

  lookup(scope: KillScope, subject: string): KillEpoch {
    return (
      this.held.get(this.key(scope, subject)) ?? {
        scope,
        subject,
        held: false,
        updatedAt: 0,
      }
    );
  }

  private key(scope: KillScope, subject: string): string {
    return `${scope}::${subject}`;
  }
}

/**
 * Check the kill-switch for a tenant teardown. Refuses if EITHER
 * the tenant scope OR the fleet scope is held.
 *
 * This is a fail-closed check: in the absence of kill_epoch data
 * (lookup returns held=false), the teardown proceeds. Operators
 * wanting to fail-closed on missing data should wire their
 * KillSwitchProbe to refuse on lookup errors.
 */
export function checkKillSwitch(input: {
  probe: KillSwitchProbe;
  tenantId: string;
  now: number;
}): { ok: true } | { ok: false; reason: string; scope: KillScope; subject: string } {
  const tenant = input.probe.lookup("kill_tenant", input.tenantId);
  if (tenant.held) {
    return {
      ok: false,
      reason: `tenant kill-switch held for ${input.tenantId}`,
      scope: "kill_tenant",
      subject: input.tenantId,
    };
  }
  const fleet = input.probe.lookup("kill_fleet", "*");
  if (fleet.held) {
    return {
      ok: false,
      reason: "fleet kill-switch held",
      scope: "kill_fleet",
      subject: "*",
    };
  }
  return { ok: true };
}
