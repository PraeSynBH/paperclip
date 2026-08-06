# Drata API Integration: Rate Limits, Pagination & Error Handling

## Base URL

```
https://public-api.drata.com/public/v2
```

## Authentication

Bearer token via `Authorization` header:

```
Authorization: Bearer <DRATA_API_KEY>
```

API keys are managed in Drata's Settings → API Keys. Keys use a least-privilege scoping model — each key only grants access to explicitly enabled resource types.

## Rate Limits

Drata imposes standard HTTP API rate limiting. Observed behavior:

| Condition | Response |
|-----------|----------|
| Normal operation | `200 OK` |
| Rate limited | `429 Too Many Requests` with `Retry-After` header |
| Recommendation | Implement exponential backoff with jitter. Default: 1s initial, 2x multiplier, 5 retries max |

**Recommendation for sync:**
- Full sync: run once per hour maximum
- Incremental delta: poll events endpoint every 5 minutes for changes
- Batch size: 500 records per page (API maximum)

## Pagination

Drata V2 uses **cursor-based pagination** for all list endpoints.

### Request Pattern

```typescript
let cursor: string | undefined;
do {
  const params = { size: 500 };
  if (cursor) params.cursor = cursor;
  const response = await fetch(`/endpoint?${new URLSearchParams(params)}`);
  const data = await response.json();
  // Process data.data
  cursor = data.pagination.cursor;
} while (cursor);
```

### Pagination Response

```json
{
  "data": [...],
  "pagination": {
    "cursor": "eyJsYXN0SWQiOjEyMzQsImRpcmVjdGlvbiI6ImZvcndhcmQifQ==",
    "totalCount": 1234
  }
}
```

- `cursor`: null when on the last page
- `totalCount`: only present when `includeTotalCount=true` on first request
- `size`: 1–500, default 50
- `sort`/`sortDir`: available on most endpoints for ordering (e.g., `sort=createdAt&sortDir=DESC`)

## Expand Parameter

V2 uses an `expand[]` query parameter to include related objects inline:

| Endpoint | Expandable Fields |
|----------|-------------------|
| Controls | `frameworks`, `owners`, `monitoringTests` |
| Assets | `device`, `assetClassTypes`, `complianceChecks`, `customFields`, `identifiers`, `owner` |
| Users | `roles`, `backgroundChecks`, `documents`, `identities` |
| Devices | `asset`, `complianceChecks`, `identifiers`, `documents` |

## Error Handling

| Status | Meaning | Action |
|--------|---------|--------|
| `200` | Success | Process response |
| `201` | Created (POST) | Process response |
| `204` | No Content (update) | Success, no body |
| `400` | Validation error | Fix request payload |
| `401` | Invalid API key | Rotate key, check expiry |
| `403` | Permission denied | Key lacks scope for this endpoint |
| `404` | Not found / No access | Endpoint not available to this key; request scope expansion |
| `412` | Terms not accepted | Accept Drata API terms in dashboard |
| `422` | Unprocessable entity | Business logic error |
| `429` | Rate limited | Back off, respect `Retry-After` |
| `500` | Server error | Retry with backoff |

### Error Response Format

```json
{
  "statusCode": 404,
  "message": "Cannot GET /public/v2/controls",
  "code": 10000,
  "debugInfo": null
}
```

## Endpoint Availability Matrix (Current API Key)

