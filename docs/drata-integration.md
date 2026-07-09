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
| `GET /controls` | 404 | Not in key scope |
| `GET /control-library` | 403 | Endpoint exists, no permission |
| `GET /frameworks` | 404 | Not in key scope |
| `GET /monitoring-tests` | 404 | Not in key scope |
| `GET /evidence` | 404 | Not in key scope |
| `GET /risks` | 404 | Not in key scope |

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