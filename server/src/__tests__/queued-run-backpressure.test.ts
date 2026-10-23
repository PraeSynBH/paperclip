// PRA-6499: unit tests for the queued-run backpressure classifier.
//
// The classifier is pure on purpose, so these run without a database. The last case
// replays a real captured backlog (fixtures/heartbeat-queue-20261020T0904Z.json) and
// asserts the acceptance criterion against it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  classifyQueuedRunBackpressure,
  classifyQueuedRunWakeability,
  compareQueuedRunsForPromotion,
  describeQueuedAge,
  resolveQueuedRunReapBoundSec,
  summariseAgentQueue,
  type QueuedRunRowLike,
  type QueuedRunWakeabilityIssueLike,
} from "../services/queued-run-backpressure.js";

const NOW = new Date("2026-10-20T09:06:00Z");
const BOUND = resolveQueuedRunReapBoundSec(0);

function row(
  id: string,
  createdAt: string,
  extra: Partial<QueuedRunRowLike> = {},
): QueuedRunRowLike {
  return {
    id,
    agentId: "cccf9a46-318f-4ec9-b938-1cd7f2d9fc1b",
    status: "queued",
    startedAt: null,
    wakeupRequestId: `w-${id}`,
    createdAt: new Date(createdAt),
    contextSnapshot: { issueId: "issue-1" },
    ...extra,
  };
}

describe("resolveQueuedRunReapBoundSec", () => {
  it("is max(2 x interval, 1h)", () => {
    expect(BOUND).toBe(3600);
    expect(resolveQueuedRunReapBoundSec(60)).toBe(3600);
    expect(resolveQueuedRunReapBoundSec(3600)).toBe(7200);
    expect(resolveQueuedRunReapBoundSec(Number.NaN)).toBe(3600);
    expect(resolveQueuedRunReapBoundSec(-5)).toBe(3600);
  });
});

describe("classifyQueuedRunBackpressure", () => {
  it("reaps a never-started row older than the bound with a named reason", () => {
    const verdict = classifyQueuedRunBackpressure({
      rows: [row("a", "2026-10-20T07:06:00Z")],
      now: NOW,
      boundSec: BOUND,
    });
    expect(verdict.reap).toHaveLength(1);
    expect(verdict.keep).toEqual([]);
    expect(verdict.reap[0]?.errorCode).toBe("queued_run_expired");
    expect(verdict.reap[0]?.ageSec).toBe(7200);
    expect(verdict.reap[0]?.reason).toMatch(/never started/);
    expect(verdict.reap[0]?.reason).toMatch(/2h/);
  });

  it("keeps a row exactly at the bound and reaps one second over", () => {
    const at = classifyQueuedRunBackpressure({
      rows: [row("a", "2026-10-20T08:06:00Z")],
      now: NOW,
      boundSec: BOUND,
    });
    expect(at.reap).toHaveLength(0);
    const over = classifyQueuedRunBackpressure({
      rows: [row("a", "2026-10-20T08:05:59Z")],
      now: NOW,
      boundSec: BOUND,
    });
    expect(over.reap).toHaveLength(1);
  });

  it("never age-reaps a row that did start", () => {
    const verdict = classifyQueuedRunBackpressure({
      rows: [row("a", "2026-10-20T07:06:00Z", { startedAt: new Date("2026-10-20T07:06:01Z") })],
      now: NOW,
      boundSec: BOUND,
    });
    expect(verdict.reap).toHaveLength(0);
    expect(verdict.keep).toEqual(["a"]);
  });

  it("supersedes older duplicate wakes for the same issue and keeps the newest", () => {
    const verdict = classifyQueuedRunBackpressure({
      rows: [
        row("a", "2026-10-20T08:57:38Z"),
        row("b", "2026-10-20T08:57:39Z"),
        row("c", "2026-10-20T08:57:40Z"),
      ],
      now: NOW,
      boundSec: BOUND,
    });
    expect(verdict.keep).toEqual(["c"]);
    expect(verdict.supersede.map((decision) => decision.runId)).toEqual(["a", "b"]);
    expect(verdict.supersede.every((decision) => decision.errorCode === "superseded_by_newer_wake")).toBe(true);
    expect(verdict.supersede.every((decision) => /newer wake for the same issue/.test(decision.reason))).toBe(true);
  });

  it("does NOT coalesce different issues for the same agent away", () => {
    const verdict = classifyQueuedRunBackpressure({
      rows: [
        row("a", "2026-10-20T08:57:38Z", { contextSnapshot: { issueId: "issue-1" } }),
        row("b", "2026-10-20T08:57:39Z", { contextSnapshot: { issueId: "issue-2" } }),
        row("c", "2026-10-20T08:57:40Z", { contextSnapshot: { issueId: "issue-3" } }),
      ],
      now: NOW,
      boundSec: BOUND,
    });
    expect(verdict.supersede).toHaveLength(0);
    expect([...verdict.keep].sort()).toEqual(["a", "b", "c"]);
  });

  it("coalesces issue-less timer wakes per agent", () => {
    const verdict = classifyQueuedRunBackpressure({
      rows: [
        row("a", "2026-10-20T08:57:38Z", { contextSnapshot: { wakeReason: "heartbeat_timer" } }),
        row("b", "2026-10-20T08:58:38Z", { contextSnapshot: { wakeReason: "heartbeat_timer" } }),
      ],
      now: NOW,
      boundSec: BOUND,
    });
    expect(verdict.keep).toEqual(["b"]);
    expect(verdict.supersede.map((decision) => decision.runId)).toEqual(["a"]);
  });

  it("lets reap win over coalesce for a stale duplicate", () => {
    const verdict = classifyQueuedRunBackpressure({
      rows: [row("old", "2026-10-20T06:00:00Z"), row("new", "2026-10-20T08:57:00Z")],
      now: NOW,
      boundSec: BOUND,
    });
    expect(verdict.reap.map((decision) => decision.runId)).toEqual(["old"]);
    expect(verdict.supersede).toHaveLength(0);
    expect(verdict.keep).toEqual(["new"]);
  });

  it("ignores non-queued rows", () => {
    const verdict = classifyQueuedRunBackpressure({
      rows: [
        row("a", "2026-10-20T06:00:00Z", { status: "running" }),
        row("b", "2026-10-20T06:00:00Z", { status: "succeeded" }),
      ],
      now: NOW,
      boundSec: BOUND,
    });
    expect(verdict.reap.length + verdict.supersede.length + verdict.keep.length).toBe(0);
  });
});

