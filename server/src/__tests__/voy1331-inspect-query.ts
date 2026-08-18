// Inspect the compiled SQL query without needing a database connection
import { and, eq, sql } from "drizzle-orm";
import { createDb } from "@paperclipai/db";

// Create a minimal db just for dialect compilation
const db = createDb("postgres://localhost:5432/nonexistent");

const companyId = "00000000-0000-0000-0000-000000000001";
const query = "deploy";
const searchLimit = 10;

// Build the query like searchPublished does
const qb = db
  .select({
    id: sql`id`,
    title: sql`title`,
    summary: sql`summary`,
    score: sql<number>`ts_rank(
      to_tsvector('english', title || ' ' || coalesce(body, '')),
      plainto_tsquery('english', ${query})
    )`,
  })
  .from(sql`knowledge_documents`)
  .where(
    sql`company_id = ${companyId} AND status = 'published' AND to_tsvector('english', title || ' ' || coalesce(body, '')) @@ plainto_tsquery('english', ${query})`,
  )
  .orderBy(sql`score DESC`)
  .limit(searchLimit);

// @ts-expect-error - internal API
const dialect = qb._.dialect;
// @ts-expect-error - internal API
const queryObj = qb._.query;

let compiled;
try {
  // @ts-expect-error - internal API
  compiled = dialect.sqlToQuery(queryObj.sql);
} catch (e) {
  // Try the query object directly
  compiled = { sql: String(queryObj.sql), params: [] };
}

console.log("=== Compiled SQL ===");
console.log("SQL:", compiled.sql);
console.log("Params:", JSON.stringify(compiled.params));
console.log("Params count:", compiled.params?.length);

// Also try building the exact searchPublished query with table references
const qb2 = db
  .select({
    id: sql`id`,
    title: sql`title`,
    summary: sql`summary`,
    score: sql<number>`ts_rank(
      to_tsvector('english', title || ' ' || coalesce(body, '')),
      plainto_tsquery('english', ${query})
    )`,
  })
  .from(sql`knowledge_documents`)
  .where(
    sql`company_id = ${companyId} AND status = 'published' AND to_tsvector('english', title || ' ' || coalesce(body, '')) @@ plainto_tsquery('english', ${query})`,
  )
  .orderBy(sql`score DESC`)
  .limit(searchLimit);

// @ts-expect-error - internal API
const compiled2 = qb2._.dialect.sqlToQuery(qb2._.query.sql);
console.log("\n=== Compiled SQL (v2) ===");
console.log("SQL:", compiled2.sql);
console.log("Params:", JSON.stringify(compiled2.params));

process.exit(0);