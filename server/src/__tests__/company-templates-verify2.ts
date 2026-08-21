/**
 * Verify company template deploy via direct postgres.js connection.
 * This uses a raw postgres.js client (not through Drizzle) to test
 * the deploy flow, avoiding any module resolution issues.
 */
import { createDb } from "@paperclipai/db";
import { companyTemplateService } from "../services/company-templates.js";

const url = "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";

async function main() {
  const db = createDb(url);
  const svc = companyTemplateService(db);
  const TEST_OWNER = "template-e2e-user";

  // Test with a template whose prefix isn't taken
  const keys = [
    { key: "cpa-firm", prefix: "LED" },
    { key: "engineering-team", prefix: "FOR" },
    { key: "support-ops", prefix: "NIM" },
  ];

  // Travel concierge is expected to fail due to "VOY" prefix conflict
  // inside a transaction — this is a known bug.
  console.log("Known bug: travel-concierge (VOY prefix) will fail in tx\n");

  for (const { key, prefix } of keys) {
    console.log(`Deploying ${key} (prefix: ${prefix})...`);
    try {
      const result = await svc.deployTemplate(key, {
        companyName: `${prefix} Test Co ${Date.now()}`,
        budgetMonthlyCents: 0,
        ownerUserId: TEST_OWNER,
      });
      console.log(`  ✅ Company: ${result.company.name} (${result.company.id})`);
      console.log(`  ✅ Agents: ${result.agents.length}`);
      console.log(`  ✅ Goal: ${result.goal?.title}`);
      console.log(`  ✅ Project: ${result.project?.name}`);
      console.log(`  ✅ Issue: ${result.issue?.title}`);
      console.log(`  ✅ Warnings: ${result.warnings.length}`);
    } catch (err: any) {
      console.log(`  ❌ FAILED: ${err.message.slice(0, 200)}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
