/**
 * Agent Marketplace Service
 *
 * Provides browse and one-click hire for marketplace agents (from the
 * @paperclipai/agents-catalog package). Modeled after the knowledge-starter-packs
 * and teams-catalog patterns.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "@paperclipai/db";
import type {
  MarketplaceAgentResponse,
  MarketplaceAgentInstallResponse,
  MarketplaceAgentSkillRequirement,
} from "@paperclipai/shared";
import { notFound, unprocessable } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { agentService } from "./agents.js";
import { companySkillService } from "./company-skills.js";

// ── Catalog resolution ────────────────────────────────────────────────────────

interface MarketplaceAgentCatalogEntry {
  id: string;
  key: string;
  kind: "bundled" | "community";
  category: string;
  slug: string;
  name: string;
  description: string;
  icon: string | null;
  role: string;
  title: string | null;
  path: string;
  recommendedForCompanyTypes: string[];
  tags: string[];
  requiredSkills: MarketplaceAgentSkillRequirement[];
  defaultAdapterType: string;
  defaultAdapterConfig: Record<string, unknown>;
  defaultPermissions: Record<string, unknown>;
  defaultBudgetMonthlyCents: number;
}

interface MarketplaceAgentManifest {
  schemaVersion: number;
  packageName: string;
  packageVersion: string;
  generatedAt: string;
  agents: MarketplaceAgentCatalogEntry[];
}

const serviceDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(serviceDir, "../../..");
const require = createRequire(import.meta.url);

const catalogPackageName = "@paperclipai/agents-catalog";
const catalogManifestSpecifier = `${catalogPackageName}/catalog.json`;
const devCatalogManifestPath = path.join(repoRoot, "packages/agents-catalog/generated/catalog.json");

let cachedManifest: { manifest: MarketplaceAgentManifest } | null = null;

export class AgentCatalogUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "AgentCatalogUnavailableError";
    if (options && "cause" in options) {
      Object.defineProperty(this, "cause", {
        value: options.cause,
        configurable: true,
        writable: true,
      });
    }
  }
}

function resolveManifestPath(): string {
  try {
    return require.resolve(catalogManifestSpecifier);
  } catch {
    if (existsSync(devCatalogManifestPath)) {
      return devCatalogManifestPath;
    }
    throw new AgentCatalogUnavailableError(
      `Agent marketplace catalog manifest not found. Checked: ${catalogManifestSpecifier} and ${devCatalogManifestPath}.`,
    );
  }
}

function loadManifest(): MarketplaceAgentManifest {
  if (cachedManifest) return cachedManifest.manifest;
  const manifestPath = resolveManifestPath();
  const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as MarketplaceAgentManifest;
  cachedManifest = { manifest: raw };
  return raw;
}

function stripInternalConfig(entry: MarketplaceAgentCatalogEntry): MarketplaceAgentResponse {
  return {
    id: entry.id,
    key: entry.key,
    kind: entry.kind,
    category: entry.category,
    slug: entry.slug,
    name: entry.name,
    description: entry.description,
    icon: entry.icon,
    role: entry.role,
    title: entry.title,
    recommendedForCompanyTypes: entry.recommendedForCompanyTypes,
    tags: entry.tags,
    requiredSkills: entry.requiredSkills,
    defaultAdapterType: entry.defaultAdapterType,
    defaultBudgetMonthlyCents: entry.defaultBudgetMonthlyCents,
  };
}

// ── Service ────────────────────────────────────────────────────────────────────

export interface AgentMarketplaceService {
  /** List available marketplace agents, optionally filtered by category/role/query. */
  listAgents(options?: {
    category?: string;
    role?: string;
    q?: string;
  }): MarketplaceAgentResponse[];

  /** Get a single marketplace agent by id, key, or slug. */
  getAgent(ref: string): MarketplaceAgentResponse | null;

  /**
   * One-click hire: create an agent from a marketplace entry, install required
   * skills, and return the result.
   */
  hire(
    companyId: string,
    ref: string,
    options?: {
      name?: string;
      actorAgentId?: string;
      adapterType?: string;
      adapterConfig?: Record<string, unknown>;
    },
  ): Promise<MarketplaceAgentInstallResponse>;
}

