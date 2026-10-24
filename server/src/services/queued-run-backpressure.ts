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

// PRX-6045: codes for the *not-wakeable* half of the sweep. A queued run whose
// issue can never be woken again is cancelled by reason, before the age bound is
// consulted, so the churn is attributed to the real cause instead of showing up
// as `queued_run_expired` (the age rule, which says nothing about why).
export const QUEUED_RUN_ISSUE_NOT_FOUND_ERROR_CODE = "issue_not_found";
export const QUEUED_RUN_ISSUE_TERMINAL_ERROR_CODE = "issue_terminal_status";
export const QUEUED_RUN_ISSUE_BLOCKED_ERROR_CODE = "issue_dependencies_blocked";
export const QUEUED_RUN_ISSUE_DESCRIPTOR_PARKED_ERROR_CODE = "issue_parked_on_unblock_action";

export type QueuedRunTerminalErrorCode =
  | typeof QUEUED_RUN_EXPIRED_ERROR_CODE
  | typeof QUEUED_RUN_SUPERSEDED_ERROR_CODE;

export type QueuedRunNotWakeableErrorCode =
  | typeof QUEUED_RUN_ISSUE_NOT_FOUND_ERROR_CODE
  | typeof QUEUED_RUN_ISSUE_TERMINAL_ERROR_CODE
  | typeof QUEUED_RUN_ISSUE_BLOCKED_ERROR_CODE
  | typeof QUEUED_RUN_ISSUE_DESCRIPTOR_PARKED_ERROR_CODE;

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

/**
 * PRX-6045 — the "promote-or-cancel" half of the dispatch rules.
 *
 * A queued run can only ever start if its issue is still wakeable. Two of the
 * three ways an issue stops being wakeable are decided by issue state alone, so
 * they can be classified without touching the database:
 *
 *   - `done` / `cancelled`  -> `issue_terminal_status`
 *   - unresolved blockers   -> `issue_dependencies_blocked`
 *   - row points at nothing -> `issue_not_found`
 *
 * Everything else is `keep`. A `blocked` issue whose blockers are all resolved is
 * wakeable again (PRX-6026 resolved-dependency gate), which is why the rule reads
 * `unresolvedBlockerCount` and not the status string.
 *
 * Wake-protected rows (an issue interaction wake, a resume intent, a wake driven by
 * a fresh comment) are filtered by the caller: this module has no access to the
 * context predicates that decide that, and silently dropping them here would lose
 * legitimate work on a closed issue.
 */
export interface QueuedRunWakeabilityIssueLike {
  status?: string | null;
  unresolvedBlockerCount?: number | null;
  unresolvedBlockerIssueIds?: ReadonlyArray<string> | null;
  /**
   * A `blocked` issue carrying an `unblockDescriptor` is parked on a named action: the
   * descriptor says "wait for X, then do Y" and the wake that resumes it is the one
   * carrying that signal (an interaction/comment/resume wake, which the caller filters
   * out before classifying). Any other queued wake cannot move it.
   *
   * Measured on this instance 2026-10-23T10:3xZ: of 1552 issues with a descriptor, 1380
   * are owned by an agent, 164 by the board and 8 by a user — so an owner-type filter
   * would have exempted 89 % of exactly the rows this rule exists for, including
   * PRX-5508 (CTO-owned, promoted to `running` and burned a turn on a parked card).
   */
  hasUnblockDescriptor?: boolean | null;
  unblockDescriptorOwner?: "board" | "user" | "agent" | null;
  unblockDescriptorAction?: string | null;
}

export interface QueuedRunNotWakeableDecision {
  runId: string;
  agentId: string | null;
  issueId: string;
  wakeupRequestId: string | null;
  ageSec: number;
  errorCode: QueuedRunNotWakeableErrorCode;
  reason: string;
}

export interface QueuedRunWakeabilityVerdict {
  cancel: QueuedRunNotWakeableDecision[];
  keep: string[];
}

export function describeUnresolvedBlockers(count: number): string {
  return count === 1 ? "1 unresolved blocker" : `${count} unresolved blockers`;
}

