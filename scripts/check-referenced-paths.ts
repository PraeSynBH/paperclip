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
 *   3. COMMAND NOT FOUND — the script's *binary* does not resolve, so it
 *      exits 127. `"lint": "eslint src/"` with eslint absent from
 *      devDependencies (RBR-786).
 *
 * All three are invisible to `tsc --noEmit` and to `npm run build`, because
 * neither ever resolves an npm script's argv. That is why this needs to be
 * its own check.
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

/** Shell builtins and control words that are never a resolvable binary. */
const SHELL_WORDS = new Set(["cd", "echo", "exit", "set", "export", "true", "false"]);

interface Violation {
  script: string;
  command: string;
  path: string;
  reason: "not-on-disk" | "not-in-git" | "not-a-file" | "command-not-found";
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

/**
 * The executable each `&&`/`||`/`;`/`|` segment invokes.
 *
 * A script can also be dead because the *binary* is missing, not just its
 * arguments — `"lint": "eslint src/"` with eslint absent from devDependencies
 * exits 127 for everyone. Same dangling-reference class as a missing file,
 * and equally invisible to tsc and to `npm run build`.
 */
function extractCommands(command: string): string[] {
  return command
    .split(/&&|\|\||[;|]/)
    .map((segment) => segment.trim().split(/\s+/)[0] ?? "")
    .map((token) => token.replace(/^['"]|['"]$/g, ""))
    // Skip env-var prefixes (FOO=bar cmd) and shell words.
    .filter((token) => token && !token.includes("=") && !SHELL_WORDS.has(token));
}

/** npm puts node_modules/.bin first on PATH, so resolve there before the system. */
function commandResolves(command: string): boolean {
  if (command.includes("/")) return existsSync(resolve(REPO_ROOT, command));
  if (existsSync(resolve(REPO_ROOT, "node_modules/.bin", command))) return true;
  try {
    // `command -v` needs a shell, but passing argv with shell:true is a
    // DEP0190 injection footgun — inline the (already-validated) token instead.
    execFileSync("/bin/sh", ["-c", `command -v -- "$1"`, "sh", command], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
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
    for (const binary of extractCommands(command)) {
      checked += 1;
      if (!commandResolves(binary)) {
        violations.push({ script, command, path: binary, reason: "command-not-found" });
      }
    }

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
      case "command-not-found":
        console.error(
          "    problem: command does not resolve — not in node_modules/.bin " +
            "and not on PATH. `npm run` exits 127. Add it to devDependencies, " +
            "or remove the script entry.",
        );
        break;
    }
    console.error("");
  }

  process.exit(1);
}

main();
