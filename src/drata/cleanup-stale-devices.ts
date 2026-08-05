import { DrataClient } from "./client.js";
import { assertConfigSync, config } from "../config.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

interface DeviceRecord {
  id: number;
  assetId: number | null;
  osVersion: string | null;
  serialNumber: string | null;
  model: string | null;
  macAddress: string | null;
  lastCheckedAt: string | null;
  sourceType: string;
  isDeviceCompliant: boolean;
  encryptionEnabled: boolean | null;
  firewallEnabled: boolean | null;
  screenLockTime: number | null;
  antivirusEnabled: boolean | null;
  autoUpdateEnabled: boolean | null;
  passwordManagerEnabled: boolean | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  personnelId: number | null;
  userId: number | null;
}

interface PersonnelRecord {
  id: number;
  userId: number;
  firstName: string;
  lastName: string;
  email: string;
  employmentStatus: string;
  startDate: string | null;
  endDate: string | null;
  department: string | null;
  jobTitle: string | null;
}

interface UserRecord {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  roles: string[];
}

interface AssetRecord {
  id: number;
  name: string;
  assetType: string;
  assetProvider: string;
  removedAt: string | null;
  externalId: string | null;
}

interface StaleDevice {
  deviceId: number;
  assetId: number | null;
  osVersion: string | null;
  model: string | null;
  serialNumber: string | null;
  macAddress: string | null;
  lastCheckedAt: string | null;
  daysSinceHeartbeat: number | null;
  sourceType: string;
  personnelId: number | null;
  userId: number | null;
  personnelName: string | null;
  personnelEmail: string | null;
  employmentStatus: string | null;
  personnelEndDate: string | null;
  category: "no_heartbeat_ever" | "stale_over_30d" | "terminated_personnel" | "orphan_no_user";
  recommendedAction: string;
}

const STALE_THRESHOLD_DAYS = 30;

