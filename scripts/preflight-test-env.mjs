#!/usr/bin/env node
// RBR-937 AC2: report an unprovisioned / mis-enved test tree as a SETUP BLOCKER
// with a distinct exit code, instead of letting it surface as a test failure.
//
// Two landmines cost RBR-912 whole agent runs:
//
//  1. `NODE_ENV=production` is inherited from the Paperclip agent runtime. pnpm
//     then prints `devDependencies: skipped because NODE_ENV is set to
//     production` and omits vitest itself, so `pnpm exec vitest` dies with
//     `Command "vitest" not found`. That looks like a broken repo; it is an
//     inherited env var.
//  2. `node_modules` can be present but completely empty (no `.modules.yaml`,
//     no `.bin/vitest`). Every test then fails for reasons unrelated to the code
//     under test.
//
// Exit codes:
//   0  environment is usable
//   3  SETUP BLOCKER (distinct from vitest's 1 = tests failed)

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const SETUP_BLOCKER_EXIT_CODE = 3;

/**
 * Workspace packages whose `node_modules` must exist for a server-side
 * verification to mean anything. A pnpm workspace installs per-package trees, so
 * a populated ROOT `node_modules` does not imply the workspace is provisioned.
 */
export const CRITICAL_WORKSPACE_PACKAGES = ["server", "packages/shared"];

/** Deps whose absence makes running any test impossible. */
const REQUIRED_BIN_NAMES = ["vitest"];

/**
 * `NODE_ENV=production` is only fatal for lanes that *install*. A test lane that
 * spawns vitest with an explicit `NODE_ENV=test` (as `run-vitest-stable.mjs`
 * does) is unaffected by the inherited value, so blocking there would be a false
 * blocker — and a false setup blocker is exactly as expensive as the silent
 * failure this preflight exists to prevent.
 *
 * @param nodeEnv raw NODE_ENV value
 * @param lane "install" — the caller will run pnpm install, so production is fatal.
 *             "test"    — the caller forces NODE_ENV=test downstream; warn only.
 */
export function classifyNodeEnv(nodeEnv, lane = "test") {
  const normalized = (nodeEnv ?? "").trim();
  if (normalized !== "production") {
    return { ok: true, severity: "ok", code: "node_env_ok", nodeEnv: normalized || "(unset)" };
  }

  const message =
    "NODE_ENV=production is set (inherited from the agent runtime). pnpm skips devDependencies " +
    "under it and omits vitest, so `pnpm exec vitest` fails with `Command \"vitest\" not found`.";
  const remedy =
    "Run test lanes through `pnpm test:run` / `scripts/detached-verify.sh`, which force " +
    "NODE_ENV=test. If invoking vitest directly, prefix with `NODE_ENV=test`. Never `pnpm install` " +
    "with NODE_ENV=production in this repo.";

  if (lane === "install") {
    return { ok: false, severity: "blocker", code: "node_env_production", message, remedy };
  }

  return {
    ok: true,
    severity: "warning",
    code: "node_env_production_tolerated",
    message: `${message} This lane forces NODE_ENV=test for the test process, so it is survivable here.`,
    remedy,
  };
}

export function classifyNodeModules(repoRoot, { existsSyncImpl = existsSync, readdirSyncImpl = readdirSync } = {}) {
  const nodeModulesDir = path.join(repoRoot, "node_modules");
  if (!existsSyncImpl(nodeModulesDir)) {
    return {
      ok: false,
      severity: "blocker",
      code: "node_modules_missing",
      message: "node_modules/ does not exist — the workspace has never been provisioned.",
      remedy: "Run `NODE_ENV=test pnpm install` (or `bash scripts/detached-verify.sh --install`).",
    };
  }

  let entries = [];
  try {
    entries = readdirSyncImpl(nodeModulesDir);
  } catch (error) {
    return {
      ok: false,
      severity: "blocker",
      code: "node_modules_unreadable",
      message: `node_modules/ could not be read: ${error instanceof Error ? error.message : String(error)}`,
      remedy: "Check permissions, then run `NODE_ENV=test pnpm install`.",
    };
  }

  const meaningful = entries.filter((entry) => entry !== "." && entry !== "..");
  if (meaningful.length === 0) {
    return {
      ok: false,
      severity: "blocker",
      code: "node_modules_empty",
      message: "node_modules/ exists but is completely empty (0 entries) — dependencies were wiped.",
      remedy: "Run `NODE_ENV=test pnpm install` (or `bash scripts/detached-verify.sh --install`).",
    };
  }

  if (!meaningful.includes(".modules.yaml")) {
    return {
      ok: false,
      severity: "blocker",
      code: "node_modules_no_manifest",
      message:
        `node_modules/ has ${meaningful.length} entr${meaningful.length === 1 ? "y" : "ies"} but no ` +
        ".modules.yaml — pnpm did not finish provisioning this tree.",
      remedy: "Run `NODE_ENV=test pnpm install` (or `bash scripts/detached-verify.sh --install`).",
    };
  }

  const missingBins = REQUIRED_BIN_NAMES.filter(
    (bin) => !existsSyncImpl(path.join(nodeModulesDir, ".bin", bin)),
  );
  if (missingBins.length > 0) {
    return {
      ok: false,
      severity: "blocker",
      code: "dev_dependency_bins_missing",
      message:
        `node_modules/.bin is missing required dev binaries: ${missingBins.join(", ")}. ` +
        "This is the signature of an install performed under NODE_ENV=production.",
      remedy: "Re-run `NODE_ENV=test pnpm install` so devDependencies are materialized.",
    };
  }

  return { ok: true, severity: "ok", code: "node_modules_ok", entryCount: meaningful.length };
}

