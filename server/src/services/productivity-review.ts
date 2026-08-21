import { and, asc, desc, eq, gt, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { clampIssueRequestDepth } from "@paperclipai/shared";
import {
  activityLog,
  agents,
  companies,
  costEvents,
  heartbeatRuns,
  issueComments,
  issues,
  projects,
} from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { logActivity } from "./activity-log.js";
import { budgetService } from "./budgets.js";
import { issueService } from "./issues.js";
import {
  recoveryAssigneeAdapterOverrides,
  withRecoveryModelProfileHint,
} from "./recovery/model-profile-hint.js";
import { RECOVERY_ORIGIN_KINDS } from "./recovery/origins.js";

export const PRODUCTIVITY_REVIEW_ORIGIN_KIND = RECOVERY_ORIGIN_KINDS.issueProductivityReview;
export const DEFAULT_PRODUCTIVITY_REVIEW_NO_COMMENT_STREAK_RUNS = 10;
export const DEFAULT_PRODUCTIVITY_REVIEW_LONG_ACTIVE_HOURS = 6;
export const DEFAULT_PRODUCTIVITY_REVIEW_HIGH_CHURN_HOURLY = 10;
export const DEFAULT_PRODUCTIVITY_REVIEW_HIGH_CHURN_SIX_HOURS = 30;
export const DEFAULT_PRODUCTIVITY_REVIEW_RESOLVED_SNOOZE_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_PRODUCTIVITY_REVIEW_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
export const DEFAULT_PRODUCTIVITY_REVIEW_MAX_REFRESH_COMMENTS = 3;
export const DEFAULT_PRODUCTIVITY_REVIEW_CREATION_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_PRODUCTIVITY_REVIEW_MAX_CREATIONS_PER_WINDOW = 3;

const TERMINAL_RUN_STATUSES = ["succeeded", "failed", "cancelled", "timed_out"] as const;
const ACTIVE_RUN_STATUSES = ["queued", "running", "scheduled_retry"] as const;
const MAX_CANDIDATE_ISSUES = 250;
const MAX_RUNS_FOR_STREAK = 100;
const MAX_PARENT_WALK_DEPTH = 25;
const MAX_DISPOSITIONED_REVIEW_LOOKBACK = 5;
export const PRODUCTIVITY_REVIEW_REFRESH_COMMENT_PREFIX = "Productivity review evidence refreshed.";
export const PRODUCTIVITY_REVIEW_RECURRENCE_COMMENT_PREFIX =
  "Productivity review cause recurred (no new review minted).";

/**
 * Run terminations that happen *before* the adapter ever executes. A run that
 * terminated with one of these codes produced no work and could not have
 * produced an issue comment, so it must never increment a no-comment streak
 * (RBR-983 AC2). Nine such runs cancelled each other inside a 43-second window
 * on RBR-920 and were counted as evidence of poor diligence.
 */
export const PRODUCTIVITY_REVIEW_PRE_START_CANCEL_ERROR_CODES = new Set<string>([
  "issue_assignee_changed",
  "lock_released_on_reassignment",
  "issue_reassigned",
  "issue_terminal_status",
  "issue_not_in_progress",
  "issue_execution_lock_changed",
  "issue_review_participant_changed",
  "issue_continuation_waiting_on_review",
  "issue_paused",
  "issue_dependencies_blocked",
  "issue_not_found",
  "agent_not_found",
  "agent_not_invokable",
  "budget_blocked",
]);

/**
 * Statuses in which the assignee cannot act right now. This is deliberately
 * stricter than `isAgentStatusInvokable`: an `error` agent can be *re-invoked*
 * later, but at this instant it has no process and cannot comment, so measuring
 * the absence of its output says nothing about its work habits (RBR-983 AC1/AC4).
 */
const NON_ACTING_AGENT_STATUSES = new Set<string>([
  "error",
  "paused",
  "terminated",
  "pending_approval",
]);

type IssueRow = typeof issues.$inferSelect;
type AgentRow = typeof agents.$inferSelect;
type HeartbeatRunRow = typeof heartbeatRuns.$inferSelect;
type ProductivityReviewTrigger = "no_comment_streak" | "long_active_duration" | "high_churn";
/**
 * What the fired signal is actually evidence *about*:
 * - `productivity`: the assignee's diligence/output (the only kind that is a performance finding)
 * - `capacity`: the time budget — runs were killed mid-flight by the wall clock (RBR-983 AC3)
 * - `infra`: the platform — the assignee had no live process (RBR-983 AC1)
 */
type ProductivityReviewSignalClass = "productivity" | "capacity" | "infra";

type AssigneeActability = {
  canAct: boolean;
  reason: string | null;
  detail: Record<string, unknown>;
};

type ProductivityReviewThresholds = {
  noCommentStreakRuns: number;
  longActiveMs: number;
  highChurnHourly: number;
  highChurnSixHours: number;
  resolvedSnoozeMs: number;
  refreshIntervalMs: number;
  maxRefreshComments: number;
  creationWindowMs: number;
  maxCreationsPerWindow: number;
};

type ProductivityReviewEvidence = {
  trigger: ProductivityReviewTrigger;
  signalClass: ProductivityReviewSignalClass;
  signalClassReason: string;
  triggerReasons: string[];
  sourceIssue: IssueRow;
  sourceAgent: AgentRow;
  noCommentStreak: number;
  totalRunCount: number;
  terminalRunCount: number;
  executedRunCount: number;
  preStartCancelledRunCount: number;
  wallClockTimeoutRunCount: number;
  activeRunCount: number;
  runCountLastHour: number;
  runCountLastSixHours: number;
  commentCount: number;
  commentCountLastHour: number;
  commentCountLastSixHours: number;
  elapsedMs: number | null;
  latestRuns: HeartbeatRunRow[];
  latestComments: Array<typeof issueComments.$inferSelect>;
  costCents: number;
  usageSamples: Array<{ runId: string; usageJson: Record<string, unknown> | null }>;
  nextAction: string | null;
  thresholds: ProductivityReviewThresholds;
  generatedAt: Date;
};

type EnqueueWakeup = (
  agentId: string,
  opts?: {
    source?: "timer" | "assignment" | "on_demand" | "automation";
    triggerDetail?: "manual" | "ping" | "callback" | "system";
    reason?: string | null;
    payload?: Record<string, unknown> | null;
    requestedByActorType?: "user" | "agent" | "system";
    requestedByActorId?: string | null;
    contextSnapshot?: Record<string, unknown>;
  },
) => Promise<unknown | null>;

function productivityReviewFingerprint(sourceIssueId: string) {
  return `productivity-review:${sourceIssueId}`;
}

function issueRunScopeSql(issueId: string) {
  return sql`(
    ${heartbeatRuns.contextSnapshot}->>'issueId' = ${issueId}
    or ${heartbeatRuns.contextSnapshot}->>'taskId' = ${issueId}
    or ${heartbeatRuns.contextSnapshot}->>'taskKey' = ${issueId}
  )`;
}

function msToHuman(ms: number | null) {
  if (ms === null) return "unknown";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  return `${hours}h ${minutes % 60}m`;
}

function issueUiLink(issue: { identifier: string | null; id: string }, prefix: string) {
  const label = issue.identifier ?? issue.id;
  return `[${label}](/${prefix}/issues/${label})`;
}

function runUiLink(run: { id: string; agentId: string }, prefix: string) {
  return `[${run.id}](/${prefix}/agents/${run.agentId}/runs/${run.id})`;
}

function truncateInline(value: string | null | undefined, max = 260) {
  if (!value) return "";
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= max ? compact : `${compact.slice(0, max - 3)}...`;
}

function readPositiveInteger(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function coerceDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function buildThresholds(overrides?: Partial<ProductivityReviewThresholds>): ProductivityReviewThresholds {
  return {
    noCommentStreakRuns: readPositiveInteger(
      overrides?.noCommentStreakRuns ?? DEFAULT_PRODUCTIVITY_REVIEW_NO_COMMENT_STREAK_RUNS,
      DEFAULT_PRODUCTIVITY_REVIEW_NO_COMMENT_STREAK_RUNS,
    ),
    longActiveMs: readPositiveInteger(
      overrides?.longActiveMs ?? DEFAULT_PRODUCTIVITY_REVIEW_LONG_ACTIVE_HOURS * 60 * 60 * 1000,
      DEFAULT_PRODUCTIVITY_REVIEW_LONG_ACTIVE_HOURS * 60 * 60 * 1000,
    ),
    highChurnHourly: readPositiveInteger(
      overrides?.highChurnHourly ?? DEFAULT_PRODUCTIVITY_REVIEW_HIGH_CHURN_HOURLY,
      DEFAULT_PRODUCTIVITY_REVIEW_HIGH_CHURN_HOURLY,
    ),
    highChurnSixHours: readPositiveInteger(
      overrides?.highChurnSixHours ?? DEFAULT_PRODUCTIVITY_REVIEW_HIGH_CHURN_SIX_HOURS,
      DEFAULT_PRODUCTIVITY_REVIEW_HIGH_CHURN_SIX_HOURS,
    ),
    resolvedSnoozeMs: readPositiveInteger(
      overrides?.resolvedSnoozeMs ?? DEFAULT_PRODUCTIVITY_REVIEW_RESOLVED_SNOOZE_MS,
      DEFAULT_PRODUCTIVITY_REVIEW_RESOLVED_SNOOZE_MS,
    ),
    refreshIntervalMs: readPositiveInteger(
      overrides?.refreshIntervalMs ?? DEFAULT_PRODUCTIVITY_REVIEW_REFRESH_INTERVAL_MS,
      DEFAULT_PRODUCTIVITY_REVIEW_REFRESH_INTERVAL_MS,
    ),
    maxRefreshComments: readPositiveInteger(
      overrides?.maxRefreshComments ?? DEFAULT_PRODUCTIVITY_REVIEW_MAX_REFRESH_COMMENTS,
      DEFAULT_PRODUCTIVITY_REVIEW_MAX_REFRESH_COMMENTS,
    ),
    creationWindowMs: readPositiveInteger(
      overrides?.creationWindowMs ?? DEFAULT_PRODUCTIVITY_REVIEW_CREATION_WINDOW_MS,
      DEFAULT_PRODUCTIVITY_REVIEW_CREATION_WINDOW_MS,
    ),
    maxCreationsPerWindow: readPositiveInteger(
      overrides?.maxCreationsPerWindow ?? DEFAULT_PRODUCTIVITY_REVIEW_MAX_CREATIONS_PER_WINDOW,
      DEFAULT_PRODUCTIVITY_REVIEW_MAX_CREATIONS_PER_WINDOW,
    ),
  };
}

function choosePrimaryTrigger(input: {
  noComment: boolean;
  longActive: boolean;
  highChurn: boolean;
}): ProductivityReviewTrigger | null {
  if (input.noComment) return "no_comment_streak";
  if (input.highChurn) return "high_churn";
  if (input.longActive) return "long_active_duration";
  return null;
}

function isSoftStopTrigger(trigger: ProductivityReviewTrigger) {
  return trigger === "no_comment_streak" || trigger === "high_churn";
}

function formatTrigger(trigger: ProductivityReviewTrigger) {
  if (trigger === "no_comment_streak") return "No-comment streak";
  if (trigger === "high_churn") return "High churn";
  return "Long active duration";
}

function formatSignalClass(signalClass: ProductivityReviewSignalClass) {
  if (signalClass === "capacity") return "Capacity signal (time budget)";
  if (signalClass === "infra") return "Infrastructure signal (platform fault)";
  return "Productivity signal (assignee diligence)";
}

/**
 * True when the run terminated before the adapter ever started executing.
 * Such a run produced no work and could not have posted a comment.
 *
 * Detection is defence-in-depth: a pre-start cancel is identified by errorCode
 * (the authoritative signal, set by `evaluateQueuedRunStaleness` /
 * `cancelScheduledRetryForGate` / lock-release), and additionally by the
 * structural fact that a cancelled run never received a `startedAt` stamp
 * (`claimQueuedRun` sets `startedAt` at the moment it flips queued -> running).
 */
export function isPreStartCancelledRun(run: {
  status: string;
  errorCode?: string | null;
  startedAt?: Date | null;
  resultJson?: Record<string, unknown> | null;
}) {
  if (run.status !== "cancelled") return false;
  if (run.errorCode && PRODUCTIVITY_REVIEW_PRE_START_CANCEL_ERROR_CODES.has(run.errorCode)) return true;
  const stopReason = run.resultJson?.stopReason;
  if (typeof stopReason === "string" && PRODUCTIVITY_REVIEW_PRE_START_CANCEL_ERROR_CODES.has(stopReason)) {
    return true;
  }
  // A cancelled run with no startedAt was never claimed, so it never executed.
  return !run.startedAt;
}

/**
 * True when the run was killed mid-flight by the harness wall clock. It was
 * doing real work; the evidence is about the time budget, not diligence.
 */
export function isWallClockTimeoutRun(run: { status: string; errorCode?: string | null }) {
  return run.status === "timed_out" || run.errorCode === "timeout";
}

/**
 * A run "executed" if it was actually claimed and handed to the adapter. Only
 * executed runs are admissible evidence about the assignee's output.
 */
export function isExecutedRun(run: {
  status: string;
  errorCode?: string | null;
  startedAt?: Date | null;
  resultJson?: Record<string, unknown> | null;
}) {
  if (!TERMINAL_RUN_STATUSES.includes(run.status as (typeof TERMINAL_RUN_STATUSES)[number])) return false;
  return !isPreStartCancelledRun(run);
}

/**
 * Classify what the fired trigger is evidence about. Order matters: an infra
 * fault dominates (the agent had no process), then capacity (the wall clock
 * killed the work), then genuine productivity.
 */
function classifySignal(input: {
  trigger: ProductivityReviewTrigger;
  actability: AssigneeActability;
  executedRunCount: number;
  wallClockTimeoutRunCount: number;
}): { signalClass: ProductivityReviewSignalClass; signalClassReason: string } {
  if (!input.actability.canAct) {
    return {
      signalClass: "infra",
      signalClassReason:
        input.actability.reason ??
        "Assignee could not act at evidence-collection time; elapsed time and missing output measure an outage, not effort.",
    };
  }
  if (
    input.trigger === "no_comment_streak" &&
    input.wallClockTimeoutRunCount > 0 &&
    input.wallClockTimeoutRunCount >= input.executedRunCount
  ) {
    return {
      signalClass: "capacity",
      signalClassReason:
        `Every executed run in the sample (${input.wallClockTimeoutRunCount}/${input.executedRunCount}) was killed mid-flight by the wall clock. ` +
        "This is evidence about the run time budget, not about the assignee's diligence.",
    };
  }
  if (input.trigger === "no_comment_streak" && input.wallClockTimeoutRunCount > 0) {
    return {
      signalClass: "capacity",
      signalClassReason:
        `${input.wallClockTimeoutRunCount} of ${input.executedRunCount} executed runs were killed mid-flight by the wall clock. ` +
        "Treat the timed-out portion as a time-budget signal; only the remaining runs speak to diligence.",
    };
  }
  return {
    signalClass: "productivity",
    signalClassReason:
      "Assignee had a live process and executed runs completed without being killed by the wall clock, so the pattern is about output.",
  };
}

export function productivityReviewService(db: Db, deps?: { enqueueWakeup?: EnqueueWakeup }) {
  const issuesSvc = issueService(db);
  const budgets = budgetService(db);

  async function getCompanyIssuePrefix(companyId: string) {
    return db
      .select({ issuePrefix: companies.issuePrefix })
      .from(companies)
      .where(eq(companies.id, companyId))
      .then((rows) => rows[0]?.issuePrefix ?? "PAP");
  }

  async function getAgent(agentId: string) {
    return db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .then((rows) => rows[0] ?? null);
  }

  function isAgentInvokable(agent: AgentRow | null | undefined) {
    return Boolean(agent && !["paused", "terminated", "pending_approval"].includes(agent.status));
  }

  /**
   * Can the assignee act *right now*? If not, absence of output is an infra
   * fault, not a performance finding (RBR-983 AC1/AC4).
   *
   * The only signal used is agent lifecycle status. This is deliberately
   * simple: an `error` agent (e.g. "Process lost -- server may have
   * restarted") has no process and cannot have produced the missing output,
   * so measuring its absence says nothing about work habits. An *idle* agent
   * legitimately has no process between heartbeats, so bare process-absence
   * is not itself a fault -- only the disqualifying lifecycle statuses are.
   */
  async function resolveAssigneeActability(
    sourceIssue: IssueRow,
    sourceAgent: AgentRow,
    activeRunCount: number,
  ): Promise<AssigneeActability> {
    if (NON_ACTING_AGENT_STATUSES.has(sourceAgent.status)) {
      return {
        canAct: false,
        reason:
          `Assignee ${sourceAgent.name} is in status \`${sourceAgent.status}\`` +
          (sourceAgent.errorReason ? ` (${truncateInline(sourceAgent.errorReason, 200)})` : "") +
          ". It had no process and could not have produced output; this is an infra fault, not a productivity finding.",
        detail: {
          assigneeStatus: sourceAgent.status,
          assigneeErrorReason: sourceAgent.errorReason ?? null,
          check: "agent_status",
        },
      };
    }

    return { canAct: true, reason: null, detail: { check: "actable", assigneeStatus: sourceAgent.status } };
  }

  async function isProductivityReviewDescendant(issue: Pick<IssueRow, "companyId" | "parentId">) {
    let parentId = issue.parentId;
    let depth = 0;
    while (parentId && depth < MAX_PARENT_WALK_DEPTH) {
      const parent = await db
        .select({ id: issues.id, parentId: issues.parentId, originKind: issues.originKind })
        .from(issues)
        .where(and(eq(issues.companyId, issue.companyId), eq(issues.id, parentId)))
        .then((rows) => rows[0] ?? null);
      if (!parent) return false;
      if (parent.originKind === PRODUCTIVITY_REVIEW_ORIGIN_KIND) return true;
      parentId = parent.parentId;
      depth += 1;
    }
    return false;
  }

  async function findOpenProductivityReview(companyId: string, sourceIssueId: string) {
    return db
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.companyId, companyId),
          eq(issues.originKind, PRODUCTIVITY_REVIEW_ORIGIN_KIND),
          eq(issues.originId, sourceIssueId),
          isNull(issues.hiddenAt),
          notInArray(issues.status, ["done", "cancelled"]),
        ),
      )
      .orderBy(desc(issues.updatedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  async function findRecentResolvedProductivityReview(
    companyId: string,
    sourceIssueId: string,
    thresholds: ProductivityReviewThresholds,
    now: Date,
  ) {
    const cutoff = new Date(now.getTime() - thresholds.resolvedSnoozeMs);
    return db
      .select({ id: issues.id, identifier: issues.identifier, status: issues.status, updatedAt: issues.updatedAt })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, companyId),
          eq(issues.originKind, PRODUCTIVITY_REVIEW_ORIGIN_KIND),
          eq(issues.originId, sourceIssueId),
          eq(issues.status, "done"),
          gt(issues.updatedAt, cutoff),
        ),
      )
      .orderBy(desc(issues.updatedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  /**
   * Has an infra-suppression log already been written for this issue inside
   * the window? Used to rate-limit the AC1 suppression signal so a stuck
   * assignee does not spam the activity log on every reconcile tick.
   */
  async function findRecentInfraSuppressionLog(companyId: string, sourceIssueId: string, since: Date) {
    return db
      .select({ id: activityLog.id })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.companyId, companyId),
          eq(activityLog.action, "issue.productivity_review_suppressed_infra"),
          eq(activityLog.entityType, "issue"),
          eq(activityLog.entityId, sourceIssueId),
          gt(activityLog.createdAt, since),
        ),
      )
      .orderBy(desc(activityLog.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  /**
   * AC5: a review that closed `done` with an infra/capacity signal class is a
   * disposition that a mechanical fault (or the time budget) caused the
   * pattern, not the assignee. If that closed review's cause has not since
   * been superseded by a newer review on the same source issue, re-firing a
   * fresh review re-derives a conclusion that has already been recorded.
   * Look back over the most recent dispositioned reviews (bounded) rather
   * than only the single latest one, since intervening `cancelled` reviews
   * (route probes, races) should not hide a real disposition.
   */
  async function findUnresolvedDispositionedReviewCause(
    companyId: string,
    sourceIssueId: string,
  ): Promise<{ reviewIssueId: string; reviewIdentifier: string | null; signalClass: ProductivityReviewSignalClass; signalClassReason: string } | null> {
    const dispositioned = await db
      .select({ id: issues.id, identifier: issues.identifier, updatedAt: issues.updatedAt })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, companyId),
          eq(issues.originKind, PRODUCTIVITY_REVIEW_ORIGIN_KIND),
          eq(issues.originId, sourceIssueId),
          eq(issues.status, "done"),
        ),
      )
      .orderBy(desc(issues.updatedAt))
      .limit(MAX_DISPOSITIONED_REVIEW_LOOKBACK);
    for (const review of dispositioned) {
      const [creationLog] = await db
        .select({ details: activityLog.details })
        .from(activityLog)
        .where(
          and(
            eq(activityLog.companyId, companyId),
            eq(activityLog.action, "issue.productivity_review_created"),
            eq(activityLog.entityType, "issue"),
            eq(activityLog.entityId, review.id),
          ),
        )
        .orderBy(asc(activityLog.createdAt))
        .limit(1);
      const signalClass = (creationLog?.details as Record<string, unknown> | undefined)?.signalClass;
      if (signalClass === "infra" || signalClass === "capacity") {
        const signalClassReason = (creationLog?.details as Record<string, unknown> | undefined)?.signalClassReason;
        return {
          reviewIssueId: review.id,
          reviewIdentifier: review.identifier,
          signalClass,
          signalClassReason: typeof signalClassReason === "string" ? signalClassReason : formatSignalClass(signalClass),
        };
      }
      // Only the most recent disposition governs recurrence: if it closed as
      // a genuine productivity finding, an older infra disposition further
      // back is stale and must not keep suppressing new reviews.
      return null;
    }
    return null;
  }

  async function countRecentProductivityReviews(
    companyId: string,
    sourceIssueId: string,
    thresholds: ProductivityReviewThresholds,
    now: Date,
  ) {
    const cutoff = new Date(now.getTime() - thresholds.creationWindowMs);
    return db
      .select({ count: sql<number>`count(*)::int` })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, companyId),
          eq(issues.originKind, PRODUCTIVITY_REVIEW_ORIGIN_KIND),
          eq(issues.originId, sourceIssueId),
          isNull(issues.hiddenAt),
          sql`${issues.status} <> 'cancelled'`,
          sql`${issues.createdAt} >= ${cutoff.toISOString()}::timestamptz`,
        ),
      )
      .then((rows) => Number(rows[0]?.count ?? 0));
  }

  async function getRefreshCommentState(companyId: string, reviewIssueId: string) {
    return db
      .select({
        count: sql<number>`count(*)::int`,
        latestCreatedAt: sql<Date | null>`max(${issueComments.createdAt})`,
      })
      .from(issueComments)
      .where(
        and(
          eq(issueComments.companyId, companyId),
          eq(issueComments.issueId, reviewIssueId),
          sql`${issueComments.body} like ${`${PRODUCTIVITY_REVIEW_REFRESH_COMMENT_PREFIX}%`}`,
        ),
      )
      .then((rows) => {
        const row = rows[0];
        return {
          count: Number(row?.count ?? 0),
          latestCreatedAt: coerceDate(row?.latestCreatedAt),
        };
      });
  }

  async function addRefreshComment(
    reviewIssueId: string,
    body: string,
    generatedAt: Date,
  ) {
    const comment = await issuesSvc.addComment(reviewIssueId, body, {});
    await db
      .update(issueComments)
      .set({ createdAt: generatedAt, updatedAt: generatedAt })
      .where(eq(issueComments.id, comment.id));
    await db
      .update(issues)
      .set({ updatedAt: generatedAt })
      .where(eq(issues.id, reviewIssueId));
    return comment;
  }

  async function countIssueRunsSince(companyId: string, agentId: string, issueId: string, since: Date) {
    return db
      .select({ count: sql<number>`count(*)::int` })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          eq(heartbeatRuns.agentId, agentId),
          issueRunScopeSql(issueId),
          sql`coalesce(${heartbeatRuns.startedAt}, ${heartbeatRuns.createdAt}) >= ${since.toISOString()}::timestamptz`,
        ),
      )
      .then((rows) => rows[0]?.count ?? 0);
  }

  async function countIssueCommentsSince(companyId: string, issueId: string, agentId: string, since?: Date) {
    return db
      .select({ count: sql<number>`count(*)::int` })
      .from(issueComments)
      .innerJoin(heartbeatRuns, eq(heartbeatRuns.id, issueComments.createdByRunId))
      .where(
        and(
          eq(issueComments.companyId, companyId),
          eq(issueComments.issueId, issueId),
          eq(issueComments.authorAgentId, agentId),
          eq(heartbeatRuns.companyId, companyId),
          eq(heartbeatRuns.agentId, agentId),
          issueRunScopeSql(issueId),
          since ? sql`${issueComments.createdAt} >= ${since.toISOString()}::timestamptz` : undefined,
        ),
      )
      .then((rows) => rows[0]?.count ?? 0);
  }

  async function collectEvidence(
    sourceIssue: IssueRow,
    sourceAgent: AgentRow,
    thresholds: ProductivityReviewThresholds,
    now: Date,
  ): Promise<ProductivityReviewEvidence | null> {
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

    const latestRuns = await db
      .select()
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, sourceIssue.companyId),
          eq(heartbeatRuns.agentId, sourceAgent.id),
          issueRunScopeSql(sourceIssue.id),
        ),
      )
      .orderBy(desc(heartbeatRuns.createdAt), desc(heartbeatRuns.id))
      .limit(MAX_RUNS_FOR_STREAK);

    const runIds = latestRuns.map((run) => run.id);
    const commentRunIds = new Set<string>();
    if (runIds.length > 0) {
      const commentRows = await db
        .select({ createdByRunId: issueComments.createdByRunId })
        .from(issueComments)
        .where(
          and(
            eq(issueComments.companyId, sourceIssue.companyId),
            eq(issueComments.issueId, sourceIssue.id),
            inArray(issueComments.createdByRunId, runIds),
          ),
        );
      for (const row of commentRows) {
        if (row.createdByRunId) commentRunIds.add(row.createdByRunId);
      }
    }

    const terminalRuns = latestRuns.filter((run) =>
      TERMINAL_RUN_STATUSES.includes(run.status as (typeof TERMINAL_RUN_STATUSES)[number]),
    );
    // RBR-983 AC2: a run that terminated before the adapter ever started (a
    // pre-start cancel from a reassignment race, a stale-queue sweep, etc.)
    // produced no work and could not have posted a comment. Only executed
    // runs are admissible evidence about the assignee's output.
    const executedRuns = terminalRuns.filter((run) => isExecutedRun(run));
    const preStartCancelledRunCount = terminalRuns.length - executedRuns.length;
    const wallClockTimeoutRunCount = executedRuns.filter((run) => isWallClockTimeoutRun(run)).length;
    let noCommentStreak = 0;
    for (const run of executedRuns) {
      if (commentRunIds.has(run.id)) break;
      noCommentStreak += 1;
    }

    const [
      runCountLastHour,
      runCountLastSixHours,
      assigneeRunCommentCount,
      assigneeRunCommentCountLastHour,
      assigneeRunCommentCountLastSixHours,
      latestComments,
      costRow,
    ] = await Promise.all([
      countIssueRunsSince(sourceIssue.companyId, sourceAgent.id, sourceIssue.id, oneHourAgo),
      countIssueRunsSince(sourceIssue.companyId, sourceAgent.id, sourceIssue.id, sixHoursAgo),
      countIssueCommentsSince(sourceIssue.companyId, sourceIssue.id, sourceAgent.id),
      countIssueCommentsSince(sourceIssue.companyId, sourceIssue.id, sourceAgent.id, oneHourAgo),
      countIssueCommentsSince(sourceIssue.companyId, sourceIssue.id, sourceAgent.id, sixHoursAgo),
      db
        .select({ comment: issueComments })
        .from(issueComments)
        .innerJoin(heartbeatRuns, eq(heartbeatRuns.id, issueComments.createdByRunId))
        .where(
          and(
            eq(issueComments.companyId, sourceIssue.companyId),
            eq(issueComments.issueId, sourceIssue.id),
            eq(issueComments.authorAgentId, sourceAgent.id),
            eq(heartbeatRuns.companyId, sourceIssue.companyId),
            eq(heartbeatRuns.agentId, sourceAgent.id),
            issueRunScopeSql(sourceIssue.id),
          ),
        )
        .orderBy(desc(issueComments.createdAt), desc(issueComments.id))
        .limit(5)
        .then((rows) => rows.map((row) => row.comment)),
      db
        .select({ costCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::int` })
        .from(costEvents)
        .where(and(eq(costEvents.companyId, sourceIssue.companyId), eq(costEvents.issueId, sourceIssue.id)))
        .then((rows) => rows[0] ?? { costCents: 0 }),
    ]);

    const activeRunCount = latestRuns.filter((run) =>
      ACTIVE_RUN_STATUSES.includes(run.status as (typeof ACTIVE_RUN_STATUSES)[number]),
    ).length;
    const activeStartedAt = sourceIssue.startedAt ?? sourceIssue.executionLockedAt ?? null;
    const elapsedMs = sourceIssue.status === "in_progress" && activeStartedAt
      ? Math.max(0, now.getTime() - activeStartedAt.getTime())
      : null;

    // RBR-983 AC1/AC4: resolve whether the assignee could act at all *before*
    // deciding which triggers are admissible. An assignee that cannot act
    // produces no comments and accrues elapsed time purely from being stuck,
    // neither of which is a productivity finding.
    const actability = await resolveAssigneeActability(sourceIssue, sourceAgent, activeRunCount);

    // AC1: suppress the review entirely when the assignee cannot act. This is
    // an infra fault -- route it to the operator via the activity log instead
    // of minting a performance finding against an agent with no process.
    // Rate-limited the same way refresh comments are, so a stuck agent does
    // not spam the activity log on every reconcile tick.
    if (!actability.canAct) {
      const since = new Date(now.getTime() - thresholds.refreshIntervalMs);
      const alreadyLogged = await findRecentInfraSuppressionLog(sourceIssue.companyId, sourceIssue.id, since);
      if (!alreadyLogged) {
        await logActivity(db, {
          companyId: sourceIssue.companyId,
          actorType: "system",
          actorId: "system",
          agentId: sourceAgent.id,
          action: "issue.productivity_review_suppressed_infra",
          entityType: "issue",
          entityId: sourceIssue.id,
          details: {
            source: "productivity_review.reconcile",
            reason: actability.reason,
            detail: actability.detail,
            noCommentStreak,
            executedRunCount: executedRuns.length,
            preStartCancelledRunCount,
            elapsedMs,
          },
        });
      }
      return null;
    }

    const noComment = noCommentStreak >= thresholds.noCommentStreakRuns;
    // AC4: elapsed time on an assignee that cannot act measures an outage,
    // not effort, so the long-active-duration trigger must not fire on it.
    const longActive = actability.canAct && elapsedMs !== null && elapsedMs >= thresholds.longActiveMs;
    const highChurn =
      runCountLastHour >= thresholds.highChurnHourly ||
      assigneeRunCommentCountLastHour >= thresholds.highChurnHourly ||
      runCountLastSixHours >= thresholds.highChurnSixHours ||
      assigneeRunCommentCountLastSixHours >= thresholds.highChurnSixHours;
    const trigger = choosePrimaryTrigger({ noComment, longActive, highChurn });
    if (!trigger) return null;

    const { signalClass, signalClassReason } = classifySignal({
      trigger,
      actability,
      executedRunCount: executedRuns.length,
      wallClockTimeoutRunCount,
    });

    const triggerReasons: string[] = [];
    if (noComment) triggerReasons.push(`${noCommentStreak} consecutive executed issue-linked runs had no run-created issue comment`);
    if (longActive) triggerReasons.push(`current active episode has lasted ${msToHuman(elapsedMs)}`);
    if (highChurn) {
      triggerReasons.push(
        `${runCountLastHour} runs/${assigneeRunCommentCountLastHour} assignee-run comments in 1h; ${runCountLastSixHours} runs/${assigneeRunCommentCountLastSixHours} assignee-run comments in 6h`,
      );
    }
    if (preStartCancelledRunCount > 0) {
      triggerReasons.push(
        `${preStartCancelledRunCount} sampled run(s) never started (pre-start cancel) and were excluded from the no-comment streak`,
      );
    }

    return {
      trigger,
      signalClass,
      signalClassReason,
      triggerReasons,
      sourceIssue,
      sourceAgent,
      noCommentStreak,
      totalRunCount: latestRuns.length,
      terminalRunCount: terminalRuns.length,
      executedRunCount: executedRuns.length,
      preStartCancelledRunCount,
      wallClockTimeoutRunCount,
      activeRunCount,
      runCountLastHour,
      runCountLastSixHours,
      commentCount: assigneeRunCommentCount,
      commentCountLastHour: assigneeRunCommentCountLastHour,
      commentCountLastSixHours: assigneeRunCommentCountLastSixHours,
      elapsedMs,
      latestRuns: latestRuns.slice(0, 5),
      latestComments,
      costCents: costRow.costCents,
      usageSamples: latestRuns
        .filter((run) => run.usageJson)
        .slice(0, 3)
        .map((run) => ({ runId: run.id, usageJson: run.usageJson ?? null })),
      nextAction: latestRuns.find((run) => run.nextAction)?.nextAction ?? null,
      thresholds,
      generatedAt: now,
    };
  }

  async function resolveReviewOwnerAgentId(sourceIssue: IssueRow, sourceAgent: AgentRow) {
    const candidateIds: string[] = [];
    if (sourceAgent.reportsTo) candidateIds.push(sourceAgent.reportsTo);
    if (sourceIssue.createdByAgentId) candidateIds.push(sourceIssue.createdByAgentId);
    if (sourceIssue.projectId) {
      const project = await db
        .select({ leadAgentId: projects.leadAgentId })
        .from(projects)
        .where(and(eq(projects.companyId, sourceIssue.companyId), eq(projects.id, sourceIssue.projectId)))
        .then((rows) => rows[0] ?? null);
      if (project?.leadAgentId) candidateIds.push(project.leadAgentId);
    }
    const roleCandidates = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.companyId, sourceIssue.companyId), inArray(agents.role, ["cto", "ceo"])))
      .orderBy(sql`case when ${agents.role} = 'cto' then 0 else 1 end`, asc(agents.createdAt), asc(agents.id));
    candidateIds.push(...roleCandidates.map((agent) => agent.id));

    const seen = new Set<string>();
    for (const agentId of candidateIds) {
      if (seen.has(agentId)) continue;
      seen.add(agentId);
      const candidate = await getAgent(agentId);
      if (!candidate || candidate.companyId !== sourceIssue.companyId || !isAgentInvokable(candidate)) continue;
      const budgetBlock = await budgets.getInvocationBlock(sourceIssue.companyId, candidate.id, {
        issueId: sourceIssue.id,
        projectId: sourceIssue.projectId ?? null,
      });
      if (!budgetBlock) return candidate.id;
    }
    return null;
  }

  function buildReviewMarkdown(evidence: ProductivityReviewEvidence, prefix: string) {
    const latestRuns = evidence.latestRuns.length > 0
      ? evidence.latestRuns.map((run) =>
        `- ${runUiLink(run, prefix)} \`${run.status}\` liveness \`${run.livenessState ?? "unknown"}\`, created ${run.createdAt.toISOString()}${run.nextAction ? `, next action: ${truncateInline(run.nextAction, 160)}` : ""}`,
      ).join("\n")
      : "- none";
    const latestComments = evidence.latestComments.length > 0
      ? evidence.latestComments.map((comment) =>
        `- ${comment.createdAt.toISOString()}${comment.createdByRunId ? ` run \`${comment.createdByRunId}\`` : ""}: ${truncateInline(comment.body)}`,
      ).join("\n")
      : "- none";
    const usage = evidence.usageSamples.length > 0
      ? evidence.usageSamples.map((sample) => `- \`${sample.runId}\`: \`${JSON.stringify(sample.usageJson).slice(0, 500)}\``).join("\n")
      : "- no usage payloads on sampled runs";
    return [
      "Paperclip detected an unusual productivity/progression pattern on an assigned issue.",
      "",
      "## Source",
      "",
      `- Source issue: ${issueUiLink(evidence.sourceIssue, prefix)}`,
      `- Assigned agent: ${evidence.sourceAgent.name} (${evidence.sourceAgent.role})`,
      `- Primary trigger: \`${evidence.trigger}\` (${formatTrigger(evidence.trigger)})`,
      `- Signal class: \`${evidence.signalClass}\` (${formatSignalClass(evidence.signalClass)})`,
      `- Signal class reason: ${evidence.signalClassReason}`,
      `- Trigger reasons: ${evidence.triggerReasons.join("; ")}`,
      `- Generated at: ${evidence.generatedAt.toISOString()}`,
      "",
      "## Evidence",
      "",
      `- Total sampled issue-linked runs: ${evidence.totalRunCount}`,
      `- Terminal sampled runs: ${evidence.terminalRunCount}`,
      `- Executed runs (adapter actually started): ${evidence.executedRunCount}`,
      `- Pre-start cancelled runs (excluded from streak): ${evidence.preStartCancelledRunCount}`,
      `- Wall-clock timed-out runs: ${evidence.wallClockTimeoutRunCount}`,
      `- Active queued/running/scheduled runs: ${evidence.activeRunCount}`,
      `- No-comment executed-run streak: ${evidence.noCommentStreak}`,
      `- Current active elapsed time: ${msToHuman(evidence.elapsedMs)}`,
      `- Runs in rolling windows: ${evidence.runCountLastHour}/1h, ${evidence.runCountLastSixHours}/6h`,
      `- Assignee run-linked comments total/window: ${evidence.commentCount} total, ${evidence.commentCountLastHour}/1h, ${evidence.commentCountLastSixHours}/6h`,
      `- Cost events total: ${evidence.costCents} cents`,
      `- Current next action: ${evidence.nextAction ? truncateInline(evidence.nextAction, 500) : "none recorded"}`,
      "",
      "## Thresholds",
      "",
      `- No-comment streak: ${evidence.thresholds.noCommentStreakRuns} completed runs`,
      `- Long active duration: ${msToHuman(evidence.thresholds.longActiveMs)}`,
      `- High churn: ${evidence.thresholds.highChurnHourly}/1h or ${evidence.thresholds.highChurnSixHours}/6h runs/assignee-run comments`,
      `- Resolved-review snooze: ${msToHuman(evidence.thresholds.resolvedSnoozeMs)}`,
      "",
      "## Latest Runs",
      "",
      latestRuns,
      "",
      "## Latest Assignee Run Comments",
      "",
      latestComments,
      "",
      "## Usage Samples",
      "",
      usage,
      "",
      "## Manager Decision",
      "",
      "- Close as productive if this pattern is expected.",
      "- Continue with a snooze window if the current work should keep running without repeat review spam.",
      "- Request decomposition, reroute, block with an unblock owner, or stop/cancel the source work if the work is inefficient.",
    ].join("\n");
  }

  function buildRefreshComment(evidence: ProductivityReviewEvidence, prefix: string) {
    return [
      "Productivity review evidence refreshed.",
      "",
      `- Source issue: ${issueUiLink(evidence.sourceIssue, prefix)}`,
      `- Trigger: \`${evidence.trigger}\` (${formatTrigger(evidence.trigger)})`,
      `- Signal class: \`${evidence.signalClass}\` (${formatSignalClass(evidence.signalClass)})`,
      `- Reasons: ${evidence.triggerReasons.join("; ")}`,
      `- No-comment streak: ${evidence.noCommentStreak}`,
      `- Runs/assignee comments: ${evidence.runCountLastHour}/${evidence.commentCountLastHour} in 1h, ${evidence.runCountLastSixHours}/${evidence.commentCountLastSixHours} in 6h`,
      `- Next action: ${evidence.nextAction ? truncateInline(evidence.nextAction, 300) : "none recorded"}`,
    ].join("\n");
  }

  async function createOrUpdateReview(
    evidence: ProductivityReviewEvidence,
    opts: { prefix: string; thresholds: ProductivityReviewThresholds },
  ) {
    const existing = await findOpenProductivityReview(evidence.sourceIssue.companyId, evidence.sourceIssue.id);
    if (existing) {
      const refreshState = await getRefreshCommentState(evidence.sourceIssue.companyId, existing.id);
      const lastRefreshOrCreationAt = refreshState.latestCreatedAt ?? existing.createdAt;
      if (
        refreshState.count >= opts.thresholds.maxRefreshComments ||
        evidence.generatedAt.getTime() - lastRefreshOrCreationAt.getTime() < opts.thresholds.refreshIntervalMs
      ) {
        return { kind: "existing" as const, reviewIssueId: existing.id };
      }
      await addRefreshComment(existing.id, buildRefreshComment(evidence, opts.prefix), evidence.generatedAt);
      await logActivity(db, {
        companyId: evidence.sourceIssue.companyId,
        actorType: "system",
        actorId: "system",
        action: "issue.productivity_review_updated",
        entityType: "issue",
        entityId: existing.id,
        agentId: existing.assigneeAgentId,
        details: {
          source: "productivity_review.reconcile",
          sourceIssueId: evidence.sourceIssue.id,
          trigger: evidence.trigger,
          signalClass: evidence.signalClass,
          signalClassReason: evidence.signalClassReason,
          noCommentStreak: evidence.noCommentStreak,
          runCountLastHour: evidence.runCountLastHour,
          commentCountLastHour: evidence.commentCountLastHour,
        },
      });
      return { kind: "updated" as const, reviewIssueId: existing.id };
    }

    // RBR-983 AC5: if the most recent dispositioned (closed `done`) review on
    // this source issue already concluded the cause was infra or capacity,
    // and this evidence collection is still that same non-productivity class,
    // the cause has already been dispositioned and is presumably still
    // unresolved (the pattern recurred). Extend that closed review with a
    // recurrence comment instead of minting a fresh one that re-derives an
    // identical conclusion.
    if (evidence.signalClass !== "productivity") {
      const priorDisposition = await findUnresolvedDispositionedReviewCause(
        evidence.sourceIssue.companyId,
        evidence.sourceIssue.id,
      );
      if (priorDisposition) {
        const recurrenceBody = [
          PRODUCTIVITY_REVIEW_RECURRENCE_COMMENT_PREFIX,
          "",
          `- Source issue: ${issueUiLink(evidence.sourceIssue, opts.prefix)}`,
          `- New trigger: \`${evidence.trigger}\` (${formatTrigger(evidence.trigger)})`,
          `- Signal class: \`${evidence.signalClass}\` (${formatSignalClass(evidence.signalClass)})`,
          `- Reasons: ${evidence.triggerReasons.join("; ")}`,
          `- Prior disposition: \`${priorDisposition.signalClass}\` — ${priorDisposition.signalClassReason}`,
          "- No new review minted; the underlying cause was already dispositioned as non-productivity and appears unresolved.",
        ].join("\n");
        await addRefreshComment(priorDisposition.reviewIssueId, recurrenceBody, evidence.generatedAt);
        await logActivity(db, {
          companyId: evidence.sourceIssue.companyId,
          actorType: "system",
          actorId: "system",
          action: "issue.productivity_review_recurrence_held",
          entityType: "issue",
          entityId: evidence.sourceIssue.id,
          agentId: evidence.sourceAgent.id,
          details: {
            source: "productivity_review.reconcile",
            sourceIssueId: evidence.sourceIssue.id,
            trigger: evidence.trigger,
            signalClass: evidence.signalClass,
            priorReviewIssueId: priorDisposition.reviewIssueId,
            priorSignalClass: priorDisposition.signalClass,
          },
        });
        return { kind: "recurrence_deduped" as const, reviewIssueId: priorDisposition.reviewIssueId };
      }
    }

    const recentCreationCount = await countRecentProductivityReviews(
      evidence.sourceIssue.companyId,
      evidence.sourceIssue.id,
      opts.thresholds,
      evidence.generatedAt,
    );
    if (recentCreationCount >= opts.thresholds.maxCreationsPerWindow) {
      return { kind: "creation_capped" as const, reviewIssueId: null };
    }

    const ownerAgentId = await resolveReviewOwnerAgentId(evidence.sourceIssue, evidence.sourceAgent);
    let review: Awaited<ReturnType<typeof issuesSvc.create>>;
    try {
      review = await issuesSvc.create(evidence.sourceIssue.companyId, {
        title: `Review productivity for ${evidence.sourceIssue.identifier ?? evidence.sourceIssue.title}`,
        description: buildReviewMarkdown(evidence, opts.prefix),
        status: "todo",
        priority: evidence.trigger === "long_active_duration" ? "medium" : "high",
        parentId: evidence.sourceIssue.id,
        projectId: evidence.sourceIssue.projectId,
        goalId: evidence.sourceIssue.goalId,
        billingCode: evidence.sourceIssue.billingCode,
        assigneeAgentId: ownerAgentId,
        assigneeAdapterOverrides: recoveryAssigneeAdapterOverrides("status_only"),
        originKind: PRODUCTIVITY_REVIEW_ORIGIN_KIND,
        originId: evidence.sourceIssue.id,
        originFingerprint: productivityReviewFingerprint(evidence.sourceIssue.id),
        requestDepth: clampIssueRequestDepth(evidence.sourceIssue.requestDepth + 1),
      });
    } catch (error) {
      const maybe = error as { code?: string; constraint?: string; message?: string };
      const uniqueConflict = maybe.code === "23505" &&
        (
          maybe.constraint === "issues_active_productivity_review_uq" ||
          typeof maybe.message === "string" && maybe.message.includes("issues_active_productivity_review_uq")
        );
      if (!uniqueConflict) throw error;
      const raced = await findOpenProductivityReview(evidence.sourceIssue.companyId, evidence.sourceIssue.id);
      if (!raced) throw error;
      return { kind: "existing" as const, reviewIssueId: raced.id };
    }
    await db
      .update(issues)
      .set({ createdAt: evidence.generatedAt, updatedAt: evidence.generatedAt })
      .where(eq(issues.id, review.id));

    await logActivity(db, {
      companyId: evidence.sourceIssue.companyId,
      actorType: "system",
      actorId: "system",
      action: "issue.productivity_review_created",
      entityType: "issue",
      entityId: review.id,
      agentId: ownerAgentId,
      details: {
        source: "productivity_review.reconcile",
        sourceIssueId: evidence.sourceIssue.id,
        trigger: evidence.trigger,
        noCommentStreak: evidence.noCommentStreak,
        runCountLastHour: evidence.runCountLastHour,
        commentCountLastHour: evidence.commentCountLastHour,
      },
    });

    if (ownerAgentId && deps?.enqueueWakeup) {
      await deps.enqueueWakeup(ownerAgentId, {
        source: "assignment",
        triggerDetail: "system",
        reason: "issue_assigned",
        payload: withRecoveryModelProfileHint({
          issueId: review.id,
          sourceIssueId: evidence.sourceIssue.id,
          trigger: evidence.trigger,
        }, "status_only"),
        requestedByActorType: "system",
        requestedByActorId: "productivity_review",
        contextSnapshot: withRecoveryModelProfileHint({
          issueId: review.id,
          taskId: review.id,
          wakeReason: "issue_assigned",
          source: PRODUCTIVITY_REVIEW_ORIGIN_KIND,
          sourceIssueId: evidence.sourceIssue.id,
          productivityReviewTrigger: evidence.trigger,
        }, "status_only"),
      });
    }

    return { kind: "created" as const, reviewIssueId: review.id };
  }

  async function reconcileProductivityReviews(opts?: {
    now?: Date;
    companyId?: string;
    thresholds?: Partial<ProductivityReviewThresholds>;
  }) {
    const now = opts?.now ?? new Date();
    const thresholds = buildThresholds(opts?.thresholds);
    const candidates = await db
      .select()
      .from(issues)
      .where(
        and(
          opts?.companyId ? eq(issues.companyId, opts.companyId) : undefined,
          isNull(issues.hiddenAt),
          isNull(issues.assigneeUserId),
          inArray(issues.status, ["todo", "in_progress"]),
          sql`${issues.assigneeAgentId} is not null`,
          sql`${issues.originKind} <> ${PRODUCTIVITY_REVIEW_ORIGIN_KIND}`,
        ),
      )
      .orderBy(asc(issues.updatedAt), asc(issues.id))
      .limit(MAX_CANDIDATE_ISSUES);

    const result = {
      scanned: candidates.length,
      created: 0,
      updated: 0,
      existing: 0,
      snoozed: 0,
      creationCapped: 0,
      recurrenceDeduped: 0,
      skipped: 0,
      failed: 0,
      reviewIssueIds: [] as string[],
      failedIssueIds: [] as string[],
    };

    const prefixCache = new Map<string, string>();
    for (const candidate of candidates) {
      if (!candidate.assigneeAgentId) {
        result.skipped += 1;
        continue;
      }
      if (await isProductivityReviewDescendant(candidate)) {
        result.skipped += 1;
        continue;
      }
      if (await findRecentResolvedProductivityReview(candidate.companyId, candidate.id, thresholds, now)) {
        result.snoozed += 1;
        continue;
      }
      const sourceAgent = await getAgent(candidate.assigneeAgentId);
      if (!sourceAgent || sourceAgent.companyId !== candidate.companyId) {
        result.skipped += 1;
        continue;
      }
      const evidence = await collectEvidence(candidate, sourceAgent, thresholds, now);
      if (!evidence) {
        result.skipped += 1;
        continue;
      }
      let prefix = prefixCache.get(candidate.companyId);
      if (!prefix) {
        prefix = await getCompanyIssuePrefix(candidate.companyId);
        prefixCache.set(candidate.companyId, prefix);
      }
      try {
        const outcome = await createOrUpdateReview(evidence, { prefix, thresholds });
        if (outcome.kind === "created") result.created += 1;
        else if (outcome.kind === "updated") result.updated += 1;
        else if (outcome.kind === "creation_capped") result.creationCapped += 1;
        else if (outcome.kind === "recurrence_deduped") result.recurrenceDeduped += 1;
        else result.existing += 1;
        if (outcome.reviewIssueId) result.reviewIssueIds.push(outcome.reviewIssueId);
      } catch (err) {
        result.failed += 1;
        result.failedIssueIds.push(candidate.id);
        logger.warn(
          {
            err,
            companyId: candidate.companyId,
            issueId: candidate.id,
            requestDepth: candidate.requestDepth,
          },
          "productivity review reconciliation skipped malformed candidate",
        );
      }
    }

    return result;
  }

  async function isProductivityReviewContinuationHoldActive(input: {
    companyId: string;
    issueId: string;
    agentId: string;
    now?: Date;
    thresholds?: Partial<ProductivityReviewThresholds>;
  }) {
    const now = input.now ?? new Date();
    const thresholds = buildThresholds(input.thresholds);
    const [sourceIssue, sourceAgent, openReview] = await Promise.all([
      db
        .select()
        .from(issues)
        .where(and(eq(issues.companyId, input.companyId), eq(issues.id, input.issueId)))
        .then((rows) => rows[0] ?? null),
      getAgent(input.agentId),
      findOpenProductivityReview(input.companyId, input.issueId),
    ]);
    if (!sourceIssue || !sourceAgent || !openReview) return { held: false as const };
    if (sourceAgent.companyId !== input.companyId) return { held: false as const };
    const evidence = await collectEvidence(sourceIssue, sourceAgent, thresholds, now);
    if (!evidence || !isSoftStopTrigger(evidence.trigger)) return { held: false as const };
    return {
      held: true as const,
      reviewIssueId: openReview.id,
      reviewIdentifier: openReview.identifier,
      trigger: evidence.trigger,
      reason: evidence.triggerReasons.join("; "),
    };
  }

  async function recordContinuationHold(input: {
    companyId: string;
    issueId: string;
    runId: string;
    agentId: string;
    reviewIssueId: string;
    trigger: ProductivityReviewTrigger;
    reason: string;
  }) {
    await logActivity(db, {
      companyId: input.companyId,
      actorType: "system",
      actorId: "system",
      agentId: input.agentId,
      runId: input.runId,
      action: "issue.productivity_review_continuation_held",
      entityType: "issue",
      entityId: input.issueId,
      details: {
        source: "productivity_review.continuation_hold",
        reviewIssueId: input.reviewIssueId,
        trigger: input.trigger,
        reason: input.reason,
      },
    });
  }

  return {
    reconcileProductivityReviews,
    isProductivityReviewContinuationHoldActive,
    recordContinuationHold,
  };
}