export function classifyQueuedRunWakeability(input: {
  rows: ReadonlyArray<QueuedRunRowLike | null | undefined>;
  /**
   * Lookup for every issue id referenced by `rows`. An explicit `null` means "no
   * such issue" (cancel as `issue_not_found`); `undefined`/absent means "not
   * resolved in this pass" and is left alone rather than guessed at.
   */
  issueById: ReadonlyMap<string, QueuedRunWakeabilityIssueLike | null | undefined>;
  now: Date | number;
}): QueuedRunWakeabilityVerdict {
  const { rows, issueById, now } = input;
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const verdict: QueuedRunWakeabilityVerdict = { cancel: [], keep: [] };
  if (!Array.isArray(rows) || rows.length === 0 || !Number.isFinite(nowMs)) return verdict;

  for (const row of rows) {
    if (!row || row.status !== "queued") continue;
    const issueId = readQueuedIssueId(row);
    if (!issueId) continue;
    if (!issueById.has(issueId)) continue;
    const issue = issueById.get(issueId) ?? null;
    const createdAtMs = readCreatedAtMs(row);
    const ageSec = createdAtMs === null ? 0 : Math.max(0, Math.round((nowMs - createdAtMs) / 1000));
    const base = {
      runId: row.id,
      agentId: row.agentId ?? null,
      issueId,
      wakeupRequestId: row.wakeupRequestId ?? null,
      ageSec,
    };

    if (!issue) {
      verdict.cancel.push({
        ...base,
        errorCode: QUEUED_RUN_ISSUE_NOT_FOUND_ERROR_CODE,
        reason:
          `Cancelled because the target issue no longer exists, so this queued run can never start ` +
          `(waited ${describeQueuedAge(ageSec)})`,
      });
      continue;
    }

    const status = typeof issue.status === "string" ? issue.status.trim() : "";
    if (status === "done" || status === "cancelled") {
      verdict.cancel.push({
        ...base,
        errorCode: QUEUED_RUN_ISSUE_TERMINAL_ERROR_CODE,
        reason:
          `Cancelled because the issue reached terminal status (${status}) before this queued run ` +
          `could start (waited ${describeQueuedAge(ageSec)})`,
      });
      continue;
    }

    // Descriptor-parked: `blocked` with an unblock action pending. No agent wake can make
    // progress on it — the wake just queues behind work that can and then reaps. Measured
    // on the Praxis CTO queue 2026-10-23T08:19Z: 2 of its 3 queued rows were
    // descriptor-parked `blocked` issues carrying fresh automation wakes, and both sat
    // ahead of a decided `todo` card (PRX-5554) that had already been reaped three times.
    const descriptorOwner = issue.unblockDescriptorOwner ?? null;
    if (status === "blocked" && issue.hasUnblockDescriptor === true) {
      const action = typeof issue.unblockDescriptorAction === "string" ? issue.unblockDescriptorAction.trim() : "";
      verdict.cancel.push({
        ...base,
        errorCode: QUEUED_RUN_ISSUE_DESCRIPTOR_PARKED_ERROR_CODE,
        reason:
          `Cancelled because the issue is parked on an unblock action` +
          (descriptorOwner ? ` owned by ${descriptorOwner}` : "") +
          (action ? ` (${action.slice(0, 160)})` : "") +
          `, so an agent wake cannot make progress on it (waited ${describeQueuedAge(ageSec)})`,
      });
      continue;
    }

    const unresolvedBlockerCount = Number(issue.unresolvedBlockerCount ?? 0);
    if (Number.isFinite(unresolvedBlockerCount) && unresolvedBlockerCount > 0) {
      const blockerIds = Array.isArray(issue.unresolvedBlockerIssueIds)
        ? issue.unresolvedBlockerIssueIds.filter((id): id is string => typeof id === "string" && id.length > 0)
        : [];
      verdict.cancel.push({
        ...base,
        errorCode: QUEUED_RUN_ISSUE_BLOCKED_ERROR_CODE,
        reason:
          `Cancelled because the issue is parked behind ${describeUnresolvedBlockers(unresolvedBlockerCount)}` +
          (blockerIds.length > 0 ? ` (${blockerIds.slice(0, 5).join(", ")})` : "") +
          `, so this queued run cannot start until they resolve (waited ${describeQueuedAge(ageSec)})`,
      });
      continue;
    }

    verdict.keep.push(row.id);
  }

  return verdict;
}

