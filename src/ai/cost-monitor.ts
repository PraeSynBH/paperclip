import type { AiUsageMetrics, BudgetAlert } from "./types.js";

export class CostMonitor {
  private dailyCosts: Map<string, number> = new Map();
  private monthlyCosts: Map<string, number> = new Map();
  private alertHistory: BudgetAlert[] = [];

  constructor(
    private readonly monthlyLimitUsd: number = 5000,
    private readonly dailyLimitUsd: number = 250,
    private readonly alertThresholds: number[] = [0.5, 0.75, 0.85, 0.95],
    private readonly perAgentLimitUsd: number = 500,
  ) {}

  trackUsage(metrics: AiUsageMetrics): void {
    const providerModelKey = `${metrics.providerId}:${metrics.modelId}`;
    const currentDaily = this.dailyCosts.get(providerModelKey) ?? 0;
    const currentMonthly = this.monthlyCosts.get(providerModelKey) ?? 0;

    this.dailyCosts.set(providerModelKey, currentDaily + metrics.costUsd);
    this.monthlyCosts.set(providerModelKey, currentMonthly + metrics.costUsd);
  }

  checkAlerts(providerId: string, modelId: string): BudgetAlert | null {
    const key = `${providerId}:${modelId}`;
    const monthlySpend = this.monthlyCosts.get(key) ?? 0;
    const percentageUsed = monthlySpend / this.monthlyLimitUsd;

    for (const threshold of this.alertThresholds) {
      if (percentageUsed >= threshold) {
        const alreadyFired = this.alertHistory.some(
          a => a.providerId === providerId && a.modelId === modelId && a.threshold === threshold,
        );
        if (!alreadyFired) {
          const alert: BudgetAlert = {
            providerId,
            modelId,
            threshold,
            currentSpend: monthlySpend,
            budgetLimit: this.monthlyLimitUsd,
            percentageUsed,
            projectedOverage: Math.max(0, monthlySpend - this.monthlyLimitUsd),
            firedAt: new Date().toISOString(),
          };
          this.alertHistory.push(alert);
          return alert;
        }
      }
    }
    return null;
  }

  getDailySpend(providerId: string, modelId: string): number {
    return this.dailyCosts.get(`${providerId}:${modelId}`) ?? 0;
  }

  getMonthlySpend(providerId: string, modelId: string): number {
    return this.monthlyCosts.get(`${providerId}:${modelId}`) ?? 0;
  }

  getMonthlyTotal(): number {
    let total = 0;
    for (const cost of this.monthlyCosts.values()) {
      total += cost;
    }
    return total;
  }

  checkDailyLimit(providerId: string, modelId: string): boolean {
    return this.getDailySpend(providerId, modelId) >= this.dailyLimitUsd;
  }

  checkPerAgentLimit(agentId: string): boolean {
    let agentCost = 0;
    for (const [key, cost] of this.monthlyCosts.entries()) {
      if (key.includes(agentId)) {
        agentCost += cost;
      }
    }
    return agentCost >= this.perAgentLimitUsd;
  }

  resetDailyCosts(): void {
    this.dailyCosts.clear();
  }

  getBudgetReport(): { totalMonthly: number; budgetLimit: number; percentageUsed: number; perModelBreakdown: Record<string, number> } {
    const total = this.getMonthlyTotal();
    const breakdown: Record<string, number> = {};
    for (const [key, cost] of this.monthlyCosts.entries()) {
      breakdown[key] = cost;
    }
    return { totalMonthly: total, budgetLimit: this.monthlyLimitUsd, percentageUsed: total / this.monthlyLimitUsd, perModelBreakdown: breakdown };
  }
}
