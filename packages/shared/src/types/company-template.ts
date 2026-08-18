/**
 * Company template — pre-built company configuration for one-click deployment.
 * Follows the same pattern as KnowledgeStarterPack.
 */

export interface CompanyTemplateAgent {
  /** Agent role (ceo, cto, engineer, etc.) */
  role: string;
  /** Agent display name */
  name: string;
  /** Agent title/position */
  title: string;
  /** Catalog skill IDs to attach to this agent */
  skills?: string[];
  /** Markdown instructions for the agent (AGENTS.md) */
  instructions?: string;
  /** Adapter type override (defaults to "process") */
  adapterType?: string;
}

export interface CompanyTemplateCompany {
  /** Default company name */
  name: string;
  /** Company description */
  description?: string;
  /** Brand color hex */
  brandColor?: string;
  /** Monthly budget in cents */
  budgetMonthlyCents?: number;
}

export interface CompanyTemplateGoal {
  title: string;
  description?: string;
}

export interface CompanyTemplateProject {
  name: string;
  description?: string;
}

export interface CompanyTemplateStarterIssue {
  title: string;
  description?: string;
  /** Assignee agent index (0-based) */
  assigneeAgentIndex?: number;
}

export interface CompanyTemplate {
  /** Unique template key (e.g. "travel-concierge") */
  key: string;
  /** Human-readable name */
  name: string;
  /** Detailed description */
  description: string;
  /** Target industry */
  industry: string;
  /** Icon identifier */
  icon: string;
  /** Day to create the company */
  company: CompanyTemplateCompany;
  /** Agents to hire */
  agents: CompanyTemplateAgent[];
  /** Catalog skill IDs to install company-wide */
  skills?: string[];
  /** Optional knowledge starter pack to install */
  starterPackKey?: string;
  /** Company-level goal */
  goal?: CompanyTemplateGoal;
  /** Initial project */
  project?: CompanyTemplateProject;
  /** Starter issue/task */
  starterIssue?: CompanyTemplateStarterIssue;
}