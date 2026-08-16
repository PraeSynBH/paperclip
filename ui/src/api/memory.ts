import { api, ApiError } from "./client";
import type {
  MemorySnippet,
  MemoryListPage,
  MemoryContextBundle,
  MemoryRecordHandle,
} from "@paperclipai/shared";

export type { MemorySnippet } from "@paperclipai/shared";

export interface ListMemoryParams {
  bindingKey: string;
  scope?: string;
  cursor?: string;
  limit?: number;
}

export interface QueryMemoryParams {
  bindingKey: string;
  q: string;
  scope?: string;
  topK?: number;
  intent?: "agent_preamble" | "answer" | "browse";
}

function buildQuery(params?: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export const memoryApi = {
  /**
   * List memory records with cursor-based pagination.
   */
  list: async (
    companyId: string,
    params: ListMemoryParams,
  ): Promise<MemoryListPage> => {
    const query: Record<string, string | number | undefined> = {
      bindingKey: params.bindingKey,
    };
    if (params.scope) query.scope = params.scope;
    if (params.cursor) query.cursor = params.cursor;
    if (params.limit) query.limit = params.limit;
    return api.get<MemoryListPage>(
      `/companies/${companyId}/memory/records${buildQuery(query)}`,
    );
  },

  /**
   * Get a single memory record by ID.
   */
  get: async (companyId: string, recordId: string): Promise<MemorySnippet | null> => {
    try {
      return await api.get<MemorySnippet>(
        `/companies/${companyId}/memory/records/${recordId}`,
      );
    } catch (err) {
      if ((err as { status?: number }).status === 404) return null;
      throw err;
    }
  },

  /**
   * Query memory records using semantic + full-text search.
   */
  query: async (
    companyId: string,
    params: QueryMemoryParams,
  ): Promise<MemoryContextBundle> => {
    const query: Record<string, string | number | undefined> = {
      bindingKey: params.bindingKey,
      q: params.q,
    };
    if (params.scope) query.scope = params.scope;
    if (params.topK) query.topK = params.topK;
    if (params.intent) query.intent = params.intent;
    return api.get<MemoryContextBundle>(
      `/companies/${companyId}/memory/query${buildQuery(query)}`,
    );
  },

  /**
   * Forget (delete) memory records by handle.
   * Uses raw fetch since the standard api.delete doesn't support a request body.
   */
  forget: async (
    companyId: string,
    handles: MemoryRecordHandle[],
  ): Promise<void> => {
    const res = await fetch(`/api/companies/${companyId}/memory/records`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ handles }),
    });
    if (!res.ok) {
      const errorBody = await res.json().catch(() => null);
      throw new ApiError(
        (errorBody as { error?: string } | null)?.error ?? `Forget failed: ${res.status}`,
        res.status,
        errorBody,
      );
    }
  },

  /**
   * List memory operations (audit log).
   */
  operations: async (
    companyId: string,
    limit?: number,
  ): Promise<Array<{
    id: string;
    companyId: string;
    bindingId: string | null;
    providerKey: string | null;
    operationType: string;
    success: boolean;
    errorMessage: string | null;
    recordCount: number;
    createdAt: string;
  }>> => {
    const query = buildQuery({ limit: limit ?? 50 });
    return api.get<Array<{
    id: string;
    companyId: string;
    bindingId: string | null;
    providerKey: string | null;
    operationType: string;
    success: boolean;
    errorMessage: string | null;
    recordCount: number;
    createdAt: string;
  }>>(`/companies/${companyId}/memory/operations${query}`);
  },

  /**
   * List memory bindings for the company.
   */
  bindings: async (companyId: string): Promise<Array<{
    id: string;
    key: string;
    providerType: string;
    enabled: boolean;
  }>> => {
    return api.get(`/companies/${companyId}/memory/bindings`);
  },
};
