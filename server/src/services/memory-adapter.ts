import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  memoryBindingTargets,
  memoryBindings,
  memoryRecords,
  memoryOperations,
} from "@paperclipai/db";
import type {
  MemoryScope,
  MemorySourceRef,
  MemoryUsage,
  MemorySnippet,
  MemoryContextBundle,
  MemoryListPage,
  MemoryCaptureRequest,
  MemoryRecordWriteRequest,
  MemoryQueryRequest,
  MemoryListRequest,
} from "@paperclipai/shared";
import { memoryBindingService } from "./memory-bindings.js";
import { embeddingService, type EmbeddingService } from "./embedding.js";
import { logger } from "../middleware/logger.js";
import { notFound } from "../errors.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BuiltinPgvectorAdapter {
  key: string;
  capabilities: {
    profile: false;
    correction: false;
    multimodal: false;
    providerManagedExtraction: false;
    asyncExtraction: false;
    providerNativeBrowse: false;
  };

  /** Capture text from a hook or tool — generates embedding and stores. */
  capture(req: MemoryCaptureRequest): Promise<{
    records?: Array<{ providerKey: string; providerRecordId: string }>;
    usage?: MemoryUsage[];
  }>;

  /** Direct curated record write. */
  upsertRecords(req: MemoryRecordWriteRequest): Promise<{
    records?: Array<{ providerKey: string; providerRecordId: string }>;
    usage?: MemoryUsage[];
  }>;

  /** Semantic + full-text hybrid search. */
  query(req: MemoryQueryRequest): Promise<MemoryContextBundle>;

  /** Cursor-based paginated listing. */
  list(req: MemoryListRequest): Promise<MemoryListPage>;

  /** Get a single record by handle. */
  get(
    handle: { providerKey: string; providerRecordId: string },
    scope: MemoryScope,
  ): Promise<MemorySnippet | null>;

  /** Delete records by handle. */
  forget(
    handles: Array<{ providerKey: string; providerRecordId: string }>,
    scope: MemoryScope,
  ): Promise<{ usage?: MemoryUsage[] }>;
}

// ─── Default Config ─────────────────────────────────────────────────────────

const DEFAULT_TOP_K = 10;
const DEFAULT_LIST_LIMIT = 20;

// ─── Factory ────────────────────────────────────────────────────────────────

