import { DrataClient } from "./client.js";
import { assertConfigSync } from "../config.js";
import { writeFileSync } from "node:fs";

interface DeviceLite {
  id: number;
  osVersion: string | null;
  serialNumber: string | null;
  model: string | null;
  lastCheckedAt: string | null;
  sourceType: string;
  isDeviceCompliant: boolean;
  personnelId: number | null;
  userId: number | null;
}

interface PersonnelRecord {
  id: number;
  userId: number;
  employmentStatus: string;
}

async function fetchAll<T>(client: DrataClient, path: string, filter?: Record<string, unknown>): Promise<T[]> {
  const results: T[] = [];
  let cursor: string | undefined;
  const c = client as unknown as {
    request: <P>(p: string, params?: Record<string, unknown>) => Promise<P>;
  };
  do {
    const params: Record<string, unknown> = cursor ? { size: 500, cursor } : { size: 500 };
    if (filter) Object.assign(params, filter);
    const page = await c.request<{ data: T[]; pagination: { cursor: string | null } }>(path, params);
    results.push(...page.data);
    cursor = page.pagination.cursor ?? undefined;
  } while (cursor);
  return results;
}

async function main() {
  assertConfigSync();
  const client = new DrataClient();

  console.log("Fetching devices...");
  const devices = await fetchAll<DeviceLite>(client, "/devices");
  console.log("Fetching active personnel...");
  const personnel = await fetchAll<PersonnelRecord>(client, "/personnel", { employmentStatus: "CURRENT_EMPLOYEE" });

  const activePersonnelIds = new Set(personnel.map(p => p.id));
  const activeUserIds = new Set(personnel.map(p => p.userId));

  const windows = devices.filter(d => (d.osVersion || "").toLowerCase().includes("windows"));
  const home = windows.filter(d => (d.osVersion || "").toLowerCase().includes("home"));
  const pro = windows.filter(d => (d.osVersion || "").toLowerCase().includes("pro"));
  const otherWin = windows.filter(d => !(d.osVersion||"").toLowerCase().includes("home") && !(d.osVersion||"").toLowerCase().includes("pro"));

  const win11 = windows.filter(d => (d.osVersion||"").includes("11"));
  const win10 = windows.filter(d => (d.osVersion||"").includes("10") && !(d.osVersion||"").includes("11"));

  const windowsLinkedToActive = windows.filter(d => d.personnelId && activePersonnelIds.has(d.personnelId));
  const windowsHomeLinkedToActive = home.filter(d => d.personnelId && activePersonnelIds.has(d.personnelId));
  const windowsProLinkedToActive = pro.filter(d => d.personnelId && activePersonnelIds.has(d.personnelId));
  const windowsHomeNoPersonnelId = home.filter(d => !d.personnelId);
  const windowsHomeInactivePersonnelId = home.filter(d => d.personnelId && !activePersonnelIds.has(d.personnelId));
  const uniqueActivePersonnelWithHomeDevice = new Set(windowsHomeLinkedToActive.map(d => d.personnelId)).size;
  const uniqueActivePersonnelWithWindowsDevice = new Set(windowsLinkedToActive.map(d => d.personnelId)).size;

  const osVersionCounts: Record<string, number> = {};
  for (const d of windows) {
    const key = d.osVersion || "null";
    osVersionCounts[key] = (osVersionCounts[key] || 0) + 1;
  }

  const result = {
    generatedAt: new Date().toISOString(),
    totalDevices: devices.length,
    totalActivePersonnel: personnel.length,
    windows: {
      total: windows.length,
      home: home.length,
      pro: pro.length,
      otherEdition: otherWin.length,
      win11: win11.length,
      win10: win10.length,
      linkedToActivePersonnel: windowsLinkedToActive.length,
      homeLinkedToActivePersonnel: windowsHomeLinkedToActive.length,
      proLinkedToActivePersonnel: windowsProLinkedToActive.length,
      homeNoPersonnelId: windowsHomeNoPersonnelId.length,
      homeInactivePersonnelId: windowsHomeInactivePersonnelId.length,
      uniqueActivePersonnelWithHomeDevice,
      uniqueActivePersonnelWithWindowsDevice,
    },
    osVersionCounts,
  };

  console.log(JSON.stringify(result, null, 2));
  writeFileSync("data/windows-edition-analysis.json", JSON.stringify(result, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
