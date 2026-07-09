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

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = baseUrl ?? config.drata.baseUrl;
    this.apiKey = apiKey ?? config.drata.apiKey;
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

  // Controls
  async listControls(params?: DrataListParams) {
    return this.request<DrataListResponse<DrataControl>>("/controls", params);
  }

  async getAllControls() {
    return this.fetchAll<DrataControl>("/controls", { expand: ["frameworks", "owners", "monitoringTests"] });
  }

  async getControl(controlId: number, expand?: string[]) {
    const params = expand ? { expand } : {};
    return this.request<DrataControl>(`/controls/${controlId}`, params);
  }

  // Control Notes
  async listControlNotes(controlId: number, params?: DrataListParams) {
    return this.request<DrataListResponse<DrataControlNote>>(`/controls/${controlId}/notes`, params);
  }

  // Frameworks
  async listFrameworks(params?: DrataListParams) {
    return this.request<DrataListResponse<DrataFramework>>("/frameworks", params);
  }

  async getAllFrameworks() {
    return this.fetchAll<DrataFramework>("/frameworks");
  }

  // Monitoring Tests
  async listMonitoringTests(params?: DrataListParams) {
    return this.request<DrataListResponse<DrataMonitoringTest>>("/monitoring-tests", params);
  }

  async getAllMonitoringTests() {
    return this.fetchAll<DrataMonitoringTest>("/monitoring-tests", { expand: ["evidence"] });
  }

  // Evidence Library
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