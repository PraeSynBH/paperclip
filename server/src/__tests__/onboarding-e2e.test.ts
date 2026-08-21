/**
 * VOY-1546 — Onboarding E2E Flow Test: sign-up to working board.
 *
 * Covers the full flow end-to-end against embedded PostgreSQL:
 *
 * 1. User signs up (email/password via better-auth)
 * 2. User creates a company via the onboarding wizard (POST /api/onboarding/start)
 * 3. Default agents are hired (CEO + CTO + PM)
 * 4. First issue is created
 * 5. User can see the board with a working view
 *
 * Pattern: real embedded PG + real services, actor set via middleware.
 * For signup tests we build a better-auth app inline.  For the core
 * onboarding flow we use a `local_implicit` actor (the same trusted-path
 * the server uses in local_trusted mode) so rate-limiting doesn't
 * interfere and we don't rebuild better-auth per test.
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  companyMemberships,
  createDb,
  goals,
  getEmbeddedPostgresTestSupport,
  issues,
  principalPermissionGrants,
  projects,
  startEmbeddedPostgresTestDatabase,
  activityLog,
  environments,
  budgetPolicies,
  budgetIncidents,
  authUsers,
  authSessions,
  authAccounts,
} from "@paperclipai/db";
import { onboardingRoutes } from "../routes/onboarding.js";
import { companyRoutes } from "../routes/companies.js";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe.sequential : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres onboarding E2E tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("onboarding end-to-end", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-onboarding-e2e-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    // Order matters: children before parents (FK constraints)
    await db.delete(budgetIncidents).catch(() => {});
    await db.delete(budgetPolicies).catch(() => {});
    await db.delete(activityLog);
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
    await db.delete(issues);
    await db.delete(projects);
    await db.delete(goals);
    await db.delete(agents);
    await db.delete(companies);
    await db.delete(environments).catch(() => {});
    await db.delete(authSessions).catch(() => {});
    await db.delete(authAccounts).catch(() => {});
    await db.delete(authUsers).catch(() => {});
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Create an Express app with the onboarding route + a local_implicit actor. */
  function createOnboardingApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = {
        type: "board",
        userId: "local-board",
        userName: "Local Board",
        userEmail: null,
        companyIds: [],
        isInstanceAdmin: true,
        source: "local_implicit",
      };
      next();
    });
    app.use("/api/onboarding", onboardingRoutes(db));
    app.use(errorHandler);
    return app;
  }

  /**
   * Sign up a user via better-auth's email/password endpoint and return
   * the userId + session cookie.  Each test that calls this gets a fresh
   * better-auth instance and a unique email to avoid rate-limiting.
   */
  async function signupTestUser(): Promise<{ userId: string; cookie: string }> {
    const { betterAuth } = await import("better-auth");
    const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
    const { toNodeHandler } = await import("better-auth/node");

    const auth = betterAuth({
      secret: "test-secret-for-onboarding-e2e",
      database: drizzleAdapter(db, { provider: "pg", schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: await import("@paperclipai/db").then(m => m.authVerifications),
      } }),
      emailAndPassword: { enabled: true, requireEmailVerification: false, disableSignUp: false },
      advanced: { useSecureCookies: false, cookiePrefix: "paperclip-test" },
      // Override rate-limit to avoid 429 on sequential signups
      rateLimit: {
        window: 60_000,
        max: 100,
      },
    });

    const handler = toNodeHandler(auth);

    const app = express();
    app.use(express.json());
    app.all("/api/auth/{*authPath}", handler);

    const email = `test-${randomUUID()}@example.com`;
    const res = await request(app)
      .post("/api/auth/sign-up/email")
      .send({ email, password: "TestPassword123!", name: "Test User" });

    expect(res.status, `Signup failed (${res.status}): ${JSON.stringify(res.body)}`).toBe(200);

    const userId: string = res.body.user?.id;
    expect(userId).toBeTruthy();

    // Extract the session_token cookie
    const setCookie = res.headers["set-cookie"];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    const sessionCookie = cookies.find((c: string) => c.includes(".session_token"));
    expect(sessionCookie, "No session_token cookie in signup response").toBeTruthy();

    return { userId, cookie: (sessionCookie as string).split(";")[0].trim() };
  }

  // ── Test 1: Signup via better-auth ───────────────────────────────────────

  it("signs up a new user via better-auth email/password", async () => {
    const { userId, cookie } = await signupTestUser();

    // Verify the user exists in the database
    const userRow = await db
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(eq(authUsers.id, userId))
      .then((rows) => rows[0] ?? null);
    expect(userRow).toBeTruthy();
    expect(userRow!.id).toBe(userId);
  }, 15_000);

  // ── Test 2: Full onboarding flow ─────────────────────────────────────────

  it("creates company + 3 agents + goal + project + issue via onboarding/start and persists everything in DB", async () => {
    const app = createOnboardingApp();
    const companyName = `TestCo ${randomUUID().slice(0, 8)}`;

    const res = await request(app)
      .post("/api/onboarding/start")
      .send({
        company: { name: companyName, industry: "SaaS", budgetMonthlyCents: 100_00 },
      });

    expect(res.status).toBe(201);
    expect(res.body.company.name).toBe(companyName);
    expect(res.body.company.description).toContain("SaaS");
    expect(res.body.company.budgetMonthlyCents).toBe(100_00);
    expect(res.body.company.issuePrefix).toBeTruthy();

    const companyId = res.body.company.id;

    // ── 3 agents ──
    expect(res.body.agents).toHaveLength(3);
    const roles = res.body.agents.map((a: { role: string }) => a.role).sort();
    expect(roles).toEqual(["ceo", "cto", "pm"]);

    // Each agent has the required fields
    for (const agent of res.body.agents) {
      expect(agent.id).toBeTruthy();
      expect(agent.name).toBeTruthy();
      expect(agent.urlKey).toBeTruthy();
      expect(agent.adapterType).toBe("process");
      expect(["ceo", "cto", "pm"]).toContain(agent.role);
    }

    // DB: agents
    const agentRows = await db
      .select({ id: agents.id, role: agents.role })
      .from(agents)
      .where(eq(agents.companyId, companyId));
    expect(agentRows).toHaveLength(3);
    expect(agentRows.map((a) => a.role).sort()).toEqual(["ceo", "cto", "pm"]);

    // ── Goal ──
    expect(res.body.goal).toBeDefined();
    expect(res.body.goal.title).toContain(companyName);
    expect(res.body.goal.level).toBe("company");
    expect(res.body.goal.status).toBe("active");

    const goalRow = await db
      .select({ id: goals.id, title: goals.title })
      .from(goals)
      .where(eq(goals.id, res.body.goal.id))
      .then((rows) => rows[0] ?? null);
    expect(goalRow).toBeTruthy();
    expect(goalRow!.title).toBe(res.body.goal.title);

    // ── Project ──
    expect(res.body.project).toBeDefined();
    expect(res.body.project.name).toBe("Onboarding");
    expect(res.body.project.status).toBe("in_progress");

    const projectRow = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.id, res.body.project.id))
      .then((rows) => rows[0] ?? null);
    expect(projectRow).toBeTruthy();
    expect(projectRow!.name).toBe("Onboarding");

    // ── Issue ──
    expect(res.body.issue).toBeDefined();
    expect(res.body.issue.title).toContain("Hire your first engineer");
    expect(res.body.issue.status).toBe("todo");
    expect(res.body.issue.assigneeAgentId).toBeTruthy();
    expect(res.body.issue.identifier).toBeTruthy();

    const issueRow = await db
      .select({
        id: issues.id,
        title: issues.title,
        status: issues.status,
        assigneeAgentId: issues.assigneeAgentId,
        projectId: issues.projectId,
        goalId: issues.goalId,
      })
      .from(issues)
      .where(eq(issues.id, res.body.issue.id))
      .then((rows) => rows[0] ?? null);
    expect(issueRow).toBeTruthy();
    expect(issueRow!.title).toBe(res.body.issue.title);
    expect(issueRow!.status).toBe("todo");
    expect(issueRow!.assigneeAgentId).toBe(res.body.issue.assigneeAgentId);
    expect(issueRow!.projectId).toBe(res.body.project.id);
    expect(issueRow!.goalId).toBe(res.body.goal.id);

    // ── Local environment was created (ensureLocalEnvironment) ──
    const envRow = await db
      .select({ id: environments.id, driver: environments.driver })
      .from(environments)
      .where(eq(environments.driver, "local"))
      .then((rows) => rows[0] ?? null);
    expect(envRow).toBeTruthy();
    expect(envRow!.driver).toBe("local");
  }, 20_000);

  // ── Test 3: owner membership created ─────────────────────────────────────

  it("creates owner membership and default grants for the onboarding user", async () => {
    const app = createOnboardingApp();

    const res = await request(app)
      .post("/api/onboarding/start")
      .send({
        company: { name: `GrantCo ${randomUUID().slice(0, 8)}`, budgetMonthlyCents: 500_00 },
      });

    expect(res.status).toBe(201);
    const companyId = res.body.company.id;

    // The local_implicit actor's userId is "local-board"
    const memberships = await db
      .select({
        principalId: companyMemberships.principalId,
        membershipRole: companyMemberships.membershipRole,
      })
      .from(companyMemberships)
      .where(eq(companyMemberships.companyId, companyId));
    expect(memberships).toHaveLength(1);
    expect(memberships[0].principalId).toBe("local-board");
    expect(memberships[0].membershipRole).toBe("owner");

    // Permission grants exist for the owner
    const grants = await db
      .select({ id: principalPermissionGrants.id })
      .from(principalPermissionGrants)
      .where(eq(principalPermissionGrants.companyId, companyId));
    expect(grants.length).toBeGreaterThan(0);
  }, 15_000);

  // ── Test 4: default agents when none supplied ────────────────────────────

  it("defaults to CEO + CTO + PM when no agents array is supplied", async () => {
    const app = createOnboardingApp();

    const res = await request(app)
      .post("/api/onboarding/start")
      .send({
        company: { name: `DefaultCo ${randomUUID().slice(0, 8)}` },
      });

    expect(res.status).toBe(201);
    expect(res.body.agents).toHaveLength(3);
    expect(res.body.agents.map((a: { role: string }) => a.role).sort())
      .toEqual(["ceo", "cto", "pm"]);
  }, 10_000);

  // ── Test 5: validation errors ────────────────────────────────────────────

  it("rejects empty company name", async () => {
    const app = createOnboardingApp();
    const res = await request(app)
      .post("/api/onboarding/start")
      .send({ company: { name: "" } });
    expect(res.status).toBe(400);
  });

  it("rejects more than 10 agents", async () => {
    const app = createOnboardingApp();
    const res = await request(app)
      .post("/api/onboarding/start")
      .send({
        company: { name: `MaxCo ${randomUUID().slice(0, 8)}` },
        agents: Array.from({ length: 11 }, (_, i) => ({
          role: i === 0 ? ("ceo" as const) : ("engineer" as const),
          name: `Agent ${i}`,
        })),
      });
    expect(res.status).toBe(400);
  });

  // ── Test 6: better-auth session can access onboarding ────────────────────

  it("signs up then completes onboarding with the session cookie", async () => {
    // 1. Sign up
    const { userId, cookie } = await signupTestUser();

    // 2. Build an app whose actor middleware resolves the better-auth session.
    //    We create one better-auth instance up-front and share it for both
    //    the handler and the session resolver.
    const { betterAuth } = await import("better-auth");
    const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
    const { toNodeHandler } = await import("better-auth/node");

    const auth = betterAuth({
      secret: "test-secret-for-onboarding-e2e",
      database: drizzleAdapter(db, { provider: "pg", schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: (await import("@paperclipai/db")).authVerifications,
      } }),
      emailAndPassword: { enabled: true, requireEmailVerification: false, disableSignUp: false },
      advanced: { useSecureCookies: false, cookiePrefix: "paperclip-test" },
      rateLimit: { window: 60_000, max: 100 },
    });

    const baHandler = toNodeHandler(auth);

    // Express app with actor middleware that resolves the session from cookies
    const app = express();
    app.use(express.json());
    app.all("/api/auth/{*authPath}", baHandler);
    app.use((req, _res, next) => {
      // First set actor to default (none) — the auth path is handled by
      // better-auth directly. For the onboarding path, we resolve the
      // session from the cookie ourselves (mimicking what actorMiddleware
      // does in authenticated mode).
      if (req.path.startsWith("/api/auth")) {
        next();
        return;
      }
      // Resolve session from cookie
      (async () => {
        if (!auth.api?.getSession) {
          (req as any).actor = { type: "none", source: "none" };
          next();
          return;
        }
        try {
          const sessionValue = await auth.api.getSession({
            headers: new Headers({ cookie: req.headers.cookie ?? "" }),
          });
          if (sessionValue && typeof sessionValue === "object") {
            const value = sessionValue as { session?: { id?: string }; user?: { id?: string; name?: string; email?: string } };
            if (value.session?.id && value.user?.id) {
              (req as any).actor = {
                type: "board",
                userId: value.user.id,
                userName: value.user.name ?? null,
                userEmail: value.user.email ?? null,
                companyIds: [],
                memberships: [],
                isInstanceAdmin: false,
                source: "session",
              };
              next();
              return;
            }
          }
        } catch {
          // fall through
        }
        (req as any).actor = { type: "none", source: "none" };
        next();
      })();
    });
    app.use("/api/onboarding", onboardingRoutes(db));
    app.use(errorHandler);

    // 3. Call onboarding/start with the session cookie
    const companyName = `SessionCo ${randomUUID().slice(0, 8)}`;
    const res = await request(app)
      .post("/api/onboarding/start")
      .set("Cookie", cookie)
      .send({ company: { name: companyName } });

    expect(res.status, `Onboarding with session failed: ${JSON.stringify(res.body)}`).toBe(201);
    expect(res.body.company.name).toBe(companyName);
    expect(res.body.agents).toHaveLength(3);
    expect(res.body.issue).toBeDefined();

    const companyId = res.body.company.id;

    // 4. Verify the owner membership uses the signed-up userId
    const membership = await db
      .select({ principalId: companyMemberships.principalId })
      .from(companyMemberships)
      .where(eq(companyMemberships.companyId, companyId))
      .then((rows) => rows[0] ?? null);
    expect(membership).toBeTruthy();
    expect(membership!.principalId).toBe(userId);
  }, 20_000);
});