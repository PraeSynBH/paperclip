import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "@paperclipai/db";
import { sql } from "drizzle-orm";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("ESCAPE probe", () => {
  let db: any;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-escape-probe-");
    // recreate createDb inline to avoid dependency issue
    const postgres = (await import("postgres")).default;
    const drizzle = (await import("drizzle-orm/postgres-js")).drizzle;
    const sqlClient = postgres(tempDb.connectionString, { prepare: false });
    db = drizzle(sqlClient);
  }, 60_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  }, 10_000);

  it("SHOW standard_conforming_strings and test ESCAPE", async () => {
    const res = await db.execute(sql`SHOW standard_conforming_strings`);
    const scs = res[0]?.standard_conforming_strings;
    console.log("standard_conforming_strings =", scs);
    expect(scs).toBeDefined();

    // Now test the ESCAPE pattern directly
    try {
      const r = await db.execute(sql`SELECT 'hello' LIKE '%h%' ESCAPE '\\'`);
      console.log("2-backslash ESCAPE works:", r);
    } catch (e: any) {
      console.log("2-backslash ESCAPE FAILED:", e.message);
    }

    try {
      const r = await db.execute(sql`SELECT 'hello' LIKE '%h%' ESCAPE '\'`);
      console.log("1-backslash ESCAPE works:", r);
    } catch (e: any) {
      console.log("1-backslash ESCAPE FAILED:", e.message);
    }

    // Test recherche-search pattern
    const pattern = "%login%";
    const x = sql`lower(coalesce(null, '')) LIKE ${pattern} ESCAPE '\\\\'`;
    try {
      const r = await db.execute(x);
      console.log("research-search ESCAPE pattern works:", r);
    } catch (e: any) {
      console.log("research-search ESCAPE pattern FAILED:", e.message);
    }

    await (db as any).close();
  }, 30_000);
});