async function fetchAll<T>(client: DrataClient, path: string): Promise<T[]> {
  const results: T[] = [];
  let cursor: string | undefined;
  const c = client as unknown as {
    request: <P>(p: string, params?: Record<string, unknown>) => Promise<P>;
  };
  const maxRetries = 3;
  do {
    const params: Record<string, unknown> = { size: 500 };
    if (cursor) params.cursor = cursor;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const page = await c.request<{ data: T[]; pagination: { cursor: string | null } }>(path, params);
        results.push(...page.data);
        cursor = page.pagination.cursor ?? undefined;
        lastError = null;
        break;
      } catch (err: any) {
        lastError = err;
        if (err.status >= 500 || err.status === 429) {
          const waitMs = err.status === 429 ? 30000 : (attempt + 1) * 5000;
          console.warn(`   Retry ${attempt + 1}/${maxRetries} for ${path} (HTTP ${err.status}) — waiting ${waitMs / 1000}s...`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        throw err;
      }
    }
    if (lastError) throw lastError;
  } while (cursor);
  return results;
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

function classifyOS(osVersion: string | null | undefined): string {
  if (!osVersion) return "Unknown";
  const s = osVersion.toLowerCase();
  if (s.includes("macos") || s.includes("mac os") || s.includes("darwin")) return "macOS";
  if (s.includes("windows")) return "Windows";
  if (s.includes("ubuntu") || s.includes("linux")) return "Linux";
  if (s.includes("chrome")) return "ChromeOS";
  return osVersion.split(" ")[0] || "Unknown";
}

function recommendAction(
  days: number | null,
  empStatus: string | null,
  hasUser: boolean,
  sourceType: string
): string {
  if (empStatus === "TERMINATED" || empStatus === "SUSPENDED") {
    return "REMOVE — linked to terminated/suspended personnel. Revoke credentials, remove from Drata inventory.";
  }
  if (!hasUser) {
    return "REMOVE — orphan device with no user association. Remove from Drata inventory.";
  }
  if (days === null) {
    return "REMOVE — never reported heartbeat. Likely decommissioned or never enrolled. Remove from Drata inventory.";
  }
  if (days > 90) {
    return "REMOVE — no heartbeat > 90 days. Device is decommissioned. Remove from Drata inventory.";
  }
  if (days > STALE_THRESHOLD_DAYS) {
    return "REVIEW — no heartbeat > 30 days. Confirm with user if device is still active. If decommissioned, remove from Drata.";
  }
  return "KEEP — recent heartbeat, device is active.";
}

async function main() {
  assertConfigSync();
  const client = new DrataClient();

  console.log("=== RBR-93: Stale Device Inventory Cleanup ===\n");
  const startTime = Date.now();

  console.log("1/4 Fetching all devices...");
  const devices = await fetchAll<DeviceRecord>(client, "/devices");
  console.log(`   ${devices.length} devices found.\n`);

  console.log("2/4 Fetching all personnel...");
  const personnel = await fetchAll<PersonnelRecord>(client, "/personnel");
  const personnelById = new Map<number, PersonnelRecord>();
  for (const p of personnel) personnelById.set(p.id, p);
  console.log(`   ${personnel.length} personnel records.\n`);

  console.log("3/4 Fetching all users...");
  const users = await fetchAll<UserRecord>(client, "/users");
  const userById = new Map<number, UserRecord>();
  for (const u of users) userById.set(u.id, u);
  console.log(`   ${users.length} users.\n`);

  console.log("4/4 Fetching all assets...");
  let assetById = new Map<number, AssetRecord>();
  try {
    const assets = await fetchAll<AssetRecord>(client, "/assets");
    for (const a of assets) assetById.set(a.id, a);
    console.log(`   ${assets.length} assets.\n`);
  } catch (err: any) {
    console.warn(`   Assets fetch failed (HTTP ${err.status}): ${err.message}. Proceeding without asset detail.\n`);
  }

  console.log("Analyzing devices...");

  const staleDevices: StaleDevice[] = [];
  const activeDevices: DeviceRecord[] = [];

  for (const device of devices) {
    const days = daysSince(device.lastCheckedAt);
    const isStale =
      days === null ||
      days > STALE_THRESHOLD_DAYS ||
      (device.personnelId !== null && personnelById.has(device.personnelId)) === false;

    if (!isStale) {
      activeDevices.push(device);
      continue;
    }

    const person = device.personnelId ? personnelById.get(device.personnelId) : null;
    const user = device.userId ? userById.get(device.userId) : null;
    const empStatus = person?.employmentStatus ?? null;

    let category: StaleDevice["category"];
    if (days === null) {
      category = "no_heartbeat_ever";
    } else if (empStatus === "TERMINATED" || empStatus === "SUSPENDED") {
      category = "terminated_personnel";
    } else if (!device.userId) {
      category = "orphan_no_user";
    } else if (days > STALE_THRESHOLD_DAYS) {
      category = "stale_over_30d";
    } else {
      activeDevices.push(device);
      continue;
    }

    staleDevices.push({
      deviceId: device.id,
      assetId: device.assetId,
      osVersion: device.osVersion,
      model: device.model,
      serialNumber: device.serialNumber,
      macAddress: device.macAddress,
      lastCheckedAt: device.lastCheckedAt,
      daysSinceHeartbeat: days,
      sourceType: device.sourceType,
      personnelId: device.personnelId,
      userId: device.userId,
      personnelName: person ? `${person.firstName} ${person.lastName}`.trim() : (user ? `${user.firstName} ${user.lastName}`.trim() : null),
      personnelEmail: person?.email ?? user?.email ?? null,
      employmentStatus: empStatus,
      personnelEndDate: person?.endDate ?? null,
      category,
      recommendedAction: recommendAction(days, empStatus, !!device.userId, device.sourceType),
    });
  }

  staleDevices.sort((a, b) => {
    if (a.daysSinceHeartbeat === null && b.daysSinceHeartbeat !== null) return -1;
    if (a.daysSinceHeartbeat !== null && b.daysSinceHeartbeat === null) return 1;
    return (b.daysSinceHeartbeat ?? 0) - (a.daysSinceHeartbeat ?? 0);
  });

  const byCategory: Record<string, { count: number; devices: StaleDevice[] }> = {};
  for (const d of staleDevices) {
    if (!byCategory[d.category]) byCategory[d.category] = { count: 0, devices: [] };
    byCategory[d.category].count++;
    byCategory[d.category].devices.push(d);
  }

  const byOS: Record<string, number> = {};
  for (const d of staleDevices) {
    const os = classifyOS(d.osVersion);
    byOS[os] = (byOS[os] ?? 0) + 1;
  }

  const terminatedCount = staleDevices.filter((d) => d.employmentStatus === "TERMINATED" || d.employmentStatus === "SUSPENDED").length;
  const orphanCount = staleDevices.filter((d) => d.category === "orphan_no_user").length;
  const noHeartbeatCount = staleDevices.filter((d) => d.daysSinceHeartbeat === null).length;
  const over90dCount = staleDevices.filter((d) => d.daysSinceHeartbeat !== null && d.daysSinceHeartbeat > 90).length;

  const report = {
    generatedAt: new Date().toISOString(),
    issue: "RBR-93",
    summary: {
      totalDevices: devices.length,
      activeDevices: activeDevices.length,
      staleDevices: staleDevices.length,
      byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, v.count])),
      byOS,
      breakdowns: {
        terminatedPersonnel: terminatedCount,
        orphanNoUser: orphanCount,
        noHeartbeatEver: noHeartbeatCount,
        over90DaysStale: over90dCount,
      },
      note: "Drata Public API v2 does not expose DELETE for devices (404) and our API key lacks assets-delete/assets-put permissions (403). Devices must be removed manually via the Drata dashboard: Settings → Devices → select → Remove. This report maps every stale device with its asset ID for bulk removal.",
    },
    devices: staleDevices,
    personnelTerminated: personnel
      .filter((p) => p.employmentStatus === "TERMINATED" || p.employmentStatus === "SUSPENDED")
      .map((p) => ({
        id: p.id,
        name: `${p.firstName} ${p.lastName}`.trim(),
        email: p.email,
        status: p.employmentStatus,
        endDate: p.endDate,
        staleDeviceCount: staleDevices.filter((d) => d.personnelId === p.id).length,
      }))
      .filter((p) => p.staleDeviceCount > 0),
  };

  mkdirSync(config.dataDir, { recursive: true });

  const jsonPath = join(config.dataDir, "stale-device-cleanup.json");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const csvHeader = "deviceId,assetId,category,daysSinceHeartbeat,lastCheckedAt,osVersion,model,serialNumber,personnelName,personnelEmail,employmentStatus,recommendedAction\n";
  const csvRows = staleDevices
    .map((d) =>
      [
        d.deviceId,
        d.assetId ?? "",
        d.category,
        d.daysSinceHeartbeat ?? "never",
        d.lastCheckedAt ?? "",
        `"${(d.osVersion ?? "Unknown").replace(/"/g, '""')}"`,
        `"${(d.model ?? "").replace(/"/g, '""')}"`,
        d.serialNumber ?? "",
        `"${(d.personnelName ?? "").replace(/"/g, '""')}"`,
        d.personnelEmail ?? "",
        d.employmentStatus ?? "",
        `"${d.recommendedAction.replace(/"/g, '""')}"`,
      ].join(",")
    )
    .join("\n");
  writeFileSync(join(config.dataDir, "stale-device-cleanup.csv"), csvHeader + csvRows + "\n");

  const mdContent = generateMarkdownReport(report);
  const mdPath = join(config.dataDir, "stale-device-cleanup.md");
  writeFileSync(mdPath, mdContent);

  console.log("=== Results ===\n");
  console.log(`Total devices:     ${devices.length}`);
  console.log(`Active devices:    ${activeDevices.length}`);
  console.log(`Stale devices:     ${staleDevices.length}\n`);

  console.log("By category:");
  for (const [cat, data] of Object.entries(byCategory)) {
    console.log(`  ${cat}: ${data.count}`);
  }
  console.log();

  console.log("By OS:");
  for (const [os, count] of Object.entries(byOS).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${os}: ${count}`);
  }
  console.log();

  console.log("Breakdown:");
  console.log(`  No heartbeat ever:        ${noHeartbeatCount}`);
  console.log(`  Stale > 90 days:          ${over90dCount}`);
  console.log(`  Terminated personnel:     ${terminatedCount}`);
  console.log(`  Orphan (no user):         ${orphanCount}`);
  console.log(`  Terminated employees with devices: ${report.personnelTerminated.length}`);
  console.log();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Files written (${elapsed}s):`);
  console.log(`  data/stale-device-cleanup.json (${staleDevices.length} devices)`);
  console.log(`  data/stale-device-cleanup.csv  (importable spreadsheet)`);
  console.log(`  data/stale-device-cleanup.md   (cleanup guide)\n`);

  console.log("API Limitation Note:");
  console.log("  Drata Public API v2 does not support DELETE /devices/{id} (returns 404).");
  console.log("  Our API key also lacks assets-delete and assets-put permissions.");
  console.log("  Manual removal via Drata dashboard is required.");
  console.log("  See data/stale-device-cleanup.md for step-by-step instructions.\n");
}

