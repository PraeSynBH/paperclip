import { DrataClient } from "./client.js";
import { assertConfigSync, config } from "../config.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * RBR-594: Live verification of the 10 employees / device IDs named in the issue,
 * before doing any outreach or reclassification.
 *
 * Device IDs from issue: 793,796,801,803,805,827,836,844,845,848
 */

const ISSUE_DEVICE_IDS = [793, 796, 801, 803, 805, 827, 836, 844, 845, 848];

interface DeviceRecord {
  id: number;
  osVersion: string | null;
  sourceType: string;
  lastCheckedAt: string | null;
  createdAt: string;
  personnelId: number | null;
  userId: number | null;
}

interface PersonnelRecord {
  id: number;
  userId: number;
  employmentStatus: string;
  startedAt: string | null;
  separatedAt: string | null;
}

interface UserRecord {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
}

async function fetchAll<T>(client: DrataClient, path: string): Promise<T[]> {
  const results: T[] = [];
  let cursor: string | undefined;
  const c = client as unknown as {
    request: <P>(p: string, params?: Record<string, unknown>) => Promise<P>;
  };
  do {
    const params: Record<string, unknown> = { size: 500 };
    if (cursor) params.cursor = cursor;
    const page = await c.request<{ data: T[]; pagination: { cursor: string | null } }>(path, params);
    results.push(...page.data);
    cursor = page.pagination.cursor ?? undefined;
  } while (cursor);
  return results;
}

async function main() {
  assertConfigSync();
  const client = new DrataClient();

  console.log("=== RBR-594: Live verification of 10 named devices/employees ===\n");

  const devices = await fetchAll<DeviceRecord>(client, "/devices");
  const personnel = await fetchAll<PersonnelRecord>(client, "/personnel");
  const users = await fetchAll<UserRecord>(client, "/users");

  const deviceById = new Map<number, DeviceRecord>();
  for (const d of devices) deviceById.set(d.id, d);
  const personnelById = new Map<number, PersonnelRecord>();
  for (const p of personnel) personnelById.set(p.id, p);
  const userById = new Map<number, UserRecord>();
  for (const u of users) userById.set(u.id, u);

  const rows: any[] = [];
  for (const id of ISSUE_DEVICE_IDS) {
    const device = deviceById.get(id);
    if (!device) {
      rows.push({ deviceId: id, status: "NOT_FOUND_LIVE" });
      continue;
    }
    const person = device.personnelId ? personnelById.get(device.personnelId) ?? null : null;
    const user = person ? userById.get(person.userId) ?? null : null;

    // Does this personnel now have ANY device with a real OS (i.e. agent installed elsewhere)?
    const personDevices = person
      ? devices.filter((d) => d.personnelId === person.id)
      : [];
    const hasAgentDevice = personDevices.some((d) => !!d.osVersion);

    rows.push({
      deviceId: id,
      liveOsVersion: device.osVersion,
      liveSourceType: device.sourceType,
      lastCheckedAt: device.lastCheckedAt,
      personnelId: device.personnelId,
      email: user?.email ?? null,
      name: user ? `${user.firstName} ${user.lastName}`.trim() : null,
      employmentStatus: person?.employmentStatus ?? null,
      separatedAt: person?.separatedAt ?? null,
      totalDevicesForPerson: personDevices.length,
      hasAgentDeviceElsewhere: hasAgentDevice,
    });
  }

  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(join(config.dataDir, "rbr594-live-verification.json"), JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));

  console.log("deviceId | employmentStatus | email | osVersion | hasAgentElsewhere | totalDevices");
  for (const r of rows) {
    console.log(`${r.deviceId} | ${r.employmentStatus ?? "?"} | ${r.email ?? "?"} | ${r.liveOsVersion ?? "Unknown"} | ${r.hasAgentDeviceElsewhere ?? "?"} | ${r.totalDevicesForPerson ?? "?"}`);
  }
  console.log("\nWrote data/rbr594-live-verification.json");
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
