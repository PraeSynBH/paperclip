export type AgentRole =
  | "CEO" | "CTO" | "CISO" | "CRO" | "CMO" | "VP of Sales"
  | "content" | "demand_gen" | "pmm" | "devrel" | "community"
  | "enterprise_ae" | "smb_ae" | "sdr" | "partnerships" | "sales_ops"
  | "security_ops" | "security_engineering" | "compliance_audit"
  | "vendor_risk" | "awareness_training";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface ToolPermission {
  toolName: string;
  allowedRoles: AgentRole[];
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  maxInvocationsPerSession?: number;
  requiresJitSession?: boolean;
  jitRequiredScopes?: string[];
  description: string;
}

export interface ToolAuthorizationResult {
  allowed: boolean;
  reason: string | null;
  requiresApproval: boolean;
  remainingInvocations: number | null;
  jitSessionId?: string | null;
}

export type JitSessionChecker = (
  toolName: string,
  agentId: string,
  requiredScopes?: string[],
) => { active: boolean; sessionId: string | null; reason: string | null };

const DEFAULT_TOOL_PERMISSIONS: ToolPermission[] = [
  {
    toolName: "read_file",
    allowedRoles: [
      "CEO", "CTO", "CISO", "CRO", "CMO", "VP of Sales",
      "content", "demand_gen", "pmm", "devrel", "community",
      "enterprise_ae", "smb_ae", "sdr", "partnerships", "sales_ops",
      "security_ops", "security_engineering", "compliance_audit",
      "vendor_risk", "awareness_training",
    ],
    riskLevel: "low",
    requiresApproval: false,
    description: "Read files from the project workspace",
  },
  {
    toolName: "write_file",
    allowedRoles: [
      "CEO", "CTO", "CISO",
      "security_ops", "security_engineering", "compliance_audit",
      "devrel", "demand_gen",
    ],
    riskLevel: "medium",
    requiresApproval: false,
    maxInvocationsPerSession: 50,
    description: "Write files to the project workspace",
  },
  {
    toolName: "execute_command",
    allowedRoles: [
      "CTO",
      "security_ops", "security_engineering",
    ],
    riskLevel: "high",
    requiresApproval: true,
    maxInvocationsPerSession: 10,
    description: "Execute shell commands",
  },
  {
    toolName: "create_issue",
    allowedRoles: [
      "CEO", "CTO", "CISO", "CRO", "CMO", "VP of Sales",
      "security_ops", "security_engineering", "compliance_audit",
      "devrel", "demand_gen", "pmm",
    ],
    riskLevel: "low",
    requiresApproval: false,
    maxInvocationsPerSession: 20,
    description: "Create new issues/tasks",
  },
  {
    toolName: "assign_issue",
    allowedRoles: [
      "CEO", "CTO", "CISO",
    ],
    riskLevel: "medium",
    requiresApproval: false,
    maxInvocationsPerSession: 30,
    description: "Assign issues to agents",
  },
  {
    toolName: "post_comment",
    allowedRoles: [
      "CEO", "CTO", "CISO", "CRO", "CMO", "VP of Sales",
      "security_ops", "security_engineering", "compliance_audit",
      "vendor_risk", "awareness_training",
    ],
    riskLevel: "low",
    requiresApproval: false,
    description: "Post comments on issues",
  },
  {
    toolName: "web_fetch",
    allowedRoles: [
      "CTO",
      "security_ops", "security_engineering",
      "compliance_audit", "vendor_risk",
      "content", "demand_gen", "pmm", "devrel",
    ],
    riskLevel: "medium",
    requiresApproval: false,
    maxInvocationsPerSession: 20,
    description: "Fetch content from URLs",
  },
  {
    toolName: "search_knowledge",
    allowedRoles: [
      "CEO", "CTO", "CISO", "CRO", "CMO", "VP of Sales",
      "content", "demand_gen", "pmm", "devrel", "community",
      "enterprise_ae", "smb_ae", "sdr", "partnerships", "sales_ops",
      "security_ops", "security_engineering", "compliance_audit",
      "vendor_risk", "awareness_training",
    ],
    riskLevel: "low",
    requiresApproval: false,
    description: "Search company knowledge base",
  },
  {
    toolName: "git_commit",
    allowedRoles: ["CEO", "CTO", "security_engineering", "devrel"],
    riskLevel: "high",
    requiresApproval: true,
    maxInvocationsPerSession: 5,
    description: "Create git commits",
  },
  {
    toolName: "git_push",
    allowedRoles: ["CTO"],
    riskLevel: "critical",
    requiresApproval: true,
    maxInvocationsPerSession: 3,
    description: "Push commits to remote",
  },
  {
    toolName: "manage_agents",
    allowedRoles: ["CEO", "CTO", "CISO"],
    riskLevel: "critical",
    requiresApproval: true,
    maxInvocationsPerSession: 5,
    description: "Create, modify, or delete agents",
  },
  {
    toolName: "manage_secrets",
    allowedRoles: ["CTO", "CISO"],
    riskLevel: "critical",
    requiresApproval: true,
    maxInvocationsPerSession: 3,
    description: "Access or modify secrets (API keys, credentials)",
  },
  {
    toolName: "manage_billing",
    allowedRoles: ["CEO", "CTO"],
    riskLevel: "critical",
    requiresApproval: true,
    maxInvocationsPerSession: 2,
    description: "Manage billing and payment configurations",
  },
  {
    toolName: "access_customer_data",
    allowedRoles: ["CISO", "security_ops", "compliance_audit"],
    riskLevel: "critical",
    requiresApproval: true,
    maxInvocationsPerSession: 5,
    requiresJitSession: true,
    jitRequiredScopes: ["gmail.read", "calendar.read", "drive.read"],
    description: "Access customer PII or regulated data",
  },
  {
    toolName: "delete_resource",
    allowedRoles: ["CTO", "security_ops"],
    riskLevel: "critical",
    requiresApproval: true,
    maxInvocationsPerSession: 3,
    description: "Delete cloud resources, databases, or infrastructure",
  },
];

