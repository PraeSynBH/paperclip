// PRA-6499: heartbeat queue backpressure.
//
// The engine accumulates `queued` heartbeat-run rows per agent and neither drains
// nor reaps them when `heartbeat.maxConcurrentRuns = 1`. Measured 2026-10-19 by the
// CEO: 30 queued CTO rows, oldest 12.6 h, every one `startedAt: null`,
// `processPid: null` — i.e. never started. Measured again 2026-10-20 09:06 UTC:
// 19 queued rows across 19 distinct issues, 13 of them created within 50 s
// (`issue_recovery_action_restored` burst).
//
// Two rules, deliberately kept pure so they can be replayed against a captured
// run window without a database:
//
//  1. REAP — a queued row that never started and is older than the bound is
//     terminal. Bound = max(2 x heartbeat.intervalSec, 1 h).
//  2. COALESCE — at most one queued row per (agent, issue) survives. The newest
//     wins; older duplicates are cancelled as `superseded_by_newer_wake`.
//
// Why the coalesce key is (agent, issue) and not (agent): the measured backlog was
// 19 DISTINCT issues for one agent. Collapsing that to a single agent-wide queued
// row would silently drop 18 units of real work. The duplicate rows this rule
// exists for are repeated wakes for the SAME issue, which is what a burst produces.
// Rows with no issue (timer wakes) group together per agent, because a second timer
// wake carries no additional payload.
//
// Ordering matters: reap runs before coalesce, so a stale row can never win the
// "newest per group" race against a fresh one.

export const QUEUED_RUN_REAP_INTERVAL_MULTIPLIER = 2;
export const QUEUED_RUN_REAP_FLOOR_SEC = 3600;
export const NO_ISSUE_GROUP_KEY = "__no_issue__";

export const QUEUED_RUN_EXPIRED_ERROR_CODE = "queued_run_expired";
export const QUEUED_RUN_SUPERSEDED_ERROR_CODE = "superseded_by_newer_wake";

export type QueuedRunTerminalErrorCode =
  | typeof QUEUED_RUN_EXPIRED_ERROR_CODE
  | typeof QUEUED_RUN_SUPERSEDED_ERROR_CODE;

/**
 * The subset of a `heartbeat_runs` row the classifier needs. Deliberately
 * structural (not `typeof heartbeatRuns.$inferSelect`) so the module stays
 * dependency-free and replayable against a captured JSON window.
 */
export interface QueuedRunRowLike {
  id: string;
  agentId?: string | null;
  status?: string | null;
  startedAt?: Date | string | null;
  createdAt?: Date | string | null;
  wakeupRequestId?: string | null;
  contextSnapshot?: unknown;
}

export interface QueuedRunBackpressureDecision {
  runId: string;
  agentId: string | null;
  issueId: string | null;
  wakeupRequestId: string | null;
  ageSec: number;
  errorCode: QueuedRunTerminalErrorCode;
  reason: string;
}

export interface QueuedRunBackpressureVerdict {
  boundSec: number;
  nowIso: string;
  reap: QueuedRunBackpressureDecision[];
  supersede: QueuedRunBackpressureDecision[];
  keep: string[];
}

export interface AgentQueueSummary {
  agentId: string;
  agentName: string | null;
  maxConcurrentRuns: number | null;
  intervalSec: number | null;
  runningCount: number;
  queueDepth: number;
  neverStartedCount: number;
  oldestQueuedAt: string | null;
  oldestAgeSec: number;
  oldestAge: string | null;
  overBoundCount: number;
  reapBoundSec: number;
  saturated: boolean;
  queuedByIssue: Record<string, number>;
}

interface QueuedEntry {
  row: QueuedRunRowLike;
  createdAtMs: number;
  issueId: string | null;
}

/**
 * Reap bound in seconds: 2 x the agent's heartbeat interval, floored at 1 h.
 * A non-finite or zero interval (agents that run on demand only) falls back to
 * the floor rather than to zero, so the bound is never "reap everything now".
 */
export function resolveQueuedRunReapBoundSec(intervalSec: unknown): number {
  const interval = Number(intervalSec);
  const scaled =
    Number.isFinite(interval) && interval > 0
      ? interval * QUEUED_RUN_REAP_INTERVAL_MULTIPLIER
      : QUEUED_RUN_REAP_FLOOR_SEC;
  return Math.max(QUEUED_RUN_REAP_FLOOR_SEC, scaled);
}

export function describeQueuedAge(ageSec: number): string {
  const sec = Math.max(0, Math.floor(ageSec));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
}

function readCreatedAtMs(row: QueuedRunRowLike | null | undefined): number | null {
  const raw = row?.createdAt;
  if (raw instanceof Date) return raw.getTime();
  const parsed = Date.parse(String(raw ?? ""));
  return Number.isNaN(parsed) ? null : parsed;
}

