/**
 * RBR-844 diagnosis harness.
 *
 * Characterizes the predicate behind
 * `403 Issue is outside this actor's authorization boundary`
 * on `POST /issues/{id}/comments`.
 *
 * This file asserts CURRENT behaviour, not desired behaviour. It exists so the
 * remedy decision in RBR-844 is made against a measured predicate rather than a
 * read of the source. Do not "fix" these expectations without changing the
 * policy in server/src/services/authorization.ts first.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, issueComments, issues } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { authorizationService } from "../services/authorization.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("RBR-844: issue:comment authorization predicate", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-rbr844-comment-boundary-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function company() {
    return db
      .insert(companies)
      .values({
        name: `RBR844 ${randomUUID()}`,
        issuePrefix: `R8${randomUUID().slice(0, 6).toUpperCase()}`,
      })
      .returning()
      .then((rows) => rows[0]!);
  }

  async function agent(companyId: string, role: string, reportsTo: string | null = null) {
    return db
      .insert(agents)
      .values({
        companyId,
        name: `${role} ${randomUUID()}`,
        role,
        reportsTo,
        permissions: {},
        adapterType: "process",
        adapterConfig: {},
        runtimeConfig: {},
      })
      .returning()
      .then((rows) => rows[0]!);
  }

  async function issue(companyId: string, assigneeAgentId: string | null) {
    return db
      .insert(issues)
      .values({
        id: randomUUID(),
        companyId,
        title: `Issue ${randomUUID()}`,
        status: "in_progress",
        priority: "medium",
        assigneeAgentId,
        originKind: "manual",
      })
      .returning()
      .then((rows) => rows[0]!);
  }

  function commentDecision(
    companyId: string,
    actorAgentId: string,
    row: { id: string; assigneeAgentId: string | null; projectId: string | null; parentId: string | null },
  ) {
    return authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgentId, companyId, source: "agent_jwt" },
      action: "issue:comment",
      resource: {
        type: "issue",
        companyId,
        issueId: row.id,
        projectId: row.projectId,
        parentIssueId: row.parentId,
        assigneeAgentId: row.assigneeAgentId,
        assigneeUserId: null,
        status: "in_progress",
      },
      scope: { issueId: row.id, assigneeAgentId: row.assigneeAgentId },
    });
  }

  // ---- Case 1: CEO -> issue assigned to the CTO (RBR-809 / RBR-812 shape) ----
  it("denies a CEO commenting on an issue it assigned to a direct report", async () => {
    const co = await company();
    const ceo = await agent(co.id, "ceo");
    const cto = await agent(co.id, "cto", ceo.id);
    const row = await issue(co.id, cto.id);

    const decision = await commentDecision(co.id, ceo.id, row);

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("deny_missing_grant");
    // The 403 the caller sees says "outside this actor's authorization
    // boundary", implying a boundary that could be widened. The real reason is
    // that `issue:comment` has NO permission key at all
    // (authorization.ts:135 -> permissionForAction returns null), so no grant,
    // role, or scope can ever authorize it. There is nothing to widen.
    expect(decision.explanation).toBe("No agent permission mapping exists for issue:comment.");
  });

  // ---- The boundary is enforced on write but NOT on read ----
  it("allows the same CEO to READ the same issue it cannot comment on", async () => {
    const co = await company();
    const ceo = await agent(co.id, "ceo");
    const cto = await agent(co.id, "cto", ceo.id);
    const row = await issue(co.id, cto.id);

    const read = await authorizationService(db).decide({
      actor: { type: "agent", agentId: ceo.id, companyId: co.id, source: "agent_jwt" },
      action: "issue:read",
      resource: {
        type: "issue",
        companyId: co.id,
        issueId: row.id,
        projectId: null,
        parentIssueId: null,
        assigneeAgentId: cto.id,
        assigneeUserId: null,
        status: "in_progress",
      },
    });

    expect(read.allowed).toBe(true);
    expect(read.reason).toBe("allow_company_agent");
  });

  // ---- The boundary is enforced on write but NOT on assign ----
  it("allows the same CEO to ASSIGN work it will then be unable to comment on", async () => {
    const co = await company();
    const ceo = await agent(co.id, "ceo");
    const cto = await agent(co.id, "cto", ceo.id);

    const assign = await authorizationService(db).decide({
      actor: { type: "agent", agentId: ceo.id, companyId: co.id, source: "agent_jwt" },
      action: "tasks:assign",
      resource: { type: "issue", companyId: co.id, assigneeAgentId: cto.id },
      scope: { assigneeAgentId: cto.id },
    });

    expect(assign.allowed).toBe(true);
  });

  // ---- Case 2: CTO -> deploy train assigned to somebody else (RBR-805 shape) ----
  it("denies a CTO commenting on an issue assigned to one of its own reports", async () => {
    const co = await company();
    const ceo = await agent(co.id, "ceo");
    const cto = await agent(co.id, "cto", ceo.id);
    const eng = await agent(co.id, "engineer", cto.id);
    const row = await issue(co.id, eng.id);

    const decision = await commentDecision(co.id, cto.id, row);

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("deny_missing_grant");
  });

  // ---- Case 3: the relay issue. Self-assigned => allowed. Report-assigned => denied. ----
  it("allows commenting when the actor is the assignee, and denies when addressing is wrong (RBR-815 shape)", async () => {
    const co = await company();
    const ceo = await agent(co.id, "ceo");
    const cto = await agent(co.id, "cto", ceo.id);

    const selfAssigned = await issue(co.id, ceo.id);
    const allowedDecision = await commentDecision(co.id, ceo.id, selfAssigned);
    expect(allowedDecision.allowed).toBe(true);
    expect(allowedDecision.reason).toBe("allow_self");

    // The relay as actually filed: addressed to the CTO, so the CEO is locked out
    // of the very object it created to work around being locked out.
    const relayToCto = await issue(co.id, cto.id);
    const deniedDecision = await commentDecision(co.id, ceo.id, relayToCto);
    expect(deniedDecision.allowed).toBe(false);
  });

  // ---- Unassigned issues are writable by anyone in the company ----
  it("allows any company agent to comment on an issue with no agent assignee", async () => {
    const co = await company();
    const eng = await agent(co.id, "engineer");
    const row = await issue(co.id, null);

    const decision = await commentDecision(co.id, eng.id, row);

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("allow_company_agent");
  });

  // ---- The ONLY cross-boundary comment escape hatch that exists today ----
  it("allows a cross-boundary comment when the assignee has @-mentioned the actor", async () => {
    const co = await company();
    const ceo = await agent(co.id, "ceo");
    const cto = await agent(co.id, "cto", ceo.id);
    const row = await issue(co.id, cto.id);

    // The assignee (cto) mentions the ceo. Only the assignee can mint this grant.
    await db.insert(issueComments).values({
      companyId: co.id,
      issueId: row.id,
      body: `Need a decision from [@CEO](agent://${ceo.id}) on this.`,
      authorAgentId: cto.id,
      authorUserId: null,
    });

    const decision = await commentDecision(co.id, ceo.id, row);

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("allow_issue_mention_grant");
  });

  // A bare `agent://<uuid>` URI does NOT mint the grant: the SQL prefilter in
  // agentHasMentionGrantOnIssue matches on LIKE '%agent://<id>%', but the
  // authoritative extractor requires full markdown link syntax. Prose that
  // names the agent by URI looks like a mention and is not one.
  it("does NOT grant on a bare agent:// URI that is not a markdown mention link", async () => {
    const co = await company();
    const ceo = await agent(co.id, "ceo");
    const cto = await agent(co.id, "cto", ceo.id);
    const row = await issue(co.id, cto.id);

    await db.insert(issueComments).values({
      companyId: co.id,
      issueId: row.id,
      body: `Need a decision from agent://${ceo.id} on this.`,
      authorAgentId: cto.id,
      authorUserId: null,
    });

    const decision = await commentDecision(co.id, ceo.id, row);

    expect(decision.allowed).toBe(false);
  });

  it("does NOT let the actor mint its own mention grant by mentioning itself", async () => {
    const co = await company();
    const ceo = await agent(co.id, "ceo");
    const cto = await agent(co.id, "cto", ceo.id);
    const row = await issue(co.id, cto.id);

    await db.insert(issueComments).values({
      companyId: co.id,
      issueId: row.id,
      body: `[@CEO](agent://${ceo.id}) self-reference`,
      authorAgentId: ceo.id,
      authorUserId: null,
    });

    const decision = await commentDecision(co.id, ceo.id, row);

    expect(decision.allowed).toBe(false);
  });

  // ---- The finding: manager-chain authority EXISTS but is not consulted here ----
  it("allow_manager_chain resolves for tasks:manage_active_checkouts but is never consulted for issue:comment", async () => {
    const co = await company();
    const ceo = await agent(co.id, "ceo");
    const cto = await agent(co.id, "cto", ceo.id);
    const row = await issue(co.id, cto.id);

    const checkoutDecision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: ceo.id, companyId: co.id, source: "agent_jwt" },
      action: "tasks:manage_active_checkouts",
      resource: { type: "issue", companyId: co.id, issueId: row.id, assigneeAgentId: cto.id },
    });

    // The manager relationship is already modelled and already resolvable.
    expect(checkoutDecision.allowed).toBe(true);

    // ...yet the identical actor/resource pair is denied for issue:comment,
    // because the issue:comment branch returns before any manager-chain check.
    const comment = await commentDecision(co.id, ceo.id, row);
    expect(comment.allowed).toBe(false);
  });
});
