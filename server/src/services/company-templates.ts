/**
 * Company template service — pre-built company templates for one-click deployment.
 *
 * Each template is a JSON file in ../company-template-data/ that describes a
 * full company configuration (agents, skills, knowledge, goals).  The deploy
 * flow mirrors the onboarding /start endpoint.
 *
 * Deployment is wrapped in a database transaction for atomicity: if any step
 * fails the entire deployment is rolled back, leaving no partial state.
 * Non-transactional side effects (e.g. agent instructions bundle files) are
 * cleaned up when the transaction is rolled back.
 */
import { readFileSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "@paperclipai/db";
import { writePaperclipSkillSyncPreference } from "@paperclipai/adapter-utils/server-utils";
import type {
  CompanyTemplate,
  CompanyTemplateAgent,
} from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import { companyService } from "./companies.js";
import { agentService } from "./agents.js";
import { agentInstructionsService } from "./agent-instructions.js";
import { accessService } from "./access.js";
import { budgetService } from "./budgets.js";
import { goalService } from "./goals.js";
import { projectService } from "./projects.js";
import { issueService } from "./issues.js";
import { companySkillService } from "./company-skills.js";
import { knowledgeStarterPackService } from "./knowledge-starter-packs.js";
import { logActivity } from "./activity-log.js";
import { notFound } from "../errors.js";
import { AGENT_ROLE_LABELS } from "@paperclipai/shared";

// ─── Load template data ─────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, "../company-template-data");

function loadTemplates(): CompanyTemplate[] {
  const files = readdirSync(TEMPLATES_DIR).filter((f: string) => f.endsWith(".json"));
  const templates: CompanyTemplate[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(resolve(TEMPLATES_DIR, file), "utf-8");
      const tmpl = JSON.parse(content) as CompanyTemplate;
      templates.push(tmpl);
    } catch (err) {
      logger.error({ err, file }, "Failed to load company template");
    }
  }

  return templates;
}

// ─── Agent name helpers ──────────────────────────────────────────────────────

/** Resolve display name for a given agent role — matches onboarding. */
function defaultAgentName(role: string): string {
  return (AGENT_ROLE_LABELS as Record<string, string>)[role] ??
    role.charAt(0).toUpperCase() + role.slice(1);
}

// ─── Service ──────────────────────────────────────────────────────────────────

export interface CompanyTemplateService {
  /** List all available templates (metadata only — no agents/goals/etc.). */
  listTemplates(): Promise<Omit<CompanyTemplate, "agents" | "skills" | "goal" | "project" | "starterIssue">[]>;

  /** Get a single template by key, including full agent/goal/project data. */
  getTemplate(key: string): Promise<CompanyTemplate | null>;

  /**
   * Deploy a template: create company + agents + skills + knowledge + goal + project + issue.
   * Returns the created entities so the caller can navigate straight to the board.
   */
  deployTemplate(
    key: string,
    params: {
      /** Override the default company name from the template. */
      companyName?: string;
      /** Monthly budget in cents. */
      budgetMonthlyCents?: number;
      /** The owning board user id (also used for membership + log). */
      ownerUserId: string;
    },
  ): Promise<DeployResult>;
}

export interface DeployResult {
  company: {
    id: string;
    name: string;
    issuePrefix: string;
    description: string | null;
    status: string;
    createdAt: Date;
  };
  agents: Array<{
    id: string;
    name: string;
    role: string;
    title: string;
    status: string;
    urlKey: string;
  }>;
  goal: {
    id: string;
    title: string;
    description: string | null;
    level: string;
    status: string;
  } | null;
  project: {
    id: string;
    name: string;
    status: string;
  } | null;
  issue: {
    id: string;
    title: string;
    status: string;
    assigneeAgentId: string | null;
  } | null;
  warnings: string[];
}

