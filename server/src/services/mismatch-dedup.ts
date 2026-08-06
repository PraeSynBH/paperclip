interface DedupEntry {
  count: number;
  expiresAt: number;
}

export interface DedupResult {
  emit: boolean;
  count: number;
}

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

export class MismatchDedupStore {
  private store = new Map<string, DedupEntry>();
  private ceilingCount = 0;
  private ceilingWindowStart = 0;

  constructor(
    private readonly windowMs: number = DEFAULT_WINDOW_MS,
    private readonly maxKeys: number = 50_000,
    private readonly globalEmitCeilingPerSecond: number = 500,
  ) {}

  shouldEmit(key: string): DedupResult {
    this.pruneExpired();

    const now = Date.now();
    const globalCeilingCheck = this.checkGlobalCeiling(now);
    if (globalCeilingCheck.suppress) {
      return { emit: false, count: globalCeilingCheck.suppressedCount };
    }

    const entry = this.store.get(key);
    if (entry) {
      entry.count += 1;
      return { emit: false, count: entry.count };
    }

    this.enforceCapacityLimit();

    this.store.set(key, { count: 1, expiresAt: now + this.windowMs });
    return { emit: true, count: 1 };
  }

  private checkGlobalCeiling(now: number): { suppress: boolean; suppressedCount: number } {
    const second = Math.floor(now / 1000);
    if (this.ceilingWindowStart !== second) {
      this.ceilingCount = 0;
      this.ceilingWindowStart = second;
    }
    if (this.ceilingCount >= this.globalEmitCeilingPerSecond) {
      return { suppress: true, suppressedCount: this.ceilingCount };
    }
    this.ceilingCount += 1;
    return { suppress: false, suppressedCount: 0 };
  }

  private pruneExpired() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now >= entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  private enforceCapacityLimit() {
    if (this.store.size < this.maxKeys) return;

    let oldestKey: string | null = null;
    let oldestExpiry = Infinity;
    for (const [key, entry] of this.store) {
      if (entry.expiresAt < oldestExpiry) {
        oldestExpiry = entry.expiresAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this.store.delete(oldestKey);
    }
  }
}

export function buildMismatchDedupKey(params: {
  tenantId: string;
  actorId: string;
  authRunId: string;
  clientCorrelationRunId: string | null;
  route: string;
  enforcement: 'ignored' | 'rejected';
}): string {
  return [
    params.tenantId,
    params.actorId,
    params.authRunId,
    params.clientCorrelationRunId ?? '',
    params.route,
    params.enforcement,
    Math.floor(Date.now() / DEFAULT_WINDOW_MS),
  ].join(':');
}

export const defaultMismatchDedupStore = new MismatchDedupStore();