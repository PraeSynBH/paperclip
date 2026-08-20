import { and, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  activityLog,
  agents,
  documents,
  issueComments,
  issueDocuments,
  issues,
} from "@paperclipai/db";
import { embeddingService, type EmbeddingService } from "./embedding.js";
import { logger } from "../middleware/logger.js";

/**
 * Research service — the actual work performed by background job
 * processors. Each function maps 1:1 to a job type:
 *
 * - `searchActivity`          → research.activity_search
 * - `searchKeywordFirst`      → research.semantic_search (sync keyword pass)
 * - `upgradeSemanticResults`  → research.semantic_search (async upgrade)
 * - `autoAssess`              → research.auto_assess
 *
 * All functions are self-contained: they take a companyId + payload and
 * return a JSON-serializable result that gets stored on the job row.
 */

export interface ActivitySearchPayload {
  query: string;
  scope?: "issues" | "activity" | "documents" | "all";
  limit?: number;
}

export interface SemanticSearchPayload {
  query: string;
  scope?: "issues" | "activity" | "documents" | "all";
  limit?: number;
  /** Ids of the keyword-first results the semantic pass should re-rank. */
  candidateIds?: string[];
}

export interface AutoAssessPayload {
  /** Research item ids to assess. Empty = assess the company's most recent research items. */
  itemIds?: string[];
  limit?: number;
}

