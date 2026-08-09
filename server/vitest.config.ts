import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // RBR-954: every suite in this project is DB-backed — a single `it` does real
    // Postgres work (insert fixtures, run service transactions, read rows back),
    // so vitest's 5000ms default `testTimeout` was never a sane budget here. It
    // was simply never set at the config level.
    //
    // Why it had to change: `issue-thread-interactions-telemetry.test.ts` ->
    // "emits accepted suggested-task telemetry with created and skipped task
    // counts" produced three different outcomes from identical bytes, purely by
    // machine load — 1938ms (quiet) pass, 12266ms FAIL at the 5000ms default when
    // run alongside the other DB suites, 3032ms pass again in isolation. A ~6x
    // spread with no code change. Under `maxWorkers: 1` the whole shard shares one
    // cluster/process, so a loaded box stretches every test uniformly; a budget
    // tuned to the quiet case is a load-sensitive flake waiting for CI.
    //
    // Why 30000: it is ~2.4x the slowest observed loaded run (12266ms) and ~15x
    // the quiet-case cost, so it absorbs the measured load spread with headroom,
    // while still being short enough to fail a genuinely hung query rather than
    // hang a CI job.
    //
    // Do NOT reintroduce inline `it(fn, ms)` / `beforeAll(fn, ms)` budgets to fix
    // a slow test: an inline argument silently overrides both this value and the
    // `--testTimeout` CLI flag. Config level only.
    testTimeout: 30000,
    isolate: true,
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    pool: "forks",
    sequence: {
      concurrent: false,
      hooks: "list",
    },
    setupFiles: ["./src/__tests__/setup-supertest.ts"],
  },
});
