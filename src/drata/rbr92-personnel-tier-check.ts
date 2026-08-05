import { DrataClient } from "./client.js";
import { assertConfigSync } from "../config.js";

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
  const all: any[] = await fetchAll(client, "/personnel");
  const statusCounts: Record<string, number> = {};
  for (const p of all) {
    statusCounts[p.employmentStatus] = (statusCounts[p.employmentStatus] || 0) + 1;
  }
  console.log("All personnel by employmentStatus:", JSON.stringify(statusCounts, null, 2));
  console.log("Total personnel records:", all.length);
}
main().catch(e => { console.error(e); process.exit(1); });
