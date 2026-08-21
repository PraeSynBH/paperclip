import { createDb } from "@paperclipai/db";
import { companyTemplateService } from "../services/company-templates.js";

const url = "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";

async function main() {
  const db = createDb(url);
  const svc = companyTemplateService(db);

  console.log("Testing travel-concierge deploy (VOY prefix conflict)...");
  try {
    const result = await svc.deployTemplate("travel-concierge", {
      companyName: "Voyager Concierge FixTest " + Date.now(),
      budgetMonthlyCents: 0,
      ownerUserId: "fix-verify-user",
    });
    console.log(`  ✅ Company: ${result.company.name} (${result.company.id})`);
    console.log(`  ✅ Agents: ${result.agents.length}`);
    for (const a of result.agents) console.log(`     ${a.name} (${a.role})`);
    console.log(`  ✅ Goal: ${result.goal?.title}`);
    console.log(`  ✅ Project: ${result.project?.name}`);
    console.log(`  ✅ Issue: ${result.issue?.title}`);
  } catch (err: any) {
    console.log(`  ❌ FAILED: ${err.message.slice(0, 300)}`);
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
