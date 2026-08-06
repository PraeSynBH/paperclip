import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // RBR-912: embedded Postgres boots ONCE per run in this globalSetup, and
    // suites clone a pre-migrated template database from it. That is what makes
    // the hook budget below payable — before this, every suite paid a ~50-90 s
    // cluster boot inside its own `beforeAll`.
    globalSetup: ["./src/__tests__/global-setup-embedded-postgres.ts"],
    // Suite hooks now only clone/drop a database, but under the loaded serial
    // shard (maxWorkers=1) a graceful Postgres shutdown or a slow template copy
    // can still cross vitest's default 10s hookTimeout, producing flaky "Hook
    // timed out in 10000ms" failures on CI. 30s is far above the observed
    // worst-case yet still catches a genuinely hung hook. teardownTimeout
    // mirrors it for the same reason.
    //
    // Do NOT reintroduce inline `beforeAll(fn, ms)` budgets in suites: an inline
    // argument silently overrides both this value and `--hookTimeout` on the
    // CLI, which is precisely the trap RBR-912 documents.
    hookTimeout: 30000,
    teardownTimeout: 30000,
    // The shared cluster boot is charged to globalSetup, not to a test file, and
    // it can take ~90s on a cold machine.
    globalSetupTimeout: 300000,
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