/**
 * PRX-6045 (follow-up from the 2026-10-23T07:58Z Praxis CTO measurement) — promotion
 * order for a freed slot.
 *
 * The reap bound is a constant (`max(2 x interval, 1h)`) while the queue is not, and an
 * agent's service time is a step function (~30 min for the Praxis CTO: p50 22.9 min on
 * successes, exactly 30.0 min on timeouts). So a row that sits 3 deep is already
 * guaranteed to reap: 3 x 30 min = 90 min > 60 min bound. Any ordering that reorders
 * *around* a queued row therefore hands that row a guaranteed expiry — which is exactly
 * what "in_progress first, then priority" did to PRX-5554 (reaped three times at 05:49,
 * 06:50 and again at 07:58, behind two descriptor-parked automation wakes).
 *
 * The rule is the one the card asks for: **promote the oldest run for an issue that is
 * still wakeable**. Readiness stays a hard partition (a not-ready row is never promoted
 * ahead of a ready one — claim would cancel it anyway), and issue-less timer wakes sort
 * after issue work. Inside a partition, age wins; priority only breaks exact-age ties, so
 * it can still order two wakes created in the same millisecond.
 *
 * Consequence worth stating: under sustained saturation this is FIFO, and priority no
 * longer reorders the queue. That is deliberate — with a constant bound, reordering is
 * just choosing which row reaps.
 */
export interface QueuedRunPromotionEntry {
  runId: string;
  createdAtMs: number;
  hasIssueId: boolean;
  issueReady: boolean;
  issueStatus?: string | null;
  priorityRank: number;
}

/**
 * PRA-6975: a reaped wake must not be re-offered inside the window that just proved
 * the agent cannot drain it.
 *
 * The stranded-issue sweeper offers `issue_assignment_recovery` for a `todo` issue
 * whose latest run is terminal. A run cancelled as `queued_run_expired` is terminal,
 * so the reaper's own output re-arms the sweeper: the work is offered twice to an
 * agent that has just failed to start the first offer, and the replacement wake
 * competes for the same saturated slots and can itself expire. Measured on the CTO
 * (`cccf9a46`), 24 h to 2026-10-24T07:52Z: **68 of 68** `issue_assignment_recovery`
 * runs followed a `queued_run_expired` on the same issue, and all 68 fell inside the
 * bound the reaper had applied (1 h). The count tracks the expiry count, not demand.
 *
 * The suppression is a read of the reap record the reaper already wrote — the bound
 * it applied is in `heartbeat_runs.result_json.queueReapBoundSec`, the moment it
 * applied it is `finished_at`. No new table, no new column.
 *
 * The window is deliberately finite and anchored on the reap: while `now` is still
 * inside `reapedAt + boundSec` the offer is withheld, and the first sweep after the
 * window offers again. So a reaped issue delays by at most one bound and never loses
 * its only offer — the sweeper is periodic and this predicate has no other suppressor.
 *
 * `superseded_by_newer_wake` is not consulted: that path already coalesces to the
 * newest wake, and suppressing on it would drop real work (the newer wake is the one
 * that survives).
 */
export const RECOVERY_OFFER_SUPPRESSED_REASON = "reaped_wake_within_bound" as const;

/** `result_json` key the reaper records the age bound it applied under. */
export const QUEUE_REAP_BOUND_RESULT_KEY = "queueReapBoundSec";

export interface ReapedRecoveryRunLike {
  id?: string | null;
  status?: string | null;
  errorCode?: string | null;
  finishedAt?: Date | string | null;
  resultJson?: unknown;
  contextSnapshot?: unknown;
}

export type RecoveryOfferSuppressionDecision =
  | { suppress: false; reason: "not_reaped" | "outside_reap_window" }
  | {
      suppress: true;
      reason: typeof RECOVERY_OFFER_SUPPRESSED_REASON;
      reapedRunId: string | null;
      reapedAtIso: string;
      windowSec: number;
      remainingSec: number;
      suppressedUntilIso: string;
    };

function readTimestampMs(raw: unknown): number | null {
  if (raw instanceof Date) return raw.getTime();
  if (raw === null || raw === undefined) return null;
  const parsed = Date.parse(String(raw));
  return Number.isNaN(parsed) ? null : parsed;
}