export function builtinPgvectorAdapter(
  db: Db,
  embedder?: EmbeddingService,
): BuiltinPgvectorAdapter {
  const embeddingSvc = embedder ?? embeddingService();
  const bindingSvc = memoryBindingService(db);

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Format a raw record row into a MemorySnippet response.
   */
  function rowToSnippet(
    row: typeof memoryRecords.$inferSelect,
    score?: number,
  ): MemorySnippet {
    return {
      handle: {
        providerKey: "builtin_pgvector",
        providerRecordId: row.id,
      },
      text: row.text,
      score,
      summary: row.summary ?? undefined,
      source: row.sourceKind
        ? ({
            kind: row.sourceKind as MemorySourceRef["kind"],
            companyId: row.companyId,
            issueId: row.sourceIssueId ?? undefined,
            commentId: row.sourceCommentId ?? undefined,
            documentKey: row.sourceDocumentKey ?? undefined,
            runId: row.sourceRunId ?? undefined,
            activityId: row.sourceActivityId ?? undefined,
            externalRef: row.sourceExternalRef ?? undefined,
          } as MemorySourceRef)
        : undefined,
      metadata: row.metadataJson as Record<string, unknown> | undefined,
    };
  }

  /**
   * Log a memory operation for audit.
   */
  async function logOperation(input: {
    companyId: string;
    bindingId: string | null;
    providerKey?: string;
    operationType: string;
    scope: MemoryScope;
    source?: MemorySourceRef;
    success: boolean;
    errorMessage?: string;
    latencyMs: number;
    usage?: MemoryUsage;
    recordCount: number;
  }): Promise<void> {
    try {
      await db.insert(memoryOperations).values({
        companyId: input.companyId,
        bindingId: input.bindingId,
        providerKey: input.providerKey ?? null,
        operationType: input.operationType,
        scopeJson: input.scope as unknown as Record<string, unknown>,
        sourceRefJson: input.source as unknown as Record<string, unknown> ?? {},
        success: input.success,
        errorMessage: input.errorMessage ?? null,
        latencyMs: input.latencyMs,
        usageJson: (input.usage ?? {}) as Record<string, unknown>,
        recordCount: input.recordCount,
      });
    } catch (err) {
      logger.error({ err }, "Failed to log memory operation (non-fatal)");
    }
  }

  /**
   * Build scope filter conditions from a MemoryScope object.
   * Returns SQL conditions joined with AND, or the base companyId condition.
   */
  function buildScopeFilters(scope: MemoryScope): import("drizzle-orm").SQL {
    const companyFilter = eq(memoryRecords.companyId, scope.companyId);
    const extras: import("drizzle-orm").SQL[] = [];

    if (scope.agentId) {
      extras.push(
        or(
          eq(memoryRecords.scopeAgentId, scope.agentId),
          isNull(memoryRecords.scopeAgentId),
        ) as import("drizzle-orm").SQL,
      );
    }
    if (scope.projectId) {
      extras.push(
        or(
          eq(memoryRecords.scopeProjectId, scope.projectId),
          isNull(memoryRecords.scopeProjectId),
        ) as import("drizzle-orm").SQL,
      );
    }
    if (scope.issueId) {
      extras.push(
        or(
          eq(memoryRecords.scopeIssueId, scope.issueId),
          isNull(memoryRecords.scopeIssueId),
        ) as import("drizzle-orm").SQL,
      );
    }
    if (scope.runId) {
      extras.push(
        or(
          eq(memoryRecords.scopeRunId, scope.runId),
          isNull(memoryRecords.scopeRunId),
        ) as import("drizzle-orm").SQL,
      );
    }
    if (scope.namespace) {
      extras.push(eq(memoryRecords.scopeNamespace, scope.namespace));
    }
    if (scope.subjectId) {
      extras.push(
        or(
          eq(memoryRecords.scopeSubjectId, scope.subjectId),
          isNull(memoryRecords.scopeSubjectId),
        ) as import("drizzle-orm").SQL,
      );
    }
    if (scope.sessionKey) {
      extras.push(
        or(
          eq(memoryRecords.scopeSessionKey, scope.sessionKey),
          isNull(memoryRecords.scopeSessionKey),
        ) as import("drizzle-orm").SQL,
      );
    }

    if (extras.length === 0) return companyFilter;
    return and(companyFilter, ...extras) as import("drizzle-orm").SQL;
  }

  /**
   * Filter out expired records: returns a condition that keeps records
   * where expiresAt IS NULL (no expiration) OR expiresAt is in the future.
   */
  function nonExpiredFilter(): import("drizzle-orm").SQL {
    return sql`${memoryRecords.expiresAt} IS NULL OR ${memoryRecords.expiresAt} > now()` as import("drizzle-orm").SQL;
  }

  /**
   * Resolve binding ID from a binding key + company ID.
   */
  async function resolveBindingId(
    companyId: string,
    bindingKey: string,
  ): Promise<string> {
    const rows = await db
      .select({ id: memoryBindings.id })
      .from(memoryBindings)
      .where(
        and(
          eq(memoryBindings.companyId, companyId),
          eq(memoryBindings.key, bindingKey),
          eq(memoryBindings.enabled, true),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      throw notFound(
        `No enabled memory binding found with key "${bindingKey}" for company ${companyId}`,
      );
    }
    return rows[0].id;
  }

  // ─── capture ──────────────────────────────────────────────────────────────

  async function capture(
    req: MemoryCaptureRequest,
  ): Promise<{
    records?: Array<{ providerKey: string; providerRecordId: string }>;
    usage?: MemoryUsage[];
  }> {
    const start = Date.now();
    const text = req.payload.text ?? "";

    if (!text.trim()) {
      throw new Error("Capture payload text is required");
    }

    let bindingId: string;
    try {
      bindingId = await resolveBindingId(req.scope.companyId, req.bindingKey);
    } catch (err) {
      await logOperation({
        companyId: req.scope.companyId,
        bindingId: null,
        providerKey: req.bindingKey,
        operationType: "capture",
        scope: req.scope,
        source: req.source,
        success: false,
        errorMessage: (err as Error).message,
        latencyMs: Date.now() - start,
        recordCount: 0,
      });
      throw err;
    }

    // Generate embedding
    let embedding: number[] | null = null;
    let usage: MemoryUsage | undefined;
    try {
      const result = await embeddingSvc.embed(text);
      if (result.model !== "none") {
        embedding = result.embedding;
        usage = {
          provider: "builtin_pgvector",
          model: result.model,
          embeddingTokens: result.inputTokens,
          latencyMs: result.latencyMs,
        };
      }
    } catch (err) {
      logger.warn({ err }, "Embedding generation failed during capture, storing without embedding");
    }

    // Insert record
    const recordType = "auto_capture";

    const rows = await db
      .insert(memoryRecords)
      .values({
        companyId: req.scope.companyId,
        bindingId,
        recordType,
        text,
        // Drizzle's PgVector column handles array→string serialization
        embedding: embedding ?? null,
        summary: null,
        scopeCompanyId: req.scope.companyId,
        scopeAgentId: req.scope.agentId ?? null,
        scopeProjectId: req.scope.projectId ?? null,
        scopeIssueId: req.scope.issueId ?? null,
        scopeRunId: req.scope.runId ?? null,
        scopeSubjectId: req.scope.subjectId ?? null,
        scopeSessionKey: req.scope.sessionKey ?? null,
        scopeNamespace: req.scope.namespace ?? null,
        sourceKind: req.source.kind,
        sourceIssueId: req.source.issueId ?? null,
        sourceCommentId: req.source.commentId ?? null,
        sourceDocumentKey: req.source.documentKey ?? null,
        sourceRunId: req.source.runId ?? null,
        sourceActivityId: req.source.activityId ?? null,
        sourceExternalRef: req.source.externalRef ?? null,
        metadataJson: (req.metadata ?? {}) as Record<string, unknown>,
        expiresAt: sql`now() + interval '30 days'`, // default 30d TTL for auto-captured
      })
      .returning({ id: memoryRecords.id });

    const latencyMs = Date.now() - start;

    await logOperation({
      companyId: req.scope.companyId,
      bindingId,
      operationType: "capture",
      scope: req.scope,
      source: req.source,
      success: true,
      latencyMs,
      usage,
      recordCount: rows.length,
    });

    return {
      records: rows.map((r) => ({
        providerKey: "builtin_pgvector",
        providerRecordId: r.id,
      })),
      usage: usage ? [usage] : undefined,
    };
  }

  // ─── upsertRecords ────────────────────────────────────────────────────────

  async function upsertRecords(
    req: MemoryRecordWriteRequest,
  ): Promise<{
    records?: Array<{ providerKey: string; providerRecordId: string }>;
    usage?: MemoryUsage[];
  }> {
    const start = Date.now();
    let bindingId: string;

    try {
      bindingId = await resolveBindingId(req.scope.companyId, req.bindingKey);
    } catch (err) {
      await logOperation({
        companyId: req.scope.companyId,
        bindingId: null,
        providerKey: req.bindingKey,
        operationType: "record_upsert",
        scope: req.scope,
        source: req.source,
        success: false,
        errorMessage: (err as Error).message,
        latencyMs: Date.now() - start,
        recordCount: 0,
      });
      throw err;
    }

    const insertedIds: string[] = [];

    for (const entry of req.records) {
      // Generate embedding for each record
      let embedding: number[] | null = null;
      try {
        const result = await embeddingSvc.embed(entry.text);
        if (result.model !== "none") {
          embedding = result.embedding;
        }
      } catch (err) {
        logger.warn({ err }, "Embedding generation failed during upsertRecords");
      }

      const rows = await db
        .insert(memoryRecords)
        .values({
          companyId: req.scope.companyId,
          bindingId,
          recordType: "curated_note",
          text: entry.text,
          summary: entry.summary ?? null,
          embedding: embedding ?? null,
          scopeCompanyId: req.scope.companyId,
          scopeAgentId: req.scope.agentId ?? null,
          scopeProjectId: req.scope.projectId ?? null,
          scopeIssueId: req.scope.issueId ?? null,
          scopeRunId: req.scope.runId ?? null,
          scopeSubjectId: req.scope.subjectId ?? null,
          scopeSessionKey: req.scope.sessionKey ?? null,
          scopeNamespace: req.scope.namespace ?? null,
          sourceKind: req.source?.kind ?? "manual_note",
          sourceIssueId: req.source?.issueId ?? null,
          sourceCommentId: req.source?.commentId ?? null,
          sourceDocumentKey: req.source?.documentKey ?? null,
          sourceRunId: req.source?.runId ?? null,
          sourceActivityId: req.source?.activityId ?? null,
          sourceExternalRef: req.source?.externalRef ?? null,
          metadataJson: (entry.metadata ?? {}) as Record<string, unknown>,
          // Curated notes don't expire by default
          expiresAt: null,
        })
        .returning({ id: memoryRecords.id });

      insertedIds.push(...rows.map((r) => r.id));
    }

    const latencyMs = Date.now() - start;

    await logOperation({
      companyId: req.scope.companyId,
      bindingId,
      operationType: "record_upsert",
      scope: req.scope,
      source: req.source,
      success: true,
      latencyMs,
      recordCount: insertedIds.length,
    });

    return {
      records: insertedIds.map((id) => ({
        providerKey: "builtin_pgvector",
        providerRecordId: id,
      })),
    };
  }

  // ─── query ────────────────────────────────────────────────────────────────

  async function query(req: MemoryQueryRequest): Promise<MemoryContextBundle> {
    const start = Date.now();
    const topK = req.topK ?? DEFAULT_TOP_K;

    try {
      const bindingId = await resolveBindingId(
        req.scope.companyId,
        req.bindingKey,
      );
      const scopeFilter = buildScopeFilters(req.scope);

      // Empty query — return most recent records instead of semantic/full-text search
      if (!req.query || !req.query.trim()) {
        const recentRows = await db
          .select(getRecordColumns())
          .from(memoryRecords)
          .where(
            and(
              scopeFilter,
              eq(memoryRecords.bindingId, bindingId),
              nonExpiredFilter(),
            ),
          )
          .orderBy(desc(memoryRecords.createdAt))
          .limit(topK);

        const latencyMs = Date.now() - start;
        const snippets = recentRows.map((r) => rowToSnippet(r));

        await logOperation({
          companyId: req.scope.companyId,
          bindingId,
          operationType: "query",
          scope: req.scope,
          success: true,
          latencyMs,
          recordCount: snippets.length,
        });

        return { snippets };
      }

      // Try embedding search first if configured
      let embedding: number[] | null = null;
      try {
        const result = await embeddingSvc.embed(req.query);
        if (result.model !== "none") {
          embedding = result.embedding;
        }
      } catch {
        // Fall through to full-text search
      }

      let rows: Array<typeof memoryRecords.$inferSelect & { score?: number }>;

      if (embedding && embedding.length > 0) {
        // Validate embedding values to prevent SQL injection
        for (const val of embedding) {
          if (typeof val !== 'number' || !Number.isFinite(val)) {
            throw new Error(
              `Invalid embedding value at index ${embedding.indexOf(val)}: all values must be finite numbers`,
            );
          }
        }
        // Semantic search via cosine similarity using parameterized vector cast
        // CAST($1 AS vector) is fully parameterized — no sql.raw with untrusted data
        const embeddingJson = JSON.stringify(embedding);
        rows = (await db
          .select({
            ...getRecordColumns(),
            score: sql<number>`1 - (${memoryRecords.embedding} <=> CAST(${embeddingJson} AS vector))`,
          })
          .from(memoryRecords)
          .where(
            and(
              scopeFilter,
              eq(memoryRecords.bindingId, bindingId),
              sql`${memoryRecords.embedding} IS NOT NULL`,
              nonExpiredFilter(),
            ),
          )
          .orderBy(
            sql`1 - (${memoryRecords.embedding} <=> CAST(${embeddingJson} AS vector)) DESC`,
          )
          .limit(topK)) as Array<typeof memoryRecords.$inferSelect & { score?: number }>;
      } else {
        // Full-text search fallback using GIN tsvector index
        // Sanitize each word: strip characters unsafe for to_tsquery lexemes
        const tsQuery = req.query
          .split(/\s+/)
          .filter(Boolean)
          .map((w) => w.replace(/[^\w\-\']/g, '').replace(/'{2,}/g, "'"))
          .filter((w) => w.length > 0)
          .map((w) => `${w}:*`)
          .join(" & ");

        if (!tsQuery) {
          // All words were stripped — nothing to search
          const latencyMs = Date.now() - start;
          await logOperation({
            companyId: req.scope.companyId,
            bindingId,
            operationType: "query",
            scope: req.scope,
            success: true,
            latencyMs,
            recordCount: 0,
          });
          return { snippets: [] };
        }

        rows = (await db
          .select({
            ...getRecordColumns(),
            score: sql<number>`ts_rank(to_tsvector('english', ${memoryRecords.text}), to_tsquery('english', ${tsQuery}))`,
          })
          .from(memoryRecords)
          .where(
            and(
              scopeFilter,
              eq(memoryRecords.bindingId, bindingId),
              sql`to_tsvector('english', ${memoryRecords.text}) @@ to_tsquery('english', ${tsQuery})`,
              nonExpiredFilter(),
            ),
          )
          .orderBy(
            sql`ts_rank(to_tsvector('english', ${memoryRecords.text}), to_tsquery('english', ${tsQuery})) DESC`,
          )
          .limit(topK)) as Array<typeof memoryRecords.$inferSelect & { score?: number }>;
      }

      const latencyMs = Date.now() - start;
      const snippets = rows.map((r) => rowToSnippet(r, r.score));

      await logOperation({
        companyId: req.scope.companyId,
        bindingId,
        operationType: "query",
        scope: req.scope,
        success: true,
        latencyMs,
        recordCount: snippets.length,
      });

      return { snippets };
    } catch (err) {
      const latencyMs = Date.now() - start;
      logger.error({ err }, "Memory query failed");

      // Try to get binding ID for log (best-effort)
      let bindingId: string | null = null;
      let providerKey: string | undefined;
      try {
        const resolved = await resolveBindingId(
          req.scope.companyId,
          req.bindingKey,
        );
        bindingId = resolved;
        providerKey = req.bindingKey;
      } catch {
        providerKey = req.bindingKey;
      }

      await logOperation({
        companyId: req.scope.companyId,
        bindingId,
        providerKey,
        operationType: "query",
        scope: req.scope,
        success: false,
        errorMessage: (err as Error).message,
        latencyMs,
        recordCount: 0,
      });

      throw err;
    }
  }

  // ─── list ─────────────────────────────────────────────────────────────────

  async function list(req: MemoryListRequest): Promise<MemoryListPage> {
    const start = Date.now();
    const limit = req.limit ?? DEFAULT_LIST_LIMIT;

    try {
      const bindingId = await resolveBindingId(
        req.scope.companyId,
        req.bindingKey,
      );
      const scopeFilter = buildScopeFilters(req.scope);

      const conditions = [scopeFilter, eq(memoryRecords.bindingId, bindingId), nonExpiredFilter()];

      if (req.cursor) {
        conditions.push(gt(memoryRecords.createdAt, new Date(req.cursor)));
      }

      const rows = await db
        .select()
        .from(memoryRecords)
        .where(and(...conditions))
        .orderBy(asc(memoryRecords.createdAt))
        .limit(limit + 1); // fetch one extra to detect next page

      const hasMore = rows.length > limit;
      const pageRows = rows.slice(0, limit);
      const nextCursor = hasMore
        ? pageRows[pageRows.length - 1]?.createdAt.toISOString()
        : undefined;

      const latencyMs = Date.now() - start;

      await logOperation({
        companyId: req.scope.companyId,
        bindingId,
        operationType: "list",
        scope: req.scope,
        success: true,
        latencyMs,
        recordCount: pageRows.length,
      });

      return {
        items: pageRows.map((r) => rowToSnippet(r)),
        nextCursor,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      logger.error({ err }, "Memory list failed");

      let bindingId: string | null = null;
      let providerKey: string | undefined;
      try {
        const resolved = await resolveBindingId(
          req.scope.companyId,
          req.bindingKey,
        );
        bindingId = resolved;
        providerKey = req.bindingKey;
      } catch {
        providerKey = req.bindingKey;
      }

      await logOperation({
        companyId: req.scope.companyId,
        bindingId,
        providerKey,
        operationType: "list",
        scope: req.scope,
        success: false,
        errorMessage: (err as Error).message,
        latencyMs,
        recordCount: 0,
      });

      throw err;
    }
  }

  // ─── get ──────────────────────────────────────────────────────────────────

  async function get(
    handle: { providerKey: string; providerRecordId: string },
    scope: MemoryScope,
  ): Promise<MemorySnippet | null> {
    const start = Date.now();

    try {
      const rows = await db
        .select()
        .from(memoryRecords)
        .where(
          and(
            eq(memoryRecords.id, handle.providerRecordId),
            buildScopeFilters(scope),
            nonExpiredFilter(),
          ),
        )
        .limit(1);

      const latencyMs = Date.now() - start;

      if (rows.length === 0) {
        // Best-effort: resolve binding UUID for audit log.
        // Try the record without scope first (exists but out-of-scope),
        // then fall back to the active binding for this company/agent.
        let bindingId: string | null = null;
        try {
          const anyRecord = await db
            .select({ bindingId: memoryRecords.bindingId })
            .from(memoryRecords)
            .where(eq(memoryRecords.id, handle.providerRecordId))
            .limit(1);
          if (anyRecord.length > 0) {
            bindingId = anyRecord[0].bindingId;
          } else {
            const resolved = await bindingSvc.findActiveBinding(
              scope.companyId,
              scope.agentId,
            );
            bindingId = resolved?.binding.id ?? null;
          }
        } catch {
          // fall through with null bindingId
        }

        await logOperation({
          companyId: scope.companyId,
          bindingId,
          providerKey: handle.providerKey,
          operationType: "get",
          scope,
          success: true,
          latencyMs,
          recordCount: 0,
        });
        return null;
      }

      await logOperation({
        companyId: scope.companyId,
        bindingId: rows[0].bindingId,
        operationType: "get",
        scope,
        success: true,
        latencyMs,
        recordCount: 1,
      });

      return rowToSnippet(rows[0]);
    } catch (err) {
      const latencyMs = Date.now() - start;
      logger.error({ err }, "Memory get failed");

      // Best-effort binding UUID resolution for audit log
      let bindingId: string | null = null;
      try {
        const anyRecord = await db
          .select({ bindingId: memoryRecords.bindingId })
          .from(memoryRecords)
          .where(eq(memoryRecords.id, handle.providerRecordId))
          .limit(1);
        if (anyRecord.length > 0) {
          bindingId = anyRecord[0].bindingId;
        } else {
          const resolved = await bindingSvc.findActiveBinding(
            scope.companyId,
            scope.agentId,
          );
          bindingId = resolved?.binding.id ?? null;
        }
      } catch {
        // fall through with null bindingId
      }

      await logOperation({
        companyId: scope.companyId,
        bindingId,
        providerKey: handle.providerKey,
        operationType: "get",
        scope,
        success: false,
        errorMessage: (err as Error).message,
        latencyMs,
        recordCount: 0,
      });

      throw err;
    }
  }

  // ─── forget ───────────────────────────────────────────────────────────────

  async function forget(
    handles: Array<{ providerKey: string; providerRecordId: string }>,
    scope: MemoryScope,
  ): Promise<{ usage?: MemoryUsage[] }> {
    const start = Date.now();
    const ids = handles.map((h) => h.providerRecordId);

    try {
      // Use .returning() to get bindingId and accurate deletion count
      const result = await db
        .delete(memoryRecords)
        .where(
          and(
            inArray(memoryRecords.id, ids),
            buildScopeFilters(scope),
          ),
        )
        .returning({ bindingId: memoryRecords.bindingId });

      const deletedCount = result.length;
      const bindingId = result.length > 0 ? result[0].bindingId : null;
      const latencyMs = Date.now() - start;

      await logOperation({
        companyId: scope.companyId,
        bindingId,
        providerKey: handles[0]?.providerKey ?? "builtin_pgvector",
        operationType: "forget",
        scope,
        success: true,
        latencyMs,
        recordCount: deletedCount,
      });

      return {};
    } catch (err) {
      const latencyMs = Date.now() - start;
      logger.error({ err }, "Memory forget failed");

      // Best-effort binding UUID resolution for audit log
      let bindingId: string | null = null;
      try {
        const bindingRows = await db
          .select({ bindingId: memoryRecords.bindingId })
          .from(memoryRecords)
          .where(
            and(
              inArray(memoryRecords.id, ids),
              buildScopeFilters(scope),
            ),
          )
          .limit(1);
        bindingId = bindingRows.length > 0 ? bindingRows[0].bindingId : null;
      } catch {
        // fall through with null bindingId
      }

      await logOperation({
        companyId: scope.companyId,
        bindingId,
        providerKey: handles[0]?.providerKey ?? "builtin_pgvector",
        operationType: "forget",
        scope,
        success: false,
        errorMessage: (err as Error).message,
        latencyMs,
        recordCount: 0,
      });

      throw err;
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  return {
    key: "builtin_pgvector",
    capabilities: {
      profile: false,
      correction: false,
      multimodal: false,
      providerManagedExtraction: false,
      asyncExtraction: false,
      providerNativeBrowse: false,
    },
    capture,
    upsertRecords,
    query,
    list,
    get,
    forget,
  };
}

export type BuiltinPgvectorAdapterInstance = ReturnType<
  typeof builtinPgvectorAdapter
>;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getRecordColumns() {
  return {
    id: memoryRecords.id,
    companyId: memoryRecords.companyId,
    bindingId: memoryRecords.bindingId,
    recordType: memoryRecords.recordType,
    text: memoryRecords.text,
    summary: memoryRecords.summary,
    embedding: memoryRecords.embedding,
    scopeCompanyId: memoryRecords.scopeCompanyId,
    scopeAgentId: memoryRecords.scopeAgentId,
    scopeProjectId: memoryRecords.scopeProjectId,
    scopeIssueId: memoryRecords.scopeIssueId,
    scopeRunId: memoryRecords.scopeRunId,
    scopeSubjectId: memoryRecords.scopeSubjectId,
    scopeSessionKey: memoryRecords.scopeSessionKey,
    scopeNamespace: memoryRecords.scopeNamespace,
    sourceKind: memoryRecords.sourceKind,
    sourceIssueId: memoryRecords.sourceIssueId,
    sourceCommentId: memoryRecords.sourceCommentId,
    sourceDocumentKey: memoryRecords.sourceDocumentKey,
    sourceRunId: memoryRecords.sourceRunId,
    sourceActivityId: memoryRecords.sourceActivityId,
    sourceExternalRef: memoryRecords.sourceExternalRef,
    metadataJson: memoryRecords.metadataJson,
    importance: memoryRecords.importance,
    createdAt: memoryRecords.createdAt,
    updatedAt: memoryRecords.updatedAt,
    expiresAt: memoryRecords.expiresAt,
  };
}