describe("describeQueuedAge", () => {
  it("formats seconds, minutes and hours", () => {
    expect(describeQueuedAge(59)).toBe("59s");
    expect(describeQueuedAge(3600)).toBe("1h");
    expect(describeQueuedAge(45360)).toBe("12h36m");
  });
});

describe("replaying the real measured backlog", () => {
  const snapshot = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("./fixtures/heartbeat-queue-20261020T0904Z.json", import.meta.url)),
      "utf8",
    ),
  ) as { runs: QueuedRunRowLike[] };
  const rows = snapshot.runs.filter((entry) => (entry.agentId ?? "").startsWith("cccf9a46"));

  it("leaves no over-bound never-started queued row (AC2)", () => {
    const verdict = classifyQueuedRunBackpressure({ rows, now: NOW, boundSec: BOUND });
    const terminal = new Set([...verdict.reap, ...verdict.supersede].map((decision) => decision.runId));
    const stillQueued = rows.filter((entry) => entry.status === "queued" && !terminal.has(entry.id));
    const violations = stillQueued.filter(
      (entry) =>
        !entry.startedAt &&
        (NOW.getTime() - Date.parse(String(entry.createdAt))) / 1000 > BOUND,
    );
    expect(violations).toHaveLength(0);
    expect(verdict.reap.length).toBeGreaterThan(0);
  });

  it("reports the queue shape the /heartbeat-queue surface exposes", () => {
    const verdict = classifyQueuedRunBackpressure({ rows, now: NOW, boundSec: BOUND });
    const summary = summariseAgentQueue({
      agentId: "cccf9a46-318f-4ec9-b938-1cd7f2d9fc1b",
      maxConcurrentRuns: 1,
      intervalSec: 0,
      rows,
      now: NOW,
      boundSec: BOUND,
    });
    expect(summary.queueDepth).toBe(rows.filter((entry) => entry.status === "queued").length);
    expect(summary.overBoundCount).toBe(verdict.reap.length);
    expect(summary.runningCount).toBe(rows.filter((entry) => entry.status === "running").length);
    expect(summary.reapBoundSec).toBe(BOUND);
    expect(Object.keys(summary.queuedByIssue).length).toBe(summary.queueDepth);
  });
});

