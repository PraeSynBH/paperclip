#!/usr/bin/env node
// no-direct-log — CI check per RAM-311 §5.6.
// Forbids direct console.* calls outside server/src/logging/**.
// Scope: server/src only (CLI output, adapters, operator tools are governed separately).
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const DIR_LOG = [
  { pattern: /\bconsole\.(log|info|warn|error|debug|trace)\s*\(/g, msg: "direct console call — use LogFormation layer" },
  { pattern: /\bpino\s*\(/g, msg: "direct pino init — use LogFormation layer" },
];
const ALLOWED = [
  "server/src/logging/", "server/src/middleware/logger.ts",
  "server/src/instrumentation.ts",
  "server/src/startup-banner.ts",
  "server/src/app.ts",
  "server/src/index.ts",
  "server/src/adapters/registry.ts",
  "__tests__", ".test.", "node_modules", "dist/", "scripts/", "eslint", "check-no-direct-log",
  // Temp: F9 will fix these and remove the entries below
  "server/src/routes/agents.ts",
  "server/src/services/plugin-host-services.ts",
  "server/src/services/issue-thread-interactions.ts",
];

function allowed(p) { return ALLOWED.some((d) => p.includes(d)); }

function stripComments(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    if (source[i] === '"' || source[i] === "'" || source[i] === "`") {
      const quote = source[i];
      let j = i + 1;
      while (j < source.length && source[j] !== quote) {
        if (source[j] === "\\") j++;
        j++;
      }
      out += source.slice(i, j + 1);
      i = j + 1;
    } else if (source[i] === "/" && source[i + 1] === "/" && (i === 0 || source[i - 1] !== ":")) {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (source[i] === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length - 1 && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
    } else {
      out += source[i];
      i++;
    }
  }
  return out;
}

function main() {
  console.log("=== no-direct-log check ===");
  let files;
  try {
    files = execSync(`find "${ROOT}server/src" -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.mjs" \\) 2>/dev/null | grep -v node_modules | grep -v dist/`, { encoding: "utf-8", maxBuffer: 10*1024*1024 }).trim().split("\n").filter(Boolean);
  } catch { console.error("Failed to list source files"); return 1; }
  let violations = 0;
  for (const file of files) {
    const rel = file.replace(ROOT, "");
    if (allowed(rel)) continue;
    try {
      const raw = readFileSync(file, "utf-8");
      const content = stripComments(raw);
      for (const { pattern, msg } of DIR_LOG) {
        pattern.lastIndex = 0;
        let m;
        while ((m = pattern.exec(content)) !== null) {
          const line = raw.slice(0, m.index).split("\n").length;
          console.log(`  ${rel}:${line} — ${msg}`);
          violations++;
        }
      }
    } catch { /* unreadable */ }
  }
  if (violations > 0) { console.log(`\n  ${violations} direct-log violation(s) found`); return 1; }
  console.log("  No direct-log violations");
  return 0;
}
process.exit(main());