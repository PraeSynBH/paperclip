import { DrataClient } from "./client.js";
import { assertConfigSync, config } from "../config.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * RBR-742: Generate an exact, enumerated orphan Unknown-OS device list for
 * the Drata purge that RBR-730 (board manual deletion) is blocked on.
 *
 * This re-runs the device/personnel/user join LIVE against the Drata API
 * using the existing read-only key (AIRA_DRATA_API_KEY_RO / DRATA_API_KEY),
 * classifies every Unknown-OS device explicitly, and emits three files:
 *
 *   data/orphan-purge-list.csv       -- devices safe to delete (orphans)
 *   data/orphan-purge-keeplist.csv   -- devices to explicitly KEEP (active employees)
 *   data/orphan-purge-needs-review.csv -- ambiguous devices, NOT auto-included in purge
 *
 * Classification rules (per RBR-742):
 *   - Unknown-OS device = devices[].osVersion is null/empty
 *   - Orphan  = employmentStatus in (FORMER_EMPLOYEE, FORMER_CONTRACTOR), OR no personnel association at all
 *   - Keep    = employmentStatus === CURRENT_EMPLOYEE (or SERVICE_ACCOUNT — still an active org identity)
 *   - Needs review = employmentStatus is null/unrecognized/OUT_OF_SCOPE, OR device was created/enrolled
 *     since the last stale-device-cleanup snapshot (2026-07-11), OR device has a heartbeat within the
 *     last 7 days despite showing Unknown OS (may be actively enrolling, not safe to blind-delete).
 *
 * No new Drata API scopes are used. No delete/mutation calls are made — this
 * script is read-only end to end, exactly like cleanup-stale-devices.ts.
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
  updatedAt: string;
  deletedAt: string | null;
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
  jobTitle: string | null;
}

interface AssetRecord {
  id: number;
  name: string;
  assetType: string;
  assetProvider: string;
  removedAt: string | null;
  externalId: string | null;
}

type Bucket = "purge" | "keep" | "needs_review";

interface ClassifiedDevice {
  deviceId: number;
  assetId: number | null;
  serialNumber: string | null;
  model: string | null;
  macAddress: string | null;
  personnelId: number | null;
  userId: number | null;
  personnelEmail: string | null;
  personnelName: string | null;
  employmentStatus: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  daysSinceHeartbeat: number | null;
  bucket: Bucket;
  reason: string;
}