// PRX-6045: cancel-by-reason for queued runs whose issue can no longer be woken.
// These run without a database: the classifier is given the issue projection the
// heartbeat sweep fetches (status + unresolved blocker count) and nothing else.
describe("classifyQueuedRunWakeability", () => {
  const queuedRow = (
    id: string,
    issueId: string,
    createdAt: string,
    extra: Record<string, unknown> = {},
  ): QueuedRunRowLike => ({
    id,
    agentId: "agent-a",
    status: "queued",
    startedAt: null,
    createdAt,
    wakeupRequestId: `${id}-wake`,
    contextSnapshot: { issueId, ...extra },
  });

  const issue = (
    overrides: Partial<QueuedRunWakeabilityIssueLike> = {},
  ): QueuedRunWakeabilityIssueLike => ({
    status: "todo",
    unresolvedBlockerCount: 0,
    unresolvedBlockerIssueIds: [],
    ...overrides,
  });

  it("cancels terminal, blocked and missing issues with a named code, and keeps wakeable work", () => {
    const rows = [
      queuedRow("run-done", "issue-done", "2026-10-22T23:00:00Z"),
      queuedRow("run-cancelled", "issue-cancelled", "2026-10-22T23:01:00Z"),
      queuedRow("run-blocked", "issue-blocked", "2026-10-22T23:02:00Z"),
      queuedRow("run-missing", "issue-missing", "2026-10-22T23:03:00Z"),
      queuedRow("run-todo", "issue-todo", "2026-10-22T23:04:00Z"),
      // A blocked issue whose blockers all resolved is wakeable again (PRX-6026).
      queuedRow("run-unblocked", "issue-unblocked", "2026-10-22T23:05:00Z"),
      // A row with no issue id is a timer wake: not this rule's business.
      { ...queuedRow("run-no-issue", "issue-todo", "2026-10-22T23:06:00Z"), contextSnapshot: {} },
    ];
    const issueById = new Map<string, QueuedRunWakeabilityIssueLike | null>([
      ["issue-done", issue({ status: "done" })],
      ["issue-cancelled", issue({ status: "cancelled" })],
      ["issue-blocked", issue({ status: "blocked", unresolvedBlockerCount: 2, unresolvedBlockerIssueIds: ["PRX-1", "PRX-2"] })],
      ["issue-missing", null],
      ["issue-todo", issue()],
      ["issue-unblocked", issue({ status: "blocked", unresolvedBlockerCount: 0 })],
    ]);

    const verdict = classifyQueuedRunWakeability({
      rows,
      issueById,
      now: new Date("2026-10-23T05:00:00Z"),
    });

    const byRunId = new Map(verdict.cancel.map((decision) => [decision.runId, decision]));
    expect(byRunId.get("run-done")?.errorCode).toBe("issue_terminal_status");
    expect(byRunId.get("run-cancelled")?.errorCode).toBe("issue_terminal_status");
    expect(byRunId.get("run-blocked")?.errorCode).toBe("issue_dependencies_blocked");
    expect(byRunId.get("run-blocked")?.reason).toContain("2 unresolved blockers");
    expect(byRunId.get("run-blocked")?.reason).toContain("PRX-1");
    expect(byRunId.get("run-missing")?.errorCode).toBe("issue_not_found");
    // 5h58m old (23:02Z -> 05:00Z), but the reason is the issue state, not the age.
    expect(byRunId.get("run-blocked")?.ageSec).toBe(5 * 3600 + 58 * 60);

    // Issue-less (timer) rows are not this rule's business: neither cancelled nor
    // reported as kept.
    expect(verdict.keep.sort()).toEqual(["run-todo", "run-unblocked"].sort());
  });

  it("leaves rows alone when the issue projection was not fetched", () => {
    const verdict = classifyQueuedRunWakeability({
      rows: [queuedRow("run-x", "issue-x", "2026-10-22T23:00:00Z")],
      issueById: new Map(),
      now: new Date("2026-10-23T05:00:00Z"),
    });
    expect(verdict.cancel).toHaveLength(0);
    expect(verdict.keep).toEqual([]);
  });
});

