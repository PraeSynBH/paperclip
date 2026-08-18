/**
 * Diagnostic reproduction of the knowledge search 500 against the running
 * embedded PostgreSQL (port 54329).
 *
 * Tests the real searchPublished service query with better error diagnostics.
 */
import { randomUUID } from "node:crypto";
import { createDb } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import { knowledgeDocuments } from "@paperclipai/db";
import { knowledgeDocumentService } from "../services/knowledge-documents.js";

const CONNECTION = "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";

async function main() {
  const db = createDb(CONNECTION);
  const client = (db as any).$client as any;

  const companyId = randomUUID();
  const docId = randomUUID();
  const prefix = "VOY" + randomUUID().slice(0, 6).toUpperCase();

  // Seed company + published document using raw SQL (stale-schema safe)
  await client.unsafe(
    `INSERT INTO companies (id, name, issue_prefix, require_board_approval_for_new_agents) VALUES ($1, $2, $3, $4)`,
    [companyId, "Repro Co", prefix, false],
  );
  await client.unsafe(
    `INSERT INTO knowledge_documents (id, company_id, title, summary, body, status, version, published_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
    [
      docId,
      companyId,
      "Deployment guide",
      "How to deploy",
      "Step one: build the image. Step two: ship it.",
      "published",
      1,
    ],
  );

  // Test 1: Real searchPublished (as the repro does)
  console.log("\n=== Test 1: Real searchPublished ===");
  try {
    const svc = knowledgeDocumentService(db);
    const results = await svc.searchPublished(companyId, "deploy");
    console.log("SUCCESS: results =", JSON.stringify(results, null, 2));
  } catch (err: any) {
    console.error("ERROR:", err?.message || err);
    console.error("Stack:", err?.stack?.split("\n").slice(0, 6).join("\n"));
    console.error("Query:", err?.query);
    console.error("Params:", err?.params);
  }

  // Test 2: Same query via Drizzle SQL template
  console.log("\n=== Test 2: Drizzle SQL template ===");
  try {
    const rows = await db
      .select({
        id: knowledgeDocuments.id,
        title: knowledgeDocuments.title,
        summary: knowledgeDocuments.summary,
        score: sql<number>`ts_rank(
          to_tsvector('english', ${knowledgeDocuments.title} || ' ' || coalesce(${knowledgeDocuments.body}, '')),
          plainto_tsquery('english', ${"deploy"})
        )`,
      })
      .from(knowledgeDocuments)
      .where(
        sql`to_tsvector('english', ${knowledgeDocuments.title} || ' ' || coalesce(${knowledgeDocuments.body}, '')) @@ plainto_tsquery('english', ${"deploy"})`,
      )
      .orderBy(sql`score DESC`)
      .limit(10);
    console.log("SUCCESS: rows =", rows.length);
  } catch (err: any) {
    console.error("ERROR:", err?.message || err);
    console.error("Query:", err?.query);
    console.error("Params:", err?.params);
    // Check for cause/original error
    if ((err as any).cause) console.error("Cause:", (err as any).cause);
    if ((err as any).originalError) console.error("Original:", (err as any).originalError);
    if ((err as any).innerError) console.error("Inner:", (err as any).innerError);
  }

  // Test 3: Raw postgres.js query (not through Drizzle)
  console.log("\n=== Test 3: Raw postgres.js ===");
  try {
    const raw = await client.unsafe(
      `SELECT ts_rank(
        to_tsvector('english', 'hello world'),
        plainto_tsquery('english', $1)
      ) as score`,
      ["deploy"],
    );
    console.log("SUCCESS: rows =", raw.length);
  } catch (err: any) {
    console.error("ERROR:", err?.message || err);
    console.error("PG severity:", err.severity, "code:", err.code, "routine:", err.routine);
  }

  // Test 4: Simpler Drizzle query without tsvector
  console.log("\n=== Test 4: Simple Drizzle query (no full-text search) ===");
  try {
    const rows = await db
      .select({
        id: knowledgeDocuments.id,
        title: knowledgeDocuments.title,
      })
      .from(knowledgeDocuments)
      .limit(5);
    console.log("SUCCESS: rows =", rows.length, rows.map((r: any) => r.title));
  } catch (err: any) {
    console.error("ERROR:", err?.message || err);
  }

  // Test 5: Drizzle with plain ILIKE (non-tsvector)
  console.log("\n=== Test 5: Drizzle ILIKE (alternative search approach) ===");
  try {
    const rows = await db
      .select({
        id: knowledgeDocuments.id,
        title: knowledgeDocuments.title,
      })
      .from(knowledgeDocuments)
      .where(
        sql`${knowledgeDocuments.title} ILIKE ${"%" + "deploy" + "%"}`,
      )
      .limit(5);
    console.log("SUCCESS: rows =", rows.length, rows.map((r: any) => r.title));
  } catch (err: any) {
    console.error("ERROR:", err?.message || err);
  }

  // Cleanup
  await client.unsafe(`DELETE FROM knowledge_documents WHERE id = $1`, [docId]);
  await client.unsafe(`DELETE FROM companies WHERE id = $1`, [companyId]);

  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exitCode = 1;
});
