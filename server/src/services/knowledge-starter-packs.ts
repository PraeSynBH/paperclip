/**
 * Knowledge base starter packs — curated knowledge document bundles
 * for common industries, enabling one-click installation into a company
 * knowledge base.
 *
 * Each pack is a set of pre-written documents covering the key knowledge
 * areas a company in that industry typically needs. Installation creates
 * each document as published (skipping the draft→review→publish workflow
 * for starter content, since it is pre-reviewed).
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "@paperclipai/db";
import type {
  KnowledgeStarterPack,
  KnowledgeStarterPackInstallResult,
} from "@paperclipai/shared";
import { knowledgeDocumentService } from "./knowledge-documents.js";
import { logger } from "../middleware/logger.js";

// ─── Load pack data from JSON ────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKS_DIR = resolve(__dirname, "../knowledge-starter-packs-data");

function loadPacks(): KnowledgeStarterPack[] {
  const files = readdirSync(PACKS_DIR).filter((f: string) => f.endsWith(".json"));
  const packs: KnowledgeStarterPack[] = [];

  for (const file of files) {
    const content = readFileSync(resolve(PACKS_DIR, file), "utf-8");
    const pack = JSON.parse(content) as KnowledgeStarterPack;
    packs.push(pack);
  }

  return packs;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export interface KnowledgeStarterPackService {
  /** List all available starter packs (documents excluded — use getPack). */
  listPacks(): Promise<Omit<KnowledgeStarterPack, "documents">[]>;

  /** Get a single starter pack by key, including its documents. */
  getPack(packKey: string): Promise<KnowledgeStarterPack | null>;

  /**
   * Install a starter pack into a company's knowledge base.
   * Creates all documents as published in a single transaction.
   * Returns the IDs of the created documents.
   */
  installPack(
    companyId: string,
    packKey: string,
    actorAgentId?: string,
  ): Promise<KnowledgeStarterPackInstallResult>;
}

export function knowledgeStarterPackService(db: Db): KnowledgeStarterPackService {
  const knowledgeSvc = knowledgeDocumentService(db);
  const packs = loadPacks();

  async function listPacks(): Promise<Omit<KnowledgeStarterPack, "documents">[]> {
    return packs.map((pack) => ({
      key: pack.key,
      name: pack.name,
      description: pack.description,
      industry: pack.industry,
      icon: pack.icon,
      documentCount: pack.documentCount,
    }));
  }

  async function getPack(packKey: string): Promise<KnowledgeStarterPack | null> {
    return packs.find((p) => p.key === packKey) ?? null;
  }

  async function installPack(
    companyId: string,
    packKey: string,
    actorAgentId?: string,
  ): Promise<KnowledgeStarterPackInstallResult> {
    const pack = packs.find((p) => p.key === packKey);
    if (!pack) {
      throw new Error(`Starter pack '${packKey}' not found. Available packs: ${packs.map((p) => p.key).join(", ")}`);
    }

    // Check for existing documents with the same titles to avoid duplicates
    const existingDocs = await knowledgeSvc.list(companyId, { limit: 100 });
    const existingTitles = new Set(existingDocs.items.map((d) => d.title.toLowerCase()));

    const documentIds: string[] = [];
    let createdCount = 0;

    for (const doc of pack.documents) {
      // Skip if a document with the same title already exists
      if (existingTitles.has(doc.title.toLowerCase())) {
        logger.info(
          { companyId, packKey, title: doc.title },
          "Skipping existing knowledge document (title already exists)",
        );
        continue;
      }

      try {
        const created = await knowledgeSvc.create(
          companyId,
          {
            title: doc.title,
            summary: doc.summary,
            body: doc.body,
          },
          actorAgentId,
        );

        // Auto-publish: submit for review, approve, then publish
        // Since these are starter packs (pre-curated content), we fast-track
        // them through the review workflow.
        await knowledgeSvc.submitForReview(companyId, created.id, {}, actorAgentId);
        await knowledgeSvc.review(
          companyId,
          created.id,
          { status: "approved", comment: "Auto-approved (starter pack content)" },
          actorAgentId,
        );
        await knowledgeSvc.publish(companyId, created.id, { changeDescription: "Initial publication from starter pack" });

        documentIds.push(created.id);
        createdCount++;
      } catch (err) {
        logger.error(
          { err, companyId, packKey, title: doc.title },
          "Failed to create knowledge document from starter pack",
        );
        // Continue with remaining documents even if one fails
      }
    }

    logger.info(
      { companyId, packKey, createdCount, totalInPack: pack.documents.length },
      "Starter pack installed",
    );

    return {
      packKey,
      documentsCreated: createdCount,
      documentIds,
    };
  }

  return {
    listPacks,
    getPack,
    installPack,
  };
}
