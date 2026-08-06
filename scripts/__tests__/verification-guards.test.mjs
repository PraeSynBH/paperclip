// RBR-937 — guards that keep verification honest and affordable.
//
// These tests deliberately use `node --test` rather than vitest: the whole point
// of RBR-937 is that expensive DB-backed verification does not fit in one agent
// run, so the guards protecting that path must themselves be cheap to verify.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const detachedVerify = path.join(repoRoot, "scripts", "detached-verify.sh");
const runVitestStable = path.join(repoRoot, "scripts", "run-vitest-stable.mjs");

const {
  ZeroMatchFilterError,
  assertFiltersMatchTestFiles,
  collectTestFiles,
  extractPositionalFilters,
  filterMatchesTestFile,
  findSimilarTestFiles,
} = await import(path.join(repoRoot, "scripts", "vitest-filter-guard.mjs"));

const { classifyNodeEnv, classifyNodeModules, classifyWorkspaceProvisioning, runPreflight, formatPreflightReport } =
  await import(path.join(repoRoot, "scripts", "preflight-test-env.mjs"));

function tempDir(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// AC3 — an explicit filter matching zero files is a hard failure
// ---------------------------------------------------------------------------

test("AC3: a filter matching zero test files throws rather than passing silently", () => {
  const testFiles = ["server/src/__tests__/issue-thread-interactions-service.test.ts"];

  assert.throws(
    () => assertFiltersMatchTestFiles(["server/src/__tests__/deleted-suite.test.ts"], testFiles),
    ZeroMatchFilterError,
  );
});

test("AC3: the RBR-912 regression — a deleted suite folded into another file is caught", () => {
  // The real incident: a report cited a suite that had been folded into the
  // service suite. Vitest ran the one filter that matched, exited 0, and the
  // green run did not prove the cited tests ran.
  const testFiles = [
    "server/src/__tests__/issue-thread-interactions-service.test.ts",
    "server/src/__tests__/issue-thread-interactions-telemetry.test.ts",
  ];
  const filters = [
    "server/src/__tests__/issue-thread-interactions-service.test.ts",
    "server/src/__tests__/issue-thread-interactions-supersession.test.ts", // deleted
  ];

  let error;
  try {
    assertFiltersMatchTestFiles(filters, testFiles);
  } catch (thrown) {
    error = thrown;
  }

  assert.ok(error instanceof ZeroMatchFilterError, "expected a ZeroMatchFilterError");

  // Only the stale filter is reported, and it names the survivor as the likely target.
  assert.equal(error.zeroMatchFilters.length, 1);
  assert.match(error.zeroMatchFilters[0].filter, /supersession/);
  assert.ok(
    error.zeroMatchFilters[0].suggestions.some((s) => s.includes("issue-thread-interactions")),
    `expected a nearby-suite suggestion, got ${JSON.stringify(error.zeroMatchFilters[0].suggestions)}`,
  );
});

test("AC3: filters that all match are returned with their resolutions", () => {
  const testFiles = ["a/foo.test.ts", "b/foo.test.ts", "b/bar.test.ts"];
  const resolved = assertFiltersMatchTestFiles(["foo.test.ts", "b/bar"], testFiles);

  assert.equal(resolved.length, 2);
  assert.deepEqual(resolved[0].matches, ["a/foo.test.ts", "b/foo.test.ts"]);
  assert.deepEqual(resolved[1].matches, ["b/bar.test.ts"]);
});

test("AC3: vitest substring-filter semantics are mirrored, including ./ prefixes", () => {
  assert.ok(filterMatchesTestFile("foo.test.ts", "server/src/foo.test.ts"));
  assert.ok(filterMatchesTestFile("./server/src/foo.test.ts", "server/src/foo.test.ts"));
  assert.ok(filterMatchesTestFile("src/foo", "server/src/foo.test.ts"));
  assert.ok(!filterMatchesTestFile("nope", "server/src/foo.test.ts"));
  assert.ok(!filterMatchesTestFile("", "server/src/foo.test.ts"));
});

test("AC3: flags and their values are never mistaken for positional filters", () => {
  const filters = extractPositionalFilters([
    "run",
    "--project",
    "@paperclipai/server",
    "--no-file-parallelism",
    "--maxWorkers=1",
    "--exclude",
    "src/skipped.test.ts",
    "-t",
    "some test name",
    "server/src/__tests__/real.test.ts",
  ]);

  assert.deepEqual(filters, ["server/src/__tests__/real.test.ts"]);
});

test("AC3: --shard and --reporter values are not treated as filters", () => {
  assert.deepEqual(extractPositionalFilters(["--shard", "1/3", "--reporter", "json"]), []);
});

test("AC3: no filters at all is not an error (a full-suite run is legitimate)", () => {
  assert.deepEqual(extractPositionalFilters(["run", "--project", "@paperclipai/server"]), []);
  assert.deepEqual(assertFiltersMatchTestFiles([], ["a/foo.test.ts"]), []);
});

test("AC3: collectTestFiles skips node_modules and dist", () => {
  const root = tempDir("rbr937-collect-");
  try {
    mkdirSync(path.join(root, "src"), { recursive: true });
    mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
    mkdirSync(path.join(root, "dist"), { recursive: true });
    writeFileSync(path.join(root, "src", "real.test.ts"), "");
    writeFileSync(path.join(root, "src", "notatest.ts"), "");
    writeFileSync(path.join(root, "node_modules", "pkg", "vendored.test.ts"), "");
    writeFileSync(path.join(root, "dist", "built.test.js"), "");

    assert.deepEqual(collectTestFiles(root), ["src/real.test.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC3: findSimilarTestFiles ignores noise tokens instead of suggesting everything", () => {
  const testFiles = ["server/src/__tests__/totally-unrelated.test.ts"];
  assert.deepEqual(findSimilarTestFiles("a.test.ts", testFiles), []);
});

test("AC3: the guard CLI exits non-zero on a zero-match filter", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, "scripts", "vitest-filter-guard.mjs"), "definitely-not-a-real-suite-rbr937.test.ts"],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.stderr}`);
  assert.match(result.stderr, /matched 0 test files/);
});

test("AC3: the guard CLI exits 0 for a filter that resolves", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, "scripts", "vitest-filter-guard.mjs"), "scripts/__tests__/verification-guards.test.mjs"],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
});

test("AC3: the real test lane refuses to launch vitest on a stale filter", () => {
  // End-to-end: the guard is wired into run-vitest-stable.mjs, so a stale suite
  // name fails before vitest starts (no embedded Postgres boot is paid).
  const result = spawnSync(
    process.execPath,
    [
      runVitestStable,
      "--mode",
      "serialized",
      "--shard-index",
      "0",
      "--shard-count",
      "1",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "test" },
      timeout: 60_000,
    },
  );

  // This lane derives its own suite list from disk, so it must NOT trip the
  // guard. Guarding against a false positive is as important as the catch.
  assert.doesNotMatch(result.stdout + result.stderr, /matched 0 test files/);
});

// ---------------------------------------------------------------------------
// AC2 — environment landmines report as SETUP BLOCKERS, not test failures
// ---------------------------------------------------------------------------

test("AC2: NODE_ENV=production is fatal for an install lane", () => {
  const check = classifyNodeEnv("production", "install");
  assert.equal(check.ok, false);
  assert.equal(check.code, "node_env_production");
  assert.match(check.message, /devDependencies/);
  assert.match(check.remedy, /NODE_ENV=test/);
});

test("AC2: NODE_ENV=production is tolerated-with-warning for a test lane that forces NODE_ENV=test", () => {
  // run-vitest-stable.mjs spawns vitest with NODE_ENV=test, so the inherited
  // production value cannot break it. Reporting a blocker here would be a false
  // blocker, which costs an agent run just as surely as a silent failure.
  const check = classifyNodeEnv("production", "test");
  assert.equal(check.ok, true);
  assert.equal(check.severity, "warning");
  assert.equal(check.code, "node_env_production_tolerated");
});

test("AC2: a sane NODE_ENV passes cleanly", () => {
  assert.equal(classifyNodeEnv("test", "install").ok, true);
  assert.equal(classifyNodeEnv("development", "install").ok, true);
  assert.equal(classifyNodeEnv(undefined, "install").nodeEnv, "(unset)");
});

test("AC2: a missing node_modules is a setup blocker", () => {
  const root = tempDir("rbr937-nm-missing-");
  try {
    const check = classifyNodeModules(root);
    assert.equal(check.ok, false);
    assert.equal(check.code, "node_modules_missing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC2: the RBR-912 regression — an empty node_modules is a setup blocker, not a test failure", () => {
  const root = tempDir("rbr937-nm-empty-");
  try {
    mkdirSync(path.join(root, "node_modules"));
    const check = classifyNodeModules(root);
    assert.equal(check.ok, false);
    assert.equal(check.code, "node_modules_empty");
    assert.match(check.message, /completely empty/);
    assert.match(check.remedy, /pnpm install/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC2: node_modules without .modules.yaml is a half-provisioned tree", () => {
  const root = tempDir("rbr937-nm-partial-");
  try {
    mkdirSync(path.join(root, "node_modules", "some-pkg"), { recursive: true });
    const check = classifyNodeModules(root);
    assert.equal(check.ok, false);
    assert.equal(check.code, "node_modules_no_manifest");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC2: a production-install signature (no vitest bin) is named as such", () => {
  const root = tempDir("rbr937-nm-nobin-");
  try {
    mkdirSync(path.join(root, "node_modules"), { recursive: true });
    writeFileSync(path.join(root, "node_modules", ".modules.yaml"), "");
    const check = classifyNodeModules(root);
    assert.equal(check.ok, false);
    assert.equal(check.code, "dev_dependency_bins_missing");
    assert.match(check.message, /NODE_ENV=production/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC2: a fully provisioned tree passes", () => {
  const root = tempDir("rbr937-nm-ok-");
  try {
    mkdirSync(path.join(root, "node_modules", ".bin"), { recursive: true });
    writeFileSync(path.join(root, "node_modules", ".modules.yaml"), "");
    writeFileSync(path.join(root, "node_modules", ".bin", "vitest"), "");
    const check = classifyNodeModules(root);
    assert.equal(check.ok, true);
    assert.equal(check.code, "node_modules_ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC2: the blocker report says 'NOT a test failure' in so many words", () => {
  const root = tempDir("rbr937-report-");
  try {
    mkdirSync(path.join(root, "node_modules"));
    const result = runPreflight(root, { NODE_ENV: "production" }, { lane: "install" });
    assert.equal(result.ok, false);

    const report = formatPreflightReport(result);
    assert.match(report, /SETUP BLOCKER/);
    assert.match(report, /NOT a test failure/);
    assert.match(report, /Do not report the change under test as broken/);
    // Both landmines are surfaced together rather than one-at-a-time.
    assert.match(report, /node_env_production/);
    assert.match(report, /node_modules_empty/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC2: preflight exits with the distinct setup-blocker code 3, not vitest's 1", () => {
  const root = tempDir("rbr937-exit3-");
  try {
    mkdirSync(path.join(root, "node_modules"));
    const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "preflight-test-env.mjs")], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PAPERCLIP_REPO_ROOT: root, NODE_ENV: "production" },
    });

    // 3 is deliberately distinct from 1 (tests failed) so callers can branch.
    assert.equal(result.status, 3, `expected exit 3, got ${result.status}: ${result.stderr}`);
    assert.match(result.stderr, /SETUP BLOCKER/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC2: a pnpm workspace package with deps but no node_modules is a setup blocker", () => {
  // The RBR-937 self-inflicted case: root node_modules looked healthy, every
  // workspace tree was bare, and `tsc` emitted 40+ "Cannot find module 'zod'"
  // errors that were recorded as a verification FAIL rather than a setup blocker.
  const root = tempDir("rbr937-ws-bare-");
  try {
    mkdirSync(path.join(root, "server"), { recursive: true });
    writeFileSync(
      path.join(root, "server", "package.json"),
      JSON.stringify({ name: "server", dependencies: { zod: "^3" } }),
    );

    const check = classifyWorkspaceProvisioning(root, { packages: ["server"] });
    assert.equal(check.ok, false);
    assert.equal(check.code, "workspace_packages_unprovisioned");
    assert.deepEqual(check.unprovisioned, ["server"]);
    assert.match(check.message, /Cannot find module/);
    assert.match(check.remedy, /pnpm install/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC2: a provisioned workspace package passes", () => {
  const root = tempDir("rbr937-ws-ok-");
  try {
    mkdirSync(path.join(root, "server", "node_modules"), { recursive: true });
    writeFileSync(
      path.join(root, "server", "package.json"),
      JSON.stringify({ name: "server", dependencies: { zod: "^3" } }),
    );

    assert.equal(classifyWorkspaceProvisioning(root, { packages: ["server"] }).ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC2: a dependency-free workspace package never raises a false blocker", () => {
  // A false setup blocker costs an agent run just as surely as a silent failure.
  const root = tempDir("rbr937-ws-nodeps-");
  try {
    mkdirSync(path.join(root, "server"), { recursive: true });
    writeFileSync(path.join(root, "server", "package.json"), JSON.stringify({ name: "server" }));

    assert.equal(classifyWorkspaceProvisioning(root, { packages: ["server"] }).ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC2: an absent workspace package is skipped rather than reported", () => {
  const root = tempDir("rbr937-ws-absent-");
  try {
    assert.equal(classifyWorkspaceProvisioning(root, { packages: ["server"] }).ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC2: preflight on this repo reports only real, actionable environment state", () => {
  // Deliberately not asserting exit 0: an agent worktree may legitimately be
  // unprovisioned. What must hold is that the verdict is honest — a clean tree
  // exits 0, and an unprovisioned one exits 3 naming a provisioning blocker,
  // never some unrelated code and never vitest's 1.
  const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "preflight-test-env.mjs")], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.ok([0, 3].includes(result.status), `expected exit 0 or 3, got ${result.status}: ${result.stderr}`);

  if (result.status === 3) {
    assert.match(result.stderr, /SETUP BLOCKER/);
    assert.match(result.stderr, /node_modules|workspace_packages_unprovisioned/);
  } else {
    assert.match(result.stdout, /OK — environment can run tests/);
  }
});

// ---------------------------------------------------------------------------
// AC1 — the detached harness outlives the run that started it
// ---------------------------------------------------------------------------

function detached(args, env = {}) {
  return spawnSync("bash", [detachedVerify, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 120_000,
  });
}

test("AC1: start returns immediately and the job completes after the starter exits", () => {
  const root = tempDir("rbr937-dv-");
  const env = { PAPERCLIP_DETACHED_VERIFY_ROOT: root };
  try {
    const startedAt = Date.now();
    const start = detached(
      ["start", "--name", "ac1", "--", "bash", "-c", 'sleep 6; echo "  Tests  58 passed (58)"; exit 0'],
      env,
    );
    const startElapsed = Date.now() - startedAt;

    assert.equal(start.status, 0, `start failed: ${start.stderr}`);
    // The whole point: starting must not cost the caller the job's duration.
    assert.ok(startElapsed < 5000, `start should return promptly, took ${startElapsed}ms`);

    // Immediately after start, the job is running — reported as exit 2, not a failure.
    const midStatus = detached(["status", "--name", "ac1"], env);
    assert.equal(midStatus.status, 2, `expected RUNNING (2), got ${midStatus.status}`);
    assert.match(midStatus.stderr, /STILL RUNNING/);

    // A later "wake" reads the durable artifact.
    const finished = detached(["wait", "--name", "ac1", "--timeout", "60"], env);
    assert.equal(finished.status, 0, `expected PASS (0), got ${finished.status}: ${finished.stdout}`);
    assert.match(finished.stdout, /RESULT: PASS/);
    assert.match(finished.stdout, /Tests {2}58 passed \(58\)/);

    // And reading it again is cheap and idempotent.
    const reportedAt = Date.now();
    const report = detached(["report", "--name", "ac1"], env);
    assert.equal(report.status, 0);
    assert.match(report.stdout, /RESULT: PASS/);
    assert.ok(Date.now() - reportedAt < 5000, "reading a durable result must be fast");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC1: a failing verification is reported as FAIL (exit 1) with the failing lines", () => {
  const root = tempDir("rbr937-dv-fail-");
  const env = { PAPERCLIP_DETACHED_VERIFY_ROOT: root };
  try {
    const start = detached(
      [
        "start",
        "--name",
        "ac1fail",
        "--",
        "bash",
        "-c",
        'echo "  Tests  3 failed | 55 passed (58)"; echo "AssertionError: expected 1 to be 2"; exit 1',
      ],
      env,
    );
    assert.equal(start.status, 0, `start failed: ${start.stderr}`);

    const report = detached(["wait", "--name", "ac1fail", "--timeout", "60"], env);
    assert.equal(report.status, 1, `expected FAIL (1), got ${report.status}: ${report.stdout}`);
    assert.match(report.stdout, /RESULT: FAIL \(exit 1\)/);
    assert.match(report.stdout, /AssertionError: expected 1 to be 2/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC4: a killed job reports UNVERIFIED (exit 3), never FAIL", () => {
  // This is the AC4 contract at the harness level: losing the process is not
  // evidence the change is broken.
  const root = tempDir("rbr937-dv-killed-");
  const env = { PAPERCLIP_DETACHED_VERIFY_ROOT: root };
  try {
    const start = detached(["start", "--name", "ac4kill", "--", "bash", "-c", "sleep 120"], env);
    assert.equal(start.status, 0, `start failed: ${start.stderr}`);

    const meta = JSON.parse(
      spawnSync("cat", [path.join(root, "ac4kill", "meta.json")], { encoding: "utf8" }).stdout,
    );
    assert.ok(meta.pid > 0, "expected a recorded pid");
    spawnSync("kill", ["-9", String(meta.pid)]);

    // Give the kill a moment to land.
    spawnSync("sleep", ["2"]);

    const status = detached(["status", "--name", "ac4kill"], env);
    assert.equal(status.status, 3, `expected SETUP BLOCKER (3), got ${status.status}: ${status.stderr}`);
    assert.match(status.stderr, /UNVERIFIED, not failed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC1: an unknown job is exit 4, distinct from both pass and fail", () => {
  const root = tempDir("rbr937-dv-none-");
  try {
    const status = detached(["status", "--name", "never-started"], {
      PAPERCLIP_DETACHED_VERIFY_ROOT: root,
    });
    assert.equal(status.status, 4);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC1: start refuses to launch a second copy of a live job", () => {
  const root = tempDir("rbr937-dv-dup-");
  const env = { PAPERCLIP_DETACHED_VERIFY_ROOT: root };
  try {
    assert.equal(detached(["start", "--name", "dup", "--", "bash", "-c", "sleep 30"], env).status, 0);

    const second = detached(["start", "--name", "dup", "--", "bash", "-c", "sleep 30"], env);
    assert.equal(second.status, 2, "a second start must report RUNNING, not clobber the first");
    assert.match(second.stderr, /already running/);
  } finally {
    // Clean up the sleeper so it does not outlive the test run.
    try {
      const meta = JSON.parse(
        spawnSync("cat", [path.join(root, "dup", "meta.json")], { encoding: "utf8" }).stdout,
      );
      if (meta.pid) spawnSync("kill", ["-9", String(meta.pid)]);
    } catch {
      // best effort
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC1: a verification command containing shell metacharacters survives round-tripping", () => {
  const root = tempDir("rbr937-dv-quote-");
  const env = { PAPERCLIP_DETACHED_VERIFY_ROOT: root };
  try {
    // Quoting bugs in a harness like this fail *open* — the command silently
    // becomes something else and the result is meaningless.
    const start = detached(
      ["start", "--name", "quoting", "--", "bash", "-c", 'echo "a b&c;d $HOME \'q\'"; exit 0'],
      env,
    );
    assert.equal(start.status, 0, `start failed: ${start.stderr}`);

    const report = detached(["wait", "--name", "quoting", "--timeout", "60"], env);
    assert.equal(report.status, 0, `expected PASS, got ${report.status}: ${report.stdout}`);

    const log = spawnSync("cat", [path.join(root, "quoting", "run.log")], { encoding: "utf8" }).stdout;
    assert.match(log, /a b&c;d/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC1: the runner forces NODE_ENV=test even when started under production", () => {
  const root = tempDir("rbr937-dv-env-");
  const env = { PAPERCLIP_DETACHED_VERIFY_ROOT: root, NODE_ENV: "production" };
  try {
    const start = detached(
      ["start", "--name", "envcheck", "--", "bash", "-c", 'echo "NODE_ENV=$NODE_ENV"; exit 0'],
      env,
    );
    assert.equal(start.status, 0, `start failed: ${start.stderr}`);

    assert.equal(detached(["wait", "--name", "envcheck", "--timeout", "60"], env).status, 0);

    const log = spawnSync("cat", [path.join(root, "envcheck", "run.log")], { encoding: "utf8" }).stdout;
    assert.match(log, /NODE_ENV=test/);
    assert.doesNotMatch(log, /NODE_ENV=production/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC1: a non-node verification is not gated on the node test environment", () => {
  // Regression: the runner used to run the node preflight for EVERY command, so a
  // shell verification in an unprovisioned tree was reported as a SETUP BLOCKER
  // it had nothing to do with. A false blocker costs a run like any other lie.
  const root = tempDir("rbr937-dv-nonnode-");
  const env = { PAPERCLIP_DETACHED_VERIFY_ROOT: root };
  try {
    const start = detached(["start", "--name", "shellonly", "--", "bash", "-c", 'echo hi; exit 0'], env);
    assert.equal(start.status, 0, `start failed: ${start.stderr}`);

    const report = detached(["wait", "--name", "shellonly", "--timeout", "60"], env);
    assert.equal(report.status, 0, `expected PASS, got ${report.status}: ${report.stdout}`);
    assert.doesNotMatch(report.stdout, /SETUP BLOCKER/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC1: --no-preflight lets a node command opt out of the env gate", () => {
  const root = tempDir("rbr937-dv-nopf-");
  const env = { PAPERCLIP_DETACHED_VERIFY_ROOT: root };
  try {
    const start = detached(
      ["start", "--name", "nopf", "--no-preflight", "--", "node", "-e", "console.log('ok')"],
      env,
    );
    assert.equal(start.status, 0, `start failed: ${start.stderr}`);

    const report = detached(["wait", "--name", "nopf", "--timeout", "60"], env);
    assert.equal(report.status, 0, `expected PASS, got ${report.status}: ${report.stdout}`);
    assert.doesNotMatch(report.stdout, /SETUP BLOCKER/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC1: usage output is not truncated as the header grows", () => {
  // The header block is the harness's only documentation; a hardcoded sed range
  // used to cut it off mid-sentence when new flags were added.
  const help = detached(["--help"]);
  assert.equal(help.status, 64, `expected usage exit 64, got ${help.status}`);
  assert.match(help.stdout, /--no-preflight/);
  assert.match(help.stdout, /Status 3 exists/);
});

test("AC1: list reports running and completed jobs distinctly", () => {
  const root = tempDir("rbr937-dv-list-");
  const env = { PAPERCLIP_DETACHED_VERIFY_ROOT: root };
  try {
    assert.equal(detached(["start", "--name", "done-job", "--", "bash", "-c", "exit 0"], env).status, 0);
    assert.equal(detached(["wait", "--name", "done-job", "--timeout", "30"], env).status, 0);

    const list = detached(["list"], env);
    assert.equal(list.status, 0);
    assert.match(list.stdout, /done-job\s+complete \(exit 0\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