export class ToolAuthorizer {
  private invocationCounts: Map<string, Map<string, number>> = new Map();
  private jitSessionChecker: JitSessionChecker | null = null;

  constructor(
    private readonly permissions: ToolPermission[] = DEFAULT_TOOL_PERMISSIONS,
  ) {}

  setJitSessionChecker(checker: JitSessionChecker): void {
    this.jitSessionChecker = checker;
  }

  authorizeTool(
    toolName: string,
    agentRole: AgentRole,
    agentId: string,
  ): ToolAuthorizationResult {
    const permission = this.permissions.find(
      p => p.toolName === toolName ||
          toolName.toLowerCase() === p.toolName.toLowerCase(),
    );

    if (!permission) {
      return {
        allowed: false,
        reason: `Tool '${toolName}' is not registered in the authorization policy. Default deny.`,
        requiresApproval: false,
        remainingInvocations: null,
      };
    }

    if (!permission.allowedRoles.includes(agentRole)) {
      return {
        allowed: false,
        reason: `Agent role '${agentRole}' is not authorized to use tool '${toolName}'`,
        requiresApproval: false,
        remainingInvocations: null,
      };
    }

    if (permission.requiresJitSession) {
      // Default-deny: a tool that requires a JIT session must never be
      // authorized when no session checker is wired. Previously this branch
      // was skipped entirely when `jitSessionChecker` was null, which let
      // `access_customer_data` through on any ToolAuthorizer constructed
      // outside the governance/pipeline path. Fail closed instead.
      if (!this.jitSessionChecker) {
        return {
          allowed: false,
          reason: `Tool '${toolName}' requires an active JIT session, but no JIT session checker is configured. Default deny.`,
          requiresApproval: false,
          remainingInvocations: null,
        };
      }

      const jitCheck = this.jitSessionChecker(
        toolName,
        agentId,
        permission.jitRequiredScopes,
      );
      if (!jitCheck.active) {
        return {
          allowed: false,
          reason: jitCheck.reason ?? `Tool '${toolName}' requires an active JIT session`,
          requiresApproval: false,
          remainingInvocations: null,
          jitSessionId: jitCheck.sessionId,
        };
      }
    }

    if (permission.maxInvocationsPerSession !== undefined) {
      const remaining = this.checkInvocationLimit(agentId, toolName, permission.maxInvocationsPerSession);
      if (remaining <= 0) {
        return {
          allowed: false,
          reason: `Tool '${toolName}' invocation limit reached (max: ${permission.maxInvocationsPerSession})`,
          requiresApproval: false,
          remainingInvocations: 0,
        };
      }
      this.incrementInvocation(agentId, toolName);
      return {
        allowed: true,
        reason: null,
        requiresApproval: permission.requiresApproval,
        remainingInvocations: remaining - 1,
      };
    }

    return {
      allowed: true,
      reason: null,
      requiresApproval: permission.requiresApproval,
      remainingInvocations: null,
    };
  }

  authorizeTools(
    toolNames: string[],
    agentRole: AgentRole,
    agentId: string,
  ): { allowed: string[]; denied: { name: string; reason: string }[]; requiresApproval: string[] } {
    const allowed: string[] = [];
    const denied: { name: string; reason: string }[] = [];
    const requiresApproval: string[] = [];

    for (const name of toolNames) {
      const result = this.authorizeTool(name, agentRole, agentId);
      if (result.allowed) {
        allowed.push(name);
        if (result.requiresApproval) {
          requiresApproval.push(name);
        }
      } else {
        denied.push({ name, reason: result.reason ?? "Unknown reason" });
      }
    }

    return { allowed, denied, requiresApproval };
  }

  getPermissionsForRole(role: AgentRole): ToolPermission[] {
    return this.permissions.filter(p => p.allowedRoles.includes(role));
  }

  getHighRiskToolsForRole(role: AgentRole): ToolPermission[] {
    return this.getPermissionsForRole(role).filter(
      p => p.riskLevel === "high" || p.riskLevel === "critical",
    );
  }

  getPendingApprovals(agentId: string, agentRole: AgentRole): string[] {
    return this.permissions
      .filter(p => p.requiresApproval && p.allowedRoles.includes(agentRole))
      .map(p => p.toolName);
  }

  resetSession(agentId: string): void {
    this.invocationCounts.delete(agentId);
  }

  private checkInvocationLimit(agentId: string, toolName: string, max: number): number {
    const agentCounts = this.invocationCounts.get(agentId);
    if (!agentCounts) return max;
    const used = agentCounts.get(toolName) ?? 0;
    return Math.max(0, max - used);
  }

  private incrementInvocation(agentId: string, toolName: string): void {
    if (!this.invocationCounts.has(agentId)) {
      this.invocationCounts.set(agentId, new Map());
    }
    const agentCounts = this.invocationCounts.get(agentId)!;
    agentCounts.set(toolName, (agentCounts.get(toolName) ?? 0) + 1);
  }

  getInvocationCounts(agentId: string): Record<string, number> {
    const counts: Record<string, number> = {};
    const agentCounts = this.invocationCounts.get(agentId);
    if (agentCounts) {
      for (const [tool, count] of agentCounts.entries()) {
        counts[tool] = count;
      }
    }
    return counts;
  }

  getAllPermissions(): ReadonlyArray<ToolPermission> {
    return this.permissions;
  }
}