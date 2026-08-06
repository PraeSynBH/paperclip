import type {
  AiGovernanceConfig,
  ContentFilterRule,
  DataClassificationRule,
} from "./types.js";
import { ContentGuardrails, CONTENT_FILTER_RULES } from "./guardrails.js";
import { CostMonitor } from "./cost-monitor.js";
import { MigrationAdapter } from "./adapter.js";
import { GeminiClient } from "./gemini-client.js";
import { SecureAiPipeline } from "./pipeline.js";
import { AuditLogger } from "./audit-log.js";
import { RateLimiter } from "./rate-limiter.js";
import { OutputValidator } from "./output-validator.js";
import { ToolAuthorizer } from "./tool-auth.js";
import type { PipelineConfig, PipelineResult } from "./pipeline.js";
import type { OpenAiChatRequest, OpenAiChatResponse } from "./format-adapter.js";
import type { AgentRole } from "./tool-auth.js";
import { JitAccessManager } from "./jit-access.js";
import { config, loadConfig } from "../config.js";
import { DEFAULT_SAFETY_CONFIG } from "./safety-settings.js";
import type { AiSafetyConfig } from "./safety-settings.js";

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
  contentFilters: CONTENT_FILTER_RULES,
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
  // GL-F9 (RBR-135): Gemini safety thresholds are governance-owned and
  // per-project configurable. Add entries to `projectOverrides` keyed by
  // project id; overrides may only be equal or stricter than `minimumThreshold`.
  safetyConfig: DEFAULT_SAFETY_CONFIG,
};

export class AiGovernanceEngine {
  public readonly guardrails: ContentGuardrails;
  public readonly costMonitor: CostMonitor;
  public readonly migrationAdapter: MigrationAdapter;
  public readonly pipeline: SecureAiPipeline;
  public readonly auditLogger: AuditLogger;
  public readonly rateLimiter: RateLimiter;
  public readonly outputValidator: OutputValidator;
  public readonly toolAuthorizer: ToolAuthorizer;
  public readonly jitAccessManager: JitAccessManager;
  public readonly safetyConfig: AiSafetyConfig;

  constructor(
    config: AiGovernanceConfig = DEFAULT_GOVERNANCE_CONFIG,
    geminiClient?: GeminiClient,
  ) {
    this.guardrails = new ContentGuardrails(
      config.contentFilters.length > 0 ? config.contentFilters : undefined,
      config.dataClassificationRules,
    );
    this.costMonitor = new CostMonitor(
      config.budgetConfig.defaultMonthlyLimit,
      config.budgetConfig.dailyCostLimit,
      config.budgetConfig.alertThresholds,
      config.budgetConfig.perAgentCostLimit,
    );
    this.migrationAdapter = new MigrationAdapter(config.migrationPlan);
    this.auditLogger = new AuditLogger({ logToConsole: false });
    this.rateLimiter = new RateLimiter();
    this.outputValidator = new OutputValidator({
      htmlSanitization: true,
      scriptSanitization: true,
      hallucinationDetection: true,
    });
    this.toolAuthorizer = new ToolAuthorizer();
    this.jitAccessManager = new JitAccessManager(undefined, this.auditLogger);
    this.safetyConfig = config.safetyConfig ?? DEFAULT_SAFETY_CONFIG;

    const client = geminiClient ?? new GeminiClient({
      apiKey: "", // No static key — must be injected via createGovernanceEngine
    });

    this.pipeline = new SecureAiPipeline({
      geminiClient: client,
      guardrails: this.guardrails,
      costMonitor: this.costMonitor,
      auditLogger: this.auditLogger,
      rateLimiter: this.rateLimiter,
      outputValidator: this.outputValidator,
      toolAuthorizer: this.toolAuthorizer,
      jitAccessManager: this.jitAccessManager,
      safetyConfig: this.safetyConfig,
    });
  }

  async chat(
    request: OpenAiChatRequest,
    agentId: string,
    projectId: string,
    agentRole?: AgentRole,
  ): Promise<PipelineResult> {
    return this.pipeline.process(request, agentId, projectId, agentRole);
  }

  static getProviderById(config: AiGovernanceConfig, providerId: string) {
    return config.providers.find(p => p.id === providerId);
  }

  /**
   * Effective Gemini safety settings for a project (GL-F9). Use this to audit
   * what thresholds a given project will actually send to Gemini.
   */
  getSafetySettings(projectId?: string) {
    return this.pipeline.resolveSafetySettings(projectId);
  }

  getConfig(): AiGovernanceConfig {
    return DEFAULT_GOVERNANCE_CONFIG;
  }
}

export async function createGovernanceEngine(): Promise<AiGovernanceEngine> {
  const cfg = await loadConfig();
  const geminiClient = new GeminiClient({
    apiKey: cfg.googleAi.apiKey,
    baseUrl: cfg.googleAi.baseUrl,
  });
  return new AiGovernanceEngine(DEFAULT_GOVERNANCE_CONFIG, geminiClient);
}

export { DEFAULT_GOVERNANCE_CONFIG };