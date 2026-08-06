# RBR-979 — Startup reaper liveness predicate: landing record

**Owner:** CTO · **Branch:** `rbr979-reaper-liveness` · **HEAD:** `9eccd948cf`
**Worktree:** `/private/tmp/rbr979-liveness` · **Date:** 2026-08-06

> **Why this file exists instead of an issue comment.** The CTO run that did this work
> (`0770e96c-5fbb-4cf7-bf25-c7daedb8a9bd`) was itself reaped as `process_lost` at **09:58:30**
> *while it was still executing*, which invalidated its API token mid-report (`401 Agent
> authentication required`). The report could not be PATCHed to the issue. That is not an aside —
> it is the third independent reproduction of the defect this ticket describes, and it happened to
> the run fixing it. Details in "Third occurrence" below.

## Commits

| SHA | What |
|---|---|
| `cc1fc9004e` | fix: liveness predicate wired into `reapOrphanedRuns` |
| `a69c00c9c7` | test: negative control (16 tests) + mutation controls |
| `3ae2c932f7` | test: no-globalSetup vitest config |
| `7e5c1dc474` | test: DB-level restart negative controls (5 tests, real reaper + PG) |
| `9eccd948cf` | fix: drop stray duplicate migration blocking the embedded-PG tier |

RBR-974 was not context-switched away from; it is committed separately on `rbr974-admission`
(`442de84d07`). The two changes are additive, as the ticket states.

## The root cause is one layer deeper than the ticket states

The ticket says the startup reaper "has no process liveness check". **It has one.**
`server/src/services/heartbeat.ts` already read `run.processPid` and called `isProcessAlive()`
before reaping.

**It never fired, because `process_pid` was NULL for all 31 runs.**

Live DB (embedded PG `:54329`, read-only query):

```
adapter_type | total | with_pid | with_pgid | with_pstart
hermes_local |  2321 |        5 |         5 |           5
```

**5 of 2321 runs in the last 7 days recorded a pid.** All 31 reaped at 09:26:41 had
`process_pid IS NULL`, so the guard evaluated `null && ...` → falsy → reap. Every one.