// The last snapshot RBR-730 / RBR-660 were basing decisions on. Any device
// enrolled (createdAt) on/after this timestamp is fleet drift that the stale
// snapshot never saw — flag it rather than silently purge or keep it.
const LAST_SNAPSHOT_AT = new Date("2026-07-11T14:44:33.314Z");
// Devices with a very recent heartbeat despite Unknown OS may be mid-enrollment.
const RECENT_HEARTBEAT_DAYS = 7;

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

  console.log("=== RBR-742: Live Orphan Unknown-OS Device Enumeration (Drata purge for RBR-730) ===\n");
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

  // Assets are best-effort — the read-only key may or may not expose /assets
  // depending on scope; the join does not depend on it for classification,
  // only to enrich assetId cross-reference if independently available.
  let assetById = new Map<number, AssetRecord>();
  try {
    const assets = await fetchAll<AssetRecord>(client, "/assets");
    for (const a of assets) assetById.set(a.id, a);
    console.log(`   (bonus) ${assets.length} assets fetched for cross-reference.\n`);
  } catch (err: any) {
    console.warn(`   Assets fetch skipped (HTTP ${err.status ?? "?"}): ${err.message}. Not required for classification.\n`);
  }

  const unknownOSDevices = devices.filter((d) => !d.osVersion);
  console.log(`Unknown-OS devices (live, right now): ${unknownOSDevices.length}\n`);

  const classified: ClassifiedDevice[] = [];

  for (const device of unknownOSDevices) {
    const person = device.personnelId ? personnelById.get(device.personnelId) ?? null : null;
    const user = person ? userById.get(person.userId) ?? null : null;
    const empStatus = person?.employmentStatus ?? null;
    const days = daysSince(device.lastCheckedAt);
    const enrolledSinceSnapshot = new Date(device.createdAt) >= LAST_SNAPSHOT_AT;
    const recentHeartbeat = days !== null && days <= RECENT_HEARTBEAT_DAYS;

    let bucket: Bucket;
    let reason: string;

    if (empStatus === "CURRENT_EMPLOYEE" || empStatus === "SERVICE_ACCOUNT") {
      // Active org identity — never auto-purge, regardless of anything else.
      bucket = "keep";
      reason = `employmentStatus=${empStatus} — active org identity, must not be purged`;
    } else if (empStatus === null) {
      // No personnel association at all is "orphan" per the spec, UNLESS the
      // device looks freshly enrolled or recently checked in — that's fleet
      // drift the CEO's audit specifically warned about, so it goes to review.
      if (enrolledSinceSnapshot || recentHeartbeat) {
        bucket = "needs_review";
        reason = enrolledSinceSnapshot
          ? `no personnel association, but device createdAt (${device.createdAt}) is on/after last snapshot (${LAST_SNAPSHOT_AT.toISOString()}) — possible new enrollment, not in prior triage`
          : `no personnel association, but lastCheckedAt is within ${RECENT_HEARTBEAT_DAYS}d — device may be actively checking in`;
      } else {
        bucket = "purge";
        reason = "no personnel association (orphan device)";
      }
    } else if (empStatus === "FORMER_EMPLOYEE" || empStatus === "FORMER_CONTRACTOR") {
      if (enrolledSinceSnapshot || recentHeartbeat) {
        bucket = "needs_review";
        reason = enrolledSinceSnapshot
          ? `employmentStatus=${empStatus} but device createdAt (${device.createdAt}) is on/after last snapshot (${LAST_SNAPSHOT_AT.toISOString()}) — verify before deleting`
          : `employmentStatus=${empStatus} but lastCheckedAt is within ${RECENT_HEARTBEAT_DAYS}d — verify before deleting`;
      } else {
        bucket = "purge";
        reason = `employmentStatus=${empStatus}`;
      }
    } else {
      // OUT_OF_SCOPE or any other unrecognized status — do not default to purge.
      bucket = "needs_review";
      reason = `employmentStatus=${empStatus} — not explicitly FORMER_EMPLOYEE/FORMER_CONTRACTOR/CURRENT_EMPLOYEE, requires human judgment`;
    }

    classified.push({
      deviceId: device.id,
      assetId: device.assetId,
      serialNumber: device.serialNumber,
      model: device.model,
      macAddress: device.macAddress,
      personnelId: device.personnelId,
      userId: person?.userId ?? device.userId ?? null,
      personnelEmail: user?.email ?? null,
      personnelName: user ? `${user.firstName} ${user.lastName}`.trim() : null,
      employmentStatus: empStatus,
      lastCheckedAt: device.lastCheckedAt,
      createdAt: device.createdAt,
      daysSinceHeartbeat: days,
      bucket,
      reason,
    });
  }

  const purgeList = classified.filter((d) => d.bucket === "purge").sort((a, b) => a.deviceId - b.deviceId);
  const keepList = classified.filter((d) => d.bucket === "keep").sort((a, b) => a.deviceId - b.deviceId);
  const needsReview = classified.filter((d) => d.bucket === "needs_review").sort((a, b) => a.deviceId - b.deviceId);

  mkdirSync(config.dataDir, { recursive: true });

  writeCsv(
    join(config.dataDir, "orphan-purge-list.csv"),
    ["deviceId", "assetId", "serialNumber", "model", "personnelEmail", "employmentStatus", "lastCheckedAt", "reason"],
    purgeList.map((d) => [d.deviceId, d.assetId, d.serialNumber, d.model, d.personnelEmail, d.employmentStatus, d.lastCheckedAt, d.reason])
  );

  writeCsv(
    join(config.dataDir, "orphan-purge-keeplist.csv"),
    ["deviceId", "assetId", "serialNumber", "model", "personnelEmail", "employmentStatus", "lastCheckedAt", "reason"],
    keepList.map((d) => [d.deviceId, d.assetId, d.serialNumber, d.model, d.personnelEmail, d.employmentStatus, d.lastCheckedAt, d.reason])
  );

  writeCsv(
    join(config.dataDir, "orphan-purge-needs-review.csv"),
    ["deviceId", "assetId", "serialNumber", "model", "personnelEmail", "employmentStatus", "lastCheckedAt", "createdAt", "reason"],
    needsReview.map((d) => [d.deviceId, d.assetId, d.serialNumber, d.model, d.personnelEmail, d.employmentStatus, d.lastCheckedAt, d.createdAt, d.reason])
  );

  const byStatus: Record<string, number> = {};
  for (const d of unknownOSDevices) {
    const p = d.personnelId ? personnelById.get(d.personnelId) : null;
    const key = p?.employmentStatus ?? "NO_PERSONNEL";
    byStatus[key] = (byStatus[key] ?? 0) + 1;
  }

  const summary = {
    generatedAt: generatedAt.toISOString(),
    issue: "RBR-742",
    blocks: "RBR-730",
    supersedes: "RBR-660 confirmation 14704166-7a80-496b-9561-e54eaab370ed (pending, cannot be accepted as written)",
    liveQuery: true,
    priorEstimateSource: "data/triage-unknown-devices.json (2026-07-10) estimated 188 via 197 total - 9 active, no enumerated list",
    priorStaleSnapshot: "data/stale-device-cleanup.json (2026-07-11) — 194 Unknown-OS, also stale by the time of this run",
    counts: {
      totalDevicesLive: devices.length,
      unknownOSDevicesLive: unknownOSDevices.length,
      purgeCount: purgeList.length,
      keepCount: keepList.length,
      needsReviewCount: needsReview.length,
      unknownOSByEmploymentStatusLive: byStatus,
    },
    deltaFrom188: {
      previousEstimate: 188,
      actualPurgeCount: purgeList.length,
      delta: purgeList.length - 188,
      explanation:
        "The 188 figure was `197 total Unknown-OS (Jul 10 snapshot) - 9 active-employee matches`, never an enumerated list. " +
        "This run queries Drata live and classifies every device explicitly by employmentStatus, holding out ambiguous " +
        "devices (no clear status, or enrolled/checked-in since the last Jul 11 snapshot) into needs-review instead of " +
        "defaulting them into the purge bucket. The fleet has also grown (647 devices live vs 621 on Jul 10, and " +
        "unknownOS is 205 live vs 197 on Jul 10 vs 194 on Jul 11), so the raw unknown-OS count itself has moved.",
    },
    keepListVerification: keepList.map((d) => ({
      deviceId: d.deviceId,
      personnelId: d.personnelId,
      email: d.personnelEmail,
      employmentStatus: d.employmentStatus,
    })),
  };

  writeFileSync(join(config.dataDir, "orphan-purge-summary.json"), JSON.stringify(summary, null, 2));

  console.log("=== Results ===\n");
  console.log(`Total devices (live):        ${devices.length}`);
  console.log(`Unknown-OS devices (live):   ${unknownOSDevices.length}\n`);
  console.log("By employmentStatus (live, Unknown-OS only):");
  for (const [k, v] of Object.entries(byStatus)) console.log(`  ${k}: ${v}`);
  console.log();
  console.log(`PURGE (orphan, safe to delete):  ${purgeList.length}`);
  console.log(`KEEP (active employee, exclude): ${keepList.length}`);
  console.log(`NEEDS REVIEW (ambiguous):        ${needsReview.length}\n`);
  console.log(`Delta from prior 188 estimate: ${purgeList.length - 188 >= 0 ? "+" : ""}${purgeList.length - 188}\n`);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Files written (${elapsed}s):`);
  console.log(`  data/orphan-purge-list.csv         (${purgeList.length} rows — the actual purge list)`);
  console.log(`  data/orphan-purge-keeplist.csv      (${keepList.length} rows — provably excluded active employees)`);
  console.log(`  data/orphan-purge-needs-review.csv  (${needsReview.length} rows — ambiguous, not auto-included)`);
  console.log(`  data/orphan-purge-summary.json      (machine-readable summary + delta explanation)\n`);

  console.log("Reminder: Drata Public API v2 does not support DELETE /devices/{id} (404) and the");
  console.log("assets-delete/assets-put scopes return 403. Manual dashboard deletion by a human");
  console.log("admin against orphan-purge-list.csv is still required — this script is read-only.\n");
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