export function agentMarketplaceService(db: Db): AgentMarketplaceService {
  const agents = agentService(db);
  const companySkills = companySkillService(db);

  function listAgents(options?: {
    category?: string;
    role?: string;
    q?: string;
  }): MarketplaceAgentResponse[] {
    try {
      const manifest = loadManifest();
      let results = manifest.agents;

      if (options?.category) {
        const cat = options.category.toLowerCase();
        results = results.filter((a) => a.category.toLowerCase() === cat);
      }
      if (options?.role) {
        const role = options.role.toLowerCase();
        results = results.filter((a) => a.role === role);
      }
      if (options?.q) {
        const query = options.q.toLowerCase();
        results = results.filter(
          (a) =>
            a.name.toLowerCase().includes(query) ||
            a.description.toLowerCase().includes(query) ||
            a.tags.some((t) => t.toLowerCase().includes(query)),
        );
      }

      return results.map(stripInternalConfig);
    } catch (error) {
      if (error instanceof AgentCatalogUnavailableError) {
        logger.warn({ err: error }, "Agent marketplace catalog unavailable; returning empty list");
        return [];
      }
      throw error;
    }
  }

  function getAgent(ref: string): MarketplaceAgentResponse | null {
    try {
      const manifest = loadManifest();
      const entry =
        manifest.agents.find((a) => a.id === ref) ??
        manifest.agents.find((a) => a.key === ref) ??
        manifest.agents.find((a) => a.slug === ref) ??
        null;
      return entry ? stripInternalConfig(entry) : null;
    } catch (error) {
      if (error instanceof AgentCatalogUnavailableError) {
        return null;
      }
      throw error;
    }
  }

  async function hire(
    companyId: string,
    ref: string,
    options?: {
      name?: string;
      actorAgentId?: string;
      adapterType?: string;
      adapterConfig?: Record<string, unknown>;
    },
  ): Promise<MarketplaceAgentInstallResponse> {
    const manifest = loadManifest();
    const entry =
      manifest.agents.find((a) => a.id === ref) ??
      manifest.agents.find((a) => a.key === ref) ??
      manifest.agents.find((a) => a.slug === ref) ??
      null;

    if (!entry) {
      throw notFound(`Marketplace agent "${ref}" not found`);
    }

    // ── 1. Create the agent ────────────────────────────────────────────────
    const agentName = options?.name ?? entry.name;
    const adapterType = options?.adapterType ?? entry.defaultAdapterType;
    const adapterConfig = options?.adapterConfig ?? entry.defaultAdapterConfig;

    const createdAgent = await agents.create(companyId, {
      name: agentName,
      role: entry.role,
      title: entry.title,
      icon: entry.icon,
      adapterType,
      adapterConfig,
      permissions: entry.defaultPermissions,
      budgetMonthlyCents: entry.defaultBudgetMonthlyCents,
      status: "idle",
      spentMonthlyCents: 0,
      lastHeartbeatAt: null,
    });

    // ── 2. Install required catalog skills ─────────────────────────────────
    const warnings: string[] = [];
    let skillsInstalled = 0;

    if (entry.requiredSkills.length > 0) {
      // First resolve the catalog skill ID from the key
      for (const req of entry.requiredSkills) {
        if (!req.required) continue; // optional skills are just recommendations
        try {
          // Look up the catalog skill by its key to get the ID
          const { getCatalogSkillOrThrow } = await import("./skills-catalog.js");
          const catalogSkill = getCatalogSkillOrThrow(req.catalogSkillKey);
          const result = await companySkills.installFromCatalog(companyId, {
            catalogSkillId: catalogSkill.id,
          });
          skillsInstalled++;
          if (result.warnings?.length) warnings.push(...result.warnings);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push(`Failed to install skill "${req.catalogSkillKey}": ${msg}`);
          logger.warn(
            { err, companyId, agentName, catalogSkillKey: req.catalogSkillKey },
            "Marketplace hire: failed to install skill",
          );
        }
      }
    }

    logger.info(
      { companyId, agentName, agentId: createdAgent.id, skillsInstalled },
      "Marketplace agent hired",
    );

    return {
      agentId: createdAgent.id,
      agentName: createdAgent.name,
      agentRole: createdAgent.role,
      agentSlug: createdAgent.urlKey,
      skillsInstalled,
      warnings,
    };
  }

  return {
    listAgents,
    getAgent,
    hire,
  };
}