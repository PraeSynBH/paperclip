import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  companies,
  goals,
  issues,
  projects,
} from "@paperclipai/db";
import { onboardingRoutes } from "../routes/onboarding.js";
import { logActivity } from "../services/activity-log.js";
import {
  describeEmbeddedPostgres,
  resetCompanyIssueFixtures,
  routeApp,
  seedCompanyWithBoardAccess,
  useEmbeddedPostgres,
} from "./helpers/route-test-harness.js";

vi.mock("../services/activity-log.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/activity-log.js")>();
  return { ...actual, logActivity: vi.fn(actual.logActivity) };
});

describeEmbeddedPostgres("Onboarding routes", () => {
  const ctx = useEmbeddedPostgres("onboarding-routes");

  afterEach(async () => {
    await ctx.db.delete(activityLog);
    await ctx.db.delete(issues);
    await ctx.db.delete(projects);
    await ctx.db.delete(agents);
    await ctx.db.delete(goals);
    await resetCompanyIssueFixtures(ctx.db);
  });

  async function seedCompany() {
    const seeded = await seedCompanyWithBoardAccess(ctx.db, "Onboarding test");
    const app = routeApp(ctx.db, seeded.actor, onboardingRoutes);
    return { ...seeded, app };
  }

  describe("GET /api/companies/:companyId/onboarding/status", () => {
    it("returns pending status for a new company", async () => {
      const { companyId, app } = await seedCompany();

      const response = await request(app)
        .get(`/api/companies/${companyId}/onboarding/status`);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("pending");
      expect(response.body.selectedRole).toBeNull();
      expect(response.body.completedAt).toBeNull();
      expect(response.body.canSelectRole).toBe(true);
    });

    it("returns completed status after role selection", async () => {
      const { companyId, app } = await seedCompany();
      const role = "engineer";

      // Select a role first
      await request(app)
        .post(`/api/companies/${companyId}/onboarding/role`)
        .send({ role });

      const response = await request(app)
        .get(`/api/companies/${companyId}/onboarding/status`);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("completed");
      expect(response.body.selectedRole).toBe(role);
      expect(response.body.completedAt).toBeTruthy();
      expect(response.body.canSelectRole).toBe(false);
    });

    it("returns skipped status after skip", async () => {
      const { companyId, app } = await seedCompany();

      await request(app)
        .post(`/api/companies/${companyId}/onboarding/skip`);

      const response = await request(app)
        .get(`/api/companies/${companyId}/onboarding/status`);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("skipped");
      expect(response.body.completedAt).toBeTruthy();
      expect(response.body.canSelectRole).toBe(false);
    });
  });

  describe("POST /api/companies/:companyId/onboarding/role", () => {
    it("creates goal, project, agent, and issue for the selected role", async () => {
      const { companyId, app } = await seedCompany();
      const role = "cto";

      const response = await request(app)
        .post(`/api/companies/${companyId}/onboarding/role`)
        .send({ role });

      expect(response.status).toBe(200);
      expect(response.body.applied).toBe(true);
      expect(response.body.role).toBe(role);
      expect(response.body.companyId).toBe(companyId);
      expect(response.body.agentId).toBeTruthy();
      expect(response.body.projectId).toBeTruthy();
      expect(response.body.goalId).toBeTruthy();
      expect(response.body.issueId).toBeTruthy();

      // Verify company onboarding status updated
      const company = await ctx.db
        .select({
          onboardingStatus: companies.onboardingStatus,
          onboardingSelectedRole: companies.onboardingSelectedRole,
          onboardingCompletedAt: companies.onboardingCompletedAt,
        })
        .from(companies)
        .where(eq(companies.id, companyId))
        .then((rows) => rows[0]);

      expect(company?.onboardingStatus).toBe("completed");
      expect(company?.onboardingSelectedRole).toBe(role);
      expect(company?.onboardingCompletedAt).toBeTruthy();

      // Verify goal was created
      const companyGoals = await ctx.db
        .select()
        .from(goals)
        .where(eq(goals.companyId, companyId));
      expect(companyGoals).toHaveLength(1);

      // Verify agent was created
      const companyAgents = await ctx.db
        .select()
        .from(agents)
        .where(eq(agents.companyId, companyId));
      expect(companyAgents).toHaveLength(1);
      expect(companyAgents[0]?.title).toBe("CTO");
      expect(companyAgents[0]?.role).toBe("general");

      // Verify project was created
      const companyProjects = await ctx.db
        .select()
        .from(projects)
        .where(eq(projects.companyId, companyId));
      expect(companyProjects).toHaveLength(1);

      // Verify issue was created
      const companyIssues = await ctx.db
        .select()
        .from(issues)
        .where(and(eq(issues.companyId, companyId), eq(issues.status, "todo")));
      expect(companyIssues).toHaveLength(1);
    });

    it("rejects role selection when onboarding is already completed", async () => {
      const { companyId, app } = await seedCompany();
      const role = "engineer";

      // First selection succeeds
      await request(app)
        .post(`/api/companies/${companyId}/onboarding/role`)
        .send({ role });

      // Second selection should fail
      const response = await request(app)
        .post(`/api/companies/${companyId}/onboarding/role`)
        .send({ role: "ceo" });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe("Onboarding has already been completed or skipped");
    });

    it("rejects role selection after onboarding is skipped", async () => {
      const { companyId, app } = await seedCompany();

      await request(app)
        .post(`/api/companies/${companyId}/onboarding/skip`);

      const response = await request(app)
        .post(`/api/companies/${companyId}/onboarding/role`)
        .send({ role: "engineer" });

      expect(response.status).toBe(409);
    });

    it("rejects invalid role values", async () => {
      const { companyId, app } = await seedCompany();

      const response = await request(app)
        .post(`/api/companies/${companyId}/onboarding/role`)
        .send({ role: "invalid_role" });

      expect(response.status).toBe(400);
    });
  });

  describe("POST /api/companies/:companyId/onboarding/skip", () => {
    it("marks the company as skipped", async () => {
      const { companyId, app } = await seedCompany();

      const response = await request(app)
        .post(`/api/companies/${companyId}/onboarding/skip`);

      expect(response.status).toBe(200);
      expect(response.body.skipped).toBe(true);

      const company = await ctx.db
        .select({
          onboardingStatus: companies.onboardingStatus,
          onboardingCompletedAt: companies.onboardingCompletedAt,
        })
        .from(companies)
        .where(eq(companies.id, companyId))
        .then((rows) => rows[0]);

      expect(company?.onboardingStatus).toBe("skipped");
      expect(company?.onboardingCompletedAt).toBeTruthy();
    });

    it("rejects skip when onboarding is already completed", async () => {
      const { companyId, app } = await seedCompany();

      await request(app)
        .post(`/api/companies/${companyId}/onboarding/role`)
        .send({ role: "engineer" });

      const response = await request(app)
        .post(`/api/companies/${companyId}/onboarding/skip`);

      expect(response.status).toBe(409);
    });
  });
});