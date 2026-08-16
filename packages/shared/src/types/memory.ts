/** Memory binding and configuration */

export interface MemoryBindingConfig {
  providerType: "builtin_pgvector" | string; // plugin id for plugin providers
  configJson: Record<string, unknown>;
  capabilitiesJson: MemoryCapabilities;
}

export interface MemoryCapabilities {
  profile?: boolean;
  correction?: boolean;
  multimodal?: boolean;
  providerManagedExtraction?: boolean;
  asyncExtraction?: boolean;
  providerNativeBrowse?: boolean;
}

export type MemoryRecordType =
  | "auto_capture"
  | "curated_note"
  | "profile"
  | "decision";

export type MemorySourceKind =
  | "issue_comment"
  | "issue_document"
  | "issue"
  | "run"
  | "activity"
  | "manual_note"
  | "external_document";

export interface MemoryRecord {
  id: string;
  companyId: string;
  bindingId: string;
  recordType: MemoryRecordType;
  text: string;
  summary?: string;
  scope: MemoryScope;
  source: MemorySourceRef;
  metadataJson?: Record<string, unknown>;
  importance?: number;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface MemoryScope {
  companyId: string;
  agentId?: string;
  projectId?: string;
  issueId?: string;
  runId?: string;
  subjectId?: string;
  sessionKey?: string;
  namespace?: string;
}

export interface MemorySourceRef {
  kind: MemorySourceKind;
  companyId: string;
  issueId?: string;
  commentId?: string;
  documentKey?: string;
  runId?: string;
  activityId?: string;
  externalRef?: string;
}

export interface MemoryQueryRequest {
  bindingKey: string;
  scope: MemoryScope;
  query: string;
  topK?: number;
  intent?: "agent_preamble" | "answer" | "browse";
  metadataFilter?: Record<string, unknown>;
}

export interface MemoryContextBundle {
  snippets: MemorySnippet[];
  profileSummary?: string;
  usage?: MemoryUsage[];
}

export interface MemorySnippet {
  handle: MemoryRecordHandle;
  text: string;
  score?: number;
  summary?: string;
  source?: MemorySourceRef;
  metadata?: Record<string, unknown>;
}

export interface MemoryRecordHandle {
  providerKey: string;
  providerRecordId: string;
}

export interface MemoryUsage {
  provider: string;
  biller?: string;
  model?: string;
  billingType?: "metered_api" | "subscription_included" | "subscription_overage" | "unknown";
  attributionMode?: "billed_directly" | "included_in_run" | "external_invoice" | "untracked";
  inputTokens?: number;
  outputTokens?: number;
  embeddingTokens?: number;
  costCents?: number;
  latencyMs?: number;
}

export interface MemoryCaptureRequest {
  bindingKey: string;
  scope: MemoryScope;
  source: MemorySourceRef;
  payload: { text?: string; mimeType?: string; metadata?: Record<string, unknown> };
  metadata?: Record<string, unknown>;
}

export interface MemoryRecordWriteEntry {
  text: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryRecordWriteRequest {
  bindingKey: string;
  scope: MemoryScope;
  source?: MemorySourceRef;
  records: MemoryRecordWriteEntry[];
}

export interface MemoryListRequest {
  bindingKey: string;
  scope: MemoryScope;
  cursor?: string;
  limit?: number;
  metadataFilter?: Record<string, unknown>;
}

export interface MemoryListPage {
  items: MemorySnippet[];
  nextCursor?: string;
  usage?: MemoryUsage[];
}

export type MemoryOperationType =
  | "capture"
  | "record_upsert"
  | "query"
  | "list"
  | "get"
  | "forget"
  | "correct";

export type MemoryExtractionHookKind =
  | "post_run_capture"
  | "issue_comment_capture"
  | "issue_document_capture";

export type MemoryExtractionJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";