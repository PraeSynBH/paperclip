import { eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companies } from "@paperclipai/db";
import { AGENT_ROLES, AGENT_ROLE_LABELS, ONBOARDING_FIRST_TASK_ORIGIN_KIND, type AgentRole } from "@paperclipai/shared";
import type { OnboardingStatus } from "@paperclipai/shared";
import { agentService } from "./agents.js";
import { projectService } from "./projects.js";
import { goalService } from "./goals.js";
import { issueService } from "./issues.js";
import { logActivity, publishActivity, type ActivityPublication } from "./activity-log.js";
import { badRequest, conflict } from "../errors.js";
import { ga4AnalyticsService, buildOnboardingCompletedEvent } from "./ga4-analytics.js";

export type OnboardingAuditActor = {
  actorType: "agent" | "user" | "system" | "plugin";
  actorId: string;
  agentId?: string | null;
  runId?: string | null;
};

export function onboardingService(db: Db) {
  const ONBOARDING_PROJECT_NAME = "Onboarding";

  async function getCompanyOnboardingState(companyId: string) {
    const row = await db
      .select({
        onboardingStatus: companies.onboardingStatus,
        onboardingSelectedRole: companies.onboardingSelectedRole,
        onboardingCompletedAt: companies.onboardingCompletedAt,
      })
      .from(companies)
      .where(eq(companies.id, companyId))
      .then((rows) => rows[0] ?? null);

    return row;
  }

  /**
   * Get the current onboarding status for a company.
   */
  async function getStatus(companyId: string) {
    const state = await getCompanyOnboardingState(companyId);
    if (!state) {
      throw badRequest("Company not found");
    }

    const status = state.onboardingStatus as OnboardingStatus;
    return {
      status,
      selectedRole: state.onboardingSelectedRole,
      completedAt: state.onboardingCompletedAt?.toISOString() ?? null,
      canSelectRole: status === "pending",
    };
  }

  /**
   * Select a role for the company during onboarding. Creates the initial
   * agent, project, goal, and first task based on the selected role.
   */
  async function selectRole(
    companyId: string,
    role: AgentRole,
    audit?: OnboardingAuditActor,
  ) {
    const publications: ActivityPublication[] = [];

    const result = await db.transaction(async (tx) => {
      const dbx = tx as unknown as Db;
      const agentSvc = agentService(dbx);
      const projectSvc = projectService(dbx);
      const goalSvc = goalService(dbx);
      const issueSvc = issueService(dbx);

      // Lock the company row and check onboarding status inside the
      // transaction to prevent a TOCTOU race with concurrent selectRole/skip.
      await tx.execute(
        sql`select ${companies.id} from ${companies} where ${companies.id} = ${companyId} for update`,
      );

      const [companyState] = await dbx
        .select({
          onboardingStatus: companies.onboardingStatus,
          onboardingSelectedRole: companies.onboardingSelectedRole,
          onboardingCompletedAt: companies.onboardingCompletedAt,
        })
        .from(companies)
        .where(eq(companies.id, companyId))
        .then((rows) => rows);

      if (!companyState) {
        throw badRequest("Company not found");
      }

      if (companyState.onboardingStatus !== "pending") {
        throw conflict("Onboarding has already been completed or skipped", {
          currentStatus: companyState.onboardingStatus,
        });
      }

      // 1. Create a company-level goal
      const goal = await goalSvc.create(companyId, {
        title: AGENT_ROLE_LABELS[role],
        description: `Onboarding goal for ${AGENT_ROLE_LABELS[role]} role`,
        level: "company",
        status: "active",
      });

      // 2. Create the onboarding project
      const project = await projectSvc.create(companyId, {
        name: ONBOARDING_PROJECT_NAME,
        status: "in_progress",
        goalIds: [goal.id],
      });

      // 3. Create the initial agent based on the role
      const agentName = AGENT_ROLE_LABELS[role];
      const agentRole = role === "ceo" ? "ceo" : "general";

      const agent = await agentSvc.create(companyId, {
        name: agentName,
        role: agentRole,
        title: AGENT_ROLE_LABELS[role],
        adapterType: "claude_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
        status: "idle",
        spentMonthlyCents: 0,
        lastHeartbeatAt: null,
      });

      // 4. Create a first task
      const issue = await issueSvc.create(companyId, {
        title: `Get started with ${AGENT_ROLE_LABELS[role]}`,
        description: `Welcome! As our ${AGENT_ROLE_LABELS[role]}, here are your first steps to get started.`,
        assigneeAgentId: agent.id,
        projectId: project.id,
        goalId: goal.id,
        status: "todo",
        originKind: ONBOARDING_FIRST_TASK_ORIGIN_KIND,
        idempotencyKey: `onboarding-role:${companyId}:${role}`,
      });

      // 5. Update company onboarding state
      const now = new Date();
      await dbx
        .update(companies)
        .set({
          onboardingStatus: "completed",
          onboardingSelectedRole: role,
          onboardingCompletedAt: now,
          updatedAt: now,
        })
        .where(eq(companies.id, companyId));

      if (audit) {
        await logActivity(
          dbx,
          {
            companyId,
            actorType: audit.actorType,
            actorId: audit.actorId,
            agentId: audit.agentId ?? null,
            runId: audit.runId ?? null,
            action: "company.onboarding_role_selected",
            entityType: "company",
            entityId: companyId,
            details: {
              role,
              agentId: agent.id,
              projectId: project.id,
              goalId: goal.id,
              issueId: issue.id,
            },
          },
          publications,
        );
      }

      return {
        agentId: agent.id,
        projectId: project.id,
        goalId: goal.id,
        issueId: issue.id,
      };
    });

    for (const publication of publications) publishActivity(publication);

    // GA4 tracking: fire onboarding_completed event after successful role selection
    ga4AnalyticsService.send(buildOnboardingCompletedEvent(companyId, role));

    return result;
  }

  /**
   * Skip onboarding for a company. Lands on empty dashboard.
   */
  async function skip(
    companyId: string,
    audit?: OnboardingAuditActor,
  ) {
    const publications: ActivityPublication[] = [];

    await db.transaction(async (tx) => {
      const dbx = tx as unknown as Db;

      // Lock the company row and check onboarding status inside the
      // transaction to prevent a TOCTOU race with concurrent selectRole/skip.
      await tx.execute(
        sql`select ${companies.id} from ${companies} where ${companies.id} = ${companyId} for update`,
      );

      const [companyState] = await dbx
        .select({
          onboardingStatus: companies.onboardingStatus,
        })
        .from(companies)
        .where(eq(companies.id, companyId))
        .then((rows) => rows);

      if (!companyState) {
        throw badRequest("Company not found");
      }

      if (companyState.onboardingStatus !== "pending") {
        throw conflict("Onboarding has already been completed or skipped", {
          currentStatus: companyState.onboardingStatus,
        });
      }

      const now = new Date();
      await dbx
        .update(companies)
        .set({
          onboardingStatus: "skipped",
          onboardingCompletedAt: now,
          updatedAt: now,
        })
        .where(eq(companies.id, companyId));

      if (audit) {
        await logActivity(
          dbx,
          {
            companyId,
            actorType: audit.actorType,
            actorId: audit.actorId,
            agentId: audit.agentId ?? null,
            runId: audit.runId ?? null,
            action: "company.onboarding_skipped",
            entityType: "company",
            entityId: companyId,
            details: {},
          },
          publications,
        );
      }
    });

    for (const publication of publications) publishActivity(publication);
  }

  return {
    getStatus,
    selectRole,
    skip,
  };
}