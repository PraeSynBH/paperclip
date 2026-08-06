#!/usr/bin/env node
// RBR-937 AC3: an explicit vitest filter that matches zero test files must be a
// hard failure, not a silent pass.
//
// Why this exists: vitest treats positional CLI arguments as *substring filters*
// against test file paths. A filter that matches nothing is silently ignored. If
// you pass two filters and only one resolves, vitest runs the one that matched
// and exits 0 — so "tests passed" can mean "the suite I actually cited never
// ran". RBR-912 hit exactly this: a report cited
// `issue-thread-interactions-supersession.test.ts`, which had already been
// deleted and folded into the service suite. The filter matched nothing, vitest
// said nothing, and the run reported success.
//
// Usage as a CLI (exit 1 with a listed reason on any zero-match filter):
//   node scripts/vitest-filter-guard.mjs server/src/__tests__/foo.test.ts
//
// Usage as a module: see assertFiltersMatchTestFiles.

import { readdirSync, statSync } from "node:fs";
import path from "node:path";

export const TEST_FILE_SUFFIXES = [".test.ts", ".test.tsx", ".test.mts", ".test.js", ".test.mjs"];

const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".turbo",
  ".vite",
  ".worktrees",
  "coverage",
  "dist",
  "node_modules",
]);

// Vitest option flags that consume the following argv entry, so we do not
// mistake their values for positional filters.
const VALUE_FLAGS = new Set([
  "--config",
  "--exclude",
  "--hookTimeout",
  "--maxWorkers",
  "--minWorkers",
  "--mode",
  "--outputFile",
  "--pool",
  "--project",
  "--reporter",
  "--retry",
  "--shard",
  "--testNamePattern",
  "--testTimeout",
  "-t",
]);

function toPosix(value) {
  return value.split(path.sep).join("/");
}

export function isTestFilePath(filePath) {
  const posix = toPosix(filePath);
  return TEST_FILE_SUFFIXES.some((suffix) => posix.endsWith(suffix));
}

/**
 * Collect every test file under `roots`, returned as paths relative to
 * `repoRoot` in posix form.
 */
export function collectTestFiles(repoRoot, roots = ["."]) {
  const found = new Set();

  const walk = (absoluteDir) => {
    let entries;
    try {
      entries = readdirSync(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
        walk(path.join(absoluteDir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const absolute = path.join(absoluteDir, entry.name);
      if (!isTestFilePath(absolute)) continue;
      found.add(toPosix(path.relative(repoRoot, absolute)));
    }
  };

  for (const root of roots) {
    const absoluteRoot = path.resolve(repoRoot, root);
    let stats;
    try {
      stats = statSync(absoluteRoot);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      walk(absoluteRoot);
      continue;
    }
    if (stats.isFile() && isTestFilePath(absoluteRoot)) {
      found.add(toPosix(path.relative(repoRoot, absoluteRoot)));
    }
  }

  return [...found].sort((a, b) => a.localeCompare(b));
}

/**
 * Mirror vitest's positional-filter semantics: a filter matches a test file when
 * the file path contains the filter as a substring. We additionally accept a
 * leading `./` and absolute paths inside the repo so agent-supplied paths behave
 * the way an agent expects.
 */
export function filterMatchesTestFile(filter, testFile) {
  const normalizedFile = toPosix(testFile);
  let normalizedFilter = toPosix(filter).trim();
  if (normalizedFilter === "") return false;
  if (normalizedFilter.startsWith("./")) normalizedFilter = normalizedFilter.slice(2);
  return normalizedFile.includes(normalizedFilter);
}

/**
 * Extract the positional filters from a vitest argv, ignoring flags, flag
 * values, and the `run`/`watch` subcommand.
 */
export function extractPositionalFilters(argv) {
  const filters = [];
  let sawSubcommand = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg.startsWith("-")) {
      if (VALUE_FLAGS.has(arg)) index += 1;
      continue;
    }
    if (!sawSubcommand && (arg === "run" || arg === "watch" || arg === "related" || arg === "bench")) {
      sawSubcommand = true;
      continue;
    }
    filters.push(arg);
  }

  return filters;
}

export function resolveFilterMatches(filters, testFiles) {
  return filters.map((filter) => ({
    filter,
    matches: testFiles.filter((testFile) => filterMatchesTestFile(filter, testFile)),
  }));
}

export function findSimilarTestFiles(filter, testFiles, limit = 5) {
  const basename = toPosix(filter).split("/").pop() ?? filter;
  const stem = basename.replace(/\.test\.[cm]?[jt]sx?$/, "").replace(/[^a-zA-Z0-9]+/g, " ").trim();
  const tokens = stem.split(/\s+/).filter((token) => token.length >= 4);
  if (tokens.length === 0) return [];

  return testFiles
    .map((testFile) => ({
      testFile,
      score: tokens.filter((token) => testFile.toLowerCase().includes(token.toLowerCase())).length,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.testFile.localeCompare(b.testFile))
    .slice(0, limit)
    .map((entry) => entry.testFile);
}

export class ZeroMatchFilterError extends Error {
  constructor(zeroMatchFilters) {
    const lines = zeroMatchFilters.map((entry) => {
      const suggestions =
        entry.suggestions.length > 0
          ? `\n      did you mean: ${entry.suggestions.join(", ")}`
          : "\n      no similarly named test file found";
      return `  - "${entry.filter}" matched 0 test files${suggestions}`;
    });
    super(
      "Explicit test filter(s) matched zero test files. Vitest would ignore these silently, " +
        "so a green run would not prove the cited tests ran.\n" +
        `${lines.join("\n")}`,
    );
    this.name = "ZeroMatchFilterError";
    this.zeroMatchFilters = zeroMatchFilters;
  }
}

/**
 * Throw when any supplied filter resolves to zero test files.
 * Returns the per-filter resolution when every filter matched at least one file.
 */
export function assertFiltersMatchTestFiles(filters, testFiles) {
  const resolved = resolveFilterMatches(filters, testFiles);
  const zeroMatch = resolved
    .filter((entry) => entry.matches.length === 0)
    .map((entry) => ({
      filter: entry.filter,
      suggestions: findSimilarTestFiles(entry.filter, testFiles),
    }));

  if (zeroMatch.length > 0) throw new ZeroMatchFilterError(zeroMatch);
  return resolved;
}

function main(argv) {
  const repoRoot = process.env.PAPERCLIP_REPO_ROOT ?? process.cwd();
  const filters = extractPositionalFilters(argv);
  if (filters.length === 0) {
    console.log("[filter-guard] no explicit filters supplied; nothing to verify");
    return 0;
  }

  const testFiles = collectTestFiles(repoRoot);
  try {
    const resolved = assertFiltersMatchTestFiles(filters, testFiles);
    for (const entry of resolved) {
      console.log(`[filter-guard] "${entry.filter}" -> ${entry.matches.length} test file(s)`);
    }
    return 0;
  } catch (error) {
    if (error instanceof ZeroMatchFilterError) {
      console.error(`[filter-guard] ${error.message}`);
      return 1;
    }
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
