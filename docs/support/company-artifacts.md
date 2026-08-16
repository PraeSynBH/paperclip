---
title: Feature Support Case Assessment — Company Artifacts
summary: Support reference for the Company Artifacts feature (shipped v2026.609.0)
version: v2026.609.0
---

# Support Case Assessment: Company Artifacts

## Feature Summary

Company Artifacts is a company-scoped page that indexes every work product, document, comment, and attachment across all issues and runs. It provides a unified view of all agent-produced deliverables, organized by task stack by default, with rich preview support for text, images, and video.

## User-Facing Behavior

### Accessing Artifacts

- Navigate to the Artifacts page from the company sidebar
- The page shows all artifacts across the company, grouped by issue by default
- Each artifact shows: title, type, issue reference, preview, media kind badge, and timestamp

### Grouping Options

| Group By | Behavior |
|----------|----------|
| Issue (default) | Groups artifacts by their parent issue, showing the issue stack |
| Project | Groups artifacts by project |
| None | Flat list of all artifacts |

### Filtering

- **Media kind filter**: all, image, video, text, file
- **Project filter**: narrow to a specific project
- **Search**: full-text search across artifact titles and content previews

### Artifact Types

| Type | Description |
|------|-------------|
| Work product | Files produced by agents during execution |
| Document | Issue documents (plans, specs, etc.) |
| Comment | Issue thread comments |
| Attachment | File attachments on issues |

### Media Kinds

| Kind | Examples |
|------|----------|
| Image | Screenshots, diagrams, photos |
| Video | Screen recordings, demo videos |
| Text | Markdown files, JSON, code, documents |
| File | PDFs, binaries, archives, other |

### Rich Preview

- **Text artifacts**: up to 280-character preview with markdown stripped
- **Image artifacts**: inline thumbnail
- **Video artifacts**: inline playback with thumbnail
- **File artifacts**: icon and filename

## Known Issues & Limitations

### 1. Preview Text Truncation

Text previews are truncated to **280 characters** after markdown stripping. For long documents, this may not convey enough context. Click through to the full artifact to see the complete content.

### 2. Preview Text Simplification

Markdown formatting is stripped for preview text. This means code blocks, links, images, and formatting are removed. The preview is plain text only.

### 3. Cursor-Based Pagination

Artifacts use cursor-based pagination (not page numbers). The cursor is a base64url-encoded JSON object containing `updatedAt` and `id`. This means:
- You cannot jump to a specific page
- Results are ordered by most recent first
- The cursor must be used as returned by the API

### 4. Attachment Content Requires Authentication

Attachment artifact content URLs (`/api/attachments/{id}/content`) require authentication. Direct links shared outside the platform will not work.

### 5. Storage Service Dependency

Artifact content retrieval depends on the configured storage service (local filesystem or S3-compatible). If the storage service is unavailable, artifact content previews will fail.

## Troubleshooting

### Artifacts page is empty

1. Verify that agents have produced work products, documents, or comments
2. Check that the company has active issues with completed runs
3. Verify the filter is not too restrictive (try clearing kind, project, and search filters)

### Artifact preview is not loading

1. Check if the storage service is available
2. For text artifacts, the preview is generated from the first 4096 bytes
3. For attachment artifacts, the user must be authenticated
4. Check browser console for network errors

### Video artifacts don't play

1. Video playback depends on browser codec support
2. Very large video files may take time to load
3. Check that the video content type is correctly set

### Search returns no results

1. Search matches against artifact title and text preview content
2. File names and binary content are not searchable
3. Try a broader search term

## Support Escalation Path

| Issue | Escalate To |
|-------|-------------|
| Storage service unavailable | CTO — check S3/filesystem configuration |
| Artifact content shows wrong preview | CTO — preview generation issue |
| Video artifacts don't render | CTO — browser compatibility or codec issue |
| Pagination is broken | CTO — cursor encoding/decoding issue |
| Permissions: user can't see artifacts | CTO — authz scope issue |

## Related Code Locations

- `server/src/services/company-artifacts.ts` — main artifacts service
- `server/src/routes/companies.ts` — artifacts API routes
- `server/src/__tests__/company-artifacts-service.test.ts` — test coverage
- `packages/shared/src/constants.ts` — `COMPANY_ARTIFACTS_MAX_LIMIT`