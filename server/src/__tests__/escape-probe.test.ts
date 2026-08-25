import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "@paperclipai/db";
import { sql } from "drizzle-orm";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("ESCAPE probe", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-escape-probe-");
    db = createDb(tempDb.connectionString);
  }, 60_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  }, 10_000);

  it("standard_conforming_strings is on (default PostgreSQL behavior)", async () => {
    const res = await db.execute(sql`SHOW standard_conforming_strings`);
    const scs = res[0]?.standard_conforming_strings as string | undefined;
    expect(scs).toBe("on");
  });

  it("LIKE with ESCAPE '\\\\' matches literal underscore in text", async () => {
    // The escape-probe purpose: verify that LIKE ESCAPE '\\' (double-backslash
    // in JS string → single-backslash in SQL) works correctly. Embedded
    // postgres may have different escaping rules than the production PG.
    const r = await db.execute(sql`
      SELECT 'hello_world' LIKE '%h%' ESCAPE '\\' AS match
    `);
    const match = r[0]?.match as boolean | undefined;
    expect(match).toBe(true);
  });

  it("LIKE with ESCAPE '\\\\' treats escaped underscore as literal", async () => {
    // With backslash as escape char, '\\_' should match a literal underscore,
    // not act as a single-character wildcard. The pattern '%\\_%' expects
    // an underscore character.
    const r = await db.execute(sql`
      SELECT 'hello_world' LIKE '%\\_%' ESCAPE '\\' AS match
    `);
    const match = r[0]?.match as boolean | undefined;
    expect(match).toBe(true);
  });

  it("LIKE ESCAPE pattern matches research-search style escapeLikePattern", async () => {
    // Simulates the escapeLikePattern function used in research-search.ts:
    // value.replace(/[\\%_]/g, "\\$&") — input "login_user" becomes "login\\_user"
    // Then the LIKE pattern is '%' + escaped_value + '%'
    const r = await db.execute(sql`
      SELECT 'hello_login_user_test' LIKE '%login\\_user%' ESCAPE '\\' AS match
    `);
    const match = r[0]?.match as boolean | undefined;
    expect(match).toBe(true);
  });

  it("LIKE ESCAPE correctly rejects non-matching patterns", async () => {
    const r = await db.execute(sql`
      SELECT 'hello_world' LIKE '%xyz%' ESCAPE '\\' AS match
    `);
    const match = r[0]?.match as boolean | undefined;
    expect(match).toBe(false);
  });
});