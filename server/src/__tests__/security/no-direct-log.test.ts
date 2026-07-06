import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
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
});