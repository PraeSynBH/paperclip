/**
 * Real OS process-table probe for the reap liveness predicate (RBR-979).
 *
 * One `ps` snapshot per reap sweep, shared across every candidate run. The
 * reaper evaluates tens of runs per sweep, so per-run `ps` calls would be both
 * slow and internally inconsistent (a process could appear to die between two
 * probes of the same sweep). A single snapshot makes the whole sweep agree on
 * one view of the world.
 *
 * Falls back to `process.kill(pid, 0)` for pid liveness when the snapshot could
 * not be taken, and reports snapshot failure so the predicate can refuse to reap
 * on missing evidence rather than guessing.
 */

import { execFile } from "node:child_process";

const PS_TIMEOUT_MS = 10_000;
const PS_MAX_BUFFER_BYTES = 32 * 1024 * 1024;

export type ProcessSnapshotEntry = {
  pid: number;
  startTimeMs: number | null;
  command: string;
};

export type ProcessSnapshot = {
  entries: ProcessSnapshotEntry[];
  byPid: Map<number, ProcessSnapshotEntry>;
  /** Non-null when `ps` failed; the predicate treats this as "cannot prove death". */
  error: string | null;
};

const EMPTY_SNAPSHOT: ProcessSnapshot = {
  entries: [],
  byPid: new Map(),
  error: "process snapshot unavailable",
};

/**
 * `ps -o lstart=` renders e.g. "Thu Aug  6 09:11:16 2026" in the local zone.
 * Date.parse handles that form on both macOS and Linux coreutils output.
 */
export function parseLstart(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : ms;
}

export function parseProcessSnapshot(stdout: string): ProcessSnapshotEntry[] {
  const entries: ProcessSnapshotEntry[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    // pid, then a fixed 5-field lstart ("Thu Aug  6 09:11:16 2026"), then the
    // command (which itself contains arbitrary whitespace, so it is the tail).
    const match = /^\s*(\d+)\s+(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const pid = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    entries.push({
      pid,
      startTimeMs: parseLstart(match[2] ?? ""),
      command: match[3] ?? "",
    });
  }
  return entries;
}

function runPs(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "ps",
      ["-axww", "-o", "pid=,lstart=,command="],
      { timeout: PS_TIMEOUT_MS, maxBuffer: PS_MAX_BUFFER_BYTES },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      },
    );
  });
}

export async function captureProcessSnapshot(): Promise<ProcessSnapshot> {
  if (process.platform === "win32") return { ...EMPTY_SNAPSHOT, byPid: new Map() };
  try {
    const entries = parseProcessSnapshot(await runPs());
    return {
      entries,
      byPid: new Map(entries.map((entry) => [entry.pid, entry])),
      error: null,
    };
  } catch (error) {
    return {
      entries: [],
      byPid: new Map(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function pidAliveViaSignal(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the pid exists but belongs to another user.
    return (error as NodeJS.ErrnoException | undefined)?.code === "EPERM";
  }
}

function processGroupAliveViaSignal(processGroupId: number) {
  if (process.platform === "win32") return false;
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException | undefined)?.code === "EPERM";
  }
}

export function createProcessTableProbeFromSnapshot(snapshot: ProcessSnapshot) {
  const snapshotUsable = snapshot.error === null;
  return {
    snapshotError: snapshot.error,
    isPidAlive(pid: number) {
      // The signal probe is authoritative for "does this pid exist"; the
      // snapshot only supplies identity (start time / cmdline).
      if (pidAliveViaSignal(pid)) return true;
      return snapshotUsable ? snapshot.byPid.has(pid) : false;
    },
    isProcessGroupAlive(processGroupId: number) {
      return processGroupAliveViaSignal(processGroupId);
    },
    startTimeForPid(pid: number) {
      return snapshot.byPid.get(pid)?.startTimeMs ?? null;
    },
    pidsMentioningRunId(runId: string) {
      if (!snapshotUsable) {
        // Refuse to answer "nothing claims this run" when we cannot see the
        // process table — an empty answer here would authorize a reap.
        throw new Error(`process snapshot unavailable: ${snapshot.error}`);
      }
      if (!runId) return [];
      const pids: number[] = [];
      for (const entry of snapshot.entries) {
        if (entry.command.includes(runId)) pids.push(entry.pid);
      }
      return pids;
    },
  };
}
