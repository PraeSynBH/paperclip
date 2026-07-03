import type { AgentApiKeyScope } from "@paperclipai/shared";

declare const AuthRunIdBrand: unique symbol;

export type AuthRunId = string & { [AuthRunIdBrand]: never };

export function asAuthRunId(value: string): AuthRunId {
  return value as AuthRunId;
}

export function toRunIdString(value: AuthRunId): string {
  return value;
}

export interface BoardAuthContext {
  readonly type: "board";
  readonly userId: string;
  readonly userName: string | null;
  readonly userEmail: string | null;
  readonly isInstanceAdmin: boolean;
  readonly source: "local_implicit" | "session" | "board_key" | "cloud_tenant";
  readonly companyIds?: readonly string[];
  readonly memberships?: readonly Array<{
    readonly companyId: string;
    readonly membershipRole?: string | null;
    readonly status?: string;
  }>;
  readonly keyId?: string;
}

export interface AgentAuthContext {
  readonly type: "agent";
  readonly agentId: string;
  readonly companyId: string;
  readonly source: "agent_key" | "agent_jwt";
  readonly keyId?: string;
  readonly keyScope?: AgentApiKeyScope;
}

export interface NoneAuthContext {
  readonly type: "none";
  readonly source: "none";
}

export type AuthContext = BoardAuthContext | AgentAuthContext | NoneAuthContext;

export interface ClientCorrelationContext {
  readonly clientCorrelationRunId: AuthRunId | undefined;
}

export function getRunIdFromCorrelation(
  correlation: ClientCorrelationContext | undefined,
): AuthRunId | undefined {
  return correlation?.clientCorrelationRunId;
}

export function requireAuthRunId(
  correlation: ClientCorrelationContext | undefined,
): AuthRunId {
  const runId = getRunIdFromCorrelation(correlation);
  if (!runId) {
    throw new Error("AuthRunId is required but correlation context has no runId");
  }
  return runId;
}
