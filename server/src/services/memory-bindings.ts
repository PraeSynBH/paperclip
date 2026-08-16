import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  memoryBindingTargets,
  memoryBindings,
} from "@paperclipai/db";
import type {
  MemoryBindingConfig,
  MemoryCapabilities,
} from "@paperclipai/shared";
import {
  createMemoryBindingSchema,
  createMemoryBindingTargetSchema,
  updateMemoryBindingSchema,
  type CreateMemoryBinding,
  type CreateMemoryBindingTarget,
  type UpdateMemoryBinding,
} from "@paperclipai/shared";
import { conflict, notFound } from "../errors.js";

// ─── Resolved Binding Result ───────────────────────────────────────────────

export interface ResolvedBinding {
  /** The binding record itself. */
  binding: {
    id: string;
    companyId: string;
    key: string;
    providerType: string;
    configJson: Record<string, unknown>;
    capabilitiesJson: Record<string, unknown>;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
  /** The target entry that produced this resolution. */
  target: {
    id: string;
    targetType: "company" | "agent";
    targetId: string;
    priority: number;
    createdAt: Date;
  };
  /** Resolution metadata. */
  resolution: {
    source: "agent_override" | "company_default";
    agentId?: string;
  };
}

export interface BindingRow {
  id: string;
  companyId: string;
  key: string;
  providerType: string;
  configJson: Record<string, unknown>;
  capabilitiesJson: Record<string, unknown>;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface BindingTargetRow {
  id: string;
  companyId: string;
  targetType: "company" | "agent";
  targetId: string;
  bindingId: string;
  priority: number;
  createdAt: Date;
}

// ─── Service Factory ────────────────────────────────────────────────────────

export function memoryBindingService(db: Db) {
  // ─── Binding Resolution ──────────────────────────────────────────────────

  /**
   * Find the active binding for a company, optionally overriding per-agent.
   *
   * Resolution order:
   * 1. If `agentId` is provided, look for a binding target with
   *    target_type='agent' and target_id matching the agent.
   * 2. Fall back to the company default (target_type='company',
   *    target_id = companyId).
   * 3. Return null if no binding is found at either level.
   *
   * Only enabled bindings are considered.
   */
  async function findActiveBinding(
    companyId: string,
    agentId?: string,
  ): Promise<ResolvedBinding | null> {
    // Step 1: try agent-specific override
    if (agentId) {
      const agentTarget = await db
        .select({
          target: {
            id: memoryBindingTargets.id,
            targetType: memoryBindingTargets.targetType,
            targetId: memoryBindingTargets.targetId,
            priority: memoryBindingTargets.priority,
            createdAt: memoryBindingTargets.createdAt,
          },
          binding: {
            id: memoryBindings.id,
            companyId: memoryBindings.companyId,
            key: memoryBindings.key,
            providerType: memoryBindings.providerType,
            configJson: memoryBindings.configJson,
            capabilitiesJson: memoryBindings.capabilitiesJson,
            enabled: memoryBindings.enabled,
            createdAt: memoryBindings.createdAt,
            updatedAt: memoryBindings.updatedAt,
          },
        })
        .from(memoryBindingTargets)
        .innerJoin(
          memoryBindings,
          eq(memoryBindingTargets.bindingId, memoryBindings.id),
        )
        .where(
          and(
            eq(memoryBindingTargets.companyId, companyId),
            eq(memoryBindingTargets.targetType, "agent"),
            eq(memoryBindingTargets.targetId, agentId),
            eq(memoryBindings.enabled, true),
          ),
        )
        .orderBy(desc(memoryBindingTargets.priority))
        .limit(1)
        .then(normalizeRows);

      if (agentTarget.length > 0) {
        return {
          binding: agentTarget[0].binding,
          target: agentTarget[0].target,
          resolution: {
            source: "agent_override",
            agentId,
          },
        };
      }
    }

    // Step 2: fall back to company default
    const companyTarget = await db
      .select({
        target: {
          id: memoryBindingTargets.id,
          targetType: memoryBindingTargets.targetType,
          targetId: memoryBindingTargets.targetId,
          priority: memoryBindingTargets.priority,
          createdAt: memoryBindingTargets.createdAt,
        },
        binding: {
          id: memoryBindings.id,
          companyId: memoryBindings.companyId,
          key: memoryBindings.key,
          providerType: memoryBindings.providerType,
          configJson: memoryBindings.configJson,
          capabilitiesJson: memoryBindings.capabilitiesJson,
          enabled: memoryBindings.enabled,
          createdAt: memoryBindings.createdAt,
          updatedAt: memoryBindings.updatedAt,
        },
      })
      .from(memoryBindingTargets)
      .innerJoin(
        memoryBindings,
        eq(memoryBindingTargets.bindingId, memoryBindings.id),
      )
      .where(
        and(
          eq(memoryBindingTargets.companyId, companyId),
          eq(memoryBindingTargets.targetType, "company"),
          eq(memoryBindingTargets.targetId, companyId),
          eq(memoryBindings.enabled, true),
        ),
      )
      .orderBy(desc(memoryBindingTargets.priority))
      .limit(1)
      .then(normalizeRows);

    if (companyTarget.length > 0) {
      return {
        binding: companyTarget[0].binding,
        target: companyTarget[0].target,
        resolution: {
          source: "company_default",
        },
      };
    }

    return null;
  }

  // ─── CRUD: Bindings ──────────────────────────────────────────────────────

  async function listBindings(companyId: string): Promise<BindingRow[]> {
    return db
      .select()
      .from(memoryBindings)
      .where(eq(memoryBindings.companyId, companyId))
      .orderBy(memoryBindings.key)
      .then(normalizeRows);
  }

  async function getBinding(
    companyId: string,
    bindingId: string,
  ): Promise<BindingRow> {
    const rows = await db
      .select()
      .from(memoryBindings)
      .where(
        and(
          eq(memoryBindings.id, bindingId),
          eq(memoryBindings.companyId, companyId),
        ),
      )
      .limit(1)
      .then(normalizeRows);

    if (rows.length === 0) {
      throw notFound(`Memory binding ${bindingId} not found`);
    }
    return rows[0];
  }

  async function createBinding(
    companyId: string,
    input: CreateMemoryBinding,
  ): Promise<BindingRow> {
    const parsed = createMemoryBindingSchema.parse(input);

    let rows: BindingRow[];
    try {
      rows = await db
        .insert(memoryBindings)
        .values({
          companyId,
          key: parsed.key,
          providerType: parsed.providerType,
          configJson: parsed.configJson as Record<string, unknown>,
          capabilitiesJson: parsed.capabilitiesJson as Record<string, unknown>,
          enabled: parsed.enabled,
        })
        .returning()
        .then(normalizeRows);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw conflict(
          `Memory binding with key "${parsed.key}" already exists for this company`,
        );
      }
      throw err;
    }

    return rows[0];
  }

