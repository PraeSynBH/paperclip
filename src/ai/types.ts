import type { AiSafetyConfig } from "./safety-settings.js";

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
  /**
   * Gemini content-safety policy (GL-F9). Optional for backward compatibility;
   * when omitted, `DEFAULT_SAFETY_CONFIG` from `safety-settings.ts` applies.
   */
  safetyConfig?: AiSafetyConfig;
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

export interface SessionMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

export interface SessionContext {
  sessionId: string;
  messages: SessionMessage[];
  maxWindowSize: number;
}

export type ObfuscationType = "base64" | "rot13" | "leetspeak" | "unicode_normalization" | "url_encoding";

export interface ObfuscationResult {
  detected: boolean;
  types: ObfuscationType[];
  normalizedContent: string | null;
}

// ─── ISO 42001 A.8.4: Proactive AI Risk Register ───

export type AiRiskCategory =
  | "LLM01_prompt_injection"
  | "LLM02_insecure_output_handling"
  | "LLM03_training_data_poisoning"
  | "LLM04_model_denial_of_service"
  | "LLM05_supply_chain"
  | "LLM06_excessive_agency"
  | "LLM07_system_prompt_leakage"
  | "LLM08_vector_weakness"
  | "LLM09_misinformation"
  | "LLM10_unbounded_consumption"
  | "ISO42001_A.7_AI_resources"
  | "ISO42001_A.8_AI_risk_assessment"
  | "ISO42001_A.9_AI_impact_assessment"
  | "ISO42001_A.10_AI_system_design"
  | "ISO42001_budget_governance"
  | "ISO42001_model_selection"
  | "ISO42001_data_governance"
  | "ISO42001_access_control"
  | "ISO42001_third_party"
  | "ISO27001_A.8_technological";

export type AiRiskLikelihood = 1 | 2 | 3 | 4 | 5;

export type AiRiskImpact = 1 | 2 | 3 | 4 | 5;

export type AiRiskSeverity = "critical" | "high" | "medium" | "low";

export type AiRiskTreatment = "avoid" | "mitigate" | "transfer" | "accept";

export type AiRiskStatus = "identified" | "assessed" | "treated" | "accepted" | "closed";

export interface AiRiskEntry {
  id: string;
  category: AiRiskCategory;
  name: string;
  description: string;
  affectedSystems: string[];
  likelihood: AiRiskLikelihood;
  impact: AiRiskImpact;
  score: number;
  severity: AiRiskSeverity;
  treatment: AiRiskTreatment;
  mitigationPlan: string;
  residualLikelihood: AiRiskLikelihood | null;
  residualImpact: AiRiskImpact | null;
  residualScore: number | null;
  owner: string;
  status: AiRiskStatus;
  relatedFindings: string[];
  relatedControls: string[];
  identifiedAt: string;
  lastReviewedAt: string;
  nextReviewAt: string;
  closedAt: string | null;
  evidence: string[];
}

export interface AiRiskRegisterConfig {
  defaultReviewIntervalDays: number;
  severityThresholds: {
    critical: number;
    high: number;
    medium: number;
  };
  acceptanceCriteria: {
    maxResidualScore: number;
    requireCeoApprovalAboveScore: number;
  };
  /** ISO 42001 requires quarterly risk review. Default: 90 days. */
  mandatoryReviewCadenceDays: number;
}

export interface AiRiskReport {
  generatedAt: string;
  totalRisks: number;
  bySeverity: Record<AiRiskSeverity, number>;
  byStatus: Record<AiRiskStatus, number>;
  byTreatment: Record<AiRiskTreatment, number>;
  inherentRiskProfile: { averageScore: number; highestSeverity: AiRiskSeverity };
  residualRiskProfile: { averageScore: number; highestSeverity: AiRiskSeverity };
  overdueReviews: string[];
  topRisks: Pick<AiRiskEntry, "id" | "name" | "score" | "severity" | "treatment" | "status">[];
}
