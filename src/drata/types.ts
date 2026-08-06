export interface DrataPagination {
  cursor: string | null;
  totalCount?: number;
}

export interface DrataListResponse<T> {
  data: T[];
  pagination: DrataPagination;
}

export interface DrataUser {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: string;
  updatedAt: string;
  jobTitle: string | null;
  avatarUrl: string | null;
  drataTermsAgreedAt: string | null;
  roles: string[];
}

export interface DrataWorkspace {
  id: number;
  name: string;
  description?: string | null;
  /** Legacy/alternate flag; the v2 API returns `primary` instead. */
  isDefault?: boolean;
  /** True for the account's primary workspace (v2 API shape). */
  primary?: boolean;
}

export interface DrataControlRequirement {
  id: number;
  name: string;
  description: string | null;
  frameworkName: string;
  frameworkTag: string;
  frameworkSlug: string;
  externalId: string | null;
  longDescription: string | null;
}

export interface DrataControlFlags {
  hasEvidence: boolean;
  hasPolicy: boolean;
  hasTicket: boolean;
  isReady: boolean;
  [key: string]: boolean;
}

export interface DrataControl {
  id: number;
  name: string;
  description: string;
  code?: string;
  /** Legacy flat-path field; v2 exposes readiness via `flags.isReady`. */
  status?: "ready" | "not_ready" | "not_applicable" | "not_required";
  controlType?: string;
  remappedFromId?: number | null;
  workspaceId?: number;
  createdAt: string;
  updatedAt: string;
  frameworks?: DrataFramework[];
  /** `expand[]=requirements` — each requirement names its framework. */
  requirements?: DrataControlRequirement[];
  /** `expand[]=flags` */
  flags?: DrataControlFlags;
  owners?: DrataUser[] | { data: DrataUser[]; totalCount: number };
  monitoringTests?: DrataMonitoringTest[];
}

export interface DrataFramework {
  id: number;
  name: string;
  description: string | null;
  version: string | null;
  isStandard: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DrataMonitoringTest {
  id: number;
  name: string;
  description: string | null;
  /** Legacy flat-path field; v2 reports `checkResultStatus`. */
  status?: "pass" | "fail" | "not_tested" | "not_applicable" | "unknown";
  /** v2: PASSED | FAILED | ERROR | NOT_APPLICABLE | ... */
  checkResultStatus?: string;
  /** v2: ENABLED | DISABLED */
  checkStatus?: string;
  testSource?: string;
  testId?: number;
  lastPassedAt?: string | null;
  failedSince?: string | null;
  lastTestedAt?: string | null;
  nextTestAt?: string | null;
  testInterval?: string;
  controlId?: number;
  /** `expand[]=controls` */
  controls?: DrataControl[];
  workspaceId?: number;
  createdAt: string;
  updatedAt: string;
  evidence?: DrataEvidence[];
}

export interface DrataEvidence {
  id: number;
  name: string;
  description: string | null;
  status: "active" | "inactive" | "archived";
  renewalDate: string | null;
  lastCollectedAt: string | null;
  collectionMethod: string;
  workspaceId: number;
  createdAt: string;
  updatedAt: string;
}

export interface DrataPersonnel {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  employmentStatus: string;
  jobTitle: string | null;
  startDate: string | null;
  endDate: string | null;
  department: string | null;
  managerId: number | null;
  workspaceId: number;
  createdAt: string;
  updatedAt: string;
}

export interface DrataDevice {
  id: number;
  assetId: number;
  osVersion: string | null;
  serialNumber: string | null;
  model: string | null;
  macAddress: string | null;
  lastCheckedAt: string | null;
  sourceType: string;
  isDeviceCompliant: boolean;
  screenLockTime: number | null;
  antivirusEnabled: boolean | null;
  autoUpdateEnabled: boolean | null;
  passwordManagerEnabled: boolean | null;
  encryptionEnabled: boolean | null;
  firewallEnabled: boolean | null;
  asset?: {
    id: number;
    name: string;
    assetType: string;
    owner?: DrataUser;
  };
}

export interface DrataVendor {
  id: number;
  name: string;
  description: string | null;
  vendorTypeId: number | null;
  riskTier: string | null;
  status: string;
  workspaceId: number;
  createdAt: string;
  updatedAt: string;
}

export interface DrataPolicy {
  id: number;
  name: string;
  description: string | null;
  status: string;
  lastAcknowledgedAt: string | null;
  renewalDate: string | null;
  workspaceId: number;
  createdAt: string;
  updatedAt: string;
}

export interface DrataRisk {
  id: number;
  name: string;
  description: string | null;
  inherentScore: number | null;
  residualScore: number | null;
  status: string;
  riskRegisterId: number | null;
  workspaceId: number;
  createdAt: string;
  updatedAt: string;
}

export interface DrataEvent {
  id: number;
  eventType: string;
  description: string;
  userId: number | null;
  workspaceId: number;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface DrataAsset {
  id: number;
  name: string;
  description: string | null;
  assetType: "PHYSICAL" | "VIRTUAL";
  assetProvider: string;
  assetClassTypes: string[];
  removedAt: string | null;
  owner?: DrataUser;
  device?: DrataDevice;
  notes: string | null;
  externalId: string | null;
  externalOwnerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DrataControlNote {
  id: number;
  content: string;
  controlId: number;
  userId: number;
  createdAt: string;
  updatedAt: string;
}

export type DrataSortDirection = "ASC" | "DESC";

export interface DrataListParams {
  cursor?: string;
  size?: number;
  sort?: string;
  sortDir?: DrataSortDirection;
  expand?: string[];
  includeTotalCount?: boolean;
  [key: string]: unknown;
}