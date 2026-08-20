/**
 * Database Health Watchdog
 *
 * In embedded-PostgreSQL deployments the server owns the database process.
 * If that child process dies (crash, OOM kill, macOS sleep/wake edge case),
 * the HTTP server keeps running but every DB-backed request — including the
 * health endpoint's DB probe — returns a 503, and the SLA monitor records an
 * outage for as long as the process stays alive.
 *
 * This watchdog probes the DB on an interval and:
 *
 *   1. When in embedded mode, attempts to restart the embedded PostgreSQL
 *      instance (stop + start) once the DB has been unreachable for several
 *      consecutive probes.
 *   2. If the embedded PG restart fails or the DB stays unreachable after the
 *      restart attempt, calls process.exit(1) so launchd's KeepAlive bounces
 *      the whole stack (which respawns both server and embedded PG).
 *   3. In external-postgres mode logs warnings only — the server cannot fix an
 *      external DB outage, and the health endpoint already reports 503.
 *      Exiting the process would not restore an external DB, and could cause
 *      unnecessary restart loops.
 *
 * The probe function (`dbHealthProbe`) does NOT restart PG on failure — that
 * is gated by the consecutive-failure threshold to prevent restart cascades
 * (fixed in PRA-1051). An in-flight mutex prevents concurrent probe execution.
 *
 * Without this watchdog, a dead embedded Postgres leaves the server silently
 * serving 503s indefinitely. That is exactly what caused PRA-902 (and PRA-808
 * before it): 14+ hours of monitored downtime for paperclip.praesyn.int.
 *
 * Environment variables:
 *   PAPERCLIP_DB_WATCHDOG_INTERVAL_MS   — probe interval (default: 30_000 ms)
 *   PAPERCLIP_DB_WATCHDOG_MAX_FAILURES  — consecutive failures before action
 *                                          (default: 3)
 */

import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function probeIntervalMs(): number {
  const raw = process.env.PAPERCLIP_DB_WATCHDOG_INTERVAL_MS;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 30_000;
}

