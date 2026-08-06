/**
 * RBR-979 negative-control tests for the reap liveness predicate.
 *
 * The bug being fixed is FALSE POSITIVES: a server restart reaped 31 LIVE agent
 * runs as orphaned. A test that only proves dead runs get reaped is decorative.
 * So every case here that matters asserts a live run is LEFT ALONE, and the
 * suite includes explicit mutation checks proving the guard is load-bearing.
 *
 * Real-world specimens are used as fixtures: the two runs named in the ticket
 * (the CEO run mid-PATCH and the CTO run working RBR-974) were both reaped at
 * 09:26:41 while their `hermes chat -q` processes were alive and their
 * process_pid columns were NULL.
 */

import { describe, expect, it } from "vitest";

import {
  classifyRunProcessLiveness,
  isReapAuthorizedReason,
  PROCESS_START_TIME_TOLERANCE_MS,
  type ProcessTableProbe,
  type RunProcessIdentity,
} from "../services/run-reap-liveness.js";
import {
  createProcessTableProbeFromSnapshot,
  parseLstart,
  parseProcessSnapshot,
} from "../services/process-table-snapshot.js";

// The two runs the ticket caught being reaped while alive.
const CEO_RUN = "dcccd14b-1462-4fe3-aff9-59cdd6a5235f";
const CTO_RUN = "dfda75b9-fb56-427f-b13f-c836a37e49e5";

function identity(overrides: Partial<RunProcessIdentity> = {}): RunProcessIdentity {
  return {
    runId: CEO_RUN,
    processPid: null,
    processGroupId: null,
    processStartedAt: null,
    tracksLocalChildProcess: true,
    ...overrides,
  };
}

/** A probe over a declared set of live processes. Nothing else exists. */
function probeOver(
  live: Array<{ pid: number; startTimeMs?: number | null; command: string }>,
  overrides: Partial<ProcessTableProbe> = {},
): ProcessTableProbe {
  return {
    isPidAlive: (pid) => live.some((p) => p.pid === pid),
    isProcessGroupAlive: () => false,
    startTimeForPid: (pid) => live.find((p) => p.pid === pid)?.startTimeMs ?? null,
    pidsMentioningRunId: (runId) =>
      live.filter((p) => p.command.includes(runId)).map((p) => p.pid),
    ...overrides,
  };
}

/** The pre-fix reaper predicate, reproduced exactly, as the mutation control. */
function legacyWouldReap(id: RunProcessIdentity, probe: ProcessTableProbe) {
  const pidAlive = id.tracksLocalChildProcess && !!id.processPid && probe.isPidAlive(id.processPid);
  const groupAlive =
    id.tracksLocalChildProcess
    && !!id.processGroupId
    && probe.isProcessGroupAlive(id.processGroupId);
  return !pidAlive && !groupAlive;
}

