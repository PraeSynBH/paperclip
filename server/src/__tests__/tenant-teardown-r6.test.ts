import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InMemoryApproverResolver,
  InMemoryKillSwitch,
  InMemoryTeardownLedger,
  mintTeardownToken,
} from "../tenant-teardown/index.js";

/**
 * R6 — teardown rejected without two approvers or with only one → 403.
 *
 * SecEng lense: Foundational Least Privilege + Defense in Depth.
 * Dual-control is the *primary* defense against unilateral teardown
 * by a single compromised admin. The mint path MUST refuse any token
 * that lacks two distinct, group-qualified, non-overlapping approvers.
 *
 * This test fails on the old code (no approver check) and passes on
 * the new code (mintTeardownToken refuses all of these variants).
 */

const APPROVER_GROUP = "teardown-approvers";
const TENANT_ID = "company-acme";
const masterSecret = "unit-test-master-secret";

function resolverWithApprovers(approverSubs: string[]): InMemoryApproverResolver {
  const r = new InMemoryApproverResolver();
  for (const s of approverSubs) r.set({ subject: s, groups: [APPROVER_GROUP] });
  r.set({ subject: "initiator", groups: ["teardown-initiators"] });
  r.set({ subject: "operator", groups: ["teardown-operators"] });
  return r;
}

describe("R6 — teardown rejected without two approvers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects when zero approvers are provided", async () => {
    const resolver = resolverWithApprovers(["approver-1", "approver-2"]);
    const ledger = new InMemoryTeardownLedger();
    const killSwitch = new InMemoryKillSwitch();
    const result = await mintTeardownToken({
      tenantId: TENANT_ID,
      initiatorSubject: "initiator",
      operatorSubject: "operator",
      approverSubjects: [],
      reason: "DSAR-R6-zero",
      approverGroup: APPROVER_GROUP,
      approverResolver: resolver,
      killSwitchProbe: killSwitch,
      ledger,
      masterSecret,
      now: Math.floor(Date.now() / 1000),
    });
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.code).toBe("approver_check_failed");
      expect(result.reason).toMatch(/dual-control/i);
    }
  });

  it("rejects when only one approver is provided", async () => {
    const resolver = resolverWithApprovers(["approver-1", "approver-2"]);
    const ledger = new InMemoryTeardownLedger();
    const killSwitch = new InMemoryKillSwitch();
    const result = await mintTeardownToken({
      tenantId: TENANT_ID,
      initiatorSubject: "initiator",
      operatorSubject: "operator",
      approverSubjects: ["approver-1"],
      reason: "DSAR-R6-one",
      approverGroup: APPROVER_GROUP,
      approverResolver: resolver,
      killSwitchProbe: killSwitch,
      ledger,
      masterSecret,
      now: Math.floor(Date.now() / 1000),
    });
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.code).toBe("approver_check_failed");
      expect(result.reason).toMatch(/dual-control/i);
    }
  });

  it("rejects when the same approver is listed twice (no real dual-control)", async () => {
    const resolver = resolverWithApprovers(["approver-1", "approver-2"]);
    const ledger = new InMemoryTeardownLedger();
    const killSwitch = new InMemoryKillSwitch();
    const result = await mintTeardownToken({
      tenantId: TENANT_ID,
      initiatorSubject: "initiator",
      operatorSubject: "operator",
      approverSubjects: ["approver-1", "approver-1"],
      reason: "DSAR-R6-dup",
      approverGroup: APPROVER_GROUP,
      approverResolver: resolver,
      killSwitchProbe: killSwitch,
      ledger,
      masterSecret,
      now: Math.floor(Date.now() / 1000),
    });
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.code).toBe("approver_check_failed");
      expect(result.reason).toMatch(/distinct/i);
    }
  });

  it("rejects when an approver is not in the approver group (IdP group-membership SoD)", async () => {
    // approver-rogue exists in IdP but is not in the approver group.
    const resolver = new InMemoryApproverResolver();
    resolver.set({ subject: "approver-1", groups: [APPROVER_GROUP] });
    resolver.set({ subject: "approver-rogue", groups: ["some-other-group"] });
    resolver.set({ subject: "initiator", groups: ["teardown-initiators"] });
    resolver.set({ subject: "operator", groups: ["teardown-operators"] });

    const ledger = new InMemoryTeardownLedger();
    const killSwitch = new InMemoryKillSwitch();
    const result = await mintTeardownToken({
      tenantId: TENANT_ID,
      initiatorSubject: "initiator",
      operatorSubject: "operator",
      approverSubjects: ["approver-1", "approver-rogue"],
      reason: "DSAR-R6-group",
      approverGroup: APPROVER_GROUP,
      approverResolver: resolver,
      killSwitchProbe: killSwitch,
      ledger,
      masterSecret,
      now: Math.floor(Date.now() / 1000),
    });
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.code).toBe("approver_check_failed");
      expect(result.reason).toMatch(/not a member of approver group/i);
    }
  });

  it("rejects when the initiator is one of the approvers (SoD)", async () => {
    const resolver = resolverWithApprovers(["approver-1", "approver-2"]);
    const ledger = new InMemoryTeardownLedger();
    const killSwitch = new InMemoryKillSwitch();
    const result = await mintTeardownToken({
      tenantId: TENANT_ID,
      initiatorSubject: "initiator",
      operatorSubject: "operator",
      approverSubjects: ["initiator", "approver-1"],
      reason: "DSAR-R6-sod",
      approverGroup: APPROVER_GROUP,
      approverResolver: resolver,
      killSwitchProbe: killSwitch,
      ledger,
      masterSecret,
      now: Math.floor(Date.now() / 1000),
    });
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.code).toBe("approver_check_failed");
      expect(result.reason).toMatch(/initiator/i);
    }
  });

  it("rejects when the operator is one of the approvers (SoD)", async () => {
    const resolver = resolverWithApprovers(["approver-1", "approver-2"]);
    const ledger = new InMemoryTeardownLedger();
    const killSwitch = new InMemoryKillSwitch();
    const result = await mintTeardownToken({
      tenantId: TENANT_ID,
      initiatorSubject: "initiator",
      operatorSubject: "operator",
      approverSubjects: ["approver-1", "operator"],
      reason: "DSAR-R6-sod-op",
      approverGroup: APPROVER_GROUP,
      approverResolver: resolver,
      killSwitchProbe: killSwitch,
      ledger,
      masterSecret,
      now: Math.floor(Date.now() / 1000),
    });
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.code).toBe("approver_check_failed");
      expect(result.reason).toMatch(/operator/i);
    }
  });
});
