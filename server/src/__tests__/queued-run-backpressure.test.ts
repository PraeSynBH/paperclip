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
  describeQueuedAge,
  resolveQueuedRunReapBoundSec,
  summariseAgentQueue,
  type QueuedRunRowLike,
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
