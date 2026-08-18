/**
 * Test the exact Drizzle-generated query via raw postgres.js
 */
import { createDb } from "@paperclipai/db";

const CONNECTION = "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";

async function main() {
  const db = createDb(CONNECTION);
  const client = (db as any).$client as any;

  // Exact query from Drizzle that fails
  const query = `select "id", "title", "summary", ts_rank(
          to_tsvector('english', "title" || ' ' || coalesce("body", '')),
          plainto_tsquery('english', $1)
        ) as "score"
        from "knowledge_documents"
        where to_tsvector('english', "knowledge_documents"."title" || ' ' || coalesce("knowledge_documents"."body", '')) @@ plainto_tsquery('english', $2)
        order by score DESC
        limit $3`;

  const params = ['deploy', 'deploy', 10];

  console.log('Testing exact Drizzle query via raw postgres.js...');
  console.log('Query:', query);
  console.log('Params:', params);

  try {
    const rows = await client.unsafe(query, params);
    console.log('SUCCESS: rows =', rows.length);
    if (rows.length > 0) console.log('First row:', JSON.stringify(rows[0]));
  } catch (err: any) {
    console.error('ERROR:', err.message || err);
    console.error('PG code:', err.code, 'severity:', err.severity, 'routine:', err.routine);
    console.error('Position:', err.position);
    // Show what's at the error position
    if (err.position) {
      const pos = parseInt(err.position);
      console.error('Context around position', pos, ':', JSON.stringify(query.slice(Math.max(0, pos - 20), pos + 20)));
    }
  }

  // Also test without the `score` alias in ORDER BY - use position instead
  const query2 = `select "id", "title", "summary", ts_rank(
          to_tsvector('english', "title" || ' ' || coalesce("body", '')),
          plainto_tsquery('english', $1)
        ) as "score"
        from "knowledge_documents"
        where to_tsvector('english', "knowledge_documents"."title" || ' ' || coalesce("knowledge_documents"."body", '')) @@ plainto_tsquery('english', $2)
        order by 3 DESC
        limit $3`;

  console.log('\nTesting with ORDER BY position (3)...');
  try {
    const rows = await client.unsafe(query2, params);
    console.log('SUCCESS: rows =', rows.length);
    if (rows.length > 0) console.log('First row:', JSON.stringify(rows[0]));
  } catch (err: any) {
    console.error('ERROR:', err.message || err);
    console.error('PG code:', err.code);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exitCode = 1;
});
