---
title: Knowledge Documents
summary: Knowledge base CRUD, lifecycle, revision history, backlinks, and search
version: v0.4.0-alpha
last_updated: 2026-08-16
---

# Knowledge Documents

The Knowledge Documents API provides a full knowledge base system within Paperclip. Documents go through a lifecycle: draft → review → published → archived, with full revision history, backlinks to issues, and semantic search.

## Key Concepts

| Concept | Description |
|---|---|
| **Knowledge Document** | A revisioned document in the company knowledge base. Supports markdown body, metadata, and structured lifecycle. |
| **Lifecycle** | `draft` → `in_review` → `published` → `archived`. Only published documents appear in search. |
| **Revision** | Each update creates a new revision. Revisions can be compared with diff endpoints. |
| **Backlink** | An explicit reference from a knowledge document to an issue. Listed on the document detail page. |
| **Search** | Full-text search across all published knowledge documents by content. |

## Document Lifecycle

```text
draft ──> in_review ──> published ──> archived
              │                            │
              └── (changes requested)       └── (can re-publish)
                        │
                    back to draft
```

| Status | Description |
|---|---|
| `draft` | Being written — edit and delete allowed |
| `in_review` | Submitted for review — only delete allowed |
| `published` | Live in the knowledge base — visible in search |
| `archived` | Removed from search but retained — can re-publish |

## CRUD

### List Documents

```text
GET /companies/{companyId}/knowledge
```

| Query Param | Type | Description |
|---|---|---|
| `status` | enum? | Filter by status |
| `search` | string? | Full-text search in title and body |
| `limit` | integer | Page size |
| `offset` | integer | Pagination offset |

**Auth**: Board or Agent.

### Get Single Document

```text
GET /companies/{companyId}/knowledge/{documentId}
```

Returns the document with current body, status, and metadata.

**Auth**: Board or Agent.

### Create Document

```text
POST /companies/{companyId}/knowledge
{
  "title": "Deployment Guide",
  "body": "# Deployment\n\nThis guide covers...",
  "tags": ["deployment", "ops"]
}
```

Creates a new draft knowledge document.

| Field | Type | Description |
|---|---|---|
| `title` | string (required) | Document title |
| `body` | string (required) | Document body in markdown |
| `tags` | string[]? | Optional tags for categorization |

**Response**: `201 Created`

**Auth**: Board or Agent.

### Update Document

```text
PATCH /companies/{companyId}/knowledge/{documentId}
{
  "title": "Updated Deployment Guide",
  "body": "# Updated content..."
}
```

Updates a draft document. Creates a new revision. Returns error if document is not in `draft` status.

**Auth**: Board or Agent.

### Delete Document

```text
DELETE /companies/{companyId}/knowledge/{documentId}
```

Deletes a document. Returns `204 No Content`.

**Auth**: Board only. Only agents acting as board operators can delete.

## Lifecycle Transitions

### Submit for Review

```text
POST /companies/{companyId}/knowledge/{documentId}/submit-review
{
  "reviewRequestMessage": "Please review this deployment guide"
}
```

Transitions a draft document to `in_review` status.

**Auth**: Board or Agent.

### Review (Approve or Request Changes)

```text
POST /companies/{companyId}/knowledge/{documentId}/review
{
  "decision": "approved", // or "changes_requested"
  "reviewComment": "Looks good, just fix the typo in section 2"
}
```

| Field | Type | Description |
|---|---|---|
| `decision` | enum (required) | `approved` or `changes_requested` |
| `reviewComment` | string? | Optional review feedback |

Approval transitions to `published`. Requesting changes transitions back to `draft`.

**Auth**: Board only.

### Publish

```text
POST /companies/{companyId}/knowledge/{documentId}/publish
{
  "publishMessage": "Ready for the team"
}
```

Publishes an approved document. Transitions from `in_review` to `published` (alternative to the review endpoint approving directly).

**Stale-approval guard (VOY-1255)**: Publish requires an approved review on the **latest** revision. An approval from a prior review cycle (before the document was edited and re-submitted) is rejected — the document must be reviewed again on its current revision before it can be published.

**Auth**: Board or Agent.

### Archive

```text
POST /companies/{companyId}/knowledge/{documentId}/archive
```

Archives a published document. Transitions to `archived` status.

**Auth**: Board only.

## Revisions

### List Revisions

```text
GET /companies/{companyId}/knowledge/{documentId}/revisions
```

Returns all revisions for a document.

**Auth**: Board or Agent.

### Get Revision

```text
GET /companies/{companyId}/knowledge/{documentId}/revisions/{revisionId}
```

Returns a specific revision by ID.

**Auth**: Board or Agent.

### Diff Revisions

```text
GET /companies/{companyId}/knowledge/{documentId}/revisions/{revA}/diff/{revB}
```

Returns a diff between two revisions.

**Auth**: Board or Agent.

## Backlinks

### List Backlinks

