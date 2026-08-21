/**
 * Minimal test: raw postgres.js transaction
 */
import { createDb } from "@paperclipai/db";
import { companies } from "@paperclipai/db/schema/index.js";

const url = "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";

async function main() {
  console.log("=== Test 1: Raw direct insert (no transaction) ===");
  const db1 = createDb(url);
  try {
    // Use the underlying SQL client directly through drizzle
    const rows = await db1.insert(companies).values({
      name: "direct-insert-test-" + Date.now(),
      description: "test",
      status: "active",
      issuePrefix: "DIT",
      budgetMonthlyCents: 0,
      spentMonthlyCents: 0,
    }).returning();
    console.log("  OK: inserted", rows[0].id);
  } catch (e: any) {
    console.log("  FAIL:", e.message);
  }

  console.log("=== Test 2: Transaction with simple insert ===");
  const db2 = createDb(url);
  try {
    const result = await db2.transaction(async (tx) => {
      const rows = await (tx as any).insert(companies).values({
        name: "tx-insert-test-" + Date.now(),
        description: "test",
        status: "active",
        issuePrefix: "TIT",
        budgetMonthlyCents: 0,
        spentMonthlyCents: 0,
      }).returning();
      console.log("  OK: inserted", rows[0].id);
      return rows[0];
    });
    console.log("  Transaction committed:", result.id);
  } catch (e: any) {
    console.log("  FAIL:", e.message);
    if ((e as any).cause) console.log("  Cause:", (e as any).cause.message);
  }

  console.log("=== Test 3: Transaction with insert + rollback ===");
  const db3 = createDb(url);
  try {
    await db3.transaction(async (tx) => {
      const rows = await (tx as any).insert(companies).values({
        name: "tx-rollback-test-" + Date.now(),
        description: "test",
        status: "active",
        issuePrefix: "TRT",
        budgetMonthlyCents: 0,
        spentMonthlyCents: 0,
      }).returning();
      console.log("  OK: inserted", rows[0].id);
      throw new Error("intentional rollback");
    });
  } catch (e: any) {
    console.log("  Expected rollback:", e.message);
  }

  console.log("=== Done ===");
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
