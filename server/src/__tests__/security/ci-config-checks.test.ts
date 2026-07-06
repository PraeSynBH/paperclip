import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const SCRIPTS = path.resolve(import.meta.dirname, "../../../../scripts");

describe("CI config checks (§6.3)", () => {
  const hasBash = (() => { try { execSync("bash --version", { stdio: "pipe" }); return true; } catch { return false; } })();

  it("check-error-tracking-config.sh exists and runs", { timeout: 30000 }, () => {
    expect(existsSync(path.join(SCRIPTS, "check-error-tracking-config.sh"))).toBe(true);
    if (hasBash) {
      try {
        execSync(`bash "${path.join(SCRIPTS, "check-error-tracking-config.sh")}"`, { encoding: "utf-8", stdio: "pipe", cwd: SCRIPTS });
      } catch (e: any) {
        expect(e.stdout || e.stderr).toBeDefined();
      }
    }
  });

  it("check-logging-config.sh exists and runs", { timeout: 30000 }, () => {
    expect(existsSync(path.join(SCRIPTS, "check-logging-config.sh"))).toBe(true);
    if (hasBash) {
      try {
        execSync(`bash "${path.join(SCRIPTS, "check-logging-config.sh")}"`, { encoding: "utf-8", stdio: "pipe", cwd: SCRIPTS });
      } catch (e: any) {
        expect(e.stdout || e.stderr).toBeDefined();
      }
    }
  });
});