| Endpoint | Status | Data Available |
|----------|--------|---------------|
| `GET /company` | 200 | Company name: Aira |
| `GET /workspaces` | 200 | 1 workspace: Aira |
| `GET /users` | 200 | 662 users |
| `GET /personnel` | 200 | 657 personnel (144 active employees) |
| `GET /devices` | 200 | 621 devices (0 compliant) |
| `GET /assets` | 200 | 425 physical assets |
| `GET /policies` | 200 | 35 active policies |
| `GET /events` | 200 | Audit log accessible |
| `GET /vendors` | 200 | 0 vendors |
| `GET /workspaces/{id}/controls` | 200 (via `/workspaces/{id}/...` prefix) | 727 controls |
| `GET /control-library` | 403 | Endpoint exists, no permission |
| `GET /workspaces/{id}/frameworks` | 200 (via `/workspaces/{id}/...` prefix) | 21 frameworks (ISO 27001:2022 = id 17, enabled) |
| `GET /workspaces/{id}/monitoring-tests` | 200 (via `/workspaces/{id}/...` prefix) | 148 monitoring tests |
| `GET /evidence` | 404 | "Multiple artifacts are not enabled for this account" — plan/entitlement gap, not a path issue |
| `GET /risks` | 404 | Not in key scope |

### Workspace-scoped paths (RBR-860)

Controls, frameworks and monitoring tests are **not** available on flat
top-level paths in the Drata v2 API — `GET /controls` returns
`404 Cannot GET /public/v2/controls`. They must be addressed under the
workspace that owns them:

```
GET /public/v2/workspaces/{workspaceId}/frameworks
GET /public/v2/workspaces/{workspaceId}/controls
GET /public/v2/workspaces/{workspaceId}/controls/{controlId}
GET /public/v2/workspaces/{workspaceId}/controls/{controlId}/notes
GET /public/v2/workspaces/{workspaceId}/monitoring-tests
```

`DrataClient.getWorkspaceId()` resolves this once per client instance from
`GET /workspaces`, preferring the workspace flagged `primary: true` (Aira has
exactly one: `{ id: 1, primary: true, name: "Aira" }`) and caching the result.
A workspace ID can also be passed explicitly to the constructor.

`/evidence` and `/risks` deliberately stay on their top-level paths — neither
is a wrong-path case. `/workspaces/{id}/evidence` returns a distinct
"Multiple artifacts are not enabled for this account" message (plan gap) and
`/workspaces/{id}/risks` 404s the same way the flat path does.

#### `expand[]` values differ on the workspace-scoped routes

The v2 routes reject the old expand names with `400 EnumValidator`:

| Resource | Valid `expand[]` values |
|----------|------------------------|
| controls | `customFields`, `evidenceIds`, `flags`, `frameworkTags`, `owners`, `requirements`, `testIds`, `topics` |
| monitoring-tests | `controls`, `monitorInstances`, `disablingUser` |

Consequences for response shape, handled by `src/drata/helpers.ts`:

- There is no `control.frameworks` array. Framework linkage comes from
  `expand[]=requirements`, where each requirement carries `frameworkName` /
  `frameworkTag`. Use `controlFrameworkNames(control)`.
- There is no `control.status` string. Readiness comes from
  `expand[]=flags` as `flags.isReady`. Use `isControlReady(control)` or
  `controlStatusLabel(control)`.
- `control.owners` is a `{ data, totalCount }` envelope, not a flat array.
  Use `controlOwners(control)`.
- Monitoring tests report `checkResultStatus` (`PASSED` / `FAILED` / ...)
  and `checkStatus` (`ENABLED` / `DISABLED`) instead of a `status` string,
  and carry no flat `controlId` — linked controls arrive via
  `expand[]=controls`.

## Configuration

Environment variables (see `.env.example`):

```bash
DRATA_API_KEY=sk_...           # Required
DRATA_BASE_URL=https://...     # Default: https://public-api.drata.com/public/v2
DATA_DIR=./data                # Sync data storage
```

## Security Review

- **Credential storage (Least Privilege):** API key stored via environment variable only; never committed to source. Key has read-only access to a limited set of resources.
- **Transport security:** HTTPS enforced via base URL.
- **Error handling (Fail Securely):** Non-2xx responses throw typed `DrataApiError` without exposing raw keys in error messages.
- **Input handling:** Query parameters sanitized via URL construction; no user-supplied paths pass directly to `fetch`.
- **Pagination safety:** Cursor-based pagination avoids offset-injection and mutation-during-pagination issues.