Why: the installed server is **2026.707.0** (`/opt/homebrew/lib/node_modules/paperclipai`, Jul 7).
The `onSpawn` PID-persistence fix is commit `0e21a27301` (#8722), **Jul 13**. The running binary
predates the plumbing that populates the column the guard depends on.

The guard was not missing — it was **silently inert against a NULL column**. That is the same
failure shape the ticket names: inferring death from the absence of a record. This is now the third
site (agent start lock RBR-977, hot-restart adoption, this one). The generalisable lesson:
**a nullable identity column feeding a destructive predicate is a false-positive generator by
construction.**

## AC5 — how many of the 31 were alive

Method, avoiding the 1.5 GB log hazard: extracted the single log line by number
(`sed -n 1318483p` on the rotated launchd log), parsed the 31 ids, intersected against
`ps -axww` command lines. Every `hermes chat -q` process carries its runId in its cmdline, so `ps`
is a sufficient oracle. No `grep` over the large log.

| Measure | Count |
|---|---|
| Reaped at 09:26:41 | 31 |
| Still live at first check (10:34, +68 min) | **14** |
| **Provably alive AT reap time** (proc start < 09:26:41, still running) | **9** |
| RunIds in processes started *after* the reap (its own retry storm) | 4 |

The 9 is a **lower bound**: it only counts processes still running at measurement time. Runs alive
at 09:26:41 that have since exited normally are not counted. So **at least 9 of 31 (29%) were false
positives; the true figure is higher.**

Confirmed-alive set:

```
79813752-c07e-4881-b9b1-9e03e8610bb1   84b426f9-8ba8-44f3-b2a7-18647ea36b31 (alive since 08:58:10)
8743d008-e47b-4b0e-b93a-ef0fbf25d3b0   880af7d0-b802-43fd-959b-757ed53cbc39
abc2e9f2-1156-40e1-bcf1-9bf98be6e601   bcf9d886-c100-4453-a9ed-8d0be24bdb0e
cb0ae3bd-c6de-41ad-9280-9ab81a4c55ef   dfda75b9-fb56-427f-b13f-c836a37e49e5 (CTO/RBR-974, named in ticket)
eec5a6e8-b96f-4751-b3c4-0ec21e59ca2c
```

`84b426f9` had been running for **28 minutes** before the sweep declared it lost.

## Third occurrence — observed live, during this run

A second reap sweep fired at **09:58:30**, while this work was in progress:

| Measure | Count |
|---|---|
| Runs reaped at 09:58:30 | 13 |
| Of those, how many recorded a pid | **0** |
| Of those, still live OS processes at 10:40 | **7** |

One of the 7 is `0770e96c-5fbb-4cf7-bf25-c7daedb8a9bd` — the CTO run writing this document. Its row:

```
status = failed | error_code = process_lost
error  = "Process lost -- server may have restarted"
finished_at = 09:58:30
```

Its process was alive the whole time and remains alive. The reap invalidated its API token, which is
how a live, working run gets converted into "no comment ⇒ no progress". This is the ticket's harm #3
(silently destroys in-flight writes) reproduced end-to-end, and it confirms the generator is **not
load-dependent and not a once-per-boot event** — it recurs on every sweep, not just at startup.

## AC1 / AC2 — the predicate

New: `server/src/services/run-reap-liveness.ts`, `server/src/services/process-table-snapshot.ts`.

Reap now requires **positive evidence of death**. Three independent liveness signals:

1. **Recorded pid alive + identity confirmed.** Pid reuse is guarded — never pid alone. Identity is
   confirmed by cmdline runId match, or kernel start time within 10s of recorded
   `process_started_at`. A pid that resolves but whose start time disagrees classifies as
   `pid_reused_original_gone`.
2. **RunId present in the live process table.** This is the signal that saves the actual production
   population, and it requires **no schema change and no new recording** — the runId is already in
   every agent process's cmdline. It recovers exactly the NULL-pid case behind this incident, and
   works retroactively on runs spawned by the currently-deployed old binary. AC2 asked for recording
   identity if it isn't recorded today; sufficient identity turned out to be already on the box, just
   never consulted.
3. **Surviving process group** (parent gone, descendant alive).

Anything else → **alive**. A probe failure resolves to alive: an unreadable process table cannot
trigger a mass reap. One shared `ps` snapshot per sweep, so all runs in a sweep agree on one view of
the world.

## AC3 — negative control, and proof it is load-bearing

`server/src/__tests__/reap-liveness.test.ts` — **18 tests, 18 passed**, no embedded Postgres
(dedicated `vitest.reaplive.config.ts`, per the standing narrow-verification constraint).

7 cases assert a **live run is left alone**, including the exact production shape (live process,
`processPid: null`, runId in cmdline) and both ticket specimens in one simulated restart sweep.

Two independent guard-strength mechanisms, because "a test that only proves dead runs get reaped is
decorative":

- **In-test mutation control.** `legacyWouldReap()` reproduces the pre-fix predicate verbatim; the
  specimen test asserts it **would** have reaped that run. The test carries its own proof of delta.
- **Executed mutation run.** Signal 2 deleted from the predicate, suite re-run:

  ```
  × SPARES the exact production specimen: live run, NULL pid, runId in cmdline
  × SPARES both runs named in the ticket in a single simulated restart sweep
  Tests  2 failed | 14 passed (16)
  ```

  Restored → 18/18. The guard is load-bearing, not decorative.

Anti-over-correction: 4 true-positive cases plus an explicit anti-deadlock case proving the
dead-holder path stays reachable, so runs cannot pile up forever.

## AC4 — auditable evidence

Per-run verdict recording the evidence acted on, for reaped **and** spared runs: pid checked, pid
alive result, process group checked and result, what confirmed identity, recorded vs observed start
time and delta, and which pids mentioned the runId. Replaces
`{"reaped":31,"runIds":[...]}`. A spared run also gets a run event so recovery reads
"live, untracked" rather than "lost" — closing the phantom-block path in harm #1 directly.

## Verification performed

All green, on a clean `pnpm install` of this branch (not a borrowed `node_modules`).

| Check | Result |
|---|---|
| `reap-liveness.test.ts` (predicate unit tests) | **18/18 passed** |
| `heartbeat-process-recovery.test.ts -t "RBR-979"` (real reaper + embedded Postgres) | **5/5 passed** |
| `tsc --noEmit -p tsconfig.json` (full server project) | **zero errors on all touched files** |
| Mutation control (delete signal 2) | fails exactly the 2 specimen tests |

The 5 DB tests are the end-to-end proof: the run row is `running` in real Postgres, the in-memory
maps are **empty** (exactly what a freshly restarted process sees), and the process is a genuinely
spawned live OS process. They pass, i.e. a simulated restart leaves live runs alone.

Full-project `tsc` reports 126 errors, **all 126** from `@paperclipai/plugin-sdk` having no `dist/`
(the install emits a warning about it). Zero are in files this branch touches; zero non-plugin errors
exist.

**No restart of `paperclipai run`.** Per the ticket's explicit constraint, verification did not
restart the server. The predicate is proven with an injected probe plus real spawned processes; the
forensic counts came from `ps` and read-only DB queries.

### Unblocking the embedded-Postgres tier was a prerequisite

The DB tests initially could not run at all. Two pre-existing faults, both fixed here:

1. **Stray duplicate migration** (commit `9eccd948cf`). RAM-902 landed force-reassign as
   `0131_force_reassign.sql` (correctly journalled) but left a **byte-identical copy** misnamed
   `0128_force_reassign.sql` with no journal entry. `inspectMigrations()` derives "available" from
   the `.sql` files **on disk** while drizzle applies only what the **journal** lists, so the orphan
   is permanently pending: bootstrap can never reach `upToDate` and **every** suite calling
   `startEmbeddedPostgresTestDatabase()` died with `Failed to bootstrap migrations:
   0128_force_reassign.sql`. Verified by control: an untouched suite (`heartbeat-list.test.ts`)
   failed identically. Journal and files now reconcile at 132/132. This was blocking the embedded-PG
   tier for every agent, not just this ticket.
2. **Inline hook budget** (in `7e5c1dc474`). A `beforeAll(fn, 20_000)` silently overrode both the
   config `hookTimeout` and `--hookTimeout` — the RBR-912 trap, already documented verbatim in
   `heartbeat-finalize-agent-status-pause-race.test.ts`. It masked the migration fault as a generic
   20s timeout. Removed so budgets live in `vitest.config.ts` where they belong.


## Escalations — not self-authorized

**1. This fix does not take effect until the server is upgraded past 2026.707.0.** The branch is
correct, but the box runs a Jul 7 binary. Merging to master does not stop the next sweep from
reaping live runs — a deploy does, and the deploy is itself a restart, which the standing
constraints put behind board approval. **Escalated, not acted on.** The month-old deployed binary is
also a plausible common cause behind other tickets in the RBR-864/931 cluster and deserves a
first-class issue regardless of this one.

**2. `heartbeat_runs.process_pid` should not be nullable for local-child adapters.** Signal 2 makes
the reaper safe without the column, but the *class* of bug survives until "no identity recorded" can
no longer mean "assume dead" anywhere in the codebase. Recommend a separate issue with the RBR-977
start lock and hot-restart adoption sites named as siblings to audit.

**3. The reaper is not startup-only.** The ticket frames this as a startup reaper defect. The
09:58:30 sweep proves the periodic reaper (`staleThresholdMs: 5min`) shares the predicate and the
same false-positive behaviour. The fix covers both because it lives in `reapOrphanedRuns`, but the
ticket title understates the blast radius.

Confirmed the log hazard: `server.log` at 1.5 GB is real, a single `grep` did time out, worked around
via line-number extraction. Out of this ticket's scope, already routed.