function generateMarkdownReport(report: any): string {
  let md = `# RBR-93: Stale Device Inventory Cleanup Report\n\n`;
  md += `**Generated:** ${report.generatedAt}\n`;
  md += `**Issue:** RBR-93 — Clean up 197 stale/unknown devices from Drata inventory\n\n`;

  md += `## Summary\n\n`;
  md += `| Metric | Count |\n`;
  md += `|--------|-------|\n`;
  md += `| Total devices | ${report.summary.totalDevices} |\n`;
  md += `| Active devices | ${report.summary.activeDevices} |\n`;
  md += `| **Stale devices** | **${report.summary.staleDevices}** |\n\n`;

  md += `### By Category\n\n`;
  md += `| Category | Count |\n`;
  md += `|----------|-------|\n`;
  for (const [cat, count] of Object.entries(report.summary.byCategory) as [string, number][]) {
    md += `| ${cat} | ${count} |\n`;
  }

  md += `\n### By OS\n\n`;
  md += `| OS | Count |\n`;
  md += `|----|-------|\n`;
  for (const [os, count] of Object.entries(report.summary.byOS) as [string, number][]) {
    md += `| ${os} | ${count} |\n`;
  }

  md += `\n### Breakdown\n\n`;
  md += `| Breakdown | Count |\n`;
  md += `|-----------|-------|\n`;
  md += `| No heartbeat ever | ${report.summary.breakdowns.noHeartbeatEver} |\n`;
  md += `| Stale > 90 days | ${report.summary.breakdowns.over90DaysStale} |\n`;
  md += `| Terminated personnel | ${report.summary.breakdowns.terminatedPersonnel} |\n`;
  md += `| Orphan (no user) | ${report.summary.breakdowns.orphanNoUser} |\n`;

  if (report.personnelTerminated.length > 0) {
    md += `\n## Terminated Personnel with Stale Devices\n\n`;
    md += `| Name | Email | Status | End Date | Stale Devices |\n`;
    md += `|------|-------|--------|----------|---------------|\n`;
    for (const p of report.personnelTerminated.slice(0, 50)) {
      md += `| ${p.name} | ${p.email} | ${p.status} | ${p.endDate ?? "—"} | ${p.staleDeviceCount} |\n`;
    }
    if (report.personnelTerminated.length > 50) {
      md += `| ... | ... | ... | ... | ${report.personnelTerminated.length - 50} more |\n`;
    }
  }

  md += `\n## Manual Removal Instructions\n\n`;
  md += `Drata Public API v2 does not support device deletion (DELETE /devices/{id} returns 404).`;
  md += ` Our API key also lacks \`assets-delete\` and \`assets-put\` permissions for asset archival.`;
  md += ` The following devices must be removed via the Drata dashboard:\n\n`;

  md += `### Step 1: Download the device list\n`;
  md += `Use the CSV file at \`data/stale-device-cleanup.csv\` with the full device list.\n\n`;

  md += `### Step 2: Remove devices in Drata\n`;
  md += `1. Log in to Drata (app.drata.com)\n`;
  md += `2. Navigate to **Settings → Devices**\n`;
  md += `3. For each device in the CSV, search by device ID or asset ID\n`;
  md += `4. Select the device → **Remove**\n`;
  md += `5. Confirm removal\n\n`;

  md += `### Step 3: Prioritized removal order\n`;
  md += `1. **Terminated personnel devices** (credentials already revoked) — highest priority\n`;
  md += `2. **No heartbeat ever** — never enrolled, safe to remove\n`;
  md += `3. **Stale > 90 days** — decommissioned\n`;
  md += `4. **Orphan devices** — no user association\n`;
  md += `5. **Stale 30-90 days** — review with user first\n\n`;

  md += `### Step 4: API key upgrade (optional)\n`;
  md += `To enable programmatic cleanup for future runs, request the following permission scopes on the Drata API key:\n`;
  md += `- \`assets-delete\` — to archive assets\n`;
  md += `- \`assets-put\` — to mark assets as removed\n\n`;

  md += `## Top 20 Stale Devices (by days since heartbeat)\n\n`;
  md += `| Device ID | Asset ID | Days Stale | Last Heartbeat | OS | Personnel | Category |\n`;
  md += `|-----------|----------|------------|----------------|-----|-----------|----------|\n`;
  for (const d of report.devices.slice(0, 20)) {
    const days = d.daysSinceHeartbeat !== null ? d.daysSinceHeartbeat : "never";
    md += `| ${d.deviceId} | ${d.assetId ?? "—"} | ${days} | ${d.lastCheckedAt?.slice(0, 10) ?? "never"} | ${d.osVersion?.slice(0, 20) ?? "Unknown"} | ${d.personnelName ?? "—"} | ${d.category} |\n`;
  }
  if (report.devices.length > 20) {
    md += `\n... and ${report.devices.length - 20} more devices in the full CSV/JSON report.\n`;
  }

  return md;
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});