/**
 * Public-facing marketplace agent type shown in API responses.
 * This is the API representation (not the full catalog internal type).
 */
export interface MarketplaceAgentResponse {
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
  recommendedForCompanyTypes: string[];
  tags: string[];
  requiredSkills: {
    catalogSkillKey: string;
    required: boolean;
  }[];
  defaultAdapterType: string;
  defaultBudgetMonthlyCents: number;
}

export interface MarketplaceAgentInstallResponse {
  agentId: string;
  agentName: string;
  agentRole: string;
  agentSlug: string;
  skillsInstalled: number;
  warnings: string[];
}

/** Skill requirement entry attached to a marketplace agent manifest. */
export interface MarketplaceAgentSkillRequirement {
  catalogSkillKey: string;
  required: boolean;
}