function readRecord(raw: unknown): Record<string, unknown> | null {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

/**
 * Decide whether an `issue_assignment_recovery` offer must be withheld because the
 * run it is about to replace was reaped as `queued_run_expired` inside its own reap
 * bound.
 *
 * `run` is the reap record to test (the caller passes the newest reaped run for the
 * same agent+issue). Rows that are not `queued_run_expired`, or that belong to a
 * different issue/agent, never suppress — that is what keeps a recovery for a
 * different issue untouched.
 */
export function evaluateReapedRecoveryOfferSuppression(input: {
  run: ReapedRecoveryRunLike | null | undefined;
  agentId?: string | null;
  issueId?: string | null;
  now?: Date | number;
  /** Bound to apply when the reap record did not carry one. */
  defaultBoundSec?: number | null;
}): RecoveryOfferSuppressionDecision {
  const { run, agentId, issueId } = input;
  const nowMs = input.now === undefined
    ? Date.now()
    : input.now instanceof Date
      ? input.now.getTime()
      : Number(input.now);
  if (!run || !Number.isFinite(nowMs)) return { suppress: false, reason: "not_reaped" };
  if (run.errorCode !== QUEUED_RUN_EXPIRED_ERROR_CODE) return { suppress: false, reason: "not_reaped" };

  const reapedAtMs = readTimestampMs(run.finishedAt);
  if (reapedAtMs === null) return { suppress: false, reason: "not_reaped" };

  // The record must be about the same work. A mismatch means the caller handed us
  // another issue's (or agent's) reap, which must never withhold this offer.
  const snapshot = readRecord(run.contextSnapshot);
  const runIssueId = snapshot && typeof snapshot.issueId === "string" ? snapshot.issueId.trim() : null;
  const runAgentId = snapshot && typeof snapshot.agentId === "string" ? snapshot.agentId.trim() : null;
  if (issueId && runIssueId && runIssueId !== issueId) return { suppress: false, reason: "not_reaped" };
  if (agentId && runAgentId && runAgentId !== agentId) return { suppress: false, reason: "not_reaped" };

  const result = readRecord(run.resultJson);
  const recordedBound = Number(result?.[QUEUE_REAP_BOUND_RESULT_KEY]);
  const fallbackBound = Number(input.defaultBoundSec);
  const windowSec = Number.isFinite(recordedBound) && recordedBound > 0
    ? recordedBound
    : Number.isFinite(fallbackBound) && fallbackBound > 0
      ? fallbackBound
      : resolveQueuedRunReapBoundSec(null);

  const elapsedMs = nowMs - reapedAtMs;
  // A reap timestamp in the future is clock skew, not evidence that the work cannot
  // drain; never withhold an offer on it.
  if (elapsedMs < 0) return { suppress: false, reason: "outside_reap_window" };
  const windowMs = windowSec * 1000;
  if (elapsedMs >= windowMs) return { suppress: false, reason: "outside_reap_window" };

  const suppressedUntilMs = reapedAtMs + windowMs;
  return {
    suppress: true,
    reason: RECOVERY_OFFER_SUPPRESSED_REASON,
    reapedRunId: typeof run.id === "string" ? run.id : null,
    reapedAtIso: new Date(reapedAtMs).toISOString(),
    windowSec,
    remainingSec: Math.max(0, Math.round((suppressedUntilMs - nowMs) / 1000)),
    suppressedUntilIso: new Date(suppressedUntilMs).toISOString(),
  };
}

export function promotionRankClass(entry: QueuedRunPromotionEntry): number {
  if (entry.hasIssueId && !entry.issueReady) return 3;
  if (!entry.hasIssueId) return 2;
  return 0;
}

export function compareQueuedRunsForPromotion(
  left: QueuedRunPromotionEntry,
  right: QueuedRunPromotionEntry,
): number {
  const leftClass = promotionRankClass(left);
  const rightClass = promotionRankClass(right);
  if (leftClass !== rightClass) return leftClass - rightClass;
  if (left.createdAtMs !== right.createdAtMs) return left.createdAtMs - right.createdAtMs;
  if (left.priorityRank !== right.priorityRank) return left.priorityRank - right.priorityRank;
  return String(left.runId).localeCompare(String(right.runId));
}
