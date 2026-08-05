import { DrataClient } from "./client.js";
import { assertConfigSync, config } from "../config.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

interface PersonnelRecord {
  id: number;
  userId: number;
  employmentStatus: string;
  startedAt: string | null;
  separatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface UserRecord {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  roles: string[];
}

interface DeviceRecord {
  id: number;
  assetId: number | null;
  osVersion: string | null;
  serialNumber: string | null;
  model: string | null;
  lastCheckedAt: string | null;
  sourceType: string;
  isDeviceCompliant: boolean;
  screenLockTime: number | null;
  antivirusEnabled: boolean | null;
  autoUpdateEnabled: boolean | null;
  passwordManagerEnabled: boolean | null;
  encryptionEnabled: boolean | null;
  firewallEnabled: boolean | null;
  personnelId: number | null;
  userId: number | null;
  asset?: { id: number; name: string; assetType: string };
}

interface DeploymentRosterRow {
  userId: number;
  email: string;
  fullName: string;
  jobTitle: string | null;
  personnelId: number | null;
  employmentStatus: string;
  startedAt: string | null;
  deviceCount: number;
  deviceSerialNumbers: string[];
  deviceOS: string[];
  anyDeviceReporting: boolean;
}

function classifyOS(osVersion: string | null | undefined): string {
  if (!osVersion) return "Unknown";
  const s = osVersion.toLowerCase();
  if (s.includes("macos") || s.includes("mac os") || s.includes("darwin")) return "macOS";
  if (s.includes("windows")) return "Windows";
  if (s.includes("ubuntu") || s.includes("linux")) return "Linux";
  if (s.includes("ios")) return "iOS";
  if (s.includes("android")) return "Android";
  return osVersion.split(" ")[0] || "Unknown";
}

async function fetchAllWithFilter<T>(
  client: DrataClient,
  path: string,
  filter?: Record<string, string | number>
): Promise<T[]> {
  const results: T[] = [];
  let cursor: string | undefined;
  const baseParams: Record<string, unknown> = { size: 500 };
  if (filter) {
    for (const [k, v] of Object.entries(filter)) {
      baseParams[k] = v;
    }
  }
  do {
    const params: Record<string, unknown> = { ...baseParams };
    if (cursor) params.cursor = cursor;
    const c = client as unknown as {
      request: <P>(p: string, params?: Record<string, unknown>) => Promise<P>;
    };
    const page = await c.request<{ data: T[]; pagination: { cursor: string | null } }>(path, params);
    results.push(...page.data);
    cursor = page.pagination.cursor ?? undefined;
  } while (cursor);
  return results;
}

async function main() {
  assertConfigSync();
  const client = new DrataClient();

  console.log("=== Aira: Drata Agent Deployment Roster Generator ===\n");
  console.log("Collecting: active personnel, all devices, user emails\n");

  console.log("1. Fetching active personnel (employmentStatus=CURRENT_EMPLOYEE)...");
  const allPersonnel = await fetchAllWithFilter<PersonnelRecord>(client, "/personnel", {
    employmentStatus: "CURRENT_EMPLOYEE",
  });
  console.log(`   Found ${allPersonnel.length} active personnel.\n`);

  console.log("2. Fetching all 621 devices (with asset expand)...");
  const allDevices = await fetchAllWithFilter<DeviceRecord>(client, "/devices", {});
  console.log(`   Found ${allDevices.length} devices.\n`);

  console.log("3. Fetching all users (for email resolution)...");
  const allUsers = await fetchAllWithFilter<UserRecord>(client, "/users", {});
  console.log(`   Found ${allUsers.length} users.\n`);

  const userById = new Map<number, UserRecord>();
  for (const u of allUsers) userById.set(u.id, u);

  const personnelById = new Map<number, PersonnelRecord>();
  for (const p of allPersonnel) personnelById.set(p.id, p);

  const devicesByUserId = new Map<number, DeviceRecord[]>();
  for (const d of allDevices) {
    if (d.userId == null) continue;
    if (!devicesByUserId.has(d.userId)) devicesByUserId.set(d.userId, []);
    devicesByUserId.get(d.userId)!.push(d);
  }

  const roster: DeploymentRosterRow[] = [];
  for (const p of allPersonnel) {
    const u = userById.get(p.userId);
    if (!u) continue;
    const userDevices = devicesByUserId.get(p.userId) ?? [];
    const isOAuth = u.email?.includes("oauth2-app") || u.email?.includes("public_api_key");
    if (isOAuth) continue;
    roster.push({
      userId: u.id,
      email: u.email,
      fullName: `${u.firstName} ${u.lastName}`.trim(),
      jobTitle: u.jobTitle,
      personnelId: p.id,
      employmentStatus: p.employmentStatus,
      startedAt: p.startedAt,
      deviceCount: userDevices.length,
      deviceSerialNumbers: userDevices.map((d) => d.serialNumber ?? "—"),
      deviceOS: userDevices.map((d) => d.osVersion ?? "Unknown"),
      anyDeviceReporting: userDevices.some((d) => d.sourceType === "AGENT" || d.lastCheckedAt),
    });
  }
  roster.sort((a, b) => a.fullName.localeCompare(b.fullName));

  const osCounts: Record<string, { total: number; withAgent: number; compliant: number }> = {};
  for (const d of allDevices) {
    const os = classifyOS(d.osVersion);
    if (!osCounts[os]) osCounts[os] = { total: 0, withAgent: 0, compliant: 0 };
    osCounts[os].total++;
    if (d.sourceType === "AGENT" || d.lastCheckedAt) osCounts[os].withAgent++;
    if (d.isDeviceCompliant) osCounts[os].compliant++;
  }

  const personnelWithDevices = roster.filter((r) => r.deviceCount > 0).length;
  const personnelWithoutDevices = roster.filter((r) => r.deviceCount === 0).length;
  const totalDevicesOnRoster = roster.reduce((s, r) => s + r.deviceCount, 0);
  const deviceToPersonnelMap = new Map<number, number>();
  for (const d of allDevices) {
    if (d.userId != null) deviceToPersonnelMap.set(d.id, d.userId);
  }
  const devicesAssignedToActive = allDevices.filter(
    (d) => d.userId != null && personnelById.has(
      allPersonnel.find((p) => p.userId === d.userId)?.id ?? -1
    )
  ).length;
  const orphanDevices = allDevices.filter(
    (d) => d.userId == null || !personnelById.has(
      allPersonnel.find((p) => p.userId === d.userId)?.id ?? -1
    )
  ).length;

  const summary = {
    generatedAt: new Date().toISOString(),
    fleet: {
      totalDevices: allDevices.length,
      devicesAssignedToActivePersonnel: devicesAssignedToActive,
      orphanDevices,
      byOS: osCounts,
      withAgentInstalled: allDevices.filter((d) => d.sourceType === "AGENT").length,
      fullyCompliant: allDevices.filter((d) => d.isDeviceCompliant).length,
    },
    personnel: {
      totalActive: allPersonnel.length,
      withEmail: roster.length,
      withDevices: personnelWithDevices,
      withoutDevices: personnelWithoutDevices,
      totalDevicesOnRoster,
    },
    rbr86Status: {
      step1_installLink: {
        status: "blocked",
        blocker: "RBR-19 (Drata API key scope expansion is in_review, but the install link itself requires a Drata admin to generate via UI: help.drata.com/en/articles/6110773). Action: a Drata admin must generate the installation link in the Drata UI and share it.",
      },
      step2_sendInstructions: {
        status: "ready",
        rosterReady: true,
        rosterSize: roster.length,
        blocker: null,
      },
      step3_monitorEnrollment: {
        status: "ready",
        baseline: {
          totalDevices: allDevices.length,
          withAgent: allDevices.filter((d) => d.sourceType === "AGENT").length,
          compliant: allDevices.filter((d) => d.isDeviceCompliant).length,
        },
      },
      step4_reportFleetComposition: {
        status: "ready",
        composition: osCounts,
      },
    },
  };

  mkdirSync(config.dataDir, { recursive: true });

  writeFileSync(
    join(config.dataDir, "deployment-roster.json"),
    JSON.stringify(
      {
        generatedAt: summary.generatedAt,
        roster,
        summary,
      },
      null,
      2
    )
  );

  const csvHeader = "userId,email,fullName,jobTitle,personnelId,employmentStatus,startedAt,deviceCount,deviceSerials,deviceOS,anyDeviceReporting\n";
  const csvRows = roster
    .map((r) =>
      [
        r.userId,
        r.email,
        `"${r.fullName.replace(/"/g, '""')}"`,
        r.jobTitle ? `"${r.jobTitle.replace(/"/g, '""')}"` : "",
        r.personnelId ?? "",
        r.employmentStatus,
        r.startedAt ?? "",
        r.deviceCount,
        `"${r.deviceSerialNumbers.join("; ")}"`,
        `"${r.deviceOS.join("; ")}"`,
        r.anyDeviceReporting,
      ].join(",")
    )
    .join("\n");
  writeFileSync(join(config.dataDir, "deployment-roster.csv"), csvHeader + csvRows + "\n");

  writeFileSync(
    join(config.dataDir, "fleet-composition.json"),
    JSON.stringify(
      {
        generatedAt: summary.generatedAt,
        fleet: summary.fleet,
        personnel: summary.personnel,
        byOS: osCounts,
      },
      null,
      2
    )
  );

  console.log("=== Fleet Composition ===");
  console.log(`Total devices: ${allDevices.length}`);
  for (const [os, c] of Object.entries(osCounts)) {
    console.log(`  ${os}: ${c.total} (agent-installed: ${c.withAgent}, compliant: ${c.compliant})`);
  }

  console.log("\n=== Personnel ===");
  console.log(`Active personnel total: ${allPersonnel.length}`);
  console.log(`Roster (excl. OAuth/bot users): ${roster.length}`);
  console.log(`  with assigned devices: ${personnelWithDevices}`);
  console.log(`  without devices: ${personnelWithoutDevices}`);
  console.log(`  total devices linked: ${totalDevicesOnRoster}`);
  console.log(`Devices not linked to active personnel (orphan): ${orphanDevices}`);

  console.log("\n=== RBR-86 Status ===");
  console.log("Step 1 (install link): BLOCKED — Drata admin must generate via UI");
  console.log(`Step 2 (send instructions): READY — roster has ${roster.length} recipients`);
  console.log(`Step 3 (monitor): READY — baseline ${allDevices.filter((d) => d.sourceType === "AGENT").length}/${allDevices.length} devices reporting`);
  console.log("Step 4 (fleet report): READY — see fleet-composition.json\n");

  console.log(`Files written:`);
  console.log(`  - data/deployment-roster.json (${roster.length} rows)`);
  console.log(`  - data/deployment-roster.csv (mail-merge ready)`);
  console.log(`  - data/fleet-composition.json (fleet stats)`);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
