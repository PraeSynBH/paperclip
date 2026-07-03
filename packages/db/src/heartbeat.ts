import { eq } from "drizzle-orm";
import { heartbeatRuns } from "./schema/heartbeat_runs.js";
import type { Db } from "./client.js";

export interface CreateHeartbeatRunParams {
  companyId: string;
  agentId: string;
  invocationSource: string;
  triggerDetail?: string | null;
  status?: string;
  wakeupRequestId?: string | null;
  contextSnapshot?: Record<string, unknown> | null;
  sessionIdBefore?: string | null;
  continuationAttempt?: number;
  retryOfRunId?: string | null;
  processLossRetryCount?: number;
  scheduledRetryAt?: Date | null;
  scheduledRetryAttempt?: number;
  scheduledRetryReason?: string | null;
  issueCommentStatus?: string;
}

export function createHeartbeatRunValues(params: CreateHeartbeatRunParams) {
  return {
    companyId: params.companyId,
    agentId: params.agentId,
    invocationSource: params.invocationSource,
    triggerDetail: params.triggerDetail ?? null,
    status: params.status ?? "queued",
    wakeupRequestId: params.wakeupRequestId ?? null,
    contextSnapshot: params.contextSnapshot ?? null,
    sessionIdBefore: params.sessionIdBefore ?? null,
    continuationAttempt: params.continuationAttempt ?? 0,
    retryOfRunId: params.retryOfRunId ?? null,
    processLossRetryCount: params.processLossRetryCount ?? 0,
    scheduledRetryAt: params.scheduledRetryAt ?? null,
    scheduledRetryAttempt: params.scheduledRetryAttempt ?? 0,
    scheduledRetryReason: params.scheduledRetryReason ?? null,
    issueCommentStatus: params.issueCommentStatus ?? "not_applicable",
  };
}

export async function createHeartbeatRun(
  db: Db,
  params: CreateHeartbeatRunParams,
) {
  const values = createHeartbeatRunValues(params);
  const [run] = await db
    .insert(heartbeatRuns)
    .values(values)
    .returning();
  return run;
}

export interface UpdateHeartbeatRunProcessMetadataParams {
  runId: string;
  pid: number;
  processGroupId: number | null;
  startedAt: string;
}

export async function updateHeartbeatRunProcessMetadata(
  db: Db,
  params: UpdateHeartbeatRunProcessMetadataParams,
) {
  const startedAt = new Date(params.startedAt);
  const [row] = await db
    .update(heartbeatRuns)
    .set({
      processPid: params.pid,
      processGroupId: params.processGroupId,
      processStartedAt: Number.isNaN(startedAt.getTime()) ? new Date() : startedAt,
      updatedAt: new Date(),
    })
    .where(eq(heartbeatRuns.id, params.runId))
    .returning();
  return row ?? null;
}