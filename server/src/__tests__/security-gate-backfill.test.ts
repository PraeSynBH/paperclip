import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  issueAccessGrantAudit,
  issueAccessGrants,
  issueDecisionOwners,
  issues,
  type Db,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  SECURITY_GATE_GRANT_SOURCE,
  backfillSecurityGateGrants,
  findActiveDecisionOwnersForIssues,
  findActiveGrantsForAgentAndIssues,
  findOpenSecurityGates,
} from "../services/security-gate-backfill.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping security gate backfill tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("security gate backfill", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-security-gate-backfill-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueAccessGrantAudit);
    await db.delete(issueAccessGrants);
    await db.delete(issueDecisionOwners);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function uniqueIssuePrefix(seed: string) {
    return `G${seed.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
  }

  async function seedCompany(seed: string) {
    const companyId = randomUUID();
    const issuePrefix = uniqueIssuePrefix(seed);
    await db.insert(companies).values({
      id: companyId,
      name: `Company-${seed}`,
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });
    return { companyId, issuePrefix };
  }

  async function seedAgent(companyId: string, name: string) {
    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name,
      role: "security",
      status: "active",
      adapterType: "opencode_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    return agentId;
  }

  it("mints grants for open G-gates where the CISO is the active decision owner", async () => {
    const { companyId } = await seedCompany("a1");
    const cisoAgentId = await seedAgent(companyId, "CISO");
    const otherAgentId = await seedAgent(companyId, "OtherReviewer");

    const openGateId = randomUUID();
    const closedGateId = randomUUID();
    const nonGateIssueId = randomUUID();
    const otherOpenGateId = randomUUID();

    await db.insert(issues).values([
      {
        id: openGateId,
        companyId,
        title: "G-gate: payment service hardening",
        status: "todo",
        priority: "high",
      },
      {
        id: closedGateId,
        companyId,
        title: "G-gate: retired — old key rotation",
        status: "done",
        priority: "high",
      },
      {
        id: nonGateIssueId,
        companyId,
        title: "Pay down tech debt in notifications",
        status: "in_progress",
        priority: "medium",
      },
      {
        id: otherOpenGateId,
        companyId,
        title: "G-gate: SOC2 evidence pull",
        status: "in_review",
        priority: "high",
      },
    ]);

    await db.insert(issueDecisionOwners).values([
      {
        companyId,
        issueId: openGateId,
        agentId: cisoAgentId,
        decisionType: "security_gate_verdict",
        assignedByType: "system",
        assignedById: "ram-294",
      },
      {
        companyId,
        issueId: closedGateId,
        agentId: cisoAgentId,
        decisionType: "security_gate_verdict",
        assignedByType: "system",
        assignedById: "ram-294",
      },
      {
        companyId,
        issueId: otherOpenGateId,
        agentId: otherAgentId,
        decisionType: "general_review",
        assignedByType: "system",
        assignedById: "ram-294",
      },
    ]);

    const result = await backfillSecurityGateGrants(db, {
      companyId,
      actor: { type: "system", id: "ram-931" },
    });

    expect(result.scannedIssues).toBe(2);
    expect(result.scannedDecisionOwners).toBe(2);
    expect(result.mintedGrants).toHaveLength(1);
    expect(result.mintedGrants[0]?.issueId).toBe(openGateId);
    expect(result.mintedGrants[0]?.agentId).toBe(cisoAgentId);
    expect(result.mintedGrants[0]?.grantSource).toBe(SECURITY_GATE_GRANT_SOURCE);
    expect(result.skipped.find((s) => s.issueId === otherOpenGateId)?.reason).toBe(
      "non_security_gate_decision_owner",
    );
    expect(result.skipped.find((s) => s.issueId === closedGateId)).toBeUndefined();

    const grants = await db.select().from(issueAccessGrants);
    expect(grants).toHaveLength(1);
    expect(grants[0]?.issueId).toBe(openGateId);
    expect(grants[0]?.agentId).toBe(cisoAgentId);
    expect(grants[0]?.grantedByType).toBe("system");
    expect(grants[0]?.grantedById).toBe("ram-931");
    expect(grants[0]?.grantSource).toBe(SECURITY_GATE_GRANT_SOURCE);
    expect(grants[0]?.scopeRootIssueId).toBe(openGateId);
    expect(grants[0]?.capabilities).toEqual(
      expect.arrayContaining([
        "gate_decision.transition",
        "issue.add_comment",
        "issue.attach_evidence",
        "issue.read",
      ]),
    );

    const auditRows = await db.select().from(issueAccessGrantAudit);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.eventType).toBe("grant_minted");
    expect(auditRows[0]?.grantId).toBe(grants[0]?.id);
    expect(auditRows[0]?.reason).toBe("security_gate_backfill");
    expect(auditRows[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is idempotent: a second run does not mint duplicates", async () => {
    const { companyId } = await seedCompany("a2");
    const cisoAgentId = await seedAgent(companyId, "CISO-A2");
    const gateId = randomUUID();

    await db.insert(issues).values({
      id: gateId,
      companyId,
      title: "G-gate: incident response tabletop",
      status: "in_progress",
      priority: "high",
    });
    await db.insert(issueDecisionOwners).values({
      companyId,
      issueId: gateId,
      agentId: cisoAgentId,
      decisionType: "security_gate_verdict",
      assignedByType: "system",
      assignedById: "ram-294",
    });

    const first = await backfillSecurityGateGrants(db, {
      companyId,
      actor: { type: "system", id: "ram-931" },
    });
    expect(first.mintedGrants).toHaveLength(1);

    const second = await backfillSecurityGateGrants(db, {
      companyId,
      actor: { type: "system", id: "ram-931" },
    });
    expect(second.mintedGrants).toHaveLength(0);
    expect(second.skipped).toHaveLength(1);
    expect(second.skipped[0]?.reason).toBe("agent_already_has_active_grant");

    const grants = await db.select().from(issueAccessGrants);
    expect(grants).toHaveLength(1);
  });

  it("skips revoked decision owners", async () => {
    const { companyId } = await seedCompany("a3");
    const cisoAgentId = await seedAgent(companyId, "CISO-A3");
    const gateId = randomUUID();

    await db.insert(issues).values({
      id: gateId,
      companyId,
      title: "G-gate: data export mTLS",
      status: "todo",
      priority: "high",
    });
    await db.insert(issueDecisionOwners).values({
      companyId,
      issueId: gateId,
      agentId: cisoAgentId,
      decisionType: "security_gate_verdict",
      assignedByType: "system",
      assignedById: "ram-294",
      revokedAt: new Date(),
      revokedByType: "system",
      revokedById: "ram-294",
      revokeReason: "retired",
    });

    const result = await backfillSecurityGateGrants(db, {
      companyId,
      actor: { type: "system", id: "ram-931" },
    });
    expect(result.mintedGrants).toHaveLength(0);
    expect(result.scannedDecisionOwners).toBe(0);
  });

  it("dry run returns the same set of grants without mutating the database", async () => {
    const { companyId } = await seedCompany("a4");
    const cisoAgentId = await seedAgent(companyId, "CISO-A4");
    const gateId = randomUUID();

    await db.insert(issues).values({
      id: gateId,
      companyId,
      title: "G-gate: vendor SSO audit",
      status: "todo",
      priority: "high",
    });
    await db.insert(issueDecisionOwners).values({
      companyId,
      issueId: gateId,
      agentId: cisoAgentId,
      decisionType: "security_gate_verdict",
      assignedByType: "system",
      assignedById: "ram-294",
    });

    const result = await backfillSecurityGateGrants(db, {
      companyId,
      dryRun: true,
      actor: { type: "system", id: "ram-931" },
    });

    expect(result.dryRun).toBe(true);
    expect(result.mintedGrants).toHaveLength(1);
    expect(result.mintedGrants[0]?.grantId).toBe("dry-run");

    const grants = await db.select().from(issueAccessGrants);
    const audit = await db.select().from(issueAccessGrantAudit);
    expect(grants).toHaveLength(0);
    expect(audit).toHaveLength(0);
  });

  it("scopes to the requested company when companyId is provided", async () => {
    const companyA = await seedCompany("a5a");
    const companyB = await seedCompany("a5b");
    const cisoAgentId = await seedAgent(companyA.companyId, "CISO-A5");

    const gateAId = randomUUID();
    const gateBId = randomUUID();

    await db.insert(issues).values([
      {
        id: gateAId,
        companyId: companyA.companyId,
        title: "G-gate: A-side",
        status: "todo",
        priority: "high",
      },
      {
        id: gateBId,
        companyId: companyB.companyId,
        title: "G-gate: B-side",
        status: "todo",
        priority: "high",
      },
    ]);

    await db.insert(issueDecisionOwners).values([
      {
        companyId: companyA.companyId,
        issueId: gateAId,
        agentId: cisoAgentId,
        decisionType: "security_gate_verdict",
        assignedByType: "system",
        assignedById: "ram-294",
      },
      {
        companyId: companyB.companyId,
        issueId: gateBId,
        agentId: cisoAgentId,
        decisionType: "security_gate_verdict",
        assignedByType: "system",
        assignedById: "ram-294",
      },
    ]);

    const result = await backfillSecurityGateGrants(db, {
      companyId: companyA.companyId,
      actor: { type: "system", id: "ram-931" },
    });

    expect(result.companyIds).toEqual([companyA.companyId]);
    expect(result.mintedGrants).toHaveLength(1);
    expect(result.mintedGrants[0]?.companyId).toBe(companyA.companyId);
  });

  it("exposes narrow read helpers used by the script and admin UIs", async () => {
    const { companyId } = await seedCompany("a6");
    const cisoAgentId = await seedAgent(companyId, "CISO-A6");
    const otherAgentId = await seedAgent(companyId, "OtherReviewer-A6");
    const gateId = randomUUID();
    const otherIssueId = randomUUID();

    await db.insert(issues).values([
      {
        id: gateId,
        companyId,
        title: "G-gate: read helper coverage",
        status: "in_review",
        priority: "high",
      },
      {
        id: otherIssueId,
        companyId,
        title: "Some other issue",
        status: "todo",
        priority: "medium",
      },
    ]);

    await db.insert(issueDecisionOwners).values([
      {
        companyId,
        issueId: gateId,
        agentId: cisoAgentId,
        decisionType: "security_gate_verdict",
        assignedByType: "system",
        assignedById: "ram-294",
      },
      {
        companyId,
        issueId: otherIssueId,
        agentId: otherAgentId,
        decisionType: "security_gate_verdict",
        assignedByType: "system",
        assignedById: "ram-294",
      },
    ]);

    const openGates = await findOpenSecurityGates(db, [companyId]);
    expect(openGates.map((g) => g.issueId)).toEqual([gateId]);

    const owners = await findActiveDecisionOwnersForIssues(db, [gateId, otherIssueId]);
    expect(owners).toHaveLength(2);

    const grants = await findActiveGrantsForAgentAndIssues(db, cisoAgentId, [gateId]);
    expect(grants.size).toBe(0);

    await db.insert(issueAccessGrants).values({
      companyId,
      agentId: cisoAgentId,
      issueId: gateId,
      scopeRootIssueId: gateId,
      capabilities: ["gate_decision.transition"],
      grantSource: SECURITY_GATE_GRANT_SOURCE,
      grantedByType: "system",
      grantedById: "test",
    });

    const granted = await findActiveGrantsForAgentAndIssues(db, cisoAgentId, [gateId]);
    expect(granted.has(gateId)).toBe(true);
  });
});
