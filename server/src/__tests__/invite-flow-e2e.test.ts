/**
 * VOY-1547 — Invite Flow E2E Test: send invite, accept, membership active.
 *
 * Covers the full invite flow end-to-end against embedded PostgreSQL:
 *
 * 1. Board user sends an invite with viewer/operator/admin role
 * 2. Recipient receives invite token (email delivery optional for test)
 * 3. Recipient accepts invite via POST /api/invites/:token/accept
 * 4. Membership becomes active with correct role
 * 5. Invited user can access company board
 *
 * Pattern: real embedded PG + real services + session-shaped actors with
 * DB-backed memberships (same pattern as routines-e2e.test.ts).
 */

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  authUsers,
  companies,
  companyMemberships,
  createDb,
  invites,
  joinRequests,
  principalPermissionGrants,
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "@paperclipai/db";
import type { HumanCompanyMembershipRole } from "@paperclipai/shared";
import { accessRoutes } from "../routes/access.js";
import { companyRoutes } from "../routes/companies.js";
import { errorHandler } from "../middleware/index.js";
import { accessService } from "../services/access.js";
import { grantsForHumanRole } from "../services/company-member-roles.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe.sequential : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres invite flow E2E tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("invite flow end-to-end", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  // ── Constants ──
  const INVITER_USER_ID = "inviter-user";
  const INVITEE_USER_ID = "invitee-user";

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-invite-flow-e2e-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    // Order matters: children before parents (FK constraints)
    await db.delete(principalPermissionGrants).catch(() => {});
    await db.delete(companyMemberships).catch(() => {});
    await db.delete(joinRequests).catch(() => {});
    await db.delete(invites).catch(() => {});
    await db.delete(companies).catch(() => {});
    await db.delete(authUsers).catch(() => {});
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  // ── Helpers ──

  /**
   * Create an Express app with access routes only. Use this for invite
   * creation and acceptance — the core flow lives under /api/invites
   * and /api/companies/:companyId/invites.
   */
  function createAccessApp(actor: Record<string, unknown>) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = actor;
      next();
    });
    app.use(
      "/api",
      accessRoutes(db, {
        deploymentMode: "authenticated",
        deploymentExposure: "private",
        bindHost: "127.0.0.1",
        allowedHostnames: [],
      }),
    );
    app.use(errorHandler);
    return app;
  }

  /**
   * Create an Express app with both access routes and company routes.
   * Use this for the final "can access company board" assertion so the
   * invited user can hit GET /api/companies/:companyId.
   */
  function createBoardApp(actor: Record<string, unknown>) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = actor;
      next();
    });
    app.use(
      "/api",
      accessRoutes(db, {
        deploymentMode: "authenticated",
        deploymentExposure: "private",
        bindHost: "127.0.0.1",
        allowedHostnames: [],
      }),
    );
    app.use("/api/companies", companyRoutes(db));
    app.use(errorHandler);
    return app;
  }

  /**
   * Seed a company + auth users for inviter and invitee.
   * Returns the company ID.
   */
  async function seedCompany(): Promise<string> {
    const companyId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: `TestCo ${randomUUID().slice(0, 8)}`,
      issuePrefix,
    });

    // Seed auth users so email resolution works during accept
    const now = new Date();
    await db.insert(authUsers).values([
      {
        id: INVITER_USER_ID,
        email: "inviter@example.com",
        name: "Inviter",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: INVITEE_USER_ID,
        email: "invitee@example.com",
        name: "Invitee",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    return companyId;
  }

  /**
   * Create an owner membership + grants for the inviter user so they can
   * create invites (users:invite permission).
   */
  async function createInviterMembership(companyId: string) {
    const access = accessService(db);
    const membership = await access.ensureMembership(
      companyId,
      "user",
      INVITER_USER_ID,
      "owner",
      "active",
    );
    await access.setPrincipalGrants(
      companyId,
      "user",
      INVITER_USER_ID,
      grantsForHumanRole("owner"),
      INVITER_USER_ID,
    );
    return membership;
  }

  /** Actor for the board user who creates the invite. */
  function inviterActor(companyId: string) {
    return {
      type: "board" as const,
      userId: INVITER_USER_ID,
      source: "session" as const,
      isInstanceAdmin: false,
      companyIds: [companyId],
      memberships: [
        { companyId, membershipRole: "owner", status: "active" as const },
      ],
    };
  }

  /** Actor for the user receiving and accepting the invite. */
  function inviteeActor() {
    return {
      type: "board" as const,
      userId: INVITEE_USER_ID,
      source: "session" as const,
      isInstanceAdmin: false,
      companyIds: [] as string[],
      memberships: [] as Array<{
        companyId: string;
        membershipRole: string;
        status: string;
      }>,
    };
  }

  /** Actor for the invitee after they have an active membership. */
  function inviteeWithAccessActor(companyId: string, role: HumanCompanyMembershipRole) {
    return {
      type: "board" as const,
      userId: INVITEE_USER_ID,
      source: "session" as const,
      isInstanceAdmin: false,
      companyIds: [companyId],
      memberships: [
        { companyId, membershipRole: role, status: "active" as const },
      ],
    };
  }

  // ── Expected grants per role (mirrors grantsForHumanRole) ──
  function expectedGrantsForRole(role: HumanCompanyMembershipRole): string[] {
    switch (role) {
      case "owner":
        return [
          "agents:create",
          "skills:create",
          "environments:manage",
          "users:invite",
          "users:manage_permissions",
          "tasks:assign",
          "joins:approve",
        ];
      case "admin":
        return [
          "agents:create",
          "skills:create",
          "environments:manage",
          "users:invite",
          "tasks:assign",
          "joins:approve",
        ];
      case "operator":
        return ["tasks:assign"];
      case "viewer":
        return [];
    }
  }

  // ── The core test parameterized over all three roles ──

  it.each([
    { role: "viewer" as HumanCompanyMembershipRole },
    { role: "operator" as HumanCompanyMembershipRole },
    { role: "admin" as HumanCompanyMembershipRole },
  ])(
    "sends invite with $role role, accepts, membership active, user can access board",
    async ({ role }) => {
      // ── 1. Seed ──
      const companyId = await seedCompany();
      await createInviterMembership(companyId);

      // ── 2. Board user (owner) sends invite ──
      const inviterApp = createAccessApp(inviterActor(companyId));
      const createRes = await request(inviterApp)
        .post(`/api/companies/${companyId}/invites`)
        .send({ allowedJoinTypes: "human", humanRole: role });

      expect(createRes.status).toBe(201);
      expect(createRes.body.token).toMatch(/^pcp_invite_/);
      expect(createRes.body.invitePath).toMatch(/^\/invite\/pcp_invite_/);
      expect(createRes.body.inviteUrl).toMatch(/\/invite\/pcp_invite_/);
      expect(createRes.body.id).toBeTruthy();
      expect(createRes.body.companyName).toBeTruthy();
      // The humanRole is stored inside defaultsPayload, not a top-level column
      expect(createRes.body.defaultsPayload?.human?.role).toBe(role);

      const token: string = createRes.body.token;
      const inviteId: string = createRes.body.id;

      // Verify the invite was persisted in the DB
      const inviteRow = await db
        .select()
        .from(invites)
        .where(eq(invites.id, inviteId))
        .then((rows) => rows[0] ?? null);
      expect(inviteRow).toBeTruthy();
      expect(inviteRow!.companyId).toBe(companyId);
      expect(inviteRow!.invitedByUserId).toBe(INVITER_USER_ID);
      expect(inviteRow!.allowedJoinTypes).toBe("human");
      expect(inviteRow!.acceptedAt).toBeNull();

      // ── 3. Recipient accepts invite ──
      const acceptApp = createAccessApp(inviteeActor());
      const acceptRes = await request(acceptApp)
        .post(`/api/invites/${token}/accept`)
        .send({ requestType: "human" });

      expect(acceptRes.status, `Accept failed: ${JSON.stringify(acceptRes.body)}`).toBe(202);
      expect(acceptRes.body.status).toBe("approved");
      expect(acceptRes.body.requestType).toBe("human");
      expect(acceptRes.body.inviteId).toBe(inviteId);
      expect(acceptRes.body.companyId).toBe(companyId);

      const joinRequestId: string = acceptRes.body.id;

      // ── 4. Verify membership in DB ──

      // 4a. Invite should be marked as accepted
      const acceptedInvite = await db
        .select({ acceptedAt: invites.acceptedAt })
        .from(invites)
        .where(eq(invites.id, inviteId))
        .then((rows) => rows[0] ?? null);
      expect(acceptedInvite).toBeTruthy();
      expect(acceptedInvite!.acceptedAt).toBeTruthy();

      // 4b. Membership should exist with correct role and active status
      const membership = await db
        .select({
          id: companyMemberships.id,
          principalId: companyMemberships.principalId,
          principalType: companyMemberships.principalType,
          membershipRole: companyMemberships.membershipRole,
          status: companyMemberships.status,
        })
        .from(companyMemberships)
        .where(
          and(
            eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, INVITEE_USER_ID),
          ),
        )
        .then((rows) => rows[0] ?? null);
      expect(membership).toBeTruthy();
      expect(membership!.principalId).toBe(INVITEE_USER_ID);
      expect(membership!.principalType).toBe("user");
      expect(membership!.membershipRole).toBe(role);
      expect(membership!.status).toBe("active");

      // 4c. Permission grants should match the role
      const expectedKeys = expectedGrantsForRole(role);
      const actualGrants = await db
        .select({ permissionKey: principalPermissionGrants.permissionKey })
        .from(principalPermissionGrants)
        .where(
          and(
            eq(principalPermissionGrants.companyId, companyId),
            eq(principalPermissionGrants.principalType, "user"),
            eq(principalPermissionGrants.principalId, INVITEE_USER_ID),
          ),
        )
        .orderBy(principalPermissionGrants.permissionKey);
      expect(actualGrants.map((g) => g.permissionKey).sort()).toEqual(
        expectedKeys.sort(),
      );

      // 4d. Join request should be approved
      const joinRequest = await db
        .select({
          status: joinRequests.status,
          approvedByUserId: joinRequests.approvedByUserId,
          approvedAt: joinRequests.approvedAt,
          requestType: joinRequests.requestType,
          requestingUserId: joinRequests.requestingUserId,
        })
        .from(joinRequests)
        .where(eq(joinRequests.id, joinRequestId))
        .then((rows) => rows[0] ?? null);
      expect(joinRequest).toBeTruthy();
      expect(joinRequest!.status).toBe("approved");
      expect(joinRequest!.approvedByUserId).toBe(INVITER_USER_ID);
      expect(joinRequest!.approvedAt).toBeTruthy();
      expect(joinRequest!.requestType).toBe("human");
      expect(joinRequest!.requestingUserId).toBe(INVITEE_USER_ID);

      // ── 5. Invited user can access company board ──
      const boardApp = createBoardApp(inviteeWithAccessActor(companyId, role));
      const accessRes = await request(boardApp).get(
        `/api/companies/${companyId}`,
      );

      // The company detail endpoint just requires assertCompanyAccess and a
      // valid companyId. All roles (even viewer) should pass this read check.
      expect(accessRes.status, `Board access failed: ${JSON.stringify(accessRes.body)}`).toBe(200);
      expect(accessRes.body.id).toBe(companyId);
      expect(accessRes.body.name).toBeTruthy();
    },
    25_000,
  );
});
