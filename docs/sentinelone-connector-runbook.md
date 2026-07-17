# SentinelOne Connector Runbook

**Issue:** [RBR-524](/RBR/issues/RBR-524)  
**Connector build issue:** [RBR-526](/RBR/issues/RBR-526)  
**Project:** Aira — ISO 27001 Continuous Monitoring

---

## Rate Limits

### Default rate limit

SentinelOne API v2.1 applies a per-token rate limit. The default is approximately:

| Window | Max Requests | Reset Behavior |
|--------|-------------|----------------|
| 10 minutes | ~1,000 | Sliding window; resets continuously |

**Verification:** After creating the service account, capture actual limits from response headers:

```bash
curl -s -i -H "Authorization: ApiToken $S1_TOKEN" \
  "$S1_URL/web/api/v2.1/agents?limit=1" 2>&1 | grep -i 'x-ratelimit'
```

**Recorded values** (fill in after verification):

| Endpoint | X-RateLimit-Limit | X-RateLimit-Remaining | X-RateLimit-Reset |
|----------|-------------------|-----------------------|-------------------|
| `/agents` | TBD | TBD | TBD |
| `/threats` | TBD | TBD | TBD |
| `/application-risks` | TBD | TBD | TBD |
| `/dv/events` | TBD | TBD | TBD |
| `/ranger/devices` | TBD | TBD | TBD |

### Rate limit headers

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests allowed in the current window |
| `X-RateLimit-Remaining` | Requests remaining in the current window |
| `X-RateLimit-Reset` | Unix timestamp (seconds) when the window resets |

### Connector rate limit strategy

1. **Do not poll faster than needed.** The connector should poll on intervals aligned with compliance evidence freshness requirements, not real-time telemetry:
   - Agent inventory: every 6 hours (A.8.1 changes are infrequent)
   - Threat events: every 1 hour (A.8.7, A.8.16)
   - Vulnerability findings: every 6 hours (A.8.8 — CVEs are patched, not real-time)
   - DV events: every 1 hour with 5-15 minute time windows (A.8.15, A.8.16)
   - Ranger devices: every 24 hours (network scan cycle)

2. **Backoff on 429.** If the API returns HTTP 429 (Too Many Requests), honor the `Retry-After` header. Implement exponential backoff with jitter: `min(2^n * 1s + rand(0,1s), 60s)` with max 5 retries.

3. **Cursor-based pagination.** All S1 v2.1 endpoints support cursor pagination. Use `nextCursor` from the `pagination` object to page through results. This is more efficient than offset-based pagination and reduces the rate-limit impact.

4. **Incremental polling (where supported).** For endpoints that support time-based filters:
   - `GET /agents?updatedAt__gte=<last_poll_time>` — fetch only agents updated since last poll
   - `GET /threats?createdAt__gte=<last_poll_time>` — fetch only new threats
   - `GET /app-risks?detectedAt__gte=<last_poll_time>` — fetch only new findings

---

## API Authentication

### Header format

All requests use the `ApiToken` scheme:

```
Authorization: ApiToken <token>
Content-Type: application/json
```

**Never use the `Bearer` scheme** — SentinelOne uses `ApiToken`, not `Bearer`.

### Token scope

| Role | Read | Write | Admin |
|------|------|-------|-------|
| **Viewer** (recommended) | Yes | No | No |
| IR Team | Yes | Limited | No |
| Admin | Yes | Yes | Yes |

**Security principle:** Use Viewer role. No write access is needed for evidence collection. The connector never modifies S1 configuration, initiates scans, or takes agent actions.

### Token retrieval from secrets manager

The connector must retrieve the token at startup and refresh on token rotation. Do NOT store the token in environment variables, config files, or source code.

**Doppler example:**
```bash
export S1_TOKEN=$(doppler secrets get SENTINELONE_API_TOKEN --plain --project aira --config prd)
export S1_URL=$(doppler secrets get SENTINELONE_TENANT_URL --plain --project aira --config prd)
```

**1Password example (op CLI):**
```bash
export S1_TOKEN=$(op read "op://Aira - Production/SentinelOne API Token/credential")
export S1_URL=$(op read "op://Aira - Production/SentinelOne API Token/S1_TENANT_URL")
```

---

## Endpoint Reference

### Base URL

The base URL is tenant-specific. Format: `https://<subdomain>.sentinelone.net`

Common regions (replace `<subdomain>` with actual Aira tenant):

| Region | Example URL |
|--------|------------|
| US East | `https://usea1-partners.sentinelone.net` |
| US West | `https://usw1-partenrs.sentinelone.net` |
| EU Central | `https://euce1-partners.sentinelone.net` |
| AP Southeast | `https://apse1-partners.sentinelone.net` |

### Evidence endpoints

| Evidence Class | Method | Path | Pagination | Time Filter |
|---------------|--------|------|-----------|-------------|
| agent_inventory | GET | `/web/api/v2.1/agents` | Cursor | `updatedAt__gte` |
| threat_event | GET | `/web/api/v2.1/threats` | Cursor | `createdAt__gte` |
| vulnerability_finding | GET | `/web/api/v2.1/application-risks` | Cursor | None built-in; use `ids` for check |
| dv_event | GET | `/web/api/v2.1/dv/events` | Cursor | `fromDate`, `toDate` (query DSL) |
| ranger_device | GET | `/web/api/v2.1/ranger/devices` | Cursor | None built-in |

