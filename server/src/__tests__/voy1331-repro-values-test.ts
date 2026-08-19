/**
 * Test if .values() call changes the behavior
 */
import { createDb } from "@paperclipai/db";

const CONNECTION = "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";

async function main() {
  const db = createDb(CONNECTION);
  const client = (db as any).$client as any;

  const query = `select "id", "title", "summary", ts_rank(
          to_tsvector('english', "title" || ' ' || coalesce("body", '')),
          plainto_tsquery('english', $1)
        ) as "score"
        from "knowledge_documents"
        where to_tsvector('english', "knowledge_documents"."title" || ' ' || coalesce("knowledge_documents"."body", '')) @@ plainto_tsquery('english', $2)
        order by score DESC
        limit $3`;

  const params = ['deploy', 'deploy', 10];

  console.log('=== Test: .values() ===');
  try {
    const rows = await client.unsafe(query, params).values();
    console.log('SUCCESS: rows =', rows.length);
  } catch (err: any) {
    console.error('ERROR:', err.message || err);
    console.error('PG code:', err.code);
  }

  // Also try with a modified query - use position instead of alias
  const query2 = `select "id", "title", "summary", ts_rank(
          to_tsvector('english', "title" || ' ' || coalesce("body", '')),
          plainto_tsquery('english', $1)
        ) as "score"
        from "knowledge_documents"
        where to_tsvector('english', "knowledge_documents"."title" || ' ' || coalesce("knowledge_documents"."body", '')) @@ plainto_tsquery('english', $2)
        order by 4 DESC
        limit $3`;

  console.log('\n=== Test: .values() with ORDER BY position ===');
  try {
    const rows = await client.unsafe(query2, params).values();
    console.log('SUCCESS: rows =', rows.length);
  } catch (err: any) {
    console.error('ERROR:', err.message || err);
    console.error('PG code:', err.code);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exitCode = 1;
});