describe("RBR-979 reap liveness predicate — negative control (false positives)", () => {
  it("SPARES the exact production specimen: live run, NULL pid, runId in cmdline", () => {
    // This is the 09:26:41 population verbatim. process_pid was NULL for all 31
    // reaped runs because the deployed server predated onSpawn pid persistence,
    // yet the runId was sitting in the live process's command line the whole
    // time. Liveness was checkable; nothing looked.
    const probe = probeOver([
      { pid: 86556, command: `hermes chat -q # CEO ... Run ID: ${CEO_RUN} ...` },
    ]);
    const verdict = classifyRunProcessLiveness(identity({ processPid: null }), probe);

    expect(verdict.alive).toBe(true);
    expect(verdict.reason).toBe("run_id_present_in_process_table");
    expect(isReapAuthorizedReason(verdict.reason)).toBe(false);
    expect(verdict.evidence.runIdPidsObserved).toEqual([86556]);

    // Mutation control: without the fix this run IS reaped. If this flips, the
    // guard has stopped being load-bearing.
    expect(legacyWouldReap(identity({ processPid: null }), probe)).toBe(true);
  });

  it("SPARES both runs named in the ticket in a single simulated restart sweep", () => {
    const probe = probeOver([
      { pid: 86556, command: `hermes chat -q # CEO Run ID: ${CEO_RUN}` },
      { pid: 17653, command: `hermes chat -q # CTO Run ID: ${CTO_RUN}` },
      { pid: 60104, command: "tsc --noEmit src/services/agent-start-lock.ts" },
    ]);

    for (const runId of [CEO_RUN, CTO_RUN]) {
      const verdict = classifyRunProcessLiveness(identity({ runId, processPid: null }), probe);
      expect(verdict.alive, `${runId} must not be reaped`).toBe(true);
      expect(isReapAuthorizedReason(verdict.reason)).toBe(false);
    }
  });

  it("SPARES a live run whose pid IS recorded and whose identity is confirmed by start time", () => {
    const startedAt = new Date("2026-08-06T09:11:16.000Z");
    const probe = probeOver([
      { pid: 4242, startTimeMs: startedAt.getTime() + 1_500, command: "hermes chat -q # no runId here" },
    ]);
    const verdict = classifyRunProcessLiveness(
      identity({ processPid: 4242, processStartedAt: startedAt }),
      probe,
    );

    expect(verdict.alive).toBe(true);
    expect(verdict.reason).toBe("pid_alive_identity_confirmed");
    expect(verdict.evidence.identityConfirmedBy).toBe("process_start_time");
    expect(verdict.evidence.startTimeDeltaMs).toBe(1_500);
  });

  it("SPARES a live pid it cannot positively identify — ambiguity must not authorize a reap", () => {
    const probe = probeOver([{ pid: 4242, startTimeMs: null, command: "some other process" }]);
    const verdict = classifyRunProcessLiveness(identity({ processPid: 4242 }), probe);

    expect(verdict.alive).toBe(true);
    expect(verdict.reason).toBe("pid_alive_identity_unverified");
    expect(isReapAuthorizedReason(verdict.reason)).toBe(false);
  });

  it("SPARES every run when the process-table probe itself fails", () => {
    // An unreadable process table must never be able to trigger a mass reap.
    const probe = probeOver([], {
      pidsMentioningRunId: () => {
        throw new Error("ps timed out");
      },
    });
    const verdict = classifyRunProcessLiveness(identity({ processPid: 4242 }), probe);

    expect(verdict.alive).toBe(true);
    expect(verdict.reason).toBe("probe_failed_assumed_alive");
    expect(verdict.evidence.probeError).toBe("ps timed out");
  });

  it("SPARES a run whose parent pid died but whose process group survives", () => {
    const probe = probeOver([], { isProcessGroupAlive: (gid) => gid === 777 });
    const verdict = classifyRunProcessLiveness(
      identity({ processPid: 4242, processGroupId: 777 }),
      probe,
    );

    expect(verdict.alive).toBe(true);
    expect(verdict.reason).toBe("process_group_alive");
    expect(verdict.evidence.processGroupAlive).toBe(true);
  });

  it("SPARES a run when start times disagree but the runId is still in the process table", () => {
    // pid was recycled, yet the run itself is demonstrably still running under
    // a different pid. Death is not proven, so no reap.
    const startedAt = new Date("2026-08-06T09:11:16.000Z");
    const probe = probeOver([
      { pid: 4242, startTimeMs: startedAt.getTime() + 5 * 60_000, command: "unrelated recycled pid" },
      { pid: 9001, command: `hermes chat -q Run ID: ${CEO_RUN}` },
    ]);
    const verdict = classifyRunProcessLiveness(
      identity({ processPid: 4242, processStartedAt: startedAt }),
      probe,
    );

    expect(verdict.alive).toBe(true);
    expect(verdict.reason).toBe("run_id_present_in_process_table");
  });

  it("does not mistake another run's live process for this run's liveness", () => {
    // The cmdline oracle must match on the run's OWN id. A sibling run being
    // alive says nothing about this one, or the predicate would spare everything
    // whenever any agent was running.
    const verdict = classifyRunProcessLiveness(
      identity({ runId: CEO_RUN, processPid: 4242 }),
      probeOver([{ pid: 3131, command: `hermes chat -q Run ID: ${CTO_RUN}` }]),
    );

    expect(verdict.alive).toBe(false);
    expect(verdict.reason).toBe("pid_dead_no_other_evidence");
    expect(verdict.evidence.runIdPidsObserved).toEqual([]);
  });

  it("holds the start-time tolerance boundary exactly", () => {
    const startedAt = new Date("2026-08-06T09:11:16.000Z");
    const at = (offsetMs: number) =>
      classifyRunProcessLiveness(
        identity({ processPid: 1234, processStartedAt: startedAt }),
        probeOver([
          { pid: 1234, startTimeMs: startedAt.getTime() + offsetMs, command: "no runId here" },
        ]),
      );

    expect(at(PROCESS_START_TIME_TOLERANCE_MS).reason).toBe("pid_alive_identity_confirmed");
    expect(at(PROCESS_START_TIME_TOLERANCE_MS + 1).reason).toBe("pid_reused_original_gone");
  });
});