### Common query parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | integer | Max items per page (default: 10, max: 1000) |
| `cursor` | string | Cursor for next page (from `pagination.nextCursor`) |
| `siteIds` | string | Comma-separated site IDs to filter |
| `accountIds` | string | Comma-separated account IDs to filter |
| `sortBy` | string | Field to sort by (endpoint-specific) |
| `sortOrder` | string | `asc` or `desc` |

### Response envelope

All endpoints return a consistent envelope:

```json
{
  "data": [
    { /* resource object */ }
  ],
  "pagination": {
    "nextCursor": "cursor-string-or-null",
    "totalItems": 1234
  },
  "errors": null
}
```

Error responses (non-2xx):

```json
{
  "errors": [
    {
      "code": 4000000,
      "detail": "Invalid parameter: siteIds",
      "title": "Bad Request"
    }
  ]
}
```

---

## Error Handling

### HTTP status codes

| Status | Meaning | Connector Action |
|--------|---------|-----------------|
| 200 | Success | Process response normally |
| 400 | Bad Request | Log error, skip request (likely a parameter issue) |
| 401 | Unauthorized | **CRITICAL**: Token expired or revoked. Alert SecOps immediately. Stop polling. |
| 403 | Forbidden | Token lacks permission for the endpoint. Check Viewer role scope. |
| 404 | Not Found | Endpoint or resource not found. Check URL. |
| 429 | Too Many Requests | Back off per rate limit strategy. Retry up to 5 times. |
| 500 | Internal Server Error | Retry with backoff (S1-side transient issue). Max 3 retries. |
| 503 | Service Unavailable | Retry with backoff. Max 3 retries. |

### Error escalation

| Severity | Condition | Action |
|----------|-----------|--------|
| **CRITICAL** | 401 errors | Wake SecOps immediately. Token rotation required. |
| **HIGH** | 3x consecutive 500/503 | Alert on monitoring channel. S1 API may be degraded. |
| **MEDIUM** | Rate limit exhaustion | Log. Stretch polling intervals temporarily. |
| **LOW** | Transient errors (single 500) | Retry. Log only if retry count > 1. |

---

## Security Notes

### Token lifecycle

- **Rotation:** Before the token expiry date (configured at creation). Default: every 365 days.
- **Rotation procedure:** Create a new service user token in S1, update the secrets manager entry, verify all 5 endpoints, revoke the old token.
- **Alerting:** Set a secrets manager expiry alert 30 days before token expiry.

### Network security

- The integration host must be able to reach the S1 API over HTTPS (port 443).
- No inbound connectivity from S1 is required (all polling is outbound from the connector).
- Consider S1 IP allowlisting if the tenant supports it, restricting API access to the integration host's IP.

### Logging and data handling

- **Never log the API token.** Strip `Authorization` headers from all logs.
- **Never log raw DV events.** DV events may contain command lines, file paths, and user data. Log only summary counts.
- **Evidence data in Drata.** Drata stores evidence data in its own data store. Ensure Drata's data retention policy aligns with ISO 27001 evidence retention requirements (typically 3 years for certification evidence).

### Secrets scanning

Configure gitleaks or trufflehog on the connector repo to detect accidental token commits:

```bash
# .gitleaks.toml
[[rules]]
id = "sentinelone-api-token"
description = "SentinelOne API Token"
regex = '''ApiToken\s+[A-Za-z0-9+\/=]{40,}'''
```

---

## Operational Checklist

### Startup

- [ ] Retrieve `SENTINELONE_API_TOKEN` and `SENTINELONE_TENANT_URL` from secrets manager.
- [ ] Health check: `GET /web/api/v2.1/agents?limit=1` → 200.
- [ ] Verify rate limit headers are present and limits are not exhausted.

### Normal operation

- [ ] Poll each evidence class on its configured interval.
- [ ] Deduplicate by dedup key before inserting into Drata.
- [ ] Log summary counts per poll cycle (agents: N new, threats: M new, etc.).
- [ ] Monitor rate limit consumption. Alert at 80% utilization.

### Incident

- [ ] 401 → Stop polling. Alert SecOps. Token rotation required.
- [ ] 3x consecutive 5xx → Alert. Switch to extended backoff.
- [ ] Rate limit exhaustion → Stretch intervals. Do not retry aggressively.

### Shutdown

- [ ] Complete current poll cycle.
- [ ] Log final evidence counts.
- [ ] Revoke token only if connector is being permanently decommissioned.

---

## Related Issues

- [RBR-523](/RBR/issues/RBR-523) — Integration plan (parent)
- [RBR-524](/RBR/issues/RBR-524) — Service account + schema setup (this issue)
- [RBR-525](/RBR/issues/RBR-525) — Drata Custom Connection + monitoring tests
- [RBR-526](/RBR/issues/RBR-526) — Connector build, deploy, operate (next step, blocked on RBR-524)