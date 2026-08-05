export class RateLimiter {
  private requestTimestamps: Map<string, number[]> = new Map();
  private budgetBlocks: Map<string, boolean> = new Map();

  constructor(
    private readonly maxRequestsPerMinute: number = 60,
    private readonly maxRequestsPerHour: number = 1000,
    private readonly maxRequestsPerAgentPerMinute: number = 10,
    private readonly maxTokensPerMinute: number = 500000,
  ) {}

  allowRequest(agentId: string, params?: { tokenCount?: number }): RateLimitResult {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const oneHourAgo = now - 3600000;

    const globalKey = "__global__";
    const globalMinuteTimestamps = this.pruneTimestamps(this.getTimestamps(globalKey), oneMinuteAgo);
    const globalHourTimestamps = this.pruneTimestamps(this.getTimestamps(globalKey), oneHourAgo);

    if (globalMinuteTimestamps.length >= this.maxRequestsPerMinute) {
      return { allowed: false, reason: `Global rate limit exceeded (${this.maxRequestsPerMinute}/min)`, retryAfterMs: 60000 };
    }

    if (globalHourTimestamps.length >= this.maxRequestsPerHour) {
      return { allowed: false, reason: `Global rate limit exceeded (${this.maxRequestsPerHour}/hour)`, retryAfterMs: 3600000 };
    }

    const agentMinuteTimestamps = this.pruneTimestamps(this.getTimestamps(agentId), oneMinuteAgo);
    if (agentMinuteTimestamps.length >= this.maxRequestsPerAgentPerMinute) {
      return { allowed: false, reason: `Agent rate limit exceeded (${this.maxRequestsPerAgentPerMinute}/min)`, retryAfterMs: 60000 };
    }

    if (this.budgetBlocks.get(agentId)) {
      return { allowed: false, reason: "Requests blocked due to budget exceeded", retryAfterMs: 86400000 };
    }

    const nowTimestamp = now;
    globalMinuteTimestamps.push(nowTimestamp);
    globalHourTimestamps.push(nowTimestamp);
    agentMinuteTimestamps.push(nowTimestamp);

    this.requestTimestamps.set(globalKey, [...globalMinuteTimestamps, ...globalHourTimestamps.filter(t => t <= oneMinuteAgo)]);
    this.requestTimestamps.set(agentId, agentMinuteTimestamps);

    return { allowed: true, reason: null, retryAfterMs: null };
  }

  blockBudget(agentId: string): void {
    this.budgetBlocks.set(agentId, true);
  }

  unblockBudget(agentId: string): void {
    this.budgetBlocks.delete(agentId);
  }

  isBudgetBlocked(agentId: string): boolean {
    return this.budgetBlocks.get(agentId) ?? false;
  }

  getStatus(agentId: string): RateLimitStatus {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const globalMinute = this.pruneTimestamps(this.getTimestamps("__global__"), oneMinuteAgo).length;
    const agentMinute = this.pruneTimestamps(this.getTimestamps(agentId), oneMinuteAgo).length;

    return {
      globalRequestsPerMinute: globalMinute,
      agentRequestsPerMinute: agentMinute,
      maxRequestsPerMinute: this.maxRequestsPerMinute,
      maxPerAgentPerMinute: this.maxRequestsPerAgentPerMinute,
      budgetBlocked: this.isBudgetBlocked(agentId),
    };
  }

  reset(agentId: string): void {
    this.requestTimestamps.delete(agentId);
    this.budgetBlocks.delete(agentId);
  }

  private getTimestamps(key: string): number[] {
    return this.requestTimestamps.get(key) ?? [];
  }

  private pruneTimestamps(timestamps: number[], cutoff: number): number[] {
    return timestamps.filter(t => t >= cutoff);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  reason: string | null;
  retryAfterMs: number | null;
}

export interface RateLimitStatus {
  globalRequestsPerMinute: number;
  agentRequestsPerMinute: number;
  maxRequestsPerMinute: number;
  maxPerAgentPerMinute: number;
  budgetBlocked: boolean;
}