/**
 * Company template service — pre-built company templates for one-click deployment.
 *
 * Each template is a JSON file in ../company-template-data/ that describes a
 * full company configuration (agents, skills, knowledge, goals).  The deploy
 * flow mirrors the onboarding /start endpoint.
 */
import { readFileSync, readdirSync } from "node:fs";
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
  const svc = companyService(db);
  const agents = agentService(db);
  const instructions = agentInstructionsService();
  const access = accessService(db);
  const budgets = budgetService(db);
  const goals = goalService(db);
  const projects = projectService(db);
  const issues = issueService(db);
  const skills = companySkillService(db);
  const starterPacks = knowledgeStarterPackService(db);

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
    const now = new Date();

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

    await logActivity(db, {
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

    const allTemplateSkills = new Set([
      ...(tmpl.skills ?? []),
      ...tmpl.agents.flatMap((a) => a.skills ?? []),
    ]);

    for (const catalogSkillId of allTemplateSkills) {
      try {
        await skills.installFromCatalog(company.id, { catalogSkillId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`Could not install skill '${catalogSkillId}': ${msg}`);
        logger.warn({ err, companyId: company.id, catalogSkillId }, "Template skill install failed");
      }
    }

    // ── 4. Create agents ─────────────────────────────────────────────────

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

      try {
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

        // Materialize instructions bundle if the template includes instructions
        if (agentDef.instructions) {
          try {
            const materialized = await instructions.materializeManagedBundle(
              created,
              { "AGENTS.md": agentDef.instructions },
              { entryFile: "AGENTS.md", replaceExisting: false },
            );
            if (materialized.adapterConfig) {
              await agents.update(created.id, {
                adapterConfig: materialized.adapterConfig as Record<string, unknown>,
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
          title: created.title ?? "",
          status: created.status,
          urlKey: created.urlKey,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`Could not create agent '${agentName}': ${msg}`);
        logger.warn({ err, companyId: company.id, agentDef }, "Template agent creation failed");
      }
    }

    // ── 5. Install knowledge starter pack (optional) ─────────────────────

    if (tmpl.starterPackKey) {
      try {
        await starterPacks.installPack(company.id, tmpl.starterPackKey);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`Could not install knowledge starter pack '${tmpl.starterPackKey}': ${msg}`);
        logger.warn({ err, companyId: company.id, starterPackKey: tmpl.starterPackKey }, "Template starter pack install failed");
      }
    }

    // ── 6. Create company-level goal ─────────────────────────────────────

    let goal: Awaited<ReturnType<typeof goals.create>> | null = null;
    if (tmpl.goal) {
      try {
        goal = await goals.create(company.id, {
          title: tmpl.goal.title,
          description: tmpl.goal.description ?? null,
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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`Could not create goal: ${msg}`);
      }
    }

    // ── 7. Create project ────────────────────────────────────────────────

    let project: Awaited<ReturnType<typeof projects.create>> | null = null;
    if (tmpl.project && goal) {
      try {
        project = await projects.create(company.id, {
          name: tmpl.project.name,
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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`Could not create project: ${msg}`);
      }
    }

    // ── 8. Create starter issue ──────────────────────────────────────────

    let starterIssue: Awaited<ReturnType<typeof issues.create>> | null = null;
    if (tmpl.starterIssue) {
      try {
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

        await logActivity(db, {
          companyId: company.id,
          actorType: "user",
          actorId: ownerUserId,
          action: "issue.created",
          entityType: "issue",
          entityId: starterIssue.id,
          details: { title: starterIssue.title, assigneeAgentId },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`Could not create starter issue: ${msg}`);
      }
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
  }

  return {
    listTemplates,
    getTemplate,
    deployTemplate,
  };
}