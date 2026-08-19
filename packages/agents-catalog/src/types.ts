import type { MarketplaceAgentSkillRequirement } from "@paperclipai/shared";

export type { MarketplaceAgentSkillRequirement };

export type MarketplaceAgentKind = "bundled" | "community";

export interface MarketplaceAgent {
  /** Unique identifier (e.g. "paperclipai:marketplace:engineering:senior-coder") */
  id: string;
  /** Namespace/key (e.g. "paperclipai/marketplace/engineering/senior-coder") */
  key: string;
  /** Catalog kind */
  kind: MarketplaceAgentKind;
  /** Category for browsing (e.g. "engineering", "product", "operations") */
  category: string;
  /** URL-safe slug */
  slug: string;
  /** Display name */
  name: string;
  /** Description / pitch */
  description: string;
  /** Agent icon name from AGENT_ICON_NAMES */
  icon: string | null;
  /** Agent role (from AGENT_ROLES) */
  role: string;
  /** Job title */
  title: string | null;
  /** Path relative to package root (e.g. "catalog/engineering/senior-coder") */
  path: string;
  /** Recommended for which company industry types */
  recommendedForCompanyTypes: string[];
  /** Search/filter tags */
  tags: string[];
  /** Required catalog skill keys (refs to @paperclipai/skills-catalog) */
  requiredSkills: MarketplaceAgentSkillRequirement[];
  /** Default adapter type (default: "process") */
  defaultAdapterType: string;
  /** Default adapter config */
  defaultAdapterConfig: Record<string, unknown>;
  /** Default permissions */
  defaultPermissions: Record<string, unknown>;
  /** Default monthly budget in cents */
  defaultBudgetMonthlyCents: number;
}

export interface MarketplaceAgentManifest {
  schemaVersion: 1;
  packageName: "@paperclipai/agents-catalog";
  packageVersion: string;
  generatedAt: string;
  agents: MarketplaceAgent[];
}

export interface MarketplaceAgentInstallResult {
  agentId: string;
  agentName: string;
  skillsInstalled: number;
  warnings: string[];
}