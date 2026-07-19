export type AuditEventType =
  | "gemini.request"
  | "gemini.response"
  | "gemini.error"
  | "guardrail.blocked"
  | "guardrail.flagged"
  | "tool.authorized"
  | "tool.denied"
  | "tool.requires_approval"
  | "budget.alert"
  | "budget.exceeded"
  | "budget.blocked"
  | "rate_limit.hit"
  | "output.validated"
  | "output.blocked"
  | "jit.session_start"
  | "jit.session_end"
  | "jit.access_granted"
  | "jit.access_denied"
  | "jit.session_expired"
  | "jit.revoke_all";

export type AuditSeverity = "debug" | "info" | "warn" | "error" | "critical";

export interface AuditEntry {
  timestamp: string;
  eventType: AuditEventType;
  severity: AuditSeverity;
  agentId: string;
  projectId: string;
  providerId?: string;
  modelId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface AuditLogConfig {
  maxEntries?: number;
  maxEntryContentLength?: number;
  logToConsole?: boolean;
}

const DEFAULT_MAX_ENTRIES = 10000;
const DEFAULT_MAX_CONTENT_LENGTH = 2000;

export class AuditLogger {
  private entries: AuditEntry[] = [];
  private readonly maxEntries: number;
  private readonly maxContentLength: number;
  private readonly logToConsole: boolean;

  constructor(config: AuditLogConfig = {}) {
    this.maxEntries = config.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxContentLength = config.maxEntryContentLength ?? DEFAULT_MAX_CONTENT_LENGTH;
    this.logToConsole = config.logToConsole ?? false;
  }

  log(
    eventType: AuditEventType,
    severity: AuditSeverity,
    agentId: string,
    projectId: string,
    summary: string,
    metadata?: Record<string, unknown>,
    providerId?: string,
    modelId?: string,
  ): AuditEntry {
    const sanitizedMetadata = metadata ? this.sanitizeMetadata(metadata) : undefined;

    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      eventType,
      severity,
      agentId,
      projectId,
      providerId,
      modelId,
      summary,
      metadata: sanitizedMetadata,
    };