describe("RBR-979 reap liveness predicate — true positives still reap", () => {
  it("reaps a genuinely dead run: pid gone, no runId anywhere, no process group", () => {
    const probe = probeOver([{ pid: 1, command: "launchd" }]);
    const verdict = classifyRunProcessLiveness(identity({ processPid: 4242 }), probe);

    expect(verdict.alive).toBe(false);
    expect(verdict.reason).toBe("pid_dead_no_other_evidence");
    expect(isReapAuthorizedReason(verdict.reason)).toBe(true);
    expect(verdict.evidence.pidChecked).toBe(4242);
    expect(verdict.evidence.pidAlive).toBe(false);
  });

  it("reaps on pid reuse: pid resolves, but start time proves it is a different process", () => {
    const startedAt = new Date("2026-08-06T09:11:16.000Z");
    const probe = probeOver([
      {
        pid: 4242,
        startTimeMs: startedAt.getTime() + PROCESS_START_TIME_TOLERANCE_MS + 60_000,
        command: "an unrelated process that inherited the pid",
      },
    ]);
    const verdict = classifyRunProcessLiveness(
      identity({ processPid: 4242, processStartedAt: startedAt }),
      probe,
    );

    expect(verdict.alive).toBe(false);
    expect(verdict.reason).toBe("pid_reused_original_gone");
    expect(isReapAuthorizedReason(verdict.reason)).toBe(true);
  });

  it("reaps a run with no recorded identity and no trace in the process table", () => {
    const verdict = classifyRunProcessLiveness(identity(), probeOver([{ pid: 1, command: "launchd" }]));

    expect(verdict.alive).toBe(false);
    expect(verdict.reason).toBe("no_identity_recorded");
    expect(isReapAuthorizedReason(verdict.reason)).toBe(true);
  });

  it("does not deadlock: the dead-holder path stays reachable so runs cannot pile up forever", () => {
    // Guards against over-correcting into "never reap anything".
    const probe = probeOver([{ pid: 1, command: "launchd" }]);
    const dead = [
      identity({ processPid: 4242 }),
      identity({ processPid: 4242, processGroupId: 4242 }),
      identity({ tracksLocalChildProcess: false }),
      identity(),
    ];
    for (const id of dead) {
      expect(isReapAuthorizedReason(classifyRunProcessLiveness(id, probe).reason)).toBe(true);
    }
  });
});

describe("RBR-979 reap evidence is auditable (AC4)", () => {
  it("records the pid checked and the result for a spared run", () => {
    const probe = probeOver([{ pid: 86556, command: `Run ID: ${CEO_RUN}` }]);
    const verdict = classifyRunProcessLiveness(identity({ processPid: 86556 }), probe);

    expect(verdict.evidence).toMatchObject({
      pidChecked: 86556,
      pidAlive: true,
      identityConfirmedBy: "cmdline_run_id",
      runIdPidsObserved: [86556],
      tracksLocalChildProcess: true,
      probeError: null,
    });
    expect(verdict.runId).toBe(CEO_RUN);
  });

  it("records the pid checked and the result for a reaped run", () => {
    const probe = probeOver([{ pid: 1, command: "launchd" }]);
    const verdict = classifyRunProcessLiveness(
      identity({ processPid: 4242, processGroupId: 4242 }),
      probe,
    );

    expect(verdict.evidence.pidChecked).toBe(4242);
    expect(verdict.evidence.pidAlive).toBe(false);
    expect(verdict.evidence.processGroupChecked).toBe(4242);
    expect(verdict.evidence.processGroupAlive).toBe(false);
  });
});

describe("RBR-979 process table snapshot parsing", () => {
  it("parses real `ps -axww -o pid=,lstart=,command=` output including spaced commands", () => {
    const entries = parseProcessSnapshot(
      [
        "    1 Wed Aug  5 22:00:01 2026 /sbin/launchd",
        "86556 Thu Aug  6 09:11:16 2026 /usr/bin/python3 /opt/homebrew/bin/hermes chat -q # CEO Run ID: " + CEO_RUN,
        "not a process line",
        "",
      ].join("\n"),
    );

    expect(entries).toHaveLength(2);
    expect(entries[1]?.pid).toBe(86556);
    expect(entries[1]?.command).toContain(CEO_RUN);
    expect(entries[1]?.startTimeMs).toBe(parseLstart("Thu Aug  6 09:11:16 2026"));
    expect(entries[1]?.startTimeMs).not.toBeNull();
  });

  it("a failed snapshot refuses to answer 'nothing claims this run' rather than authorizing a reap", () => {
    const probe = createProcessTableProbeFromSnapshot({
      entries: [],
      byPid: new Map(),
      error: "ps: command timed out",
    });

    expect(() => probe.pidsMentioningRunId(CEO_RUN)).toThrow(/process snapshot unavailable/);

    // And the predicate converts that throw into "alive", not "reap".
    const verdict = classifyRunProcessLiveness(identity({ processPid: 4242 }), probe);
    expect(verdict.alive).toBe(true);
    expect(verdict.reason).toBe("probe_failed_assumed_alive");
  });

  it("finds a live run by runId through the real snapshot probe", () => {
    const snapshotStdout = `86556 Thu Aug  6 09:11:16 2026 hermes chat -q Run ID: ${CTO_RUN}`;
    const entries = parseProcessSnapshot(snapshotStdout);
    const probe = createProcessTableProbeFromSnapshot({
      entries,
      byPid: new Map(entries.map((e) => [e.pid, e])),
      error: null,
    });

    expect(probe.pidsMentioningRunId(CTO_RUN)).toEqual([86556]);
    expect(probe.pidsMentioningRunId(CEO_RUN)).toEqual([]);
    expect(probe.startTimeForPid(86556)).toBe(parseLstart("Thu Aug  6 09:11:16 2026"));
  });
});