interface ResearchHit {
  id: string;
  type: "issue" | "document" | "activity";
  title: string;
  snippet: string | null;
  updatedAt: string;
  score: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

function toTokenArray(values: string[]) {
  if (values.length === 0) return sql`ARRAY[]::text[]`;
  return sql`ARRAY[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;
}

function tokenMatchExpression(text: SQL, tokens: SQL) {
  return sql<boolean>`
    EXISTS (
      SELECT 1 FROM unnest(${tokens}) AS t(value)
      WHERE lower(coalesce(${text}, '')) LIKE '%' || t.value || '%' ESCAPE '\\'
    )
  `;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/**
 * Search across issues, documents, and activity log by keyword.
 * This is the "keyword-first" pass — fast, deterministic, no embeddings.
 */
export function researchSearchService(db: Db) {
  const embed = embeddingService();

  function scoreTitle(title: string, normalizedQuery: string, tokens: string[]): number {
    const lower = title.toLowerCase();
    let score = 0;
    if (lower.includes(normalizedQuery)) score += 60;
    if (lower.startsWith(normalizedQuery)) score += 20;
    for (const token of tokens) {
      if (lower.includes(token)) score += 10;
    }
    return score;
  }

  async function searchIssues(
    companyId: string,
    normalizedQuery: string,
    tokens: string[],
    limit: number,
  ): Promise<ResearchHit[]> {
    const escapedQuery = escapeLikePattern(normalizedQuery);
    const containsPattern = `%${escapedQuery}%`;
    const tokenArray = toTokenArray(tokens.map(escapeLikePattern));

    const rows = await db
      .select({
        id: issues.id,
        identifier: issues.identifier,
        title: issues.title,
        description: issues.description,
        updatedAt: issues.updatedAt,
      })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, companyId),
          or(
            ilike(issues.title, containsPattern),
            sql<boolean>`lower(coalesce(${issues.identifier}, '')) LIKE ${containsPattern} ESCAPE '\\'`,
            sql<boolean>`lower(coalesce(${issues.description}, '')) LIKE ${containsPattern} ESCAPE '\\'`,
            tokenMatchExpression(sql`${issues.title}`, tokenArray),
            tokenMatchExpression(sql`${issues.description}`, tokenArray),
            sql<boolean>`
              EXISTS (
                SELECT 1 FROM issue_comments sc
                WHERE sc.company_id = ${companyId}
                  AND sc.issue_id = issues.id
                  AND sc.deleted_at IS NULL
                  AND (
                    lower(sc.body) LIKE ${containsPattern} ESCAPE '\\'
                    OR ${tokenMatchExpression(sql`sc.body`, tokenArray)}
                  )
              )
            `,
            sql<boolean>`
              EXISTS (
                SELECT 1 FROM issue_documents sid
                INNER JOIN documents sd ON sd.id = sid.document_id
                WHERE sid.company_id = ${companyId}
                  AND sd.company_id = ${companyId}
                  AND sid.issue_id = issues.id
                  AND (
                    lower(coalesce(sd.title, '')) LIKE ${containsPattern} ESCAPE '\\'
                    OR lower(coalesce(sd.latest_body, '')) LIKE ${containsPattern} ESCAPE '\\'
                    OR ${tokenMatchExpression(sql`sd.title`, tokenArray)}
                    OR ${tokenMatchExpression(sql`sd.latest_body`, tokenArray)}
                  )
              )
            `,
          ),
        ),
      )
      .orderBy(desc(issues.updatedAt))
      .limit(limit);

    return rows.map((row) => {
      const description = row.description ?? "";
      const matchIndex = description.toLowerCase().indexOf(normalizedQuery);
      const snippet =
        matchIndex >= 0
          ? `...${description.slice(Math.max(0, matchIndex - 60), matchIndex + 120)}...`
          : (row.description ?? "").slice(0, 160);
      const title = row.identifier ? `${row.identifier} ${row.title}` : row.title;
      return {
        id: row.id,
        type: "issue" as const,
        title,
        snippet: snippet.length > 0 ? snippet : null,
        updatedAt: row.updatedAt.toISOString(),
        score: scoreTitle(title, normalizedQuery, tokens),
      };
    });
  }

  async function searchDocuments(
    companyId: string,
    normalizedQuery: string,
    tokens: string[],
    limit: number,
  ): Promise<ResearchHit[]> {
    const escapedQuery = escapeLikePattern(normalizedQuery);
    const containsPattern = `%${escapedQuery}%`;
    const tokenArray = toTokenArray(tokens.map(escapeLikePattern));

    const rows = await db
      .select({
        id: documents.id,
        title: documents.title,
        latestBody: documents.latestBody,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(
        and(
          eq(documents.companyId, companyId),
          or(
            ilike(documents.title, containsPattern),
            sql<boolean>`lower(coalesce(${documents.latestBody}, '')) LIKE ${containsPattern} ESCAPE '\\'`,
            tokenMatchExpression(sql`${documents.title}`, tokenArray),
            tokenMatchExpression(sql`${documents.latestBody}`, tokenArray),
          ),
        ),
      )
      .orderBy(desc(documents.updatedAt))
      .limit(limit);

    return rows.map((row) => {
      const body = row.latestBody ?? "";
      const matchIndex = body.toLowerCase().indexOf(normalizedQuery);
      const snippet =
        matchIndex >= 0
          ? `...${body.slice(Math.max(0, matchIndex - 60), matchIndex + 120)}...`
          : body.slice(0, 160);
      return {
        id: row.id,
        type: "document" as const,
        title: row.title ?? body.slice(0, 80),
        snippet: snippet.length > 0 ? snippet : null,
        updatedAt: row.updatedAt.toISOString(),
        score: scoreTitle(row.title ?? body.slice(0, 80), normalizedQuery, tokens),
      };
    });
  }

  async function searchActivity(
    companyId: string,
    normalizedQuery: string,
    tokens: string[],
    limit: number,
  ): Promise<ResearchHit[]> {
    const escapedQuery = escapeLikePattern(normalizedQuery);
    const containsPattern = `%${escapedQuery}%`;
    const tokenArray = toTokenArray(tokens.map(escapeLikePattern));

    const rows = await db
      .select({
        id: activityLog.id,
        entityType: activityLog.entityType,
        entityId: activityLog.entityId,
        action: activityLog.action,
        createdAt: activityLog.createdAt,
      })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.companyId, companyId),
          or(
            sql<boolean>`lower(coalesce(${activityLog.action}, '')) LIKE ${containsPattern} ESCAPE '\\'`,
            tokenMatchExpression(sql`${activityLog.action}`, tokenArray),
            sql<boolean>`lower(coalesce(${activityLog.details}::text, '')) LIKE ${containsPattern} ESCAPE '\\'`,
          ),
        ),
      )
      .orderBy(desc(activityLog.createdAt))
      .limit(limit);

    return rows.map((row) => {
      const action = row.action ?? "";
      const matchIndex = action.toLowerCase().indexOf(normalizedQuery);
      const snippet =
        matchIndex >= 0
          ? `...${action.slice(Math.max(0, matchIndex - 60), matchIndex + 120)}...`
          : action.slice(0, 160);
      return {
        id: row.id,
        type: "activity" as const,
        title: action.slice(0, 80),
        snippet: snippet.length > 0 ? snippet : null,
        updatedAt: row.createdAt.toISOString(),
        score: scoreTitle(action, normalizedQuery, tokens),
      };
    });
  }

  // Internal keyword-first search — shared by the public `searchKeywordFirst`
  // method (sync path) and `upgradeSemanticResults` (candidate pool).
  async function keywordSearch(
    companyId: string,
    payload: ActivitySearchPayload,
  ): Promise<{ query: string; results: ResearchHit[]; total: number }> {
    const normalizedQuery = normalizeQuery(payload.query);
    const tokens = normalizedQuery
      .split(/\s+/)
      .filter((t) => t.length >= 2)
      .slice(0, 8);
    const limit = clampLimit(payload.limit);
    const scope = payload.scope ?? "all";

    if (normalizedQuery.length === 0) {
      return { query: payload.query, results: [], total: 0 };
    }

    const results: ResearchHit[] = [];
    if (scope === "all" || scope === "issues") {
      results.push(...(await searchIssues(companyId, normalizedQuery, tokens, limit)));
    }
    if (scope === "all" || scope === "documents") {
      results.push(...(await searchDocuments(companyId, normalizedQuery, tokens, limit)));
    }
    if (scope === "all" || scope === "activity") {
      results.push(...(await searchActivity(companyId, normalizedQuery, tokens, limit)));
    }

    // Dedupe by (type,id), keep the highest score, sort by score desc
    const seen = new Map<string, ResearchHit>();
    for (const hit of results) {
      const key = `${hit.type}:${hit.id}`;
      const existing = seen.get(key);
      if (!existing || hit.score > existing.score) seen.set(key, hit);
    }
    const merged = Array.from(seen.values()).sort((a, b) => b.score - a.score);
    return { query: payload.query, results: merged.slice(0, limit), total: merged.length };
  }

  return {
    /**
     * Keyword-first search. Returns results immediately — this is what the
     * sync part of POST /research/search serves.
     */
    searchKeywordFirst: keywordSearch,

    /**
     * Semantic upgrade pass. Reranks keyword-first candidate ids using
     * cosine similarity against the query embedding. When no embedding
     * provider is configured, falls back to the keyword ranking so the
     * job still completes successfully.
     */
    upgradeSemanticResults: async (
      companyId: string,
      payload: SemanticSearchPayload,
    ): Promise<{
      query: string;
      upgraded: boolean;
      model: string | null;
      results: ResearchHit[];
      total: number;
    }> => {
      const normalizedQuery = normalizeQuery(payload.query);
      const limit = clampLimit(payload.limit);

      // First get the keyword-first results — these are the candidate pool.
      const { results } = await keywordSearch(companyId, {
        query: payload.query,
        scope: payload.scope,
        limit,
      });

      if (normalizedQuery.length === 0 || results.length === 0) {
        return { query: payload.query, upgraded: false, model: null, results, total: results.length };
      }

      if (!embed.isConfigured()) {
        logger.info({ companyId }, "Semantic upgrade skipped: no embedding provider configured");
        return { query: payload.query, upgraded: false, model: null, results, total: results.length };
      }

      try {
        const [queryVector, ...resultVectors] = await embed.embedBatch([
          normalizedQuery,
          ...results.map((r) => `${r.title} ${r.snippet ?? ""}`),
        ]);

        const similarities = results.map((hit, index) => {
          const vec = resultVectors[index];
          const sim = cosineSimilarity(queryVector.embedding, vec.embedding);
          // Blend: 70% semantic, 30% keyword score (normalized)
          const normalizedKeywordScore = Math.min(1, hit.score / 100);
          const blended = sim * 0.7 + normalizedKeywordScore * 0.3;
          return { hit, sim, blended };
        });

        similarities.sort((a, b) => b.blended - a.blended);
        const upgraded = similarities.map((s) => ({
          ...s.hit,
          score: Math.round(s.blended * 100),
        }));

        return {
          query: payload.query,
          upgraded: true,
          model: queryVector.model,
          results: upgraded.slice(0, limit),
          total: upgraded.length,
        };
      } catch (err) {
        logger.error({ err, companyId }, "Semantic upgrade failed, returning keyword results");
        return { query: payload.query, upgraded: false, model: null, results, total: results.length };
      }
    },

    /**
     * Auto-assessment of research items. Produces a lightweight assessment:
     * recency, completeness, and a heuristic relevance score per item.
     */
    autoAssess: async (companyId: string, payload: AutoAssessPayload = {}): Promise<{
      assessedAt: string;
      items: Array<{
        id: string;
        type: "issue" | "document" | "activity";
        title: string;
        freshness: "fresh" | "stale" | "unknown";
        completeness: number;
        relevance: number;
        notes: string[];
      }>;
    }> => {
      const limit = clampLimit(payload.limit ?? 20);
      const itemIds = payload.itemIds ?? [];

      // Fetch the most recent issues as the default candidate pool.
      const issueRows = await db
        .select({
          id: issues.id,
          title: issues.title,
          description: issues.description,
          status: issues.status,
          updatedAt: issues.updatedAt,
        })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, companyId),
            itemIds.length > 0 ? inArray(issues.id, itemIds) : undefined,
            isNull(issues.hiddenAt),
          ),
        )
        .orderBy(desc(issues.updatedAt))
        .limit(limit);

      const now = Date.now();
      const FRESH_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
      const STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

      const items: Array<{
        id: string;
        type: "issue" | "document" | "activity";
        title: string;
        freshness: "fresh" | "stale" | "unknown";
        completeness: number;
        relevance: number;
        notes: string[];
      }> = issueRows.map((row) => {
        const ageMs = now - row.updatedAt.getTime();
        const freshness =
          ageMs <= FRESH_MS ? "fresh" : ageMs <= STALE_MS ? "stale" : "unknown";
        const description = row.description ?? "";
        const completeness = Math.min(
          100,
          (description.length > 200 ? 40 : 0) + (row.title.length > 20 ? 30 : 0) + (row.status ? 30 : 0),
        );
        const relevance = Math.max(0, Math.min(100, Math.round(completeness * 0.6 + (freshness === "fresh" ? 40 : freshness === "stale" ? 20 : 0))));
        const notes: string[] = [];
        if (freshness === "stale") notes.push("No updates in over a week — consider refreshing");
        if (freshness === "unknown") notes.push("No updates in over a month — likely out of date");
        if (description.length < 200) notes.push("Thin description — could use more detail");
        return {
          id: row.id,
          type: "issue" as const,
          title: row.title,
          freshness,
          completeness,
          relevance,
          notes,
        };
      });

      return { assessedAt: new Date().toISOString(), items };
    },
  };
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export type ResearchSearchService = ReturnType<typeof researchSearchService>;
export type { ResearchHit };
