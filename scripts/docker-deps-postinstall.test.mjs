import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Companion to `scripts/check-docker-deps-stage.mjs`.
//
// The deps stage in the Dockerfile copies manifests and then runs
// `pnpm install`, which executes each package's `postinstall` before anything
// is compiled. `check-docker-deps-stage.mjs` proves that every workspace
// manifest is copied; this test proves the postinstall half of the same
// contract: whatever `pnpm install` will execute in that stage has its script
// body present at install time, so the dependency layer cannot fail with
// ENOENT or silently skip an asset step.
//
// This repository currently declares no `postinstall` in a workspace package
// that the deps stage installs. The invariant is still enforced rather than
// dropped: adding one without copying its script into the stage fails here.

const repo = fileURLToPath(new URL("../", import.meta.url));

function extractDepsStage(dockerfileText) {
  const lines = dockerfileText.split("\n");
  const captured = [];
  let inDeps = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!inDeps) {
      if (/^FROM\s+.*\s+AS\s+deps$/i.test(trimmed)) inDeps = true;
      continue;
    }
    if (/^FROM\s/i.test(trimmed)) break;
    captured.push(line);
  }

  return captured.join("\n");
}

function installIndex(depsStageLines) {
  return depsStageLines.findIndex((line) => /^RUN\s+pnpm\s+install\b/.test(line.trim()));
}

function parseCopySources(lines) {
  const sources = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith("COPY ")) continue;
    const tokens = line.split(/\s+/).slice(1).filter((token) => !token.startsWith("--"));
    if (tokens.length < 2) continue;
    sources.push(...tokens.slice(0, -1));
  }
  return sources;
}

function globToRegExp(pattern) {
  let regex = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      regex += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      regex += "[^/]*";
      continue;
    }
    if (char === "?") {
      regex += "[^/]";
      continue;
    }
    regex += /[|\\{}()[\]^$+?.]/.test(char) ? `\\${char}` : char;
  }
  return new RegExp(`^${regex}$`);
}

async function readManifest(relativePath) {
  const manifest = JSON.parse(await readFile(path.join(repo, relativePath), "utf8"));
  return { manifest, postinstall: manifest.scripts?.postinstall };
}

test("the deps stage installs every workspace package that declares a postinstall", async () => {
  const dockerfile = await readFile(path.join(repo, "Dockerfile"), "utf8");
  const depsStage = extractDepsStage(dockerfile);
  assert.ok(depsStage.trim(), "expected a `FROM ... AS deps` stage in the Dockerfile");

  const lines = depsStage.split("\n");
  const installAt = installIndex(lines);
  assert.ok(installAt > -1, "expected `RUN pnpm install` in the deps stage");

  const copySources = parseCopySources(lines.slice(0, installAt));
  const copyMatchers = copySources.map(globToRegExp);

  // Walk the workspace the same way the checker does, so a postinstall added
  // to any installed package is in scope.
  const manifests = execFileSync("git", ["ls-files", "*/package.json", "package.json"], {
    cwd: repo,
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => file.endsWith("package.json"))
    .filter((file) => !file.includes("node_modules/"))
    .filter((file) => !file.includes("/examples/"))
    .filter((file) => !file.includes("/create-paperclip-plugin/"));

  let declared = 0;
  for (const manifestPath of manifests) {
    const { postinstall } = await readManifest(manifestPath);
    if (!postinstall) continue;
    declared += 1;

    const covered = copyMatchers.some((regex) => regex.test(manifestPath));
    assert.ok(
      covered,
      `${manifestPath} declares postinstall "${postinstall}" but the Dockerfile deps stage does not copy its manifest`,
    );

    const scriptToken = postinstall.split(/\s+/).find((token) => token.endsWith(".mjs") || token.endsWith(".js") || token.endsWith(".cjs"));
    if (!scriptToken) continue;
    // `node scripts/x.mjs` is resolved relative to the package directory, so
    // the script has to be copied into the stage next to the manifest.
    const packageDir = path.posix.dirname(manifestPath);
    const scriptPath = path.posix.join(packageDir, scriptToken);
    assert.ok(
      copyMatchers.some((regex) => regex.test(scriptPath)),
      `${manifestPath} runs "${postinstall}" during install but the Dockerfile deps stage never copies ${scriptPath}`,
    );
  }

  if (declared === 0) {
    console.log(
      "no installed workspace package declares postinstall today; coverage invariant re-checked against the deps stage anyway",
    );
  }
});

test("dependency-layer inputs can run every declared postinstall before compilation", async () => {
  const dockerfile = await readFile(path.join(repo, "Dockerfile"), "utf8");
  const lines = extractDepsStage(dockerfile).split("\n");
  const installAt = installIndex(lines);
  assert.ok(installAt > -1, "expected `RUN pnpm install` in the deps stage");

  const fixture = await mkdtemp(path.join(tmpdir(), "paperclip-docker-postinstall-"));
  try {
    const copied = [];
    for (const rawLine of lines.slice(0, installAt)) {
      const line = rawLine.trim();
      if (!line.startsWith("COPY ") || line.includes("--")) continue;
      const tokens = line.split(/\s+/).slice(1);
      const destination = tokens.pop();
      for (const source of tokens) {
        const absoluteSource = path.join(repo, source);
        if (!existsSync(absoluteSource)) continue;
        assert.ok(destination.endsWith("/"), "fixture supports directory COPY destinations");
        const target = path.join(fixture, destination, path.basename(source));
        await mkdir(path.dirname(target), { recursive: true });
        await cp(absoluteSource, target, { recursive: true });
        copied.push(source);
      }
    }

    // Prove the reconstruction is real before asserting anything about it.
    assert.ok(copied.includes("server/package.json"), "deps stage must copy server/package.json before installing");
    assert.ok(copied.includes("pnpm-workspace.yaml"), "deps stage must copy pnpm-workspace.yaml before installing");

    let executed = 0;
    for (const source of copied.filter((entry) => entry.endsWith("/package.json"))) {
      const cwd = path.join(fixture, path.dirname(source));
      const manifest = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8"));
      const postinstall = manifest.scripts?.postinstall;
      if (!postinstall) continue;

      const [command, ...args] = postinstall.split(/\s+/);
      assert.equal(command, "node", `postinstall "${postinstall}" must be runnable by node in the deps stage`);
      const output = execFileSync(process.execPath, args, { cwd, encoding: "utf8", timeout: 60_000 });
      assert.equal(typeof output, "string");
      executed += 1;
    }

    if (executed === 0) {
      console.log(
        "deps stage inputs reconstructed and verified; no postinstall to execute in this tree",
      );
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