export function companyTemplateService(db: Db): CompanyTemplateService {
  const templates = loadTemplates();
  const instructions = agentInstructionsService();

  const DEFAULT_AGENT_ADAPTER_TYPE = "process";

  async function listTemplates(): Promise<Omit<CompanyTemplate, "agents" | "skills" | "goal" | "project" | "starterIssue">[]> {
    return templates.map((tmpl) => ({
      key: tmpl.key,
      name: tmpl.name,
      description: tmpl.description,
      industry: tmpl.industry,
      icon: tmpl.icon,
      company: tmpl.company,
      starterPackKey: tmpl.starterPackKey,
    }));
  }

  async function getTemplate(key: string): Promise<CompanyTemplate | null> {
    return templates.find((t) => t.key === key) ?? null;
  }

  async function deployTemplate(
    key: string,
    params: { companyName?: string; budgetMonthlyCents?: number; ownerUserId: string },
  ): Promise<DeployResult> {
    const tmpl = templates.find((t) => t.key === key);
    if (!tmpl) {
      throw notFound(`Template '${key}' not found. Available: ${templates.map((t) => t.key).join(", ")}`);
    }

    const warnings: string[] = [];
    const ownerUserId = params.ownerUserId;

    // Track materialized instruction bundle root paths so we can clean up
    // non-transactional file-system artifacts if the transaction rolls back.
    const materializedBundleRoots: string[] = [];

    try {
      return await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;

        // Create transaction-bound service instances so all queries participate
        // in the outer transaction (or its savepoints).
        const svc = companyService(txDb);
        const agents = agentService(txDb);
        const access = accessService(txDb);
        const budgets = budgetService(txDb);
        const goals = goalService(txDb);
        const projects = projectService(txDb);
        const issues = issueService(txDb);
        const skills = companySkillService(txDb);
        const starterPacks = knowledgeStarterPackService(txDb);

        // ── 1. Create company ────────────────────────────────────────────────

        const companyName = params.companyName?.trim() || tmpl.company.name;
        const company = await svc.create({
          name: companyName,
          description: tmpl.company.description ?? null,
          budgetMonthlyCents: params.budgetMonthlyCents ?? tmpl.company.budgetMonthlyCents ?? 0,
        });

        // ── 2. Set up owner membership + grants ──────────────────────────────

        await access.ensureMembership(company.id, "user", ownerUserId, "owner", "active");
        await access.ensureRoleDefaultGrants(company.id, ownerUserId, "owner", ownerUserId);

        await logActivity(txDb, {
          companyId: company.id,
          actorType: "user",
          actorId: ownerUserId,
          action: "company.created",
          entityType: "company",
          entityId: company.id,
          details: { name: company.name, templateKey: key },
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

        // ── 3. Install catalog skills company-wide ───────────────────────────
        //     Failure is fatal — partial skill installs would leave the company
        //     in an inconsistent state, so the transaction rolls back.

        const allTemplateSkills = new Set([
          ...(tmpl.skills ?? []),
          ...tmpl.agents.flatMap((a) => a.skills ?? []),
        ]);

        for (const catalogSkillId of allTemplateSkills) {
          await skills.installFromCatalog(company.id, { catalogSkillId });
        }

        // ── 4. Create agents ─────────────────────────────────────────────────
        //     Failure is fatal — if any agent cannot be created the whole
        //     deployment rolls back, leaving no partial company state.

        const createdAgents: Array<{
          id: string;
          name: string;
          role: string;
          title: string;
          status: string;
          urlKey: string;
        }> = [];

        for (const agentDef of tmpl.agents) {
          const agentName = agentDef.name || defaultAgentName(agentDef.role);
          const adapterType = agentDef.adapterType || DEFAULT_AGENT_ADAPTER_TYPE;

          // Build adapterConfig with desired skills
          let adapterConfig: Record<string, unknown> = {};
          if (agentDef.skills && agentDef.skills.length > 0) {
            adapterConfig = writePaperclipSkillSyncPreference(adapterConfig, agentDef.skills);
          }

          const created = await agents.create(company.id, {
            name: agentName,
            role: agentDef.role,
            title: agentDef.title,
            adapterType,
            adapterConfig,
            status: "idle",
            spentMonthlyCents: 0,
            lastHeartbeatAt: null,
          });

          // Materialize instructions bundle if the template includes instructions.
          // This is a file-system operation — non-fatal if it fails, since the
          // agent works with adapter defaults.  The managed root path is tracked
          // so we can clean up orphaned files if the transaction later rolls back.
          if (agentDef.instructions) {
            try {
              const materialized = await instructions.materializeManagedBundle(
                created,
                { "AGENTS.md": agentDef.instructions },
                { entryFile: "AGENTS.md", replaceExisting: false },
              );
              if (materialized.bundle.managedRootPath) {
                materializedBundleRoots.push(materialized.bundle.managedRootPath);
              }
              if (materialized.adapterConfig) {
                await agents.update(created.id, {
                  adapterConfig: materialized.adapterConfig as Record<string, unknown>,
                });
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              warnings.push(`Could not materialize instructions for agent '${agentName}': ${msg}`);
              logger.warn(
                { err, agentId: created.id, agentName },
                "Template agent instructions materialization failed",
              );
            }
          }

          await logActivity(txDb, {
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
            title: created.title ?? "",
            status: created.status,
            urlKey: created.urlKey,
          });
        }

        // ── 5. Install knowledge starter pack (optional) ─────────────────────
        //     Failure is fatal — the pack is part of the template contract.

        if (tmpl.starterPackKey) {
          await starterPacks.installPack(company.id, tmpl.starterPackKey);
        }

        // ── 6. Create company-level goal ─────────────────────────────────────
        //     Failure is fatal — the template defines a goal that is part of the
        //     company configuration.

        let goal: Awaited<ReturnType<typeof goals.create>> | null = null;
        if (tmpl.goal) {
          goal = await goals.create(company.id, {
            title: tmpl.goal.title,
            description: tmpl.goal.description ?? null,
            level: "company",
            status: "active",
          });

          await logActivity(txDb, {
            companyId: company.id,
            actorType: "user",
            actorId: ownerUserId,
            action: "goal.created",
            entityType: "goal",
            entityId: goal.id,
            details: { title: goal.title },
          });
        }

        // ── 7. Create project ────────────────────────────────────────────────
        //     Failure is fatal — depends on the goal.

        let project: Awaited<ReturnType<typeof projects.create>> | null = null;
        if (tmpl.project && goal) {
          project = await projects.create(company.id, {
            name: tmpl.project.name,
            status: "in_progress",
            goalIds: [goal.id],
          });

          await logActivity(txDb, {
            companyId: company.id,
            actorType: "user",
            actorId: ownerUserId,
            action: "project.created",
            entityType: "project",
            entityId: project.id,
            details: { name: project.name },
          });
        }

        // ── 8. Create starter issue ──────────────────────────────────────────
        //     Failure is fatal — the template defines a starter issue.

        let starterIssue: Awaited<ReturnType<typeof issues.create>> | null = null;
        if (tmpl.starterIssue) {
          const assigneeAgentIndex = tmpl.starterIssue.assigneeAgentIndex ?? 0;
          const assigneeAgentId = createdAgents[assigneeAgentIndex]?.id ?? null;

          starterIssue = await issues.create(company.id, {
            title: tmpl.starterIssue.title,
            description: tmpl.starterIssue.description ?? null,
            assigneeAgentId,
            projectId: project?.id ?? null,
            goalId: goal?.id ?? null,
            status: "todo",
          });

          await logActivity(txDb, {
            companyId: company.id,
            actorType: "user",
            actorId: ownerUserId,
            action: "issue.created",
            entityType: "issue",
            entityId: starterIssue.id,
            details: { title: starterIssue.title, assigneeAgentId },
          });
        }

        logger.info(
          { companyId: company.id, templateKey: key, agentCount: createdAgents.length, warningCount: warnings.length },
          "Company template deployed",
        );

        // ── Response ─────────────────────────────────────────────────────────

        return {
          company: {
            id: company.id,
            name: company.name,
            issuePrefix: company.issuePrefix,
            description: company.description,
            status: company.status,
            createdAt: company.createdAt,
          },
          agents: createdAgents,
          goal: goal
            ? {
                id: goal.id,
                title: goal.title,
                description: goal.description,
                level: goal.level,
                status: goal.status,
              }
            : null,
          project: project
            ? {
                id: project.id,
                name: project.name,
                status: project.status,
              }
            : null,
          issue: starterIssue
            ? {
                id: starterIssue.id,
                title: starterIssue.title,
                status: starterIssue.status,
                assigneeAgentId: starterIssue.assigneeAgentId,
              }
            : null,
          warnings,
        };
      });
    } catch (err) {
      // Transaction rolled back — clean up non-transactional file-system side
      // effects (materialized agent instruction bundles) that were written
      // before the failure.
      //
      // BEHAVIORAL CHANGE (VOY-1403, M-1): callers should be aware that this
      // deployment path is now ALL-OR-NOTHING. Previously, failures in
      // individual steps (skill install, agent creation, goal/project/issue
      // creation) were soft-failed with warnings and the deployment continued.
      // Now any such failure propagates and rolls back the entire deployment —
      // no partial company/agent/skill state is left behind. Callers that
      // relied on best-effort partial deployments must treat a rejected
      // deployment as a full no-op.
      for (const root of materializedBundleRoots) {
        try {
          await rm(root, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup
        }
      }
      throw err;
    }
  }

  return {
    listTemplates,
    getTemplate,
    deployTemplate,
  };
}