// PRX-6045 (2nd pass, after the 2026-10-23T07:58Z Praxis CTO measurement):
// descriptor-parked issues are not wakeable by an agent wake, and promotion is
// oldest-wakeable-first rather than status/priority-first.
describe("classifyQueuedRunWakeability — descriptor-parked", () => {
  const row = (id: string, issueId: string): QueuedRunRowLike => ({
    id,
    agentId: "agent-a",
    status: "queued",
    startedAt: null,
    createdAt: "2026-10-23T07:00:00Z",
    wakeupRequestId: `${id}-wake`,
    contextSnapshot: { issueId },
  });

  it("cancels a blocked issue parked on a human/board unblock action, keeps agent-owned ones", () => {
    const issueById = new Map([
      ["issue-human", { status: "blocked", unblockDescriptorOwner: "user" as const, unblockDescriptorAction: "Sign in to the SendGrid console and reissue the key" }],
      ["issue-board", { status: "blocked", unblockDescriptorOwner: "board" as const, unblockDescriptorAction: "Approve the migration window" }],
      ["issue-agent", { status: "blocked", unblockDescriptorOwner: "agent" as const, unblockDescriptorAction: "Re-run the failing suite" }],
      // Descriptor left behind on a non-blocked issue must not park it.
      ["issue-todo", { status: "todo", unblockDescriptorOwner: "board" as const, unblockDescriptorAction: "stale" }],
    ]);
    const verdict = classifyQueuedRunWakeability({
      rows: [row("run-human", "issue-human"), row("run-board", "issue-board"), row("run-agent", "issue-agent"), row("run-todo", "issue-todo")],
      issueById,
      now: new Date("2026-10-23T08:00:00Z"),
    });
    const byRunId = new Map(verdict.cancel.map((decision) => [decision.runId, decision]));
    expect(byRunId.get("run-human")?.errorCode).toBe("issue_parked_on_unblock_action");
    expect(byRunId.get("run-human")?.reason).toContain("owned by user");
    expect(byRunId.get("run-board")?.errorCode).toBe("issue_parked_on_unblock_action");
    // An agent still owns an action here, so the queued run stays work.
    expect(byRunId.has("run-agent")).toBe(false);
    expect(byRunId.has("run-todo")).toBe(false);
    expect(verdict.keep.sort()).toEqual(["run-agent", "run-todo"]);
  });
});

describe("compareQueuedRunsForPromotion", () => {
  const entry = (over: Partial<Parameters<typeof compareQueuedRunsForPromotion>[0]> & { runId: string }) => ({
    createdAtMs: Date.parse("2026-10-23T07:00:00Z"),
    hasIssueId: true,
    issueReady: true,
    issueStatus: "todo",
    priorityRank: 2,
    ...over,
  });

  it("promotes the oldest wakeable run even when a newer one is in_progress and higher priority", () => {
    // The PRX-5554 shape: a decided `todo` card queued at 00:58 behind fresh
    // automation wakes on `in_progress` issues. Under the old status/priority rank the
    // card was passed over on every slot and reaped at 60 min, three times.
    const praxisCto = [
      entry({ runId: "newer-in-progress", createdAtMs: Date.parse("2026-10-23T07:31:00Z"), issueStatus: "in_progress", priorityRank: 0 }),
      entry({ runId: "prx-5554", createdAtMs: Date.parse("2026-10-23T06:58:00Z"), issueStatus: "todo", priorityRank: 2 }),
      entry({ runId: "oldest-todo", createdAtMs: Date.parse("2026-10-23T06:25:00Z"), issueStatus: "todo", priorityRank: 3 }),
    ];
    const order = [...praxisCto].sort(compareQueuedRunsForPromotion).map((run) => run.runId);
    expect(order).toEqual(["oldest-todo", "prx-5554", "newer-in-progress"]);
  });

  it("never promotes a not-ready run ahead of a ready one, and puts timer wakes after issue work", () => {
    const rows = [
      entry({ runId: "blocked-issue", createdAtMs: Date.parse("2026-10-23T05:00:00Z"), issueReady: false, issueStatus: "todo" }),
      entry({ runId: "timer-wake", createdAtMs: Date.parse("2026-10-23T05:30:00Z"), hasIssueId: false }),
      entry({ runId: "ready", createdAtMs: Date.parse("2026-10-23T07:00:00Z") }),
    ];
    const order = [...rows].sort(compareQueuedRunsForPromotion).map((run) => run.runId);
    expect(order).toEqual(["ready", "timer-wake", "blocked-issue"]);
  });

  it("uses priority only to break an exact-age tie", () => {
    const sameMs = Date.parse("2026-10-23T07:00:00Z");
    const rows = [
      entry({ runId: "low", createdAtMs: sameMs, priorityRank: 3 }),
      entry({ runId: "critical", createdAtMs: sameMs, priorityRank: 0 }),
    ];
    expect([...rows].sort(compareQueuedRunsForPromotion).map((run) => run.runId)).toEqual(["critical", "low"]);
  });
});
