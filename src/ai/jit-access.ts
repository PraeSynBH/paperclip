import type { AuditLogger } from "./audit-log.js";

export type JitDataScope =
  | "gmail.read"
  | "gmail.readwrite"
  | "calendar.read"
  | "calendar.readwrite"
  | "drive.read"
  | "drive.readwrite"
  | "meet.read"
  | "contacts.read";

export interface JitSession {
  sessionId: string;
  agentId: string;
  customerId: string;
  scopes: JitDataScope[];
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  accessCount: number;
  lastAccessAt: string | null;
  metadata: Record<string, unknown>;
}

export interface JitSessionConfig {
  defaultSessionDurationMs: number;
  idleTimeoutMs: number;
  maxExtensionCount: number;
  maxExtensionDurationMs: number;
}

export interface JitSessionSummary {
  activeSessions: number;
  totalSessions: number;
  totalAccesses: number;
  activeByCustomer: Record<string, number>;
  activeByAgent: Record<string, number>;
}

export interface JitAccessResult {
  allowed: boolean;
  reason: string | null;
  sessionId: string | null;
}

export const DEFAULT_SESSION_DURATION_MS = 30 * 60 * 1000;
export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_MAX_EXTENSION_COUNT = 3;
export const DEFAULT_MAX_EXTENSION_DURATION_MS = 30 * 60 * 1000;
/** Sweeper cadence. Mirrors the 5-minute tick from the RBR-166 Python implementation. */
export const DEFAULT_SWEEPER_INTERVAL_MS = 5 * 60 * 1000;

const DEFAULT_CONFIG: JitSessionConfig = {
  defaultSessionDurationMs: DEFAULT_SESSION_DURATION_MS,
  idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
  maxExtensionCount: DEFAULT_MAX_EXTENSION_COUNT,
  maxExtensionDurationMs: DEFAULT_MAX_EXTENSION_DURATION_MS,
};

export class JitAccessManager {
  private sessions: Map<string, JitSession> = new Map();
  private extensionCounts: Map<string, number> = new Map();
  private sweeperTimer: ReturnType<typeof setInterval> | null = null;
  private readonly config: JitSessionConfig;
  private readonly auditLogger?: AuditLogger;

