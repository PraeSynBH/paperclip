import type {
  AiGovernanceConfig,
  ContentFilterRule,
  DataClassificationRule,
  AiProvider,
} from "./types.js";
import { ContentGuardrails } from "./guardrails.js";
import { CostMonitor } from "./cost-monitor.js";
import { MigrationAdapter } from "./adapter.js";

const DEFAULT_GOVERNANCE_CONFIG: AiGovernanceConfig = {
  providers: [
    {
      id: "google-gemini",
      name: "Google Gemini (Vertex AI)",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      budgetLimitMonthlyUsd: 5000,
      budgetAlertThresholds: [0.50, 0.75, 0.85, 0.95],
      models: [
        {
          name: "Leadership",
          modelId: "gemini-2.5-pro",
          maxTokens: 32768,
          temperature: 0.7,
          topP: 0.95,
          roles: ["CEO", "CTO", "CRO", "CMO", "CISO", "VP of Sales"],
        },
        {
          name: "IC / Specialist",
          modelId: "gemini-2.5-flash",
          maxTokens: 16384,
          temperature: 0.5,
          topP: 0.95,
          roles: ["content", "demand_gen", "pmm", "devrel", "community", "enterprise_ae", "smb_ae", "sdr", "partnerships", "sales_ops", "security_ops", "security_engineering", "compliance_audit", "vendor_risk", "awareness_training"],
        },
      ],
    },
    {
      id: "openrouter-fallback",
      name: "OpenRouter (Fallback)",
      baseUrl: "https://openrouter.ai/api/v1",
      budgetLimitMonthlyUsd: 2000,
      budgetAlertThresholds: [0.50, 0.75, 0.90],
      models: [
        {
          name: "Leadership (Fallback)",
          modelId: "deepseek/deepseek-v4-pro",
          maxTokens: 32768,
          temperature: 0.7,
          topP: 0.95,
          roles: ["CEO", "CTO", "CRO", "CMO", "CISO", "VP of Sales"],
        },
      ],
    },
  ],
  dataClassificationRules: [
    { pattern: "\\b\\d{3}-\\d{2}-\\d{4}\\b", classification: "regulated", action: "redact" },
    { pattern: "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b", classification: "confidential", action: "redact" },
    { pattern: "\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14})\\b", classification: "regulated", action: "block" },
    { pattern: "\\b(sk-[a-zA-Z0-9]{32,})\\b", classification: "confidential", action: "block" },
  ],
  contentFilters: [],
  migrationPlan: {
    strategy: "parallel-canary",
    canaryAgentIds: ["aad16410", "168e1f8b"],
    cutoverDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    fallbackThresholds: {
      maxErrorRateIncrease: 0.05,
      maxLatencyDegradationPercent: 50,
      minParityScore: 0.85,
      maxCostIncreasePercent: 30,
    },
    validationSuite: {
      requiredSampleCount: 100,
      taskCategories: ["coding", "analysis", "creative", "compliance"],
      minPassRate: 0.90,
    },
  },
  budgetConfig: {
    defaultMonthlyLimit: 5000,
    alertThresholds: [0.50, 0.75, 0.85, 0.95],
    dailyCostLimit: 250,
    perAgentCostLimit: 500,
    overageAction: "alert",
  },
};

export class AiGovernanceEngine {
  public readonly guardrails: ContentGuardrails;
  public readonly costMonitor: CostMonitor;
  public readonly migrationAdapter: MigrationAdapter;

  constructor(config: AiGovernanceConfig = DEFAULT_GOVERNANCE_CONFIG) {
    this.guardrails = new ContentGuardrails(config.contentFilters.length > 0 ? config.contentFilters : undefined, config.dataClassificationRules);
    this.costMonitor = new CostMonitor(
      config.budgetConfig.defaultMonthlyLimit,
      config.budgetConfig.dailyCostLimit,
      config.budgetConfig.alertThresholds,
      config.budgetConfig.perAgentCostLimit,
    );
    this.migrationAdapter = new MigrationAdapter(config.migrationPlan);
  }

  static getProviderById(config: AiGovernanceConfig, providerId: string): AiProvider | undefined {
    return config.providers.find(p => p.id === providerId);
  }
}
