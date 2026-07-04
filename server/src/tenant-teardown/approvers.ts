/**
 * Approver / IdP group plumbing for dual-control teardown authorization.
 *
 * The teardown principal requires two distinct approvers from a designated
 * IdP approver group (e.g. `teardown-approvers`). Initiator and operator
 * must NOT be in that group (SoD). The check is the **last** gate before
 * a token is issued; without two valid, distinct, non-initiator/non-operator
 * approvers, no token can be minted.
 *
 * The actual IdP integration (RAM-177 / RAM-9.2) lives in the policy-plane
 * principal model. This module exposes a small, testable interface so the
 * issuance service can plug in whichever IdP-backed resolver the project
 * lands on. The default in-memory implementation is suitable for tests
 * and GameDay failure-injection.
 */
export interface ApproverMember {
  /** Stable IdP subject (sub). */
  subject: string;
  /** Approver groups this subject is a member of. */
  groups: readonly string[];
}

export interface ApproverResolver {
  /** Return the approver record for a subject, or null if not found. */
  lookup(subject: string): ApproverMember | null;
}

export class InMemoryApproverResolver implements ApproverResolver {
  private bySubject = new Map<string, ApproverMember>();

  set(member: ApproverMember): void {
    this.bySubject.set(member.subject, member);
  }

  remove(subject: string): void {
    this.bySubject.delete(subject);
  }

  lookup(subject: string): ApproverMember | null {
    return this.bySubject.get(subject) ?? null;
  }
}

export type ApproverCheckResult =
  | { ok: true; approvers: ApproverMember[] }
  | { ok: false; reason: string };

/**
 * Validate the dual-control approver set against the IdP resolver.
 *
 * - Each approver must be a member of `approverGroup`.
 * - Each approver must be distinct (SoD: no two approvers share a subject).
 * - Initiator (`initiatorSubject`) must NOT be in the approver group.
 * - Operator (`operatorSubject`) must NOT be in the approver group.
 * - The approver set must contain at least 2 distinct approvers.
 */
export function checkApprovers(input: {
  approverSubjects: readonly string[];
  approverGroup: string;
  initiatorSubject: string;
  operatorSubject: string;
  resolver: ApproverResolver;
}): ApproverCheckResult {
  if (!input.approverGroup) {
    return { ok: false, reason: "approver group not configured" };
  }
  if (input.approverSubjects.length < 2) {
    return { ok: false, reason: "dual-control requires at least 2 approvers" };
  }
  if (new Set(input.approverSubjects).size !== input.approverSubjects.length) {
    return { ok: false, reason: "approvers must be distinct subjects" };
  }

  const resolved: ApproverMember[] = [];
  for (const subject of input.approverSubjects) {
    const member = input.resolver.lookup(subject);
    if (!member) {
      return { ok: false, reason: `approver ${subject} not found in IdP` };
    }
    if (!member.groups.includes(input.approverGroup)) {
      return {
        ok: false,
        reason: `approver ${subject} is not a member of approver group ${input.approverGroup}`,
      };
    }
    resolved.push(member);
  }

  // SoD: initiator and operator must not be approvers.
  if (input.approverSubjects.includes(input.initiatorSubject)) {
    return { ok: false, reason: "initiator cannot be an approver (SoD)" };
  }
  if (input.approverSubjects.includes(input.operatorSubject)) {
    return { ok: false, reason: "operator cannot be an approver (SoD)" };
  }

  // Belt-and-braces: the resolved records' groups must not contain the
  // initiator or operator either (defends against stale / orphaned IdP
  // membership that hasn't been revoked yet but the approver set was
  // constructed before revocation).
  for (const a of resolved) {
    if (a.subject === input.initiatorSubject) {
      return { ok: false, reason: "initiator resolved as approver (SoD)" };
    }
    if (a.subject === input.operatorSubject) {
      return { ok: false, reason: "operator resolved as approver (SoD)" };
    }
  }

  return { ok: true, approvers: resolved };
}