/**
 * A pnpm workspace materializes a `node_modules` tree per package. The root tree
 * can be fully populated while every workspace package is bare — which is
 * exactly the state that made RBR-937's own typecheck report
 * `Cannot find module 'zod'` across 40+ files and get recorded as a FAIL when it
 * was really an unprovisioned tree.
 *
 * Only a package that actually declares dependencies is required to have a
 * `node_modules`, so a dependency-free package never raises a false blocker.
 */
export function classifyWorkspaceProvisioning(
  repoRoot,
  {
    packages = CRITICAL_WORKSPACE_PACKAGES,
    existsSyncImpl = existsSync,
    readFileSyncImpl = readFileSync,
  } = {},
) {
  const unprovisioned = [];

  for (const pkg of packages) {
    const packageJsonPath = path.join(repoRoot, pkg, "package.json");
    if (!existsSyncImpl(packageJsonPath)) continue;

    let manifest;
    try {
      manifest = JSON.parse(readFileSyncImpl(packageJsonPath, "utf8"));
    } catch {
      continue;
    }

    const declaresDeps =
      Object.keys(manifest.dependencies ?? {}).length > 0 ||
      Object.keys(manifest.devDependencies ?? {}).length > 0;
    if (!declaresDeps) continue;

    if (!existsSyncImpl(path.join(repoRoot, pkg, "node_modules"))) unprovisioned.push(pkg);
  }

  if (unprovisioned.length > 0) {
    return {
      ok: false,
      severity: "blocker",
      code: "workspace_packages_unprovisioned",
      message:
        `Workspace package(s) have no node_modules despite declaring dependencies: ${unprovisioned.join(", ")}. ` +
        "The ROOT node_modules can look healthy while these are bare, so tsc/vitest fail with " +
        "'Cannot find module' errors that look like source defects.",
      remedy: "Run `NODE_ENV=test pnpm install` at the repo root to materialize every workspace tree.",
      unprovisioned,
    };
  }

  return { ok: true, severity: "ok", code: "workspace_packages_ok" };
}

export function runPreflight(repoRoot, env = process.env, deps = {}) {
  const lane = deps.lane ?? "test";
  const checks = [
    classifyNodeEnv(env.NODE_ENV, lane),
    classifyNodeModules(repoRoot, deps),
    classifyWorkspaceProvisioning(repoRoot, deps),
  ];
  const blockers = checks.filter((check) => !check.ok);
  const warnings = checks.filter((check) => check.ok && check.severity === "warning");
  return { ok: blockers.length === 0, lane, checks, blockers, warnings };
}

export function formatPreflightReport(result) {
  const lines = [];
  if (result.ok) {
    lines.push("[test-preflight] OK — environment can run tests.");
    for (const check of result.checks) {
      lines.push(`  - ${check.code}`);
    }
    for (const warning of result.warnings ?? []) {
      lines.push(`  ~ warning ${warning.code}: ${warning.message}`);
      lines.push(`    remedy: ${warning.remedy}`);
    }
    return lines.join("\n");
  }

  lines.push("[test-preflight] SETUP BLOCKER — this is an environment problem, NOT a test failure.");
  lines.push("[test-preflight] Do not report the change under test as broken on the basis of this exit.");
  for (const blocker of result.blockers) {
    lines.push(`  ! ${blocker.code}: ${blocker.message}`);
    lines.push(`    remedy: ${blocker.remedy}`);
  }
  return lines.join("\n");
}

function main(argv) {
  const repoRoot = process.env.PAPERCLIP_REPO_ROOT ?? process.cwd();
  const lane = argv.includes("--lane=install") ? "install" : "test";
  const result = runPreflight(repoRoot, process.env, { lane });
  if (argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const report = formatPreflightReport(result);
    if (result.ok) console.log(report);
    else console.error(report);
  }
  return result.ok ? 0 : SETUP_BLOCKER_EXIT_CODE;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
