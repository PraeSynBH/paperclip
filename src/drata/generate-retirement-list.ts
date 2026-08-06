import { DrataClient } from "./client.js";
import { assertConfigSync, config } from "../config.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * RBR-560: Generate the manual-retirement candidate list for known-OS,
 * AGENT-sourceType devices whose Drata heartbeat has gone stale.
 *
 * This is the sibling of generate-orphan-purge-list.ts (RBR-742, which
 * covers Unknown-OS orphans for RBR-730/RBR-108). RBR-560 covers the other
 * half of the fleet: devices that DO report an OS (so the agent installed
 * and ran at least once) but have since stopped checking in.
 *
 * Why this script exists (2026-08-06 correction):
 * A same-day hand-off list (`rbr560-retirement-candidates-2026-08-06.json/csv`)
 * was generated using only two filters — sourceType=AGENT, known OS,
 * lastCheckedAt >48h stale — and produced 342 rows. Independent verification
 * (data/evidence/rbr560-verification-2026-08-06.json) found that list mixes
 * two very different populations:
 *
 *   - 274 devices belong to FORMER_EMPLOYEE / FORMER_CONTRACTOR personnel
 *     (median 891 days stale, up to 1421 days). The employee is gone; the
 *     device SHOULD be retired from the Drata compliance inventory
 *     regardless of the exact staleness figure. This is a safe, unambiguous
 *     purge set — matches the ~243 figure the original RBR-560 ticket
 *     description anticipated for "IT-driven retirement close-out".
 *
 *   - 68 devices belong to CURRENT_EMPLOYEE personnel, with a wildly
 *     different age profile (median 57.5 days; 15 of the 68 are <7 days
 *     stale). These are active employees whose laptop/agent had a heartbeat
 *     gap — most look like routine blips (device off over a weekend, agent
 *     restart, network issue), not decommissioned hardware. None of the 68
 *     fall in the ticket's stated "2-4y-old lastCheckedAt" range at all
 *     (zero devices between 730-1460 days). Retiring these from Drata would
 *     delete live compliance evidence for people who still work here — the
 *     same class of mistake RBR-730 caught and fixed for device 844/845
 *     before execution.
 *
 * This script re-derives both buckets live and keeps them in separate files
 * so nobody can accidentally point the Drata dashboard at the unfiltered
 * 342-row list.
 *
 * No new Drata API scopes are used. Read-only end to end — Drata Public API
 * v2 does not support DELETE /devices/{id} (404); manual dashboard removal
 * by a human admin is still required (src/drata/cleanup-stale-devices.ts:284).
 */

interface DeviceRecord {
  id: number;
  assetId: number | null;
  osVersion: string | null;
  serialNumber: string | null;
  model: string | null;
  macAddress: string | null;
  lastCheckedAt: string | null;
  sourceType: string;
  createdAt: string;
  personnelId: number | null;
  userId: number | null;
}

interface PersonnelRecord {
  id: number;
  userId: number;
  employmentStatus: string;
  startDate?: string | null;
  endDate?: string | null;
}

interface UserRecord {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
}

type Bucket = "purge" | "needs_review";

interface ClassifiedDevice {
  deviceId: number;
  assetId: number | null;
  osVersion: string | null;
  serialNumber: string | null;
  model: string | null;
  personnelId: number | null;
  userId: number | null;
  personnelEmail: string | null;
  personnelName: string | null;
  employmentStatus: string | null;
  lastCheckedAt: string | null;
  ageDays: number | null;
  bucket: Bucket;
  reason: string;
}

const STALE_HOURS = 48;

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

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function writeCsv(path: string, header: string[], rows: (string | number | null)[][]): void {
  const lines = [header.join(",")];
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  writeFileSync(path, lines.join("\n") + "\n");
}

