import { config } from "../config.js";
import type {
  DrataAsset,
  DrataControl,
  DrataControlNote,
  DrataDevice,
  DrataEvent,
  DrataEvidence,
  DrataFramework,
  DrataListParams,
  DrataListResponse,
  DrataMonitoringTest,
  DrataPersonnel,
  DrataPolicy,
  DrataRisk,
  DrataUser,
  DrataVendor,
  DrataWorkspace,
} from "./types.js";

export class DrataClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly configuredWorkspaceId?: number;
  private workspaceIdPromise?: Promise<number>;

  constructor(baseUrl?: string, apiKey?: string, workspaceId?: number) {
    this.baseUrl = baseUrl ?? config.drata.baseUrl;
    this.apiKey = apiKey ?? config.drata.apiKey;
    this.configuredWorkspaceId = workspaceId;
  }

  private async request<T>(
    path: string,
    params?: DrataListParams,
    init?: RequestInit
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const item of value) {
            url.searchParams.append(`${key}[]`, String(item));
          }
        } else {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const response = await fetch(url.toString(), {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...init?.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new DrataApiError(
        response.status,
        `Drata API error ${response.status}: ${response.statusText}`,
        body
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  private async fetchAll<T>(
    path: string,
    params: Omit<DrataListParams, "cursor"> = {}
  ): Promise<T[]> {
    const results: T[] = [];
    let cursor: string | undefined;

    do {
      const pageParams: DrataListParams = {};
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          (pageParams as Record<string, unknown>)[key] = value;
        }
      }
      if (!pageParams.size) pageParams.size = 500;
      if (cursor) pageParams.cursor = cursor;

      const page = await this.request<DrataListResponse<T>>(path, pageParams);
      results.push(...page.data);
      cursor = page.pagination.cursor ?? undefined;
    } while (cursor);

    return results;
  }

  // Workspaces
  async listWorkspaces(params?: DrataListParams) {
    return this.request<DrataListResponse<DrataWorkspace>>("/workspaces", params);
  }

  /**
   * Resolve (and cache) the workspace ID used to scope framework/control/
   * monitoring-test paths. The Drata v2 API requires these resources to be
   * addressed as `/workspaces/{id}/...`; the flat top-level paths 404.
   *
   * Prefers an explicitly configured ID, then the workspace flagged
   * `primary` (or legacy `isDefault`), then the first workspace returned.
   */
  async getWorkspaceId(): Promise<number> {
    if (this.configuredWorkspaceId !== undefined) return this.configuredWorkspaceId;

    if (!this.workspaceIdPromise) {
      this.workspaceIdPromise = (async () => {
        const page = await this.listWorkspaces({ size: 100 });
        const workspaces = page.data ?? [];
        if (workspaces.length === 0) {
          throw new Error(
            "Drata: no workspaces returned; cannot resolve workspace-scoped API paths"
          );
        }
        const primary =
          workspaces.find((ws) => ws.primary === true) ??
          workspaces.find((ws) => ws.isDefault === true) ??
          workspaces[0];
        return primary.id;
      })().catch((err) => {
        // Don't cache failures — allow a later call to retry.
        this.workspaceIdPromise = undefined;
        throw err;
      });
    }

    return this.workspaceIdPromise;
  }

  /** Build a workspace-scoped path, e.g. `/workspaces/1/controls`. */
  private async workspacePath(suffix: string): Promise<string> {
    const workspaceId = await this.getWorkspaceId();
    return `/workspaces/${workspaceId}${suffix}`;
  }

  // Controls (workspace-scoped)
  async listControls(params?: DrataListParams) {
    return this.request<DrataListResponse<DrataControl>>(
      await this.workspacePath("/controls"),
      params
    );
  }

  async getAllControls() {
    // v2 expand enum: customFields,evidenceIds,flags,frameworkTags,owners,
    // requirements,testIds,topics — `frameworks`/`monitoringTests` are 400s.
    return this.fetchAll<DrataControl>(await this.workspacePath("/controls"), {
      expand: ["frameworkTags", "owners", "requirements", "testIds", "flags"],
    });
  }

  async getControl(controlId: number, expand?: string[]) {
    const params = expand ? { expand } : {};
    return this.request<DrataControl>(
      await this.workspacePath(`/controls/${controlId}`),
      params
    );
  }

  // Control Notes (workspace-scoped)
  async listControlNotes(controlId: number, params?: DrataListParams) {
    return this.request<DrataListResponse<DrataControlNote>>(
      await this.workspacePath(`/controls/${controlId}/notes`),
      params
    );
  }

  // Frameworks (workspace-scoped)
  async listFrameworks(params?: DrataListParams) {
    return this.request<DrataListResponse<DrataFramework>>(
      await this.workspacePath("/frameworks"),
      params
    );
  }

  async getAllFrameworks() {
    return this.fetchAll<DrataFramework>(await this.workspacePath("/frameworks"));
  }

  // Monitoring Tests (workspace-scoped)
  async listMonitoringTests(params?: DrataListParams) {
    return this.request<DrataListResponse<DrataMonitoringTest>>(
      await this.workspacePath("/monitoring-tests"),
      params
    );
  }

  async getAllMonitoringTests() {
    // v2 expand enum: controls,monitorInstances,disablingUser — `evidence` 400s.
    return this.fetchAll<DrataMonitoringTest>(
      await this.workspacePath("/monitoring-tests"),
      { expand: ["controls"] }
    );
  }

  // Evidence Library
  // NOTE: intentionally NOT workspace-scoped — `/workspaces/{id}/evidence`
  // returns "Multiple artifacts are not enabled for this account" (a plan /
  // entitlement gap), not a wrong-path 404. See RBR-860.
  async listEvidence(params?: DrataListParams) {
    return this.request<DrataListResponse<DrataEvidence>>("/evidence", params);
  }

  async getAllEvidence() {
    return this.fetchAll<DrataEvidence>("/evidence");
  }

  // Personnel
  async listPersonnel(params?: DrataListParams) {
    return this.request<DrataListResponse<DrataPersonnel>>("/personnel", params);
  }

  async getAllPersonnel() {
    return this.fetchAll<DrataPersonnel>("/personnel");
  }

  // Devices
  async listDevices(params?: DrataListParams) {
    return this.request<DrataListResponse<DrataDevice>>("/devices", params);
  }

  async getAllDevices() {
    return this.fetchAll<DrataDevice>("/devices");
  }

  // Assets
  async listAssets(params?: DrataListParams) {
    return this.request<DrataListResponse<DrataAsset>>("/assets", params);
  }

  async getAllAssets() {
    return this.fetchAll<DrataAsset>("/assets", { expand: ["device", "owner", "assetClassTypes"] });
  }

  // Users
  async listUsers(params?: DrataListParams) {
    return this.request<DrataListResponse<DrataUser>>("/users", params);
  }

  async getAllUsers() {
    return this.fetchAll<DrataUser>("/users");
  }

  // Vendors
  async listVendors(params?: DrataListParams) {
    return this.request<DrataListResponse<DrataVendor>>("/vendors", params);
  }

  async getAllVendors() {
    return this.fetchAll<DrataVendor>("/vendors");
  }

  // Policies
  async listPolicies(params?: DrataListParams) {
    return this.request<DrataListResponse<DrataPolicy>>("/policies", params);
  }

  async getAllPolicies() {
    return this.fetchAll<DrataPolicy>("/policies");
  }

  // Risks
  async listRisks(params?: DrataListParams) {
    return this.request<DrataListResponse<DrataRisk>>("/risks", params);
  }

  async getAllRisks() {
    return this.fetchAll<DrataRisk>("/risks");
  }

  // Events (audit log)
  async listEvents(params?: DrataListParams & { from?: string; to?: string }) {
    return this.request<DrataListResponse<DrataEvent>>("/events", params);
  }

  // Company info
  async getCompany() {
    return this.request<{ id: number; name: string }>("/company");
  }
}

export class DrataApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: string
  ) {
    super(message);
    this.name = "DrataApiError";
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }

  get isPermissionError(): boolean {
    return this.status === 403;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }
}