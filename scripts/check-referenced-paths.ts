#!/usr/bin/env tsx
/**
 * check-referenced-paths — repo hygiene control (RBR-786)
 *
 * Fails when a path referenced by `package.json` "scripts" is missing from
 * disk or missing from git. These are the two failure modes that produced
 * RBR-783 and RBR-786:
 *
 *   1. NOT IN GIT — the file exists on the author's disk but was never
 *      committed. Everything works locally; a clean clone of `main` fails.
 *      This was RBR-783 (`src/ai/`, 9 x `src/drata/` entrypoints).
 *
 *   2. NOT ON DISK — the script points at a file that exists nowhere, in the
 *      worktree or in history. `npm run <script>` is dead on arrival for
 *      everyone including the author. This was `drata:sync` (RBR-786).
 *
 * Both are invisible to `tsc --noEmit` and to `npm run build`, because
 * neither compiler ever resolves an npm script's argv. That is why this needs
 * to be its own check.
 *
 * Usage:
 *   npm run check:paths          # exit 1 on any violation
 *
 * Wire into CI and .git/hooks/pre-push. Install the hook with:
 *   npm run hooks:install
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Extensions we treat as "this is a file path the script needs at runtime". */
const RUNTIME_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".sh", ".py"];

/**
 * Paths that are legitimately absent from git — build output, generated
 * artifacts, and anything else a script is expected to *create* rather than
 * read. Matched as prefixes against the repo-relative path.
 */
const IGNORED_PREFIXES = ["dist/", "build/", "node_modules/", "data/"];

interface Violation {
  script: string;
  command: string;
  path: string;
  reason: "not-on-disk" | "not-in-git" | "not-a-file";
}

/** Every path git knows about, as a set of repo-relative paths. */
function gitTrackedFiles(): Set<string> {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return new Set(out.split("\0").filter(Boolean));
}

/**
 * Pull candidate file paths out of a shell command string.
 *
 * Deliberately conservative: a token only counts as a path if it carries a
 * known runtime extension and is not a flag, a URL, or an npm package
 * specifier. Over-matching here turns the check into noise that people
 * disable, which is worse than not having it.
 */
function extractPaths(command: string): string[] {
  const tokens = command.split(/\s+/);
  const found: string[] = [];

  for (const raw of tokens) {
    const token = raw.replace(/^['"]|['"]$/g, "");
    if (!token || token.startsWith("-")) continue;
    if (token.includes("://")) continue;
    // npm/npx package specifiers, not paths: `@scope/pkg`, `tsx`, `eslint`
    if (token.startsWith("@")) continue;
    if (!RUNTIME_EXTENSIONS.some((ext) => token.endsWith(ext))) continue;
    // A bare `foo.sh` with no separator is ambiguous; require a path shape.
    if (!token.includes("/")) continue;
    found.push(token.replace(/^\.\//, ""));
  }

  return found;
}

function isIgnored(path: string): boolean {
  return IGNORED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function main(): void {
  const pkgPath = resolve(REPO_ROOT, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  const scripts = pkg.scripts ?? {};
  const tracked = gitTrackedFiles();

  const violations: Violation[] = [];
  let checked = 0;

  for (const [script, command] of Object.entries(scripts)) {
    for (const path of extractPaths(command)) {
      if (isIgnored(path)) continue;
      checked += 1;

      const absolute = resolve(REPO_ROOT, path);
      // Keep the check inside the repo; a script may legitimately shell out
      // to an absolute system path, which is not ours to police.
      if (relative(REPO_ROOT, absolute).startsWith("..")) continue;

      if (!existsSync(absolute)) {
        violations.push({ script, command, path, reason: "not-on-disk" });
        continue;
      }
      if (!statSync(absolute).isFile()) {
        violations.push({ script, command, path, reason: "not-a-file" });
        continue;
      }
      if (!tracked.has(path)) {
        violations.push({ script, command, path, reason: "not-in-git" });
      }
    }
  }

  if (violations.length === 0) {
    console.log(
      `check-referenced-paths: OK — ${checked} referenced path(s) across ` +
        `${Object.keys(scripts).length} npm script(s) exist on disk and in git.`,
    );
    return;
  }

  console.error(
    `check-referenced-paths: FAIL — ${violations.length} of ${checked} ` +
      `referenced path(s) are broken.\n`,
  );

  for (const v of violations) {
    console.error(`  npm run ${v.script}`);
    console.error(`    command: ${v.command}`);
    console.error(`    path:    ${v.path}`);
    switch (v.reason) {
      case "not-on-disk":
        console.error(
          "    problem: does not exist on disk or in git. Restore the file, " +
            "or remove the script entry.",
        );
        break;
      case "not-in-git":
        console.error(
          "    problem: exists on disk but is NOT COMMITTED. A clean clone " +
            "of this branch cannot run it. Run `git add` on it.",
        );
        break;
      case "not-a-file":
        console.error("    problem: path resolves to a directory, not a file.");
        break;
    }
    console.error("");
  }

  process.exit(1);
}

main();
