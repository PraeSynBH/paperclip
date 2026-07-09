import { DrataClient } from "./client.js";
import { mapDrataToIso, summarizeCoverage } from "../iso27001/mapping.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { assertConfigSync, config } from "../config.js";
import type { DrataControl, DrataFramework } from "./types.js";

interface SyncResult {
  timestamp: string;
  controls: DrataControl[];
  frameworks: DrataFramework[];
}

async function main() {
  assertConfigSync();
  const client = new DrataClient();

  console.log("=== Aira: Drata API Connectivity Test ===\n");

  // 1. Company info
  console.log("1. Company info...");
  try {
    const company = await client.getCompany();
    console.log(`   Company: ${company.name} (ID: ${company.id})\n`);
  } catch (err: any) {
    console.log(`   Error: ${err.message}\n`);
  }

  // 2. Workspaces
  console.log("2. Workspaces...");
  try {
    const workspaces = await client.listWorkspaces({ size: 10 });
    console.log(`   Found ${workspaces.data.length} workspace(s)`);
    for (const ws of workspaces.data) {
      console.log(`   - ${ws.name} (ID: ${ws.id}, Default: ${ws.isDefault})`);
    }
    console.log();
  } catch (err: any) {
    console.log(`   Error: ${err.message}\n`);
  }

  // 3. Frameworks
  console.log("3. Frameworks...");
  try {
    const frameworks = await client.getAllFrameworks();
    console.log(`   Found ${frameworks.length} framework(s):`);
    for (const fw of frameworks) {
      console.log(`   - ${fw.name}${fw.version ? ` v${fw.version}` : ""} (ID: ${fw.id})`);
    }
    console.log();
  } catch (err: any) {
    console.log(`   Error: ${err.message}\n`);
  }

  // 4. Controls
  console.log("4. Controls (fetching all with frameworks, owners, tests)...");
  try {
    const controls = await client.getAllControls();
    console.log(`   Found ${controls.length} control(s):`);
    for (const ctrl of controls.slice(0, 20)) {
      const fwNames = ctrl.frameworks?.map((f) => f.name).join(", ") ?? "none";
      console.log(`   - ${ctrl.name} [${ctrl.status}]` + (fwNames !== "none" ? ` — Frameworks: ${fwNames}` : ""));
    }
    if (controls.length > 20) console.log(`   ... and ${controls.length - 20} more`);
    console.log();
  } catch (err: any) {
    console.log(`   Error: ${err.message}\n`);
  }

  // 5. Monitoring Tests
  console.log("5. Monitoring Tests...");
  try {
    const tests = await client.getAllMonitoringTests();
    console.log(`   Found ${tests.length} monitoring test(s)`);
    const passCount = tests.filter((t) => t.status === "pass").length;
    const failCount = tests.filter((t) => t.status === "fail").length;
    console.log(`   Pass: ${passCount}, Fail: ${failCount}, Other: ${tests.length - passCount - failCount}`);
    console.log();
  } catch (err: any) {
    console.log(`   Error: ${err.message}\n`);
  }

  // 6. Devices (compliance posture)
  console.log("6. Devices...");
  try {
    const devices = await client.getAllDevices();
    console.log(`   Found ${devices.length} device(s)`);
    const compliant = devices.filter((d) => d.isDeviceCompliant).length;
    console.log(`   Compliant: ${compliant}/${devices.length}`);
    console.log();
  } catch (err: any) {
    console.log(`   Error: ${err.message}\n`);
  }

  // 7. Personnel
  console.log("7. Personnel...");
  try {
    const personnel = await client.getAllPersonnel();
    console.log(`   Found ${personnel.length} person(s)`);
    const byStatus: Record<string, number> = {};
    for (const p of personnel) {
      byStatus[p.employmentStatus] = (byStatus[p.employmentStatus] ?? 0) + 1;
    }
    for (const [status, count] of Object.entries(byStatus)) {
      console.log(`   ${status}: ${count}`);
    }
    console.log();
  } catch (err: any) {
    console.log(`   Error: ${err.message}\n`);
  }

  // 8. Vendors
  console.log("8. Vendors...");
  try {
    const vendors = await client.getAllVendors();
    console.log(`   Found ${vendors.length} vendor(s)`);
    console.log();
  } catch (err: any) {
    console.log(`   Error: ${err.message}\n`);
  }

  // 9. Users
  console.log("9. Users...");
  try {
    const users = await client.getAllUsers();
    console.log(`   Found ${users.length} user(s)`);
    console.log();
  } catch (err: any) {
    console.log(`   Error: ${err.message}\n`);
  }

  // 10. Policies
  console.log("10. Policies...");
  try {
    const policies = await client.getAllPolicies();
    console.log(`   Found ${policies.length} polic(ies)`);
    for (const p of policies.slice(0, 10)) {
      console.log(`   - ${p.name} [${p.status}]`);
    }
    if (policies.length > 10) console.log(`   ... and ${policies.length - 10} more`);
    console.log();
  } catch (err: any) {
    console.log(`   Error: ${err.message}\n`);
  }

  // 11. Assets
  console.log("11. Assets...");
  try {
    const assets = await client.getAllAssets();
    console.log(`   Found ${assets.length} asset(s)`);
    const physical = assets.filter((a) => a.assetType === "PHYSICAL").length;
    const virtual = assets.filter((a) => a.assetType === "VIRTUAL").length;
    console.log(`   Physical: ${physical}, Virtual: ${virtual}`);
    if (assets.length > 0) {
      console.log(`   Sample: ${assets[0].name} [${assets[0].assetType}] provider=${assets[0].assetProvider}`);
    }
    console.log();
  } catch (err: any) {
    console.log(`   Error: ${err.message}\n`);
  }

  // 12. Events (audit log)
  console.log("12. Events (audit log)...");
  try {
    const eventsPage = await client.listEvents({ size: 5, sort: "createdAt", sortDir: "DESC" });
    console.log(`   Found ${eventsPage.data.length} recent event(s)`);
    for (const ev of eventsPage.data.slice(0, 5)) {
      console.log(`   - [${ev.createdAt}] ${ev.eventType}: ${ev.description?.slice(0, 100) ?? "no description"}`);
    }
    console.log();
  } catch (err: any) {
    console.log(`   Error: ${err.message}\n`);
  }

  // 13. ISO 27001 mapping
  console.log("13. ISO 27001:2022 Annex A mapping (controls may be unavailable due to API key scoping)...");
  try {
    const controls = await client.getAllControls();
    const frameworks = await client.getAllFrameworks();

    const synced: SyncResult = {
      timestamp: new Date().toISOString(),
      controls,
      frameworks,
    };

    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(
      join(config.dataDir, "drata-sync.json"),
      JSON.stringify(synced, null, 2)
    );
    console.log(`   Synced ${controls.length} controls and ${frameworks.length} frameworks to data/drata-sync.json`);

    const mapping = mapDrataToIso(controls, frameworks);
    const summary = summarizeCoverage(mapping);

    console.log(`\n=== ISO 27001:2022 Coverage Summary ===`);
    console.log(`Total controls: ${summary.totalIsoControls}`);
    console.log(`Full coverage: ${summary.full}`);
    console.log(`Partial coverage: ${summary.partial}`);
    console.log(`No coverage: ${summary.none}`);
    console.log(`Overall coverage: ${summary.percentageWithCoverage}%\n`);

    console.log("By category:");
    for (const [, data] of Object.entries(summary.byCategory)) {
      console.log(`  ${data.category}: ${data.full + data.partial}/${data.total} covered`);
    }

    if (summary.gapControls.length > 0) {
      console.log(`\nGap controls (no Drata coverage):`);
      for (const gap of summary.gapControls.slice(0, 15)) {
        console.log(`  - ${gap.id} ${gap.title}`);
      }
      if (summary.gapControls.length > 15) {
        console.log(`  ... and ${summary.gapControls.length - 15} more`);
      }
    }

    writeFileSync(
      join(config.dataDir, "iso27001-coverage.json"),
      JSON.stringify({ summary, mapping }, null, 2)
    );
    console.log(`\n   Coverage report saved to data/iso27001-coverage.json`);
  } catch (err: any) {
    console.log(`   Note: Controls/frameworks endpoints returned ${err.status ?? "error"} — API key needs additional scopes.\n`);
  }

  console.log("\n=== Connectivity test complete ===");
}

main().catch(console.error);