function maxFailures(): number {
  const raw = process.env.PAPERCLIP_DB_WATCHDOG_MAX_FAILURES;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return n;
  }
  return 3;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DbHealthWatchdogOptions {
  /** The Drizzle DB client (created via createDb). */
  db: Db;
  /** Deployment mode: embedded or external. */
  mode: "embedded-postgres" | "external-postgres";
  /**
   * The EmbeddedPostgres instance — used to attempt a restart in embedded mode.
   * Ignored in external mode.
   */
  embeddedPostgres: { stop: () => Promise<void>; start: () => Promise<void> } | null;
  /** Probe interval in milliseconds. Default: env or 30_000. */
  intervalMs?: number;
  /** Consecutive failures before taking action. Default: env or 3. */
  failuresBeforeAction?: number;
  /** For tests: override process.exit (default: process.exit). */
  exitFn?: (code: number) => void;
  /** For tests: replace the probe function entirely. */
  _testProbe?: (db: Db, embeddedPostgres: { stop: () => Promise<void>; start: () => Promise<void> } | null) => Promise<"ok" | "restarted" | "failed">;
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

export type DbProbeResult = "ok" | "restarted" | "failed";

/**
 * Run a single DB health probe. Returns the outcome so the caller (or tests)
 * can inspect what happened without inspecting logs or exit behaviour.
 *
 * NOTE: The probe does NOT attempt to restart PostgreSQL on failure — that
 * responsibility belongs to the watchdog loop's consecutive-failure threshold
 * logic. Immediate restarts here bypass the threshold and can cause restart
 * cascades (PRA-1051).
 */
export async function dbHealthProbe(
  db: Db,
  mode: "embedded-postgres" | "external-postgres",
): Promise<DbProbeResult> {
  try {
    await db.execute(sql`SELECT 1`);
    return "ok";
  } catch {
    return "failed";
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Install a periodic DB health watchdog.
 *
 * Probes the database every `intervalMs`. After `failuresBeforeAction`
 * consecutive failed probes:
 *
 * - **Embedded mode**: restarts the embedded PostgreSQL instance. If the
 *   restart succeeds the failure counter is reset. If the restart fails, or if
 *   the DB is still unreachable after the restart has had a probe cycle to
 *   confirm, the server exits with code 1 so launchd restarts everything.
 * - **External mode**: logs a warning. No further action — the server cannot
 *   fix an external DB outage.
 *
 * @returns A stop function that clears the interval.
 */
export function installDbHealthWatchdog(opts: DbHealthWatchdogOptions): () => void {
  const intervalMs = opts.intervalMs ?? probeIntervalMs();
  const failuresBeforeAction = opts.failuresBeforeAction ?? maxFailures();
  const exitFn = opts.exitFn ?? ((code: number) => process.exit(code));
  const testProbe = opts._testProbe;

  let consecutiveFailures = 0;
  let restartAttempted = false;
  let probeInFlight = false;

  async function probe(): Promise<void> {
    if (probeInFlight) {
      logger.warn("DB health probe skipped — previous probe still in-flight");
      return;
    }
    probeInFlight = true;
    try {
      let result: DbProbeResult;
      if (testProbe) {
        result = await testProbe(opts.db, opts.embeddedPostgres);
      } else {
        result = await dbHealthProbe(opts.db, opts.mode);
      }

      switch (result) {
        case "ok":
          if (consecutiveFailures > 0) {
            logger.info({ consecutiveFailures }, "DB health check recovered");
          }
          consecutiveFailures = 0;
          restartAttempted = false;
          break;

        case "restarted":
          // The embedded PG was restarted and the re-probe succeeded.
          // NOTE: "restarted" is test-only — dbHealthProbe can no longer return
          // it (restart is gated by the consecutive-failure threshold in the
          // loop, PRA-1051). Only _testProbe can produce this value.
          logger.info("Embedded PostgreSQL restart confirmed; DB health restored");
          consecutiveFailures = 0;
          restartAttempted = false;
          break;

        case "failed": {
          consecutiveFailures++;
          logger.warn(
            { consecutiveFailures, failuresBeforeAction, mode: opts.mode },
            "DB health probe failed",
          );

          if (consecutiveFailures >= failuresBeforeAction) {
            // Embedded mode: attempt auto-restart once
            if (opts.mode === "embedded-postgres" && opts.embeddedPostgres && !restartAttempted) {
              restartAttempted = true;
              logger.warn("DB unreachable after consecutive failures; attempting embedded PostgreSQL restart");
              try {
                await opts.embeddedPostgres.stop();
                await opts.embeddedPostgres.start();
                logger.info("Embedded PostgreSQL restarted; waiting for next probe cycle");
                // Reset so we get another window to confirm recovery
                consecutiveFailures = 0;
              } catch (restartErr) {
                logger.error({ err: String(restartErr) }, "Embedded PostgreSQL restart failed; exiting server");
                exitFn(1);
              }
            } else if (opts.mode === "embedded-postgres") {
              // Embedded mode, already tried restart and it didn't stick
              logger.error(
                { mode: opts.mode, restartAttempted, consecutiveFailures },
                "DB unreachable after sustained failures; exiting server to force recovery",
              );
              exitFn(1);
            } else {
              // External mode — log warnings only. The server cannot fix an
              // external DB outage, and exiting would cause unnecessary restart
              // loops. The health endpoint already reports 503.
              logger.warn(
                { mode: opts.mode, consecutiveFailures, failuresBeforeAction },
                "DB unreachable in external mode; the health endpoint will report 503 until the database is restored",
              );
            }
          }
          break;
        }
      }
    } catch (err) {
      // The probe infrastructure itself threw (a buggy _testProbe, or a future
      // code path escaping dbHealthProbe's internal catch). This is NOT
      // evidence of a DB outage — do not increment the failure counter — but
      // the watchdog must stay alive and keep probing. Log loudly so the
      // failure is visible instead of the silent-monitoring-death class that
      // caused PRA-902/808.
      logger.error({ err: String(err) }, "DB health probe threw unexpectedly; watchdog continuing");
    } finally {
      probeInFlight = false;
    }
  }

  const timer = setInterval(probe, intervalMs);

  // Run a probe immediately so we catch existing failures without waiting for
  // the first interval tick.
  void probe();

  // Don't prevent the process from exiting naturally (e.g. on SIGTERM).
  timer.unref();

  return () => clearInterval(timer);
}
