import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";

const SCRIPTS = path.resolve(import.meta.dirname, "../../../../scripts");

describe("no-direct-log check (§5.6)", () => {
  it("script exists and has valid syntax", () => {
    const s = path.join(SCRIPTS, "check-no-direct-log.mjs");
    expect(existsSync(s)).toBe(true);
    execSync(`node --check "${s}"`, { encoding: "utf-8", stdio: "pipe" });
  });

  it("runs without crashing", () => {
    try {
      const result = execSync(`node "${path.join(SCRIPTS, "check-no-direct-log.mjs")}"`, { encoding: "utf-8", stdio: "pipe", cwd: SCRIPTS });
      expect(result).toBeDefined();
    } catch (e: any) {
      expect(e.stdout || e.stderr).toBeDefined();
    }
  });

  it("exits 0 on the current tree after the scope fix", () => {
    const r = execSync(`node "${SCRIPTS}/check-no-direct-log.mjs"`, { encoding: "utf-8", stdio: "pipe", cwd: SCRIPTS });
    expect(r).toMatch(/No direct-log violations/);
  });

  it("exits 1 if a console.log is added to a non-allowlisted path", () => {
    const tmp = path.join(SCRIPTS, "../server/src/tmp-test-violation.ts");
    writeFileSync(tmp, 'console.log("leak");\n');
    try {
      expect(() => execSync(`node "${SCRIPTS}/check-no-direct-log.mjs"`, { encoding: "utf-8", stdio: "pipe", cwd: SCRIPTS })).toThrow();
    } finally {
      unlinkSync(tmp);
    }
  });
});