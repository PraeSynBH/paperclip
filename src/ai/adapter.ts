import type {
  MigrationStatus,
  ParityEvalResult,
  AiUsageMetrics,
  MigrationConfig,
  FallbackThresholds,
  ValidationSuiteConfig,
} from "./types.js";
import { OPENROUTER_MODEL_MAP } from "./types.js";

const DEFAULT_MIGRATION_CONFIG: MigrationConfig = {
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
};

export class MigrationAdapter {
  private migrationStatuses: Map<string, MigrationStatus> = new Map();
  private parityResults: ParityEvalResult[] = [];

  constructor(
    private readonly config: MigrationConfig = DEFAULT_MIGRATION_CONFIG,
  ) {}

  migrateAgent(agentId: string, agentRole: string, currentModel: string): MigrationStatus {
    const targetModel = OPENROUTER_MODEL_MAP[currentModel];
    if (!targetModel) {
      const failed: MigrationStatus = {
        agentId, agentRole, currentModel, targetModel: "unknown", status: "failed",
        parityScore: null, migratedAt: null, fallbackReason: `No Gemini model mapping for ${currentModel}`,
      };
      this.migrationStatuses.set(agentId, failed);
      return failed;
    }

    const status: MigrationStatus = {
      agentId, agentRole, currentModel, targetModel, status: "pending",
      parityScore: null, migratedAt: null, fallbackReason: null,
    };
    this.migrationStatuses.set(agentId, status);
    return status;
  }

  completeMigration(agentId: string): MigrationStatus {
    const status = this.migrationStatuses.get(agentId);
    if (!status) throw new Error(`Agent ${agentId} not found in migration plan`);

    const updated: MigrationStatus = {
      ...status,
      status: "migrated",
      migratedAt: new Date().toISOString(),
    };
    this.migrationStatuses.set(agentId, updated);
    return updated;
  }

  fallbackToOpenRouter(agentId: string, reason: string): MigrationStatus {
    const status = this.migrationStatuses.get(agentId);
    if (!status) throw new Error(`Agent ${agentId} not found in migration plan`);

    const updated: MigrationStatus = {
      ...status,
      status: "fallback",
      fallbackReason: reason,
    };
    this.migrationStatuses.set(agentId, updated);
    return updated;
  }

  recordParityEval(result: ParityEvalResult): void {
    this.parityResults.push(result);

    const status = this.migrationStatuses.get(result.agentId);
    if (status && result.passed) {
      this.migrationStatuses.set(result.agentId, {
        ...status,
        parityScore: result.geminiScore / Math.max(0.01, result.openRouterScore),
      });
    }
  }

  evaluateParity(agentId: string): { migrations: MigrationStatus[]; evalResults: ParityEvalResult[] } {
    const results = this.parityResults.filter(r => r.agentId === agentId);
    if (results.length < this.config.validationSuite.requiredSampleCount) {
      return {
        migrations: [],
        evalResults: [],
      };
    }

    const passRate = results.filter(r => r.passed).length / results.length;
    if (passRate < this.config.validationSuite.minPassRate) {
      this.fallbackToOpenRouter(agentId, `Parity pass rate ${(passRate * 100).toFixed(1)}% below threshold ${(this.config.validationSuite.minPassRate * 100).toFixed(1)}%`);
      return { migrations: [this.migrationStatuses.get(agentId)!], evalResults: results };
    }

    const avgLatencyDelta = results.reduce((s, r) => s + r.latencyDeltaMs, 0) / results.length;
    if (avgLatencyDelta > 0 && avgLatencyDelta / Math.max(0.01, (results[0]?.latencyDeltaMs || 0)) > this.config.fallbackThresholds.maxLatencyDegradationPercent / 100) {
      this.fallbackToOpenRouter(agentId, `Latency degradation exceeds threshold`);
      return { migrations: [this.migrationStatuses.get(agentId)!], evalResults: results };
    }

    return { migrations: [this.migrationStatuses.get(agentId)!], evalResults: results };
  }

  mapModel(openRouterModel: string): string {
    return OPENROUTER_MODEL_MAP[openRouterModel] ?? "gemini-2.5-flash";
  }

  getMigrationStatus(agentId: string): MigrationStatus | undefined {
    return this.migrationStatuses.get(agentId);
  }

  getAllMigrationStatuses(): MigrationStatus[] {
    return Array.from(this.migrationStatuses.values());
  }

  getMigrationSummary(): { total: number; pending: number; migrated: number; failed: number; fallback: number } {
    let pending = 0, migrated = 0, failed = 0, fallback = 0;
    for (const s of this.migrationStatuses.values()) {
      if (s.status === "pending") pending++;
      else if (s.status === "migrated") migrated++;
      else if (s.status === "failed") failed++;
      else if (s.status === "fallback") fallback++;
    }
    return { total: this.migrationStatuses.size, pending, migrated, failed, fallback };
  }

  getFallbackThresholds(): FallbackThresholds {
    return this.config.fallbackThresholds;
  }

  getValidationSuite(): ValidationSuiteConfig {
    return this.config.validationSuite;
  }
}
