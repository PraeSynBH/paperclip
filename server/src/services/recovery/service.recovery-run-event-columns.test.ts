import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { heartbeatRunEvents } from "@paperclipai/db";
import {
  RECOVERY_LATEST_RUN_PROJECTION,
  buildRecoveryRunEventInsert,
  type RecoveryRunEventSource,
} from "./service.js";

// PRX-5836 regression guard.
//
// The defect was not in the insert: it was in `getLatestIssueRun()` and its two siblings, which
// returned a narrowed `heartbeat_runs` projection without `companyId`. `appendRecoveryRunEvent()`
// derives the NOT NULL `heartbeat_run_events.company_id` from that row, so every recovery decision
// record failed with `null value in column "company_id" ... violates not-null constraint`, the
// candidate was re-derived and re-failed on the next ~30 s cycle, and the "Continuation recovery
// skipped" lifecycle record that makes a stranded issue explainable never landed.
//
// These assertions are structural: they bind the projection to the real schema, so a future
// selector cannot quietly drop a column the insert needs without this file going red.

// A row with the shape `getLatestIssueRun()` returns. Built independently of the projection code
// on purpose — the point is to prove the *type and column list* carry what the insert needs, not
// to echo whatever the implementation happens to produce.
function latestRunFixture(overrides: Partial<RecoveryRunEventSource> = {}): RecoveryRunEventSource {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "44c1cd6d-01eb-43fa-adbb-267b83d99a15",
    agentId: "22222222-2222-4222-8222-222222222222",
    ...overrides,
  };
}

const LIFECYCLE_EVENT = {
  level: "warn" as const,
  message:
    "Continuation recovery skipped: the last run was killed by gateway admission starvation",
  payload: { source: "recovery.reconcile_stranded_assigned_issues", previousStatus: "in_progress" },
};

// Columns Postgres refuses to insert a NULL into unless they carry a DEFAULT.
function notNullColumnsWithoutDefault() {
  return Object.entries(getTableColumns(heartbeatRunEvents))
    .filter(([, column]) => column.notNull && !column.hasDefault)
    .map(([name]) => name)
    .sort();
}

describe("recovery run-event insert covers every NOT NULL heartbeat_run_events column", () => {
  it("declares the NOT NULL contract it is guarding (schema drift detector)", () => {
    // If this list changes, the projection/insert contract must be re-checked deliberately.
    expect(notNullColumnsWithoutDefault()).toEqual([
      "agentId",
      "companyId",
      "eventType",
      "runId",
      "seq",
    ]);
  });

  it("carries companyId in the shared projection used by getLatestIssueRun()", () => {
    // The exact omission that caused PRX-5836.
    expect(Object.keys(RECOVERY_LATEST_RUN_PROJECTION)).toContain("companyId");
  });

  it("selects every heartbeat_runs column the run event is derived from", () => {
    // run event column -> heartbeat_runs column it is copied from
    const derivedFromRun = { companyId: "companyId", runId: "id", agentId: "agentId" } as const;
    const projected = Object.keys(RECOVERY_LATEST_RUN_PROJECTION);
    for (const [eventColumn, runColumn] of Object.entries(derivedFromRun)) {
      expect(projected, `${eventColumn} is copied from heartbeat_runs.${runColumn}`).toContain(
        runColumn,
      );
    }
  });

  it("builds non-null values for every NOT NULL column from a latestRun row", () => {
    const values = buildRecoveryRunEventInsert(latestRunFixture(), LIFECYCLE_EVENT, 17);
    for (const column of notNullColumnsWithoutDefault()) {
      const value = (values as Record<string, unknown>)[column];
      expect(value, `heartbeat_run_events.${column} must not be null/undefined`).toBeDefined();
      expect(value, `heartbeat_run_events.${column} must not be null`).not.toBeNull();
    }
  });

  it("copies the run identity onto the event row (the NOT NULL that used to explode)", () => {
    const run = latestRunFixture();
    const values = buildRecoveryRunEventInsert(run, LIFECYCLE_EVENT, 17);
    expect(values.companyId).toBe(run.companyId);
    expect(values.runId).toBe(run.id);
    expect(values.agentId).toBe(run.agentId);
    expect(values.seq).toBe(17);
    // The lifecycle record itself is the point of the fix: event_type=lifecycle, level=warn.
    expect(values.eventType).toBe("lifecycle");
    expect(values.level).toBe("warn");
    expect(values.message).toContain("Continuation recovery skipped");
  });

  it("fails legibly when a caller passes a projection that dropped companyId", () => {
    const narrowed = { id: latestRunFixture().id, agentId: latestRunFixture().agentId } as unknown as
      RecoveryRunEventSource;
    expect(() => buildRecoveryRunEventInsert(narrowed, LIFECYCLE_EVENT, 1)).toThrow(
      /appendRecoveryRunEvent: run .* has no companyId \(select projection dropped it\)/,
    );
  });
});
