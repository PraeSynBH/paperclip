/**
 * Minimal test to isolate the transaction issue.
 */
import { createDb } from "@paperclipai/db";
import { companies } from "@paperclipai/db/schema/index.js";

const url = "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";
const db = createDb(url);

async function main() {
  console.log("Testing simple transaction...");
  
  try {
    await db.transaction(async (tx) => {
      console.log("tx type:", (tx as any).constructor?.name);
      
      // Try a simple insert
      const rows = await (tx as any).insert(companies).values({
        name: "minimal-tx-test-" + Date.now(),
        description: "test",
        status: "active",
        issuePrefix: "MTT",
        budgetMonthlyCents: 0,
        spentMonthlyCents: 0,
      }).returning();
      
      console.log("Inserted:", rows[0].id);
      throw new Error("rollback test"); // force rollback
    });
  } catch (err: any) {
    console.log("Transaction result:", err.message);
    if (err.cause) console.log("Cause:", (err.cause as any).message);
  }
  
  console.log("Done");
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
