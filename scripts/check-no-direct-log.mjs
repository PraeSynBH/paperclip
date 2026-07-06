#!/usr/bin/env node
// no-direct-log — CI check per RAM-311 §5.6.
// Forbids direct console.* calls outside server/src/logging/**.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const DIR_LOG = [
  { pattern: /\bconsole\.(log|info|warn|error|debug|trace)\s*\(/g, msg: "direct console call — use LogFormation layer" },
  { pattern: /\bpino\s*\(/g, msg: "direct pino init — use LogFormation layer" },
];
const ALLOWED = ["server/src/logging/", "server/src/middleware/logger.ts", "__tests__", ".test.", "node_modules", "dist/", "scripts/", "eslint", "check-no-direct-log"];

function allowed(p) { return ALLOWED.some((d) => p.includes(d)); }

function main() {
  console.log("=== no-direct-log check ===");
  let files;
  try {
    files = execSync(`find "${ROOT}server/src" "${ROOT}packages" "${ROOT}cli/src" -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.mjs" \\) 2>/dev/null | grep -v node_modules | grep -v dist/`, { encoding: "utf-8", maxBuffer: 10*1024*1024 }).trim().split("\n").filter(Boolean);
  } catch { console.error("Failed to list source files"); return 1; }
  let violations = 0;
  for (const file of files) {
    const rel = file.replace(ROOT, "");
    if (allowed(rel)) continue;
    try {
      const content = readFileSync(file, "utf-8");
      for (const { pattern, msg } of DIR_LOG) {
        pattern.lastIndex = 0;
        let m;
        while ((m = pattern.exec(content)) !== null) {
          const line = content.slice(0, m.index).split("\n").length;
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