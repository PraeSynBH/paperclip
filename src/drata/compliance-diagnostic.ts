import { DrataClient } from "./client.js";
import { assertConfigSync, config } from "../config.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

interface DeviceLite {
  id: number;
  osVersion: string | null;
  serialNumber: string | null;
  lastCheckedAt: string | null;
  sourceType: string;
  isDeviceCompliant: boolean;
  screenLockTime: number | null;
  antivirusEnabled: boolean | null;
  autoUpdateEnabled: boolean | null;
  passwordManagerEnabled: boolean | null;
  encryptionEnabled: boolean | null;
  firewallEnabled: boolean | null;
}

interface ControlBucket {
  total: number;
  passing: number;
  failing: number;
  unknown: number;
}

const CONTROLS: { key: keyof DeviceLite; label: string; required: boolean }[] = [
  { key: "encryptionEnabled", label: "Disk encryption (FileVault/BitLocker/LUKS)", required: true },
  { key: "antivirusEnabled", label: "Anti-malware enabled", required: true },
  { key: "autoUpdateEnabled", label: "OS auto-update enabled", required: true },
  { key: "passwordManagerEnabled", label: "Password manager installed", required: false },
  { key: "firewallEnabled", label: "Host firewall enabled", required: true },
  { key: "screenLockTime", label: "Screen lock configured", required: true },
];

function classifyOS(osVersion: string | null | undefined): string {
  if (!osVersion) return "Unknown";
  const s = osVersion.toLowerCase();
  if (s.includes("macos") || s.includes("mac os") || s.includes("darwin")) return "macOS";
  if (s.includes("windows")) return "Windows";
  if (s.includes("ubuntu") || s.includes("linux")) return "Linux";
  return osVersion.split(" ")[0] || "Unknown";
}

async function main() {
  assertConfigSync();
  const client = new DrataClient();

  const allDevices = await client.getAllDevices();
  const devices = allDevices as unknown as DeviceLite[];

  const agentDevices = devices.filter((d) => d.sourceType === "AGENT");
  const nonAgentDevices = devices.filter((d) => d.sourceType !== "AGENT");

  const aggregate: Record<string, ControlBucket> = {};
  for (const c of CONTROLS) {
    aggregate[c.label] = { total: 0, passing: 0, failing: 0, unknown: 0 };
  }

  const byOSFailure: Record<string, Record<string, number>> = {};

  for (const d of agentDevices) {
    const os = classifyOS(d.osVersion);
    for (const c of CONTROLS) {
      const v = d[c.key];
      const bucket = aggregate[c.label];
      bucket.total++;
      if (v === true || (c.key === "screenLockTime" && typeof v === "number" && v > 0)) {
        bucket.passing++;
      } else if (v === false) {
        bucket.failing++;
        byOSFailure[os] = byOSFailure[os] ?? {};
        byOSFailure[os][c.label] = (byOSFailure[os][c.label] ?? 0) + 1;
      } else {
        bucket.unknown++;
      }
    }
  }

  const osBreakdown: Record<string, { total: number; agentInstalled: number; compliant: number; reporting24h: number }> = {};
  for (const d of devices) {
    const os = classifyOS(d.osVersion);
    if (!osBreakdown[os]) osBreakdown[os] = { total: 0, agentInstalled: 0, compliant: 0, reporting24h: 0 };
    osBreakdown[os].total++;
    if (d.sourceType === "AGENT") osBreakdown[os].agentInstalled++;
    if (d.isDeviceCompliant) osBreakdown[os].compliant++;
    if (d.lastCheckedAt) {
      const days = (Date.now() - new Date(d.lastCheckedAt).getTime()) / (1000 * 60 * 60 * 24);
      if (days <= 1) osBreakdown[os].reporting24h++;
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    totalDevices: devices.length,
    agentInstalledDevices: agentDevices.length,
    nonAgentDevices: nonAgentDevices.length,
    fullyCompliant: devices.filter((d) => d.isDeviceCompliant).length,
    aggregateControlFailure: aggregate,
    failureByOS: byOSFailure,
    osBreakdown,
  };

  console.log(`\n=== Device Compliance Diagnostic — ${report.generatedAt} ===`);
  console.log(`Total devices:       ${report.totalDevices}`);
  console.log(`Agent installed:     ${report.agentInstalledDevices} (${((report.agentInstalledDevices / report.totalDevices) * 100).toFixed(1)}%)`);
  console.log(`No agent:            ${report.nonAgentDevices}`);
  console.log(`Fully compliant:     ${report.fullyCompliant}\n`);

  console.log("Control failure breakdown (agent-installed devices only):");
  console.log("CONTROL".padEnd(50) + "TOTAL".padStart(8) + "PASS".padStart(8) + "FAIL".padStart(8) + "UNK".padStart(8) + "  %FAIL");
  for (const c of CONTROLS) {
    const b = aggregate[c.label];
    const pct = b.total > 0 ? ((b.failing / b.total) * 100).toFixed(1) : "0.0";
    console.log(
      c.label.padEnd(50) +
        String(b.total).padStart(8) +
        String(b.passing).padStart(8) +
        String(b.failing).padStart(8) +
        String(b.unknown).padStart(8) +
        `  ${pct}%`
    );
  }

  console.log("\nOS breakdown:");
  console.log("OS".padEnd(12) + "TOTAL".padStart(8) + "AGENT".padStart(8) + "COMP".padStart(8) + "24h".padStart(8));
  for (const [os, c] of Object.entries(osBreakdown)) {
    console.log(
      os.padEnd(12) +
        String(c.total).padStart(8) +
        String(c.agentInstalled).padStart(8) +
        String(c.compliant).padStart(8) +
        String(c.reporting24h).padStart(8)
    );
  }

  if (Object.keys(byOSFailure).length > 0) {
    console.log("\nFailures by OS:");
    for (const [os, fails] of Object.entries(byOSFailure)) {
      console.log(`  ${os}:`);
      const entries = Object.entries(fails).sort((a, b) => b[1] - a[1]);
      for (const [ctrl, count] of entries) {
        console.log(`    - ${ctrl}: ${count} devices failing`);
      }
    }
  }

  mkdirSync(config.dataDir, { recursive: true });
  const outPath = join(config.dataDir, "compliance-diagnostic.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nWrote: data/compliance-diagnostic.json`);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