function readQueuedIssueId(row: QueuedRunRowLike | null | undefined): string | null {
  let context: unknown = row?.contextSnapshot;
  if (typeof context === "string") {
    try {
      context = JSON.parse(context);
    } catch {
      context = null;
    }
  }
  if (!context || typeof context !== "object") return null;
  const record = context as Record<string, unknown>;
  for (const key of ["issueId", "taskId"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

export function queuedRunGroupKey(row: QueuedRunRowLike): string {
  return readQueuedIssueId(row) ?? NO_ISSUE_GROUP_KEY;
}

/**
 * Classify a set of heartbeat-run rows.
 *
 * `reap` and `supersede` entries are terminal decisions the caller applies as a
 * compare-and-set on `status = 'queued'`.
 */
export function classifyQueuedRunBackpressure(input: {
  rows: ReadonlyArray<QueuedRunRowLike | null | undefined>;
  now: Date | number;
  boundSec: number;
}): QueuedRunBackpressureVerdict {
  const { rows, now, boundSec } = input;
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const bound = Number(boundSec);
  const result: QueuedRunBackpressureVerdict = {
    boundSec: bound,
    nowIso: new Date(nowMs).toISOString(),
    reap: [],
    supersede: [],
    keep: [],
  };
  if (!Array.isArray(rows) || rows.length === 0 || !Number.isFinite(nowMs) || !Number.isFinite(bound)) {
    return result;
  }

  const queued: QueuedEntry[] = [];
  for (const row of rows) {
    if (!row || row.status !== "queued") continue;
    const createdAtMs = readCreatedAtMs(row);
    if (createdAtMs === null) continue;
    queued.push({ row, createdAtMs, issueId: readQueuedIssueId(row) });
  }
  queued.sort((left, right) => {
    if (left.createdAtMs !== right.createdAtMs) return left.createdAtMs - right.createdAtMs;
    return String(left.row.id).localeCompare(String(right.row.id));
  });

  const survivorsByGroup = new Map<string, QueuedEntry>();
  for (const entry of queued) {
    const ageSec = Math.max(0, Math.round((nowMs - entry.createdAtMs) / 1000));
    const neverStarted = entry.row.startedAt === null || entry.row.startedAt === undefined;
    if (neverStarted && ageSec > bound) {
      result.reap.push({
        runId: entry.row.id,
        agentId: entry.row.agentId ?? null,
        issueId: entry.issueId,
        wakeupRequestId: entry.row.wakeupRequestId ?? null,
        ageSec,
        errorCode: QUEUED_RUN_EXPIRED_ERROR_CODE,
        reason:
          `Cancelled because this queued run never started and is older than the queue age bound of ` +
          `${describeQueuedAge(bound)} (age ${describeQueuedAge(ageSec)}; bound = max(2 x heartbeat interval, 1h))`,
      });
      continue;
    }
    const groupKey = entry.issueId ?? NO_ISSUE_GROUP_KEY;
    const current = survivorsByGroup.get(groupKey);
    if (!current) {
      survivorsByGroup.set(groupKey, entry);
      continue;
    }
    // Older survivor loses to the newer wake for the same issue.
    result.supersede.push({
      runId: current.row.id,
      agentId: current.row.agentId ?? null,
      issueId: current.issueId,
      wakeupRequestId: current.row.wakeupRequestId ?? null,
      ageSec: Math.max(0, Math.round((nowMs - current.createdAtMs) / 1000)),
      errorCode: QUEUED_RUN_SUPERSEDED_ERROR_CODE,
      reason:
        `Cancelled because a newer wake for the same issue (run ${entry.row.id}) superseded this ` +
        `queued run before it started (superseded_by_newer_wake)`,
    });
    survivorsByGroup.set(groupKey, entry);
  }
  for (const entry of survivorsByGroup.values()) result.keep.push(entry.row.id);
  return result;
}

/**
 * Per-agent queue shape, for the `GET /companies/:companyId/heartbeat-queue`
 * surface. `rows` may be any mix of statuses; only queued/running are summarised.
 */
export function summariseAgentQueue(input: {
  agentId: string;
  agentName?: string | null;
  maxConcurrentRuns?: number | null;
  intervalSec?: number | null;
  rows: ReadonlyArray<QueuedRunRowLike | null | undefined>;
  now: Date | number;
  boundSec: number;
}): AgentQueueSummary {
  const { agentId, agentName, maxConcurrentRuns, intervalSec, rows, now, boundSec } = input;
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const queued: Array<{
    runId: string;
    issueId: string | null;
    createdAt: string | null;
    createdAtMs: number | null;
    neverStarted: boolean;
  }> = [];
  let runningCount = 0;
  for (const row of rows ?? []) {
    if (!row) continue;
    if (row.status === "running") {
      runningCount += 1;
      continue;
    }
    if (row.status !== "queued") continue;
    const createdAtMs = readCreatedAtMs(row);
    queued.push({
      runId: row.id,
      issueId: readQueuedIssueId(row),
      createdAt: createdAtMs === null ? null : new Date(createdAtMs).toISOString(),
      createdAtMs,
      neverStarted: row.startedAt === null || row.startedAt === undefined,
    });
  }
  queued.sort((left, right) => (left.createdAtMs ?? 0) - (right.createdAtMs ?? 0));
  const oldest = queued[0] ?? null;
  const ages = queued.map((entry) =>
    entry.createdAtMs === null ? 0 : Math.max(0, Math.round((nowMs - entry.createdAtMs) / 1000)),
  );
  const overBound = queued.filter((entry, index) => entry.neverStarted && ages[index] > boundSec).length;
  return {
    agentId,
    agentName: agentName ?? null,
    maxConcurrentRuns: maxConcurrentRuns ?? null,
    intervalSec: intervalSec ?? null,
    runningCount,
    queueDepth: queued.length,
    neverStartedCount: queued.filter((entry) => entry.neverStarted).length,
    oldestQueuedAt: oldest ? oldest.createdAt : null,
    oldestAgeSec: ages.length > 0 ? Math.max(...ages) : 0,
    oldestAge: ages.length > 0 ? describeQueuedAge(Math.max(...ages)) : null,
    overBoundCount: overBound,
    reapBoundSec: boundSec,
    saturated: queued.length > 0 && runningCount >= (maxConcurrentRuns ?? 1),
    queuedByIssue: queued.reduce<Record<string, number>>((acc, entry) => {
      const key = entry.issueId ?? NO_ISSUE_GROUP_KEY;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  };
}
