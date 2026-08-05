import { DrataClient } from "./client.js";
import { assertConfigSync } from "../config.js";

interface DeviceLite {
  id: number;
  osVersion: string | null;
  personnelId: number | null;
}

interface PersonnelRecord {
  id: number;
  userId: number;
  employmentStatus: string;
}

async function fetchAll<T>(client: DrataClient, path: string, filter?: Record<string, unknown>): Promise<T[]> {
  const results: T[] = [];
  let cursor: string | undefined;
  const c = client as unknown as { request: <P>(p: string, params?: Record<string, unknown>) => Promise<P> };
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
  const devices = await fetchAll<DeviceLite>(client, "/devices");
  const allPersonnel = await fetchAll<PersonnelRecord>(client, "/personnel");

  const personnelById = new Map(allPersonnel.map(p => [p.id, p]));
  const windows = devices.filter(d => (d.osVersion || "").toLowerCase().includes("windows"));
  const home = windows.filter(d => (d.osVersion || "").toLowerCase().includes("home"));
  const pro = windows.filter(d => (d.osVersion || "").toLowerCase().includes("pro"));

  function breakdown(list: DeviceLite[]) {
    const statusCounts: Record<string, number> = {};
    for (const d of list) {
      const p = d.personnelId ? personnelById.get(d.personnelId) : undefined;
      const status = p ? p.employmentStatus : "NO_PERSONNEL_RECORD";
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }
    return statusCounts;
  }

  console.log("All Windows devices by linked personnel employmentStatus:");
  console.log(JSON.stringify(breakdown(windows), null, 2));
  console.log("Total Windows devices:", windows.length);
  console.log();
  console.log("Windows Home devices by linked personnel employmentStatus:");
  console.log(JSON.stringify(breakdown(home), null, 2));
  console.log("Total Windows Home devices:", home.length);
  console.log();
  console.log("Windows Pro devices by linked personnel employmentStatus:");
  console.log(JSON.stringify(breakdown(pro), null, 2));
  console.log("Total Windows Pro devices:", pro.length);
}
main().catch(e => { console.error(e); process.exit(1); });
