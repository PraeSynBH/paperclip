import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InMemoryApproverResolver,
  InMemoryBreakGlassAfterActionStore,
  InMemoryKillSwitch,
  InMemoryTeardownLedger,
  RecordingBreakGlassNotifier,
  TeardownService,
  mintTeardownToken,
  redeemTeardownToken,
  TEARDOWN_DEFAULT_TTL_SECONDS,
  type ApproverMember,
} from "../tenant-teardown/index.js";

const APPROVER_GROUP = "teardown-approvers";
const TENANT_ID = "company-acme";

function makeResolver(members: ApproverMember[]): InMemoryApproverResolver {
  const r = new InMemoryApproverResolver();
  for (const m of members) r.set(m);
  return r;
}

function baseResolver(): InMemoryApproverResolver {
  return makeResolver([
    { subject: "approver-1", groups: [APPROVER_GROUP] },
    { subject: "approver-2", groups: [APPROVER_GROUP] },
    { subject: "initiator", groups: ["teardown-initiators"] },
    { subject: "operator", groups: ["teardown-operators"] },
  ]);
}

const masterSecret = "unit-test-master-secret-do-not-use-in-prod";

describe("teardown principal baseline (mint/redeem lifecycle)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("mints a token, signs under per-tenant key, redeems atomically (R-precondition)", async () => {
    const resolver = baseResolver();
    const ledger = new InMemoryTeardownLedger();
    const killSwitch = new InMemoryKillSwitch();
    const svc = new TeardownService({
      masterSecret,
      approverResolver: resolver,
      killSwitchProbe: killSwitch,
      ledger,
      approverGroup: APPROVER_GROUP,
    });

    const mint = await svc.mint({
      tenantId: TENANT_ID,
      initiatorSubject: "initiator",
      operatorSubject: "operator",
      approverSubjects: ["approver-1", "approver-2"],
      reason: "DSAR-2026-0001",
      now: Math.floor(Date.now() / 1000),
    });
    expect(mint.status).toBe("ok");
    if (mint.status !== "ok") return;

    expect(mint.claims.op).toBe("teardown");
    expect(mint.claims.tenantId).toBe(TENANT_ID);
    expect(mint.claims.approvers).toEqual(["approver-1", "approver-2"]);
    expect(mint.claims.sub).toBe("initiator");
    expect(mint.claims.operator).toBe("operator");
    expect(mint.claims.scope).toContain("keys.revoke");
    expect(mint.claims.scope).toContain("rows.delete");
    expect(mint.claims.breakGlass).toBe(false);
    expect(mint.claims.exp - mint.claims.iat).toBe(TEARDOWN_DEFAULT_TTL_SECONDS);

    const redeem = await svc.redeem({
      token: mint.token,
      expectedTenantId: TENANT_ID,
      redeemedBy: "operator",
      now: Math.floor(Date.now() / 1000),
    });
    expect(redeem.status).toBe("ok");
  });

  it("rejects a second redemption of the same token (single-use)", async () => {
    const resolver = baseResolver();
    const ledger = new InMemoryTeardownLedger();
    const killSwitch = new InMemoryKillSwitch();
    const svc = new TeardownService({
      masterSecret,
      approverResolver: resolver,
      killSwitchProbe: killSwitch,
      ledger,
      approverGroup: APPROVER_GROUP,
    });
    const now = Math.floor(Date.now() / 1000);
    const mint = await svc.mint({
      tenantId: TENANT_ID,
      initiatorSubject: "initiator",
      operatorSubject: "operator",
      approverSubjects: ["approver-1", "approver-2"],
      reason: "DSAR-2026-0002",
      now,
    });
    expect(mint.status).toBe("ok");
    if (mint.status !== "ok") return;

    const first = await svc.redeem({
      token: mint.token,
      expectedTenantId: TENANT_ID,
      redeemedBy: "operator",
      now,
    });
    const second = await svc.redeem({
      token: mint.token,
      expectedTenantId: TENANT_ID,
      redeemedBy: "operator",
      now: now + 1,
    });
    expect(first.status).toBe("ok");
    expect(second.status).toBe("rejected");
    if (second.status === "rejected") {
      expect(second.code).toBe("already_redeemed");
    }
  });

  it("refuses issuance when the tenant kill-switch is held", async () => {
    const resolver = baseResolver();
    const ledger = new InMemoryTeardownLedger();
    const killSwitch = new InMemoryKillSwitch();
    killSwitch.hold("kill_tenant", TENANT_ID, Math.floor(Date.now() / 1000));
    const result = await mintTeardownToken({
      tenantId: TENANT_ID,
      initiatorSubject: "initiator",
      operatorSubject: "operator",
      approverSubjects: ["approver-1", "approver-2"],
      reason: "DSAR-2026-0003",
      approverGroup: APPROVER_GROUP,
      approverResolver: resolver,
      killSwitchProbe: killSwitch,
      ledger,
      masterSecret,
      now: Math.floor(Date.now() / 1000),
    });
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.code).toBe("kill_switch_held");
    }
  });

  it("refuses issuance when the fleet kill-switch is held", async () => {
    const resolver = baseResolver();
    const ledger = new InMemoryTeardownLedger();
    const killSwitch = new InMemoryKillSwitch();
    killSwitch.hold("kill_fleet", "*", Math.floor(Date.now() / 1000));
    const result = await mintTeardownToken({
      tenantId: TENANT_ID,
      initiatorSubject: "initiator",
      operatorSubject: "operator",
      approverSubjects: ["approver-1", "approver-2"],
      reason: "DSAR-2026-0004",
      approverGroup: APPROVER_GROUP,
      approverResolver: resolver,
      killSwitchProbe: killSwitch,
      ledger,
      masterSecret,
      now: Math.floor(Date.now() / 1000),
    });
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.code).toBe("kill_switch_held");
    }
  });

  it("break-glass issues a token and notifies CISO/Compliance/requester", async () => {
    const resolver = baseResolver();
    const ledger = new InMemoryTeardownLedger();
    const killSwitch = new InMemoryKillSwitch();
    const notifier = new RecordingBreakGlassNotifier();
    const afterAction = new InMemoryBreakGlassAfterActionStore();
    const now = Math.floor(Date.now() / 1000);

    const mint = await mintTeardownToken({
      tenantId: TENANT_ID,
      initiatorSubject: "initiator",
      operatorSubject: "operator",
      approverSubjects: ["approver-1", "approver-2"],
      reason: "BREAK-GLASS: regulator emergency",
      breakGlass: true,
      approverGroup: APPROVER_GROUP,
      approverResolver: resolver,
      killSwitchProbe: killSwitch,
      ledger,
      breakGlassNotifier: notifier,
      masterSecret,
      now,
    });
    expect(mint.status).toBe("ok");
    if (mint.status !== "ok") return;
    expect(mint.claims.breakGlass).toBe(true);
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0].recipients).toEqual(["ciso", "compliance", "requester"]);
    expect(notifier.sent[0].jti).toBe(mint.claims.jti);

    afterAction.record({
      jti: mint.claims.jti,
      filedAt: now + 60,
      filedBy: "operator",
      summary: "regulator emergency resolved; after-action filed",
    });
    expect(afterAction.lookup(mint.claims.jti)).not.toBeNull();
  });

  it("two parallel redemptions of the same token — exactly one wins", async () => {
    const resolver = baseResolver();
    const ledger = new InMemoryTeardownLedger();
    const killSwitch = new InMemoryKillSwitch();
    const svc = new TeardownService({
      masterSecret,
      approverResolver: resolver,
      killSwitchProbe: killSwitch,
      ledger,
      approverGroup: APPROVER_GROUP,
    });
    const now = Math.floor(Date.now() / 1000);
    const mint = await svc.mint({
      tenantId: TENANT_ID,
      initiatorSubject: "initiator",
      operatorSubject: "operator",
      approverSubjects: ["approver-1", "approver-2"],
      reason: "DSAR-2026-0005",
      now,
    });
    if (mint.status !== "ok") throw new Error("setup failed");

    const [a, b] = await Promise.all([
      svc.redeem({ token: mint.token, expectedTenantId: TENANT_ID, redeemedBy: "operator", now }),
      svc.redeem({ token: mint.token, expectedTenantId: TENANT_ID, redeemedBy: "operator", now }),
    ]);
    const wins = [a, b].filter((r) => r.status === "ok");
    const losses = [a, b].filter((r) => r.status === "rejected");
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    if (losses[0].status === "rejected") {
      expect(losses[0].code).toBe("already_redeemed");
    }
  });
});