  async function updateBinding(
    companyId: string,
    bindingId: string,
    input: UpdateMemoryBinding,
  ): Promise<BindingRow> {
    const parsed = updateMemoryBindingSchema.parse(input);
    const updateData: Record<string, unknown> = {};

    if (parsed.providerType !== undefined) {
      updateData.providerType = parsed.providerType;
    }
    if (parsed.configJson !== undefined) {
      updateData.configJson = parsed.configJson;
    }
    if (parsed.capabilitiesJson !== undefined) {
      updateData.capabilitiesJson = parsed.capabilitiesJson;
    }
    if (parsed.enabled !== undefined) {
      updateData.enabled = parsed.enabled;
    }

    if (Object.keys(updateData).length > 0) {
      updateData.updatedAt = sql`now()`;
    }

    const rows = await db
      .update(memoryBindings)
      .set(updateData)
      .where(
        and(
          eq(memoryBindings.id, bindingId),
          eq(memoryBindings.companyId, companyId),
        ),
      )
      .returning()
      .then(normalizeRows);

    if (rows.length === 0) {
      throw notFound(`Memory binding ${bindingId} not found`);
    }
    return rows[0];
  }

  async function deleteBinding(
    companyId: string,
    bindingId: string,
  ): Promise<void> {
    // Delete target references first (cascade should handle this, but be explicit)
    await db
      .delete(memoryBindingTargets)
      .where(
        and(
          eq(memoryBindingTargets.bindingId, bindingId),
          eq(memoryBindingTargets.companyId, companyId),
        ),
      );

    const deleted = await db
      .delete(memoryBindings)
      .where(
        and(
          eq(memoryBindings.id, bindingId),
          eq(memoryBindings.companyId, companyId),
        ),
      )
      .returning({ id: memoryBindings.id });

    if (deleted.length === 0) {
      throw notFound(`Memory binding ${bindingId} not found`);
    }
  }