  constructor(config?: Partial<JitSessionConfig>, auditLogger?: AuditLogger) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.auditLogger = auditLogger;
  }

  startSession(
    agentId: string,
    customerId: string,
    scopes: JitDataScope[],
    metadata?: Record<string, unknown>,
  ): JitSession {
    const now = new Date();
    const sessionId = `jit-${agentId}-${customerId}-${now.getTime()}`;

    const session: JitSession = {
      sessionId,
      agentId,
      customerId,
      scopes: [...scopes],
      startedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.config.defaultSessionDurationMs).toISOString(),
      endedAt: null,
      accessCount: 0,
      lastAccessAt: null,
      metadata: metadata ?? {},
    };

    this.sessions.set(sessionId, session);
    this.extensionCounts.set(sessionId, 0);

    this.auditLogger?.logJitSessionStart(agentId, customerId, sessionId, scopes, session.expiresAt);

    return { ...session };
  }

  endSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.endedAt !== null) return false;

    session.endedAt = new Date().toISOString();
    this.extensionCounts.delete(sessionId);

    this.auditLogger?.logJitSessionEnd(
      session.agentId,
      session.customerId,
      sessionId,
      session.accessCount,
      session.startedAt,
      session.endedAt,
    );

    return true;
  }

  isSessionActive(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.endedAt !== null) return false;
    if (this.isExpired(session)) {
      this.expireSession(session);
      return false;
    }
    return true;
  }

  getActiveSession(agentId: string, customerId: string): JitSession | null {
    for (const session of this.sessions.values()) {
      if (session.agentId === agentId &&
          session.customerId === customerId &&
          session.endedAt === null) {
        if (this.isExpired(session)) {
          this.expireSession(session);
          continue;
        }
        return { ...session };
      }
    }
    return null;
  }

  checkJitAccess(
    toolName: string,
    agentId: string,
    customerId?: string,
    requiredScopes?: JitDataScope[],
  ): JitAccessResult {
    const activeSessions: JitSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.agentId === agentId && session.endedAt === null) {
        if (this.isExpired(session)) {
          this.expireSession(session);
          continue;
        }
        if (!customerId || session.customerId === customerId) {
          activeSessions.push(session);
        }
      }
    }

    if (activeSessions.length === 0) {
      const reason = customerId
        ? `No active JIT session found for agent ${agentId} and customer ${customerId}`
        : `No active JIT session found for agent ${agentId}`;
      this.auditLogger?.logJitAccessDenied(agentId, toolName, reason);
      return { allowed: false, reason, sessionId: null };
    }

    const session = activeSessions[0];

    if (requiredScopes && requiredScopes.length > 0) {
      const hasAllScopes = requiredScopes.every(s => session.scopes.includes(s));
      if (!hasAllScopes) {
        const reason = `JIT session for agent ${agentId} lacks required scopes for tool ${toolName}`;
        this.auditLogger?.logJitAccessDenied(agentId, toolName, reason);
        return { allowed: false, reason, sessionId: session.sessionId };
      }
    }

    session.accessCount++;
    session.lastAccessAt = new Date().toISOString();

    this.auditLogger?.logJitAccessGranted(
      agentId,
      toolName,
      session.sessionId,
      session.accessCount,
    );

    return { allowed: true, reason: null, sessionId: session.sessionId };
  }

  extendSession(sessionId: string, durationMs?: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.endedAt !== null) return false;

    const extensionCount = this.extensionCounts.get(sessionId) ?? 0;
    if (extensionCount >= this.config.maxExtensionCount) return false;

    const extendBy = Math.min(
      durationMs ?? this.config.defaultSessionDurationMs,
      this.config.maxExtensionDurationMs,
    );

    const currentExpiry = new Date(session.expiresAt).getTime();
    const now = Date.now();
    const base = currentExpiry > now ? currentExpiry : now;
    session.expiresAt = new Date(base + extendBy).toISOString();

    this.extensionCounts.set(sessionId, extensionCount + 1);
    return true;
  }

  revokeAllForCustomer(customerId: string): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.customerId === customerId && session.endedAt === null) {
        session.endedAt = new Date().toISOString();
        count++;
      }
    }
    if (count > 0) {
      this.auditLogger?.logJitRevokeAll("customer", customerId, count);
    }
    return count;
  }

  revokeAll(): number {
    let count = 0;
    const now = new Date().toISOString();
    for (const session of this.sessions.values()) {
      if (session.endedAt === null) {
        session.endedAt = now;
        count++;
      }
    }
    if (count > 0) {
      this.auditLogger?.logJitRevokeAll("org_wide", null, count);
    }
    return count;
  }

  getActiveSessions(): JitSession[] {
    const active: JitSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.endedAt === null) {
        if (this.isExpired(session)) {
          this.expireSession(session);
          continue;
        }
        active.push({ ...session });
      }
    }
    return active;
  }

  getSession(sessionId: string): JitSession | null {
    const session = this.sessions.get(sessionId);
    return session ? { ...session } : null;
  }

  /**
   * Proactively expire any sessions that are past `expiresAt`.
   *
   * Expiry in this manager is otherwise *lazy*: a session is only marked
   * expired (and only emits `jit.session_expired`) when something happens to
   * touch it. An abandoned session therefore stays silently "active" in the
   * store and never produces an audit event. This sweep makes expiry
   * eager and observable.
   *
   * Ported from the RBR-166 Python implementation's `SessionManager.sweeper_tick`.
   *
   * @returns the number of sessions expired by this sweep.
   */
  sweepExpiredSessions(): number {
    let expired = 0;
    for (const session of this.sessions.values()) {
      if (session.endedAt === null && this.isExpired(session)) {
        this.expireSession(session);
        expired++;
      }
    }
    return expired;
  }

  /**
   * Run {@link sweepExpiredSessions} on an interval.
   *
   * Ported from the RBR-166 Python implementation's background sweeper thread.
   * The timer is `unref()`d so it never holds the process open.
   *
   * @returns a stop function that cancels the sweeper.
   */
  startSweeper(intervalMs: number = DEFAULT_SWEEPER_INTERVAL_MS): () => void {
    if (this.sweeperTimer !== null) return () => this.stopSweeper();

    this.sweeperTimer = setInterval(() => {
      try {
        this.sweepExpiredSessions();
      } catch {
        // A sweeper failure must never take down the caller.
      }
    }, intervalMs);

    this.sweeperTimer.unref?.();
    return () => this.stopSweeper();
  }

  stopSweeper(): void {
    if (this.sweeperTimer !== null) {
      clearInterval(this.sweeperTimer);
      this.sweeperTimer = null;
    }
  }

  getSessionSummary(): JitSessionSummary {
    const activeSessions = this.getActiveSessions();
    const activeByCustomer: Record<string, number> = {};
    const activeByAgent: Record<string, number> = {};

    for (const s of activeSessions) {
      activeByCustomer[s.customerId] = (activeByCustomer[s.customerId] ?? 0) + 1;
      activeByAgent[s.agentId] = (activeByAgent[s.agentId] ?? 0) + 1;
    }

    let totalAccesses = 0;
    for (const s of this.sessions.values()) {
      totalAccesses += s.accessCount;
    }

    return {
      activeSessions: activeSessions.length,
      totalSessions: this.sessions.size,
      totalAccesses,
      activeByCustomer,
      activeByAgent,
    };
  }

  private isExpired(session: JitSession): boolean {
    return new Date().getTime() >= new Date(session.expiresAt).getTime();
  }

  private expireSession(session: JitSession): void {
    session.endedAt = new Date().toISOString();
    this.extensionCounts.delete(session.sessionId);
    this.auditLogger?.logJitSessionExpired(
      session.agentId,
      session.customerId,
      session.sessionId,
      session.accessCount,
      session.expiresAt,
    );
  }
}