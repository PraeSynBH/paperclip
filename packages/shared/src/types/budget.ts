import type {
  BudgetIncidentResolutionAction,
  BudgetIncidentStatus,
  BudgetMetric,
  BudgetScopeType,
  BudgetThresholdType,
  BudgetWindowKind,
  PauseReason,
} from "../constants.js";

export interface BudgetPolicy {
  id: string;
  companyId: string;
  scopeType: BudgetScopeType;
  scopeId: string;
  metric: BudgetMetric;
  windowKind: BudgetWindowKind;
  amount: number;
  reservationCents?: string;
  warnPercent: number;
  hardStopEnabled: boolean;
  unpricedUsagePolicy: "block" | "allow";
  notifyEnabled: boolean;
  isActive: boolean;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BudgetPolicySummary {
  policyId: string;
  companyId: string;
  scopeType: BudgetScopeType;
  scopeId: string;
  scopeName: string;
  metric: BudgetMetric;
  windowKind: BudgetWindowKind;
  amount: number;
  reservationCents?: string;
  observedAmount: number;
  observedAmountExact?: string;
  unpricedEventCount: number;
  pendingRunCount: number;
  remainingAmount: number;
  utilizationPercent: number;
  warnPercent: number;
  hardStopEnabled: boolean;
  unpricedUsagePolicy: "block" | "allow";
  notifyEnabled: boolean;
  isActive: boolean;
  status: "ok" | "warning" | "hard_stop";
  paused: boolean;
  pauseReason: PauseReason | null;
  windowStart: Date;
  windowEnd: Date;
}

export interface BudgetIncident {
  id: string;
  companyId: string;
  policyId: string;
  scopeType: BudgetScopeType;
  scopeId: string;
  scopeName: string;
  metric: BudgetMetric;
  windowKind: BudgetWindowKind;
  windowStart: Date;
  windowEnd: Date;
  thresholdType: BudgetThresholdType;
  amountLimit: number;
  amountObserved: number;
  status: BudgetIncidentStatus;
  approvalId: string | null;
  approvalStatus: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * An agent-scope budget policy and the `agents.budget_monthly_cents` column that
 * mirrors it describe one limit. Dispatch enforces the policy; every surface
 * that shows the agent row reads the column. When they disagree the agent can
 * look funded and be refused, or look broke and be allowed to spend.
 *
 * Both write paths reconcile (agent patch -> policy upsert, policy upsert ->
 * agent column), so a drift row means an out-of-band write, a partial hire, or
 * a row written before the reconciliation existed. It is never silent: the
 * company attention feed carries one item per drifted policy.
 */
export interface AgentBudgetDrift {
  companyId: string;
  agentId: string;
  agentName: string;
  agentStatus: string;
  /** `agents.budget_monthly_cents` — what agent-facing surfaces show. */
  agentRowAmount: number;
  policyId: string;
  /** Raw `budget_policies.amount`, even when the policy is disabled. */
  policyAmount: number;
  /** `policyAmount` when active, `0` when the saved policy is disabled. */
  policyEffectiveAmount: number;
  /**
   * `policy_higher` — the agent row understates funding; dispatch allows more
   * than the row advertises. `agent_row_higher` — the row overstates funding
   * and dispatch hard-stops earlier. The second direction is the PRX-5585
   * freeze: $100,000 on the row, $500 enforced.
   */
  direction: "policy_higher" | "agent_row_higher";
  /** Absolute difference between the policy's effective amount and the row. */
  difference: number;
  hardStopEnabled: boolean;
  policyIsActive: boolean;
  policyUpdatedAt: Date;
  agentUpdatedAt: Date;
}

export interface BudgetOverview {
  companyId: string;
  policies: BudgetPolicySummary[];
  activeIncidents: BudgetIncident[];
  /** Agent rows that disagree with their policy amount (see AgentBudgetDrift). */
  agentBudgetDrift: AgentBudgetDrift[];
  pausedAgentCount: number;
  pausedProjectCount: number;
  pendingApprovalCount: number;
}

export interface BudgetPolicyUpsertInput {
  scopeType: BudgetScopeType;
  scopeId: string;
  metric?: BudgetMetric;
  windowKind?: BudgetWindowKind;
  amount?: number;
  reservationCents?: string | number;
  warnPercent?: number;
  hardStopEnabled?: boolean;
  unpricedUsagePolicy?: "block" | "allow";
  notifyEnabled?: boolean;
  isActive?: boolean;
}

export interface BudgetIncidentResolutionInput {
  action: BudgetIncidentResolutionAction;
  amount?: number;
  decisionNote?: string | null;
}