async function main() {
  assertConfigSync();
  const client = new DrataClient();

  console.log("=== RBR-560: Manual Retirement Candidate List (known-OS, AGENT-sourceType, stale) ===\n");
  const startTime = Date.now();
  const generatedAt = new Date();

  console.log("1/3 Fetching all devices...");
  const devices = await fetchAll<DeviceRecord>(client, "/devices");
  console.log(`   ${devices.length} devices found.\n`);

  console.log("2/3 Fetching all personnel...");
  const personnel = await fetchAll<PersonnelRecord>(client, "/personnel");
  const personnelById = new Map<number, PersonnelRecord>();
  for (const p of personnel) personnelById.set(p.id, p);
  console.log(`   ${personnel.length} personnel records.\n`);

  console.log("3/3 Fetching all users...");
  const users = await fetchAll<UserRecord>(client, "/users");
  const userById = new Map<number, UserRecord>();
  for (const u of users) userById.set(u.id, u);
  console.log(`   ${users.length} users.\n`);

  const nowMs = generatedAt.getTime();
  const candidates = devices.filter((d) => {
    if (d.sourceType !== "AGENT") return false;
    if (!d.osVersion) return false; // Unknown-OS is RBR-108/RBR-730 scope, not this ticket
    if (!d.lastCheckedAt) return true;
    const ageMs = nowMs - new Date(d.lastCheckedAt).getTime();
    return ageMs > STALE_HOURS * 3600 * 1000;
  });
  console.log(`Candidate devices (AGENT, known OS, stale >${STALE_HOURS}h): ${candidates.length}\n`);

  const classified: ClassifiedDevice[] = candidates.map((device) => {
    const person = device.personnelId ? personnelById.get(device.personnelId) ?? null : null;
    const user = person ? userById.get(person.userId) ?? null : device.userId ? userById.get(device.userId) ?? null : null;
    const empStatus = person?.employmentStatus ?? null;
    const days = daysSince(device.lastCheckedAt);

    let bucket: Bucket;
    let reason: string;

    if (empStatus === "FORMER_EMPLOYEE" || empStatus === "FORMER_CONTRACTOR") {
      bucket = "purge";
      reason = `employmentStatus=${empStatus} — separated personnel, device retirement is unambiguous regardless of exact staleness`;
    } else if (empStatus === null) {
      bucket = "purge";
      reason = "no personnel association (orphan device) — no active owner, safe to retire";
    } else if (empStatus === "CURRENT_EMPLOYEE" || empStatus === "SERVICE_ACCOUNT") {
      bucket = "needs_review";
      reason = `employmentStatus=${empStatus} — active org identity. Stale heartbeat likely reflects a support issue (agent crash, device off, reimage), not decommissioned hardware. Do NOT retire without IT confirming the device is actually gone; route to RBR-89 daily follow-up instead.`;
    } else {
      bucket = "needs_review";
      reason = `employmentStatus=${empStatus} — not explicitly FORMER_EMPLOYEE/FORMER_CONTRACTOR, requires human judgment before retirement`;
    }

    return {
      deviceId: device.id,
      assetId: device.assetId,
      osVersion: device.osVersion,
      serialNumber: device.serialNumber,
      model: device.model,
      personnelId: device.personnelId,
      userId: person?.userId ?? device.userId ?? null,
      personnelEmail: user?.email ?? null,
      personnelName: user ? `${user.firstName} ${user.lastName}`.trim() : null,
      employmentStatus: empStatus,
      lastCheckedAt: device.lastCheckedAt,
      ageDays: days,
      bucket,
      reason,
    };
  });

  const purgeList = classified.filter((d) => d.bucket === "purge").sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0));
  const needsReview = classified.filter((d) => d.bucket === "needs_review").sort((a, b) => (a.ageDays ?? 0) - (b.ageDays ?? 0));

  mkdirSync(config.dataDir, { recursive: true });

  const purgeCsvPath = join(config.dataDir, `rbr560-FINAL-retirement-list-${purgeList.length}.csv`);
  writeCsv(
    purgeCsvPath,
    ["deviceId", "assetId", "osVersion", "serialNumber", "personnelEmail", "employmentStatus", "lastCheckedAt", "ageDays", "reason"],
    purgeList.map((d) => [d.deviceId, d.assetId, d.osVersion, d.serialNumber, d.personnelEmail, d.employmentStatus, d.lastCheckedAt, d.ageDays, d.reason])
  );

  const reviewCsvPath = join(config.dataDir, `rbr560-needs-review-current-employee-${needsReview.length}.csv`);
  writeCsv(
    reviewCsvPath,
    ["deviceId", "assetId", "osVersion", "serialNumber", "personnelEmail", "employmentStatus", "lastCheckedAt", "ageDays", "reason"],
    needsReview.map((d) => [d.deviceId, d.assetId, d.osVersion, d.serialNumber, d.personnelEmail, d.employmentStatus, d.lastCheckedAt, d.ageDays, d.reason])
  );

  const byStatus: Record<string, number> = {};
  for (const d of classified) {
    const key = d.employmentStatus ?? "NO_PERSONNEL";
    byStatus[key] = (byStatus[key] ?? 0) + 1;
  }

  const ages = purgeList.map((d) => d.ageDays ?? 0).sort((a, b) => a - b);
  const median = ages.length ? ages[Math.floor(ages.length / 2)] : null;

  const reviewAges = needsReview.map((d) => d.ageDays ?? 0).sort((a, b) => a - b);
  const reviewMedian = reviewAges.length ? reviewAges[Math.floor(reviewAges.length / 2)] : null;

  const summary = {
    generatedAt: generatedAt.toISOString(),
    issue: "RBR-560",
    definition: "AGENT-sourceType, known OS, lastCheckedAt >48h stale",
    correctsPriorListDated: "2026-08-06 (rbr560-retirement-candidates-2026-08-06.json/csv, 342 rows, unsplit)",
    counts: {
      totalCandidatesLive: classified.length,
      purge: purgeList.length,
      needsReview: needsReview.length,
      byEmploymentStatus: byStatus,
    },
    purgeAgeDaysRange: purgeList.length ? { min: ages[0], max: ages[ages.length - 1], median } : null,
    needsReviewAgeDaysRange: needsReview.length ? { min: reviewAges[0], max: reviewAges[reviewAges.length - 1], median: reviewMedian } : null,
    note:
      "purge = FORMER_EMPLOYEE/FORMER_CONTRACTOR/no-personnel devices, safe to retire regardless of exact staleness. " +
      "needs_review = CURRENT_EMPLOYEE/SERVICE_ACCOUNT devices — do not retire from Drata without IT confirming the " +
      "hardware is actually decommissioned; a stale heartbeat on an active employee's device is a support issue, not " +
      "a retirement case. Retiring these would delete live compliance evidence for current staff.",
    apiLimitation:
      "Drata Public API v2 does not expose DELETE for devices (404) and the key lacks assets-delete/assets-put (403). " +
      "Manual removal via Drata dashboard by a human admin is required — see src/drata/cleanup-stale-devices.ts:284.",
  };

  const summaryPath = join(config.dataDir, "rbr560-retirement-summary.json");
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log("=== Results ===\n");
  console.log(`Total candidates (live):     ${classified.length}`);
  console.log(`PURGE (former/orphan):       ${purgeList.length}`);
  console.log(`NEEDS REVIEW (current emp):  ${needsReview.length}\n`);
  console.log("By employmentStatus:");
  for (const [k, v] of Object.entries(byStatus)) console.log(`  ${k}: ${v}`);
  console.log();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Files written (${elapsed}s):`);
  console.log(`  ${purgeCsvPath}`);
  console.log(`  ${reviewCsvPath}`);
  console.log(`  ${summaryPath}\n`);
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
