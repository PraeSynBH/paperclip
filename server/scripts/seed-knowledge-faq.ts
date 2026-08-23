#!/usr/bin/env node
/**
 * Seed FAQ knowledge documents into a company's knowledge base.
 *
 * Usage:
 *   npx tsx server/scripts/seed-knowledge-faq.ts <companyId>
 *
 * This script creates published knowledge documents from the FAQ seed data
 * for the specified company. It skips documents that already exist with the
 * same title to avoid duplicates.
 */

import { createDb } from "@paperclipai/db";
import { knowledgeDocuments } from "@paperclipai/db";
import { eq, and } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface FaqEntry {
  title: string;
  summary: string;
  body: string;
}

async function main() {
  const companyId = process.argv[2];
  if (!companyId) {
    console.error("Usage: npx tsx server/scripts/seed-knowledge-faq.ts <companyId>");
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL environment variable is required");
    process.exit(1);
  }

  const db = createDb(dbUrl);

  // Read seed data
  const seedDataPath = resolve(__dirname, "../src/knowledge-faq-seed-data.json");
  const faqEntries: FaqEntry[] = JSON.parse(readFileSync(seedDataPath, "utf-8"));

  console.log(`Seeding ${faqEntries.length} FAQ documents for company ${companyId}...`);

  let created = 0;
  let skipped = 0;

  for (const entry of faqEntries) {
    // Check if document with this title already exists
    const existing = await db
      .select({ id: knowledgeDocuments.id })
      .from(knowledgeDocuments)
      .where(
        and(
          eq(knowledgeDocuments.companyId, companyId),
          eq(knowledgeDocuments.title, entry.title),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (existing) {
      console.log(`  SKIP  ${entry.title} (already exists)`);
      skipped++;
      continue;
    }

    await db.insert(knowledgeDocuments).values({
      companyId,
      title: entry.title,
      summary: entry.summary,
      body: entry.body,
      status: "published",
      version: 1,
      publishedAt: new Date(),
    });

    console.log(`  CREATED  ${entry.title}`);
    created++;
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});