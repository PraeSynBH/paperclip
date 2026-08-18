// Connect to the running embedded PG and test the search query
// This uses postgres.js DIRECTLY (not through drizzle) to isolate the issue
import postgres from "postgres";

const CONNECTION = "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";

async function main() {
  const sql = postgres(CONNECTION);

  // First test: simple query protocol (no params) - should work
  console.log("=== Test 1: Simple query protocol (no params) ===");
  try {
    const rows = await sql`SELECT 1 AS ok`;
    console.log("  Simple query works: rows[0].ok =", rows[0]?.ok);
  } catch (err: any) {
    console.error("  Simple query FAILED:", err.message);
  }

  // Second test: simple query protocol via unsafe with simple:true
  console.log("\n=== Test 2: unsafe() with no params (simple query protocol) ===");
  try {
    const rows = await sql.unsafe("SELECT 2 AS ok", []);
    console.log("  unsafe(no params) works: rows[0].ok =", rows[0]?.ok);
  } catch (err: any) {
    console.error("  unsafe(no params) FAILED:", err.message);
  }

  // Third test: extended query protocol via unsafe with params
  console.log("\n=== Test 3: unsafe() with params (extended query protocol) ===");
  try {
    const rows = await sql.unsafe("SELECT $1::int AS val", [42]);
    console.log("  unsafe(params) works: rows[0].val =", rows[0]?.val);
  } catch (err: any) {
    console.error("  unsafe(params) FAILED:", err.message);
  }

  // Fourth test: the actual search query shape
  console.log("\n=== Test 4: Search-shaped query with params ===");
  const query = "deploy";
  const companyId = "ce49ee2f-48ea-43f1-99c3-fd78c119f32e";
  try {
    const searchSql = `
      SELECT "id", "title", "summary",
        ts_rank(
          to_tsvector('english', "title" || ' ' || coalesce("body", '')),
          plainto_tsquery('english', $1)
        ) as "score"
      FROM "knowledge_documents"
      WHERE "company_id" = $2
        AND "status" = $3
        AND to_tsvector('english', "title" || ' ' || coalesce("body", '')) @@ plainto_tsquery('english', $4)
      ORDER BY "score" DESC
      LIMIT $5
    `;
    const rows = await sql.unsafe(searchSql, [query, companyId, "published", query, 10]);
    console.log("  Search query works: rows =", rows.length);
  } catch (err: any) {
    console.error("  Search query FAILED:", err.message);
    console.error("  Code:", err.code, "Severity:", err.severity);
  }

  // Fifth test: search query with drizzle's serializer overrides
  console.log("\n=== Test 5: Search query WITH drizzle serializer overrides ===");
  const transparentParser = (val: any) => val;
  for (const type of ["1184", "1082", "1083", "1114", "1182", "1185", "1115", "1231"]) {
    (sql as any).options.parsers[type] = transparentParser;
    (sql as any).options.serializers[type] = transparentParser;
  }
  (sql as any).options.serializers["114"] = transparentParser;
  (sql as any).options.serializers["3802"] = transparentParser;

  try {
    const searchSql2 = `
      SELECT "id", "title", "summary",
        ts_rank(
          to_tsvector('english', "title" || ' ' || coalesce("body", '')),
          plainto_tsquery('english', $1)
        ) as "score"
      FROM "knowledge_documents"
      WHERE "company_id" = $2
        AND "status" = $3
        AND to_tsvector('english', "title" || ' ' || coalesce("body", '')) @@ plainto_tsquery('english', $4)
      ORDER BY "score" DESC
      LIMIT $5
    `;
    const rows = await sql.unsafe(searchSql2, [query, companyId, "published", query, 10]);
    console.log("  Search query with serializers works: rows =", rows.length);
  } catch (err: any) {
    console.error("  Search query with serializers FAILED:", err.message);
    console.error("  Code:", err.code, "Severity:", err.severity);
  }

  await sql.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exitCode = 1;
});