    this.entries.push(entry);

    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries / 2);
    }

    if (this.logToConsole) {
      const consoleMethod = severity === "error" || severity === "critical" ? "error" :
        severity === "warn" ? "warn" : "info";
      console[consoleMethod](`[AUDIT] [${eventType}] ${summary}`);
    }

    return entry;
  }

  logGeminiRequest(
    agentId: string,
    projectId: string,
    modelId: string,
    promptPreview: string,
    toolNames?: string[],
  ): AuditEntry {
    return this.log(
      "gemini.request",
      "info",
      agentId,
      projectId,
      `Gemini API request to model ${modelId}`,
      {
        promptPreview: this.truncate(promptPreview, 500),
        promptLength: promptPreview.length,
        toolNames: toolNames ?? [],
      },
      "google-gemini",
      modelId,
    );
  }

  logGeminiResponse(
    agentId: string,
    projectId: string,
    modelId: string,
    responsePreview: string,
    tokenUsage?: { prompt: number; completion: number; total: number },
    latencyMs?: number,
  ): AuditEntry {
    return this.log(
      "gemini.response",
      "info",
      agentId,
      projectId,
      `Gemini API response from model ${modelId} (${tokenUsage?.total ?? "?"} tokens)`,
      {
        responsePreview: this.truncate(responsePreview, 500),
        responseLength: responsePreview.length,
        tokenUsage,
        latencyMs,
      },
      "google-gemini",
      modelId,
    );
  }

  logGeminiError(
    agentId: string,
    projectId: string,
    modelId: string,
    errorMessage: string,
    statusCode?: number,
  ): AuditEntry {
    const severity = statusCode === 401 || statusCode === 403 ? "critical" : "error";
    return this.log(
      "gemini.error",
      severity,
      agentId,
      projectId,
      `Gemini API error: ${errorMessage}`,
      { errorMessage, statusCode },
      "google-gemini",
      modelId,
    );
  }

  logGuardrailBlock(
    agentId: string,
    projectId: string,
    blockedRule: string,
    direction: "input" | "output",
    preview?: string,
  ): AuditEntry {
    return this.log(
      "guardrail.blocked",
      "warn",
      agentId,
      projectId,
      `Guardrail blocked ${direction}: ${blockedRule}`,
      { blockedRule, direction, preview: preview ? this.truncate(preview, 200) : undefined },
    );
  }

  logGuardrailFlag(
    agentId: string,
    projectId: string,
    ruleName: string,
    confidence: number,
    direction: "input" | "output",
  ): AuditEntry {
    return this.log(
      "guardrail.flagged",
      "info",
      agentId,
      projectId,
      `Guardrail flagged ${direction}: ${ruleName} (confidence: ${confidence.toFixed(2)})`,
      { ruleName, confidence, direction },
    );
  }

  logToolAuthorization(
    agentId: string,
    projectId: string,
    toolName: string,
    result: "allowed" | "denied" | "requires_approval",
    reason?: string,
  ): AuditEntry {
    const eventType = result === "allowed" ? "tool.authorized" :
      result === "denied" ? "tool.denied" : "tool.requires_approval";

    const severity = result === "denied" ? "warn" : "info";

    return this.log(
      eventType,
      severity,
      agentId,
      projectId,
      `Tool '${toolName}' ${result}: ${reason ?? "ok"}`,
      { toolName, result, reason },
    );
  }

  logBudgetAlert(
    agentId: string,
    projectId: string,
    providerId: string,
    threshold: number,
    currentSpend: number,
    budgetLimit: number,
  ): AuditEntry {
    const percentage = Math.round((currentSpend / budgetLimit) * 100);
    return this.log(
      "budget.alert",
      percentage >= 95 ? "critical" : "warn",
      agentId,
      projectId,
      `Budget threshold ${threshold * 100}% reached: $${currentSpend.toFixed(2)} of $${budgetLimit} (${percentage}%)`,
      { providerId, threshold, currentSpend, budgetLimit, percentage },
      providerId,
    );
  }

  logBudgetBlock(
    agentId: string,
    projectId: string,
    providerId: string,
    reason: string,
  ): AuditEntry {
    return this.log(
      "budget.blocked",
      "critical",
      agentId,
      projectId,
      `Request blocked by budget control: ${reason}`,
      { providerId, reason },
      providerId,
    );
  }

  logOutputValidation(
    agentId: string,
    projectId: string,
    result: "passed" | "failed",
    findings?: string[],
  ): AuditEntry {
    const severity = result === "failed" ? "warn" : "info";
    return this.log(
      result === "passed" ? "output.validated" : "output.blocked",
      severity,
      agentId,
      projectId,
      `Output validation ${result}`,
      { result, findings },
    );
  }

  getEntries(options?: {
    since?: string;
    agentId?: string;
    eventType?: AuditEventType;
    severity?: AuditSeverity;
    limit?: number;
  }): AuditEntry[] {
    let filtered = [...this.entries];

    if (options?.since) {
      const sinceDate = new Date(options.since).getTime();
      filtered = filtered.filter(e => new Date(e.timestamp).getTime() >= sinceDate);
    }
    if (options?.agentId) {
      filtered = filtered.filter(e => e.agentId === options.agentId);
    }
    if (options?.eventType) {
      filtered = filtered.filter(e => e.eventType === options.eventType);
    }
    if (options?.severity) {
      filtered = filtered.filter(e => e.severity === options.severity);
    }
    if (options?.limit) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  }

  getCriticalEvents(): AuditEntry[] {
    return this.entries.filter(e => e.severity === "critical");
  }

  getRecentErrors(sinceMinutes: number = 60): AuditEntry[] {
    const since = new Date(Date.now() - sinceMinutes * 60000).toISOString();
    return this.getEntries({
      since,
      severity: "error",
    }).concat(this.getEntries({ since, severity: "critical" }));
  }

  getSummary(): AuditSummary {
    const total = this.entries.length;
    const byEventType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byAgent: Record<string, number> = {};

    for (const entry of this.entries) {
      byEventType[entry.eventType] = (byEventType[entry.eventType] ?? 0) + 1;
      bySeverity[entry.severity] = (bySeverity[entry.severity] ?? 0) + 1;
      byAgent[entry.agentId] = (byAgent[entry.agentId] ?? 0) + 1;
    }

    const firstEntry = this.entries[0]?.timestamp ?? null;
    const lastEntry = this.entries[this.entries.length - 1]?.timestamp ?? null;

    return { total, byEventType, bySeverity, byAgent, firstEntry, lastEntry };
  }

  logJitSessionStart(
    agentId: string,
    customerId: string,
    sessionId: string,
    scopes: string[],
    expiresAt: string,
  ): AuditEntry {
    return this.log(
      "jit.session_start",
      "info",
      agentId,
      "",
      `JIT session started for customer ${customerId} (${scopes.join(", ")})`,
      { sessionId, customerId, scopes, expiresAt },
    );
  }

  logJitSessionEnd(
    agentId: string,
    customerId: string,
    sessionId: string,
    accessCount: number,
    startedAt: string,
    endedAt: string,
  ): AuditEntry {
    const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
    return this.log(
      "jit.session_end",
      "info",
      agentId,
      "",
      `JIT session ended for customer ${customerId} (${accessCount} accesses, ${Math.round(durationMs / 1000)}s)`,
      { sessionId, customerId, accessCount, startedAt, endedAt, durationMs },
    );
  }

  logJitAccessGranted(
    agentId: string,
    toolName: string,
    sessionId: string,
    accessCount: number,
  ): AuditEntry {
    return this.log(
      "jit.access_granted",
      "info",
      agentId,
      "",
      `JIT access granted for tool '${toolName}' (call #${accessCount})`,
      { sessionId, toolName, accessCount },
    );
  }

  logJitAccessDenied(
    agentId: string,
    toolName: string,
    reason: string,
  ): AuditEntry {
    return this.log(
      "jit.access_denied",
      "warn",
      agentId,
      "",
      `JIT access denied for tool '${toolName}': ${reason}`,
      { toolName, reason },
    );
  }

  logJitSessionExpired(
    agentId: string,
    customerId: string,
    sessionId: string,
    accessCount: number,
    expiredAt: string,
  ): AuditEntry {
    return this.log(
      "jit.session_expired",
      "warn",
      agentId,
      "",
      `JIT session expired for customer ${customerId} (${accessCount} accesses)`,
      { sessionId, customerId, accessCount, expiredAt },
    );
  }

  logJitRevokeAll(
    scope: "customer" | "org_wide",
    target: string | null,
    sessionCount: number,
  ): AuditEntry {
    const summary = scope === "customer"
      ? `JIT revoke all sessions for customer ${target} (${sessionCount} sessions)`
      : `JIT revoke all sessions organization-wide (${sessionCount} sessions)`;
    return this.log(
      "jit.revoke_all",
      "critical",
      "",
      "",
      summary,
      { scope, target, sessionCount },
    );
  }

  clear(): void {
    this.entries = [];
  }

  private sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    const sensitiveKeys = [
      "apiKey", "api_key", "apikey", "secret", "password", "token",
      "auth", "credential", "private_key", "privateKey",
    ];

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (sensitiveKeys.some(k => key.toLowerCase().includes(k))) {
        sanitized[key] = "[REDACTED]";
      } else if (typeof value === "string") {
        sanitized[key] = this.truncate(value, this.maxContentLength);
      } else if (typeof value === "object" && value !== null) {
        sanitized[key] = this.sanitizeMetadata(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  private truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return value.substring(0, maxLength) + `... [truncated ${value.length - maxLength} chars]`;
  }
}

export interface AuditSummary {
  total: number;
  byEventType: Record<string, number>;
  bySeverity: Record<string, number>;
  byAgent: Record<string, number>;
  firstEntry: string | null;
  lastEntry: string | null;
}