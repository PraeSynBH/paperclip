/** Knowledge document lifecycle statuses */
export type KnowledgeDocumentStatus =
  | "draft"
  | "in_review"
  | "published"
  | "archived";

/** Review decision statuses */
export type KnowledgeReviewStatus =
  | "pending"
  | "approved"
  | "changes_requested";

/** Backlink source type */
export type KnowledgeBacklinkSourceType =
  | "originating_issue"
  | "referenced_in_body";

/** Core knowledge document entity */
export interface KnowledgeDocument {
  id: string;
  companyId: string;
  title: string;
  summary?: string;
  body: string;
  status: KnowledgeDocumentStatus;
  version: number;
  authorAgentId?: string;
  sourceIssueId?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

/** A versioned snapshot of a knowledge document */
export interface KnowledgeDocumentRevision {
  id: string;
  documentId: string;
  version: number;
  title: string;
  summary?: string;
  body: string;
  changeDescription?: string;
  authorAgentId?: string;
  createdAt: string;
}

/** A review entry for a knowledge document revision */
export interface KnowledgeDocumentReview {
  id: string;
  documentId: string;
  revisionId: string;
  reviewerAgentId?: string;
  status: KnowledgeReviewStatus;
  comment?: string;
  createdAt: string;
  decidedAt?: string;
}

/** Backlink from a knowledge document to a source issue */
export interface KnowledgeSourceBacklink {
  id: string;
  documentId: string;
  sourceIssueId: string;
  sourceType: KnowledgeBacklinkSourceType;
  createdAt: string;
}

// ─── Request Types ───────────────────────────────────────────────────────────

export interface KnowledgeDocumentCreateRequest {
  title: string;
  summary?: string;
  body?: string;
  sourceIssueId?: string;
}

export interface KnowledgeDocumentUpdateRequest {
  title?: string;
  summary?: string;
  body?: string;
}

export interface KnowledgeDocumentPublishRequest {
  changeDescription?: string;
}

export interface KnowledgeDocumentSubmitReviewRequest {
  reviewerAgentId?: string;
}

export interface KnowledgeDocumentReviewDecision {
  status: "approved" | "changes_requested";
  comment?: string;
}

export interface KnowledgeDocumentListQuery {
  status?: KnowledgeDocumentStatus;
  cursor?: string;
  limit?: number;
  search?: string;
}

export interface KnowledgeDocumentListPage {
  items: Array<{
    id: string;
    title: string;
    summary?: string;
    status: KnowledgeDocumentStatus;
    version: number;
    authorAgentId?: string;
    sourceIssueId?: string;
    createdAt: string;
    updatedAt: string;
    publishedAt?: string;
    revisionCount: number;
    latestReviewStatus?: KnowledgeReviewStatus;
  }>;
  nextCursor?: string;
  total?: number;
}

export interface KnowledgeDocumentDiff {
  oldVersion: number;
  newVersion: number;
  titleChanged: boolean;
  oldTitle?: string;
  newTitle: string;
  summaryChanged: boolean;
  oldSummary?: string;
  newSummary?: string;
  bodyDiff: string;
  changeDescription?: string;
}

export interface KnowledgeCreateBacklinkRequest {
  sourceIssueId: string;
  sourceType?: KnowledgeBacklinkSourceType;
}

export interface KnowledgeCreateBacklinkResponse {
  id: string;
}

// ─── Memory→Knowledge Promotion ──────────────────────────────────────────────

export interface KnowledgePromoteFromMemoryRequest {
  /** The memory record ID to promote */
  memoryRecordId: string;
  /** Optional title override (defaults to "Memory Record from <source>") */
  title?: string;
  /** Optional summary override */
  summary?: string;
  /** Optional body override (defaults to memory record text) */
  body?: string;
}