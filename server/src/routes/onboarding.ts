import { randomUUID } from "node:crypto";
import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import {
  AGENT_ROLES,
  AGENT_ROLE_LABELS,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import {
  agentService,
  agentInstructionsService,
  accessService,
  budgetService,
  goalService,
  projectService,
  issueService,
  logActivity,
  companyService,
} from "../services/index.js";
import {
  loadDefaultAgentInstructionsBundle,
  resolveDefaultAgentInstructionsBundleRole,
} from "../services/default-agent-instructions.js";
import { findActiveServerAdapter } from "../adapters/index.js";
import { forbidden, badRequest } from "../errors.js";
import { assertBoard, getActorInfo } from "./authz.js";

// ── Schemas ──────────────────────────────────────────────────────────────────

export const onboardingAgentItemSchema = z.object({
  role: z.enum(AGENT_ROLES).default("ceo"),
  name: z.string().min(1).optional(),
  /** Defaults to "process" (no external runtime required). */
  adapterType: z.string().min(1).default("process"),
  adapterConfig: z.record(z.string(), z.unknown()).optional().default({}),
});

export type OnboardingAgentItem = z.infer<typeof onboardingAgentItemSchema>;

export const onboardingStartSchema = z.object({
  company: z.object({
    name: z.string().min(1),
    industry: z.string().optional().nullable(),
    budgetMonthlyCents: z.number().int().nonnegative().optional().default(0),
  }),
  /** Default agents when not specified: CEO + CTO + PM. */
  agents: z.array(onboardingAgentItemSchema).min(1).max(10).optional().default([
    { role: "ceo" as const },
    { role: "cto" as const },
    { role: "pm" as const },
  ]),
});

export type OnboardingStart = z.infer<typeof onboardingStartSchema>;

const DEFAULT_TASK_TITLE = "Hire your first engineer and create a hiring plan";
const DEFAULT_TASK_DESCRIPTION =
  "You are the CEO. You set the direction for the company.\n\n" +
  "- hire a founding engineer\n" +
  "- write a hiring plan\n" +
  "- break the roadmap into concrete tasks and start delegating work";

const ONBOARDING_PROJECT_NAME = "Onboarding";

// ── Helpers ──────────────────────────────────────────────────────────────────

function adapterSupportsManagedInstructions(adapterType: string): boolean {
  const adapter = findActiveServerAdapter(adapterType);
  if (adapter?.supportsInstructionsBundle !== undefined)
    return adapter.supportsInstructionsBundle;
  const LEGACY_BUNDLE_ADAPTERS = new Set([
    "acpx_local",
    "claude_local",
    "codex_local",
    "droid_local",
    "gemini_local",
    "opencode_local",
    "cursor",
    "pi_local",
  ]);
  return LEGACY_BUNDLE_ADAPTERS.has(adapterType);
}

/** Resolve a display name for a given agent role. */
function defaultAgentName(role: string): string {
  return AGENT_ROLE_LABELS[role as keyof typeof AGENT_ROLE_LABELS] ??
    role.charAt(0).toUpperCase() + role.slice(1);
}

// ── Route ────────────────────────────────────────────────────────────────────

export function onboardingRoutes(db: Db) {
  const router = Router();
  const svc = companyService(db);
  const agents = agentService(db);
  const instructions = agentInstructionsService();
  const access = accessService(db);
  const budgets = budgetService(db);
  const goals = goalService(db);
  const projects = projectService(db);
  const issues = issueService(db);

  /**
   * POST /start — Full self-service onboarding.
   *
   * Creates a company (with the authenticated user as owner), hires the
   * requested default agents, seeds a company-level goal, an "Onboarding"
   * project, and a starter task assigned to the first (CEO) agent.
   *
   * Returns all created entities so the caller can navigate straight to the
   * working board.
   */
  router.post(
    "/start",
    validate(onboardingStartSchema),
    async (req, res) => {
      assertBoard(req);

      // Require either local_implicit / instance-admin, or an authenticated
      // board user session (self-service path).
      if (req.actor.source !== "local_implicit" && !req.actor.isInstanceAdmin) {
        if (!req.actor.userId) {
          throw forbidden(
            "Authenticated user session required for self-service onboarding",
          );
        }
      }

      const body = onboardingStartSchema.parse(req.body);
      const ownerUserId = req.actor.userId ?? "local-board";
      const ownerPrincipalId = ownerUserId;
      const actor = getActorInfo(req);
      const now = new Date();

      // ── 1. Create company ────────────────────────────────────────────────

      const companyName = body.company.name.trim();
      const description = body.company.industry
        ? `Industry: ${body.company.industry.trim()}`
        : null;

      const company = await svc.create({
        name: companyName,
        description,
        budgetMonthlyCents: body.company.budgetMonthlyCents,
      });

      // ── 2. Set up owner membership + grants ──────────────────────────────

      await access.ensureMembership(
        company.id,
        "user",
        ownerPrincipalId,
        "owner",
        "active",
      );
      await access.ensureRoleDefaultGrants(
        company.id,
        ownerPrincipalId,
        "owner",
        ownerUserId,
      );

      await logActivity(db, {
        companyId: company.id,
        actorType: "user",
        actorId: ownerUserId,
        action: "company.created",
        entityType: "company",
        entityId: company.id,
        details: { name: company.name },
      });

      if (company.budgetMonthlyCents > 0) {
        await budgets.upsertPolicy(
          company.id,
          {
            scopeType: "company",
            scopeId: company.id,
            amount: company.budgetMonthlyCents,
            windowKind: "calendar_month_utc",
          },
          ownerUserId,
        );
      }

      // ── 3. Create agents ─────────────────────────────────────────────────

      const createdAgents: Array<{
        id: string;
        name: string;
        role: string;
        title: string | null;
        icon: string | null;
        status: string;
        adapterType: string;
        urlKey: string;
      }> = [];
      const agentItems = body.agents;

      for (let i = 0; i < agentItems.length; i++) {
        const item = agentItems[i];
        const agentName = item.name?.trim() || defaultAgentName(item.role);

        const created = await agents.create(company.id, {
          name: agentName,
          role: item.role,
          title: defaultAgentName(item.role),
          adapterType: item.adapterType || "process",
          adapterConfig: (item.adapterConfig ?? {}) as Record<string, unknown>,
          status: "idle",
          spentMonthlyCents: 0,
          lastHeartbeatAt: null,
        });

        // Materialize default instructions bundle based on role
        if (
          adapterSupportsManagedInstructions(created.adapterType) &&
          !created.adapterConfig?.instructionsFilePath &&
          !created.adapterConfig?.instructionsBundleMode
        ) {
          try {
            const files = await loadDefaultAgentInstructionsBundle(
              resolveDefaultAgentInstructionsBundleRole(created),
            );
            const materialized = await instructions.materializeManagedBundle(
              created,
              files,
              {
                entryFile: "AGENTS.md",
                replaceExisting: false,
              },
            );
            if (materialized.adapterConfig) {
              await agents.update(created.id, {
                adapterConfig: materialized.adapterConfig as Record<
                  string,
                  unknown
                >,
              });
            }
          } catch {
            // Non-fatal — agent works with adapter defaults
          }
        }

        await logActivity(db, {
          companyId: company.id,
          actorType: "user",
          actorId: ownerUserId,
          action: "agent.created",
          entityType: "agent",
          entityId: created.id,
          details: { name: created.name, role: created.role },
        });

        createdAgents.push({
          id: created.id,
          name: created.name,
          role: created.role,
          title: created.title,
          icon: created.icon,
          status: created.status,
          adapterType: created.adapterType,
          urlKey: created.urlKey,
        });
      }

      // ── 4. Create company-level goal ─────────────────────────────────────

      const goalTitle = `Scale ${companyName}`;
      const goalDescription = body.company.industry
        ? `Build a leading ${body.company.industry.trim()} company.`
        : `Grow ${companyName} into a market leader.`;

      const goal = await goals.create(company.id, {
        title: goalTitle,
        description: goalDescription,
        level: "company",
        status: "active",
      });

      await logActivity(db, {
        companyId: company.id,
        actorType: "user",
        actorId: ownerUserId,
        action: "goal.created",
        entityType: "goal",
        entityId: goal.id,
        details: { title: goal.title },
      });

      // ── 5. Create Onboarding project ─────────────────────────────────────

      const project = await projects.create(company.id, {
        name: ONBOARDING_PROJECT_NAME,
        status: "in_progress",
        goalIds: [goal.id],
      });

      await logActivity(db, {
        companyId: company.id,
        actorType: "user",
        actorId: ownerUserId,
        action: "project.created",
        entityType: "project",
        entityId: project.id,
        details: { name: project.name },
      });

      // ── 6. Create sample task ────────────────────────────────────────────

      const ceoAgent = createdAgents.length > 0 ? createdAgents[0] : null;

      const issue = await issues.create(company.id, {
        title: DEFAULT_TASK_TITLE,
        description: DEFAULT_TASK_DESCRIPTION,
        assigneeAgentId: ceoAgent?.id ?? null,
        projectId: project.id,
        goalId: goal.id,
        status: "todo",
      });

      await logActivity(db, {
        companyId: company.id,
        actorType: "user",
        actorId: ownerUserId,
        action: "issue.created",
        entityType: "issue",
        entityId: issue.id,
        details: { title: issue.title, assigneeAgentId: ceoAgent?.id ?? null },
      });

      // ── Response ─────────────────────────────────────────────────────────

      res.status(201).json({
        company: {
          id: company.id,
          name: company.name,
          issuePrefix: company.issuePrefix,
          description: company.description,
          budgetMonthlyCents: company.budgetMonthlyCents,
          status: company.status,
          createdAt: company.createdAt,
        },
        agents: createdAgents,
        goal: {
          id: goal.id,
          title: goal.title,
          description: goal.description,
          level: goal.level,
          status: goal.status,
        },
        project: {
          id: project.id,
          name: project.name,
          status: project.status,
        },
        issue: issue
          ? {
              id: issue.id,
              identifier: (issue as { identifier?: string }).identifier ??
                issue.id,
              title: issue.title,
              status: issue.status,
              assigneeAgentId: issue.assigneeAgentId,
            }
          : null,
      });
    },
  );

  return router;
}