import { DrataClient } from "./client.js";
import { assertConfigSync, config } from "../config.js";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

interface DeviceLite {
  id: number;
  osVersion: string | null;
  serialNumber: string | null;
  lastCheckedAt: string | null;
  sourceType: string;
  isDeviceCompliant: boolean;
  personnelId: number | null;
  userId: number | null;
}

function classifyOS(osVersion: string | null | undefined): string {
  if (!osVersion) return "Unknown";
  const s = osVersion.toLowerCase();
  if (s.includes("macos") || s.includes("mac os") || s.includes("darwin")) return "macOS";
  if (s.includes("windows")) return "Windows";
  if (s.includes("ubuntu") || s.includes("linux")) return "Linux";
  return osVersion.split(" ")[0] || "Unknown";
}

async function fetchAll<T>(client: DrataClient, path: string): Promise<T[]> {
  const results: T[] = [];
  let cursor: string | undefined;
  const c = client as unknown as {
    request: <P>(p: string, params?: Record<string, unknown>) => Promise<P>;
  };
  do {
    const page = await c.request<{ data: T[]; pagination: { cursor: string | null } }>(
      path,
      cursor ? { size: 500, cursor } : { size: 500 }
    );
    results.push(...page.data);
    cursor = page.pagination.cursor ?? undefined;
  } while (cursor);
  return results;
}

async function main() {
  assertConfigSync();
  const client = new DrataClient();

  const devices = await fetchAll<DeviceLite>(client, "/devices");
  const total = devices.length;
  const withAgent = devices.filter((d) => d.sourceType === "AGENT" || d.lastCheckedAt).length;
  const compliant = devices.filter((d) => d.isDeviceCompliant).length;
  const recentlyChecked = devices.filter((d) => {
    if (!d.lastCheckedAt) return false;
    const days = (Date.now() - new Date(d.lastCheckedAt).getTime()) / (1000 * 60 * 60 * 24);
    return days <= 1;
  }).length;
  const stalled = devices.filter((d) => {
    if (!d.lastCheckedAt) return true;
    const days = (Date.now() - new Date(d.lastCheckedAt).getTime()) / (1000 * 60 * 60 * 24);
    return days > 7;
  }).length;

  const byOS: Record<string, { total: number; withAgent: number; compliant: number; reportingLast24h: number }> = {};
  for (const d of devices) {
    const os = classifyOS(d.osVersion);
    if (!byOS[os]) byOS[os] = { total: 0, withAgent: 0, compliant: 0, reportingLast24h: 0 };
    byOS[os].total++;
    if (d.sourceType === "AGENT" || d.lastCheckedAt) byOS[os].withAgent++;
    if (d.isDeviceCompliant) byOS[os].compliant++;
    if (d.lastCheckedAt) {
      const days = (Date.now() - new Date(d.lastCheckedAt).getTime()) / (1000 * 60 * 60 * 24);
      if (days <= 1) byOS[os].reportingLast24h++;
    }
  }

  const snapshot = {
    snapshotAt: new Date().toISOString(),
    total,
    withAgent,
    compliant,
    recentlyChecked,
    stalled,
    pctWithAgent: ((withAgent / Math.max(total, 1)) * 100).toFixed(1),
    pctCompliant: ((compliant / Math.max(total, 1)) * 100).toFixed(1),
    byOS,
    outstandingInstalls: total - withAgent,
  };

  mkdirSync(config.dataDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const dailyPath = join(config.dataDir, `daily-enrollment-${today}.json`);
  writeFileSync(dailyPath, JSON.stringify(snapshot, null, 2));

  const historyPath = join(config.dataDir, "enrollment-history.jsonl");
  writeFileSync(historyPath, (existsSync(historyPath) ? readFileSync(historyPath, "utf-8") : "") + JSON.stringify(snapshot) + "\n");

  console.log(`\n=== Daily Enrollment Snapshot — ${today} ===`);
  console.log(`Total devices:           ${total}`);
  console.log(`With agent installed:    ${withAgent} (${snapshot.pctWithAgent}%)`);
  console.log(`Reporting last 24h:      ${recentlyChecked}`);
  console.log(`Stalled (>7d no report): ${stalled}`);
  console.log(`Fully compliant:         ${compliant} (${snapshot.pctCompliant}%)`);
  console.log(`Outstanding installs:    ${snapshot.outstandingInstalls}`);
  console.log(`\nBy OS:`);
  for (const [os, c] of Object.entries(byOS)) {
    console.log(`  ${os.padEnd(10)} total=${String(c.total).padStart(4)}  agent=${String(c.withAgent).padStart(4)}  compliant=${String(c.compliant).padStart(4)}  last24h=${String(c.reportingLast24h).padStart(4)}`);
  }
  console.log(`\nWrote: data/daily-enrollment-${today}.json`);
  console.log(`Appended: data/enrollment-history.jsonl`);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