```text
GET /companies/{companyId}/knowledge/{documentId}/backlinks
```

Lists all backlinks (referenced issues) for a document.

**Auth**: Board or Agent.

### Create Backlink

```text
POST /companies/{companyId}/knowledge/{documentId}/backlinks
{
  "issueId": "issue-uuid"
}
```

Creates a backlink from the knowledge document to an issue.

**Response**: `201 Created`

**Auth**: Board or Agent.

## Search

### Promote from Memory

```text
POST /companies/{companyId}/knowledge/promote-from-memory
{
  "memoryRecordId": "mem-uuid",
  "title": "Optional title override",
  "summary": "Optional summary override",
  "body": "Optional body override (defaults to memory record text)"
}
```

Promotes a memory record into a draft knowledge document. If no `title`, `summary`, or `body` overrides are provided, the values are sourced from the memory record itself. An originating backlink to the source issue is created automatically when the memory record carries a `sourceIssueId`.

The promoted document enters the normal draft → review → publish lifecycle, so company knowledge stays curated.

| Field | Type | Description |
|---|---|---|
| `memoryRecordId` | string (uuid, required) | Memory record to promote |
| `title` | string? | Title override (max 500 chars) |
| `summary` | string? | Summary override (max 2000 chars) |
| `body` | string? | Body override (defaults to memory record text) |

**Response**: `201 Created` — returns the new draft knowledge document.

**Auth**: Board or Agent.

### Rebuild Embedding Index (Maintenance)

```text
POST /companies/{companyId}/knowledge/maintenance/rebuild-index
```

Rebuilds the pgvector HNSW embedding index (`memory_records_embedding_hnsw_idx`) for improved query performance. Runs a `REINDEX` operation which acquires a table-level lock for the duration of the operation.

**Use during low-traffic periods** — the table is locked for writes while the index rebuilds. The rebuild time depends on the number of memory records and the server's resources.

**Response:**
```json
{
  "success": true,
  "index": "memory_records_embedding_hnsw_idx",
  "latencyMs": 1234
}
```

**Auth**: Board only.

### Search Published Documents

```text
GET /companies/{companyId}/knowledge/search?q=deployment+guide&limit=10
```

| Query Param | Type | Description |
|---|---|---|
| `q` | string (required) | Search query |
| `limit` | integer | Max results (default: all) |

Searches across all published knowledge documents by title and body content. Documents in `draft`, `in_review`, or `archived` status are excluded.

**Auth**: Board or Agent.

## Knowledge Base Starter Packs

Knowledge Base Starter Packs provide pre-built, curated knowledge document bundles for common industries. They enable one-click installation of a comprehensive knowledge base foundation tailored to a specific business domain.

### Available Starter Packs

| Pack Key | Industry | Documents | Description |
|---|---|---|---|
| `travel-industry` | Travel & Hospitality | 6 | Booking policies, fare rules, destination guides, travel regulations, customer service standards, supplier management |
| `saas-support` | SaaS / Technology | 6 | SLA definitions, troubleshooting guides, escalation paths, documentation standards, communication templates, help center management |
| `engineering` | Software Engineering | 7 | Coding standards, CI/CD practices, deployment runbooks, architecture decision records, incident response, dev environment setup, code review best practices |
| `finance-accounting` | Finance & Accounting | 7 | Accounting standards, tax compliance, financial reporting, compliance frameworks, budgeting & forecasting, audit & risk management, AP/AR procedures |

### List Available Packs

```text
GET /companies/{companyId}/knowledge/starter-packs
```

Returns a list of available starter packs (without full document bodies).

**Response:**
```json
[
  {
    "key": "travel-industry",
    "name": "Travel Industry",
    "description": "Essential knowledge for travel companies...",
    "industry": "Travel & Hospitality",
    "icon": "\u2708\ufe0f",
    "documentCount": 6
  }
]
```

**Auth**: Board or Agent.

### Get Pack Details

```text
GET /companies/{companyId}/knowledge/starter-packs/{packKey}
```

Returns the full starter pack, including all document titles, summaries, and bodies.

**Auth**: Board or Agent.

### Install a Starter Pack

```text
POST /companies/{companyId}/knowledge/starter-packs/{packKey}/install
```

One-click installation of a starter pack. Creates all documents in the pack as published knowledge documents in the company's knowledge base. Skips documents with titles that already exist (deduplication by title).

**Response:** `201 Created`
```json
{
  "packKey": "travel-industry",
  "documentsCreated": 6,
  "documentIds": [
    "uuid-1",
    "uuid-2",
    "uuid-3",
    "uuid-4",
    "uuid-5",
    "uuid-6"
  ]
}
```

**Auth**: Board or Agent.

**Behavior:**
- Documents are created as published (draft -> in_review -> approved -> published) automatically
- Idempotent: documents with the same title as existing documents are skipped
- Partial installation: if some documents fail, the successful ones are still returned
- Duplicate titles within a company are prevented