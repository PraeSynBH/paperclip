export interface ModelTier {
  name: string;
  modelId: string;
  maxTokens: number;
  temperature: number;
  topP: number;
  roles: string[];
}

export interface AiProvider {
  id: string;
  name: string;
  baseUrl: string;
  models: ModelTier[];
  budgetLimitMonthlyUsd: number;
  budgetAlertThresholds: number[];
}

export interface MigrationStatus {
  agentId: string;
  agentRole: string;
  currentModel: string;
  targetModel: string;
  status: "pending" | "migrated" | "fallback" | "failed";
  parityScore: number | null;
  migratedAt: string | null;
  fallbackReason: string | null;
}

export interface ContentFilterResult {
  allowed: boolean;
  blockedRule: string | null;
  sanitizedContent: string | null;
  riskScore: number;
  categories: ContentCategory[];
}

export interface ContentCategory {
  name: string;
  matched: boolean;
  confidence: number;
}

export interface AiUsageMetrics {
  providerId: string;
  modelId: string;
  agentId: string;
  projectId: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  requestCount: number;
  errorCount: number;
  latencyMsAvg: number;
  windowStart: string;
  windowEnd: string;
}

export interface BudgetAlert {
  providerId: string;
  modelId: string;
  threshold: number;
  currentSpend: number;
  budgetLimit: number;
  percentageUsed: number;
  projectedOverage: number;
  firedAt: string;
}

export interface ParityEvalResult {
  agentId: string;
  taskId: string;
  taskCategory: string;
  openRouterModel: string;
  geminiModel: string;
  openRouterScore: number;
  geminiScore: number;
  latencyDeltaMs: number;
  costDeltaUsd: number;
  passed: boolean;
  evaluatedAt: string;
}

export interface AiGovernanceConfig {
  providers: AiProvider[];
  dataClassificationRules: DataClassificationRule[];
  contentFilters: ContentFilterRule[];
  migrationPlan: MigrationConfig;
  budgetConfig: BudgetConfig;
}

export interface DataClassificationRule {
  pattern: string;
  classification: "public" | "internal" | "confidential" | "regulated";
  action: "block" | "redact" | "warn" | "audit";
}

export interface ContentFilterRule {
  id: string;
  name: string;
  category: string;
  description: string;
  action: "block" | "redact" | "warn";
  priority: number;
}

export interface MigrationConfig {
  strategy: "parallel-canary" | "direct-cutover" | "gradual-rollout";
  canaryAgentIds: string[];
  cutoverDeadline: string;
  fallbackThresholds: FallbackThresholds;
  validationSuite: ValidationSuiteConfig;
}

export interface FallbackThresholds {
  maxErrorRateIncrease: number;
  maxLatencyDegradationPercent: number;
  minParityScore: number;
  maxCostIncreasePercent: number;
}

export interface ValidationSuiteConfig {
  requiredSampleCount: number;
  taskCategories: string[];
  minPassRate: number;
}

export interface BudgetConfig {
  defaultMonthlyLimit: number;
  alertThresholds: number[];
  dailyCostLimit: number;
  perAgentCostLimit: number;
  overageAction: "alert" | "block" | "throttle";
}

export const OPENROUTER_MODEL_MAP: Record<string, string> = {
  "openrouter/deepseek/deepseek-v4-pro": "gemini-2.5-pro",
  "openrouter/minimax/minimax-m3": "gemini-2.5-flash",
  "openrouter/moonshotai/kimi-k2.7-code": "gemini-2.5-pro",
  "openrouter/openai/gpt-5.5": "gemini-2.5-pro",
};

export const MODEL_TIER_MAP: Record<string, string> = {
  "gemini-2.5-pro": "leadership",
  "gemini-2.5-flash": "ic",
};

export const AGENT_MIGRATION_STATUS: Record<string, MigrationStatus> = {
  "53c28b5d": {
    agentId: "53c28b5d",
    agentRole: "CEO",
    currentModel: "openrouter/deepseek/deepseek-v4-pro",
    targetModel: "gemini-2.5-pro",
    status: "pending",
    parityScore: null,
    migratedAt: null,
    fallbackReason: null,
  },
  "b7079c44": {
    agentId: "b7079c44",
    agentRole: "CTO",
    currentModel: "openrouter/deepseek/deepseek-v4-pro",
    targetModel: "gemini-2.5-pro",
    status: "pending",
    parityScore: null,
    migratedAt: null,
    fallbackReason: null,
  },
  "aad16410": {
    agentId: "aad16410",
    agentRole: "CISO",
    currentModel: "openrouter/deepseek/deepseek-v4-pro",
    targetModel: "gemini-2.5-pro",
    status: "pending",
    parityScore: null,
    migratedAt: null,
    fallbackReason: null,
  },
};