  // ─── CRUD: Binding Targets ───────────────────────────────────────────────

  async function listTargets(
    companyId: string,
  ): Promise<BindingTargetRow[]> {
    return db
      .select()
      .from(memoryBindingTargets)
      .where(eq(memoryBindingTargets.companyId, companyId))
      .orderBy(
        memoryBindingTargets.targetType,
        desc(memoryBindingTargets.priority),
      )
      .then(normalizeRows);
  }

  async function getAgentTarget(
    companyId: string,
    agentId: string,
  ): Promise<BindingTargetRow | null> {
    const rows = await db
      .select()
      .from(memoryBindingTargets)
      .where(
        and(
          eq(memoryBindingTargets.companyId, companyId),
          eq(memoryBindingTargets.targetType, "agent"),
          eq(memoryBindingTargets.targetId, agentId),
        ),
      )
      .limit(1)
      .then(normalizeRows);

    return rows.length > 0 ? rows[0] : null;
  }

  async function createTarget(
    companyId: string,
    input: CreateMemoryBindingTarget,
  ): Promise<BindingTargetRow> {
    const parsed = createMemoryBindingTargetSchema.parse(input);

    // Verify binding exists and belongs to company
    await getBinding(companyId, parsed.bindingId);

    let rows: BindingTargetRow[];
    try {
      rows = await db
        .insert(memoryBindingTargets)
        .values({
          companyId,
          targetType: parsed.targetType,
          targetId: parsed.targetId,
          bindingId: parsed.bindingId,
          priority: parsed.priority,
        })
        .returning()
        .then(normalizeRows);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw conflict(
          `Memory binding target for ${parsed.targetType} ${parsed.targetId} already exists`,
        );
      }
      throw err;
    }

    return rows[0];
  }

  async function deleteTarget(
    companyId: string,
    targetId: string,
  ): Promise<void> {
    const deleted = await db
      .delete(memoryBindingTargets)
      .where(
        and(
          eq(memoryBindingTargets.id, targetId),
          eq(memoryBindingTargets.companyId, companyId),
        ),
      )
      .returning({ id: memoryBindingTargets.id });

    if (deleted.length === 0) {
      throw notFound(`Memory binding target ${targetId} not found`);
    }
  }

  // ─── Agent Memory Config View ────────────────────────────────────────────

  /**
   * Get the resolved memory configuration for an agent.
   * Returns the binding resolution + target metadata.
   * Returns null if no binding is configured.
   */
  async function getAgentMemoryConfig(
    companyId: string,
    agentId: string,
  ): Promise<{
    agentId: string;
    bindingId: string;
    bindingKey: string;
    providerType: string;
    enabled: boolean;
    targetType: "agent" | "company";
    capabilities: MemoryCapabilities;
    createdAt: string;
  } | null> {
    const resolved = await findActiveBinding(companyId, agentId);
    if (!resolved) return null;

    return {
      agentId,
      bindingId: resolved.binding.id,
      bindingKey: resolved.binding.key,
      providerType: resolved.binding.providerType,
      enabled: resolved.binding.enabled,
      targetType: resolved.target.targetType as "agent" | "company",
      capabilities: resolved.binding.capabilitiesJson as MemoryCapabilities,
      createdAt: resolved.target.createdAt instanceof Date
        ? resolved.target.createdAt.toISOString()
        : String(resolved.target.createdAt),
    };
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  return {
    findActiveBinding,
    listBindings,
    getBinding,
    createBinding,
    updateBinding,
    deleteBinding,
    listTargets,
    getAgentTarget,
    createTarget,
    deleteTarget,
    getAgentMemoryConfig,
  };
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Detect whether a Postgres error is a unique-constraint violation (code 23505).
 */
function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const err = error as { code?: string };
  return err.code === "23505";
}

function normalizeRows<T>(rows: T[]): T[] {
  return rows as T[];
}

/** Type helper for the service factory return type. */
export type MemoryBindingService = ReturnType<typeof memoryBindingService>;
