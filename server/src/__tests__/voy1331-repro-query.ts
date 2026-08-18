/**
 * Reproduction of the knowledge search 500 against the running
 * embedded PostgreSQL (port 54329).
 *
 * Seeds via raw SQL (the running cluster predates memory_record_id),
 * then calls the REAL searchPublished service query.
 */
import { randomUUID } from "node:crypto";
import { createDb } from "@paperclipai/db";
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

  try {
    console.log("Calling real searchPublished...");
    const svc = knowledgeDocumentService(db);
    const results = await svc.searchPublished(companyId, "deploy");
    console.log("SUCCESS: results =", JSON.stringify(results, null, 2));
  } catch (err: any) {
    console.error("ERROR:", err?.message || err);
    console.error("Stack:", err?.stack);
    console.error("Query:", err?.query);
    console.error("Params:", err?.params);
    process.exitCode = 1;
  }

  // Cleanup
  await client.unsafe(`DELETE FROM knowledge_documents WHERE id = $1`, [docId]);
  await client.unsafe(`DELETE FROM companies WHERE id = $1`, [companyId]);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exitCode = 1;
});