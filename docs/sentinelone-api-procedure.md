# SentinelOne API Surface Inventory — Token-Provisioning Procedure

**Issue:** [RBR-529](/RBR/issues/RBR-529)  
**Parent plan:** [RBR-523](/RBR/issues/RBR-523#document-plan)  
**Siblings:** [RBR-525](/RBR/issues/RBR-525) (Drata side), [RBR-526](/RBR/issues/RBR-526) (connector build)  
**Project:** Aira — ISO 27001 Continuous Monitoring  
**Security lens:** Least Privilege, Minimize Attack Surface, Secure Defaults, Defense in Depth

---

## Overview

This document is the authoritative API procedure for Rambur's SentinelOne Singularity Platform integration. It covers all 11 endpoints required by the integration plan, the service-account token lifecycle, and the evidence capture pipeline (S1 → AWS Secrets Manager → S3 → Drata).

**Audience:** SecOps (token creation, operational runbook), the connector developer on [RBR-526](/RBR/issues/RBR-526), and Compliance & Audit for control mapping verification.

**Prerequisite:** SentinelOne Management Console admin access (Account Admin or Site Admin) for the Aira tenant. The tenant URL is `https://<subdomain>.sentinelone.net`.

---

## Part 1: Service Account and API Token

### 1.1 — Create a Read-Only Service User

1. Log into the SentinelOne Management Console at `https://<subdomain>.sentinelone.net`.
2. Navigate to **Settings** → **Users** → **Service Users** tab.
3. Click **Create Service User** and configure:

| Field | Value | Notes |
|-------|-------|-------|
| **Name** | `Drata Evidence Collector` | Descriptive; readable in `/activities` audit log |
| **Role** | **Viewer** | Read-only. Never use Admin, IR Team, or Site Admin. |
| **Scope** | **Account** | Required for cross-endpoint evidence (accounts, roles, system status are account-scoped). If Aira is single-site, Account scope is safe. |
| **Expiration** | 365 days | Requires annual rotation. Set a 330-day reminder. |

> **Security rationale (Least Privilege):** Viewer role grants read-only access to all endpoints in scope. It cannot modify policies, trigger scans, initiate agent actions, or change configuration. This is the minimum viable privilege for evidence collection.

4. After creation, SentinelOne displays the API token **once**. Copy it immediately.

### 1.2 — Store the API Token in AWS Secrets Manager

Store the token under the key `s1/api_token`:

```bash
aws secretsmanager create-secret \
  --name "s1/api_token" \
  --description "SentinelOne API token (Viewer role) for Drata evidence collector — created per RBR-529" \
  --secret-string '{
    "token": "<api-token-from-step-1.1>",
    "tenant_url": "https://<subdomain>.sentinelone.net",
    "scope": "account",
    "created_at": "2026-07-16T00:00:00Z",
    "expires_at": "2027-07-16T00:00:00Z",
    "created_by": "RBR-529 procedure"
  }' \
  --region us-east-1
```

**Verification:**

```bash
aws secretsmanager get-secret-value --secret-id "s1/api_token" --region us-east-1 --query SecretString --output text | python3 -m json.tool
```

**Token rotation (annual):**
1. Create a new service user token in the S1 console.
2. Update the secret: `aws secretsmanager update-secret --secret-id "s1/api_token" --secret-string '{"token":"<new-token>",...}' --region us-east-1`
3. Verify all 11 endpoints return 200 with the new token.
4. Delete the old service user in the S1 console.

**Security notes:**
- The token is read-only (Viewer role). It cannot modify S1 configuration.
- It can read all endpoint data for the scoped Account (agent inventory, threats, vulnerabilities, admin accounts, roles, audit log, DNS/URL events, threat intel).
- Treat it as a secret. Never commit, log, or share it.
- Enable automatic rotation in AWS Secrets Manager with a 30-day warning before expiry.

---

## Part 2: API Endpoint Inventory

### Authentication Header (all endpoints)

```
Authorization: ApiToken <token>
Content-Type: application/json
```

> **Critical:** SentinelOne uses `ApiToken`, not `Bearer`. Using `Bearer` returns 401.

### Common Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | integer | Items per page (default: 10, max: 1000) |
| `cursor` | string | Opaque cursor from `pagination.nextCursor` |
| `siteIds` | string | Comma-separated site IDs to filter |
| `accountIds` | string | Comma-separated account IDs to filter |
| `sortBy` | string | Field to sort by (endpoint-specific) |
| `sortOrder` | string | `asc` or `desc` |

### Response Envelope (all endpoints)

```json
{
  "data": [ { /* resource object */ } ],
  "pagination": { "nextCursor": "cursor-or-null", "totalItems": 1234 },
  "errors": null
}
```

### Rate Limits

| Window | Max Requests | Header | Reset |
|--------|-------------|--------|-------|
| 10 minutes | ~1,000 per token | `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` | Sliding window |

**Connector strategy:** Polling intervals aligned with evidence freshness (see table below). On HTTP 429, honor `Retry-After` header with exponential backoff + jitter: `min(2^n * 1s + rand(0,1s), 60s)`, max 5 retries.

---

### Endpoint 1: `GET /web/api/v2.1/agents`

| Attribute | Detail |
|-----------|--------|
| **ISO control** | A.8.1 (Inventory of Assets), A.8.9 (Configuration Management), A.8.24 (Cryptography) |
| **Required scope** | Viewer — Site-level read |
| **Pagination** | Cursor (`pagination.nextCursor`) |
| **Time filter** | `updatedAt__gte=<ISO8601>` for incremental polls |
| **Poll interval** | Every 6 hours (A.8.1 changes infrequent) |
| **Key response fields** | `uuid`, `computerName`, `osType`, `osName`, `lastActiveDate`, `isActive`, `isDecommissioned`, `siteName`, `externalIp`, `diskEncryptionStatus`, `firewallEnabled`, `agentVersion`, `scanStatus` |

```bash
# List all agents, page 1
curl -s -H "Authorization: ApiToken $S1_TOKEN" \
  -H "Content-Type: application/json" \
  "$S1_URL/web/api/v2.1/agents?limit=100" | python3 -m json.tool

# Incremental: agents updated since last poll
curl -s -H "Authorization: ApiToken $S1_TOKEN" \
  "$S1_URL/web/api/v2.1/agents?limit=100&updatedAt__gte=2026-07-16T00:00:00Z" | python3 -m json.tool
```

**Pitfalls:**
- `isActive` is based on heartbeat window (typically 30 min). An agent that is off may show `isActive: false` but `isDecommissioned: false`.
- `diskEncryptionStatus` may return `"unknown"` for agents that haven't reported disk encryption state. Do not treat `"unknown"` as `"not_encrypted"`.
- `externalIp` is the last known public IP; it may be stale for agents that have been offline.

---

### Endpoint 2: `GET /web/api/v2.1/agents/{id}`

| Attribute | Detail |
|-----------|--------|
| **ISO control** | A.8.1 (per-asset detail), A.8.9 (configuration) |
| **Required scope** | Viewer |
| **Path param** | `id` = agent UUID (from `/agents` list) |
| **Paginated** | No — single resource |
| **Poll interval** | On-demand when a specific agent needs detail beyond the list view |
| **Key response fields** | All from `/agents` list, plus: `installedApplications[]`, `activeThreats`, `networkInterfaces[]`, `mitigationMode`, `policyName`, `rangerStatus` |

```bash
AGENT_UUID="a1b2c3d4-e5f6-7890-abcd-ef1234567890"
curl -s -H "Authorization: ApiToken $S1_TOKEN" \
  "$S1_URL/web/api/v2.1/agents/$AGENT_UUID" | python3 -m json.tool
```

**Pitfalls:**
- The single-agent endpoint returns `data` as a single object, not an array. The response envelope differs from the list endpoint.
- `installedApplications[]` can be large; consider whether the connector needs full app inventory for every agent or only the count.

---

### Endpoint 3: `GET /web/api/v2.1/threats`

| Attribute | Detail |
|-----------|--------|
| **ISO control** | A.8.7 (Protection Against Malware), A.8.16 (Monitoring Activities) |
| **Required scope** | Viewer |
| **Pagination** | Cursor |
| **Time filter** | `createdAt__gte=<ISO8601>` for new threats |
| **Poll interval** | Every 1 hour |
| **Key response fields** | `id`, `createdAt`, `classification`, `confidenceLevel`, `mitigationStatus`, `resolutionStatus`, `severity`, `agentRealtimeInfo.agentComputerName`, `threatInfo.threatName`, `threatInfo.filePath`, `threatInfo.sha1`, `threatInfo.sha256` |

```bash
# Recent threats
curl -s -H "Authorization: ApiToken $S1_TOKEN" \
  "$S1_URL/web/api/v2.1/threats?limit=50&createdAt__gte=2026-07-15T00:00:00Z&sortBy=createdAt&sortOrder=desc" \
  | python3 -m json.tool
```

**Pitfalls:**
- `mitigationStatus` values are `mitigated`, `not_mitigated`, `partially_mitigated`, `marked_as_benign`, `marked_as_threat`. A threat marked `marked_as_benign` was a false positive; do not count it against control effectiveness.
- Threat IDs are 64-bit integers, not UUIDs. Use string type in schemas to avoid integer overflow.
- The `threatInfo` sub-object varies by classification; some fields are null for non-file-based threats.

---

### Endpoint 4: `GET /web/api/v2.1/application-risks`

| Attribute | Detail |
|-----------|--------|
| **ISO control** | A.8.8 (Management of Technical Vulnerabilities), A.6.8 |
| **Required scope** | Viewer |
| **Pagination** | Cursor |
| **Time filter** | None built-in; use `detectedAt__gte` in API queries if supported by the tenant version |
| **Poll interval** | Every 6 hours |
| **Key response fields** | `id`, `cveId`, `applicationName`, `applicationVersion`, `applicationVendor`, `detectedAt`, `mitigatedAt`, `isMitigated`, `severity`, `cvssScore`, `cvssVector`, `cveDescription`, `agentUuid`, `agentComputerName`, `exploitAvailable` |

```bash
curl -s -H "Authorization: ApiToken $S1_TOKEN" \
  "$S1_URL/web/api/v2.1/application-risks?limit=100&sortBy=detectedAt&sortOrder=desc" \
  | python3 -m json.tool
```

> **Note:** RBR-529 specifies `GET /vulnerabilities`. In SentinelOne Singularity Platform, application vulnerabilities are exposed as `GET /web/api/v2.1/application-risks`. Some S1 API versions may expose `GET /web/api/v2.1/vulnerabilities` under the vulnerability management module. Verify which path returns CVEs for your tenant and use `application-risks` as the documented primary.

**Pitfalls:**
- `isMitigated: true` means the app was either updated or removed. The `mitigatedAt` timestamp tells you when.
- `exploitAvailable: true` escalates priority — these should be flagged in Drata evidence.
- CVSS scores may be null for newer CVEs not yet scored by NVD.

---

### Endpoint 5: `GET /web/api/v2.1/users`

| Attribute | Detail |
|-----------|--------|
| **ISO control** | A.8.2 (Privileged Access Rights — admin account inventory) |
| **Required scope** | Viewer |
| **Pagination** | Cursor |
| **Time filter** | None built-in |
| **Poll interval** | Every 24 hours (admin account changes are rare) |
| **Key response fields** | `id`, `fullName`, `email`, `username`, `role`, `scope`, `twoFaEnabled`, `source`, `dateJoined`, `lastLogin`, `isServiceUser`, `siteRoles[]` |

```bash
# All users (including admins)
curl -s -H "Authorization: ApiToken $S1_TOKEN" \
  "$S1_URL/web/api/v2.1/users?limit=100" | python3 -m json.tool

# Filter: admin-role users only (may require additional filtering in connector)
curl -s -H "Authorization: ApiToken $S1_TOKEN" \
  "$S1_URL/web/api/v2.1/users?limit=100&role=admin" | python3 -m json.tool
```

> **Path note:** RBR-529 specifies `GET /accounts/account-management/accounts`. The user management endpoint in SentinelOne API v2.1 is `GET /web/api/v2.1/users`. The path `accounts/account-management/accounts` may correspond to a newer API module. Verify against your tenant's API documentation (available at `https://<tenant>.sentinelone.net/api-doc`). If the `accounts/account-management/accounts` path returns data, prefer it; otherwise `users` is the canonical path.

**Pitfalls:**
- Users with `source: "sso"` are federated; their `twoFaEnabled` reflects SSO-side MFA, not S1-side MFA. Do not flag SSO users with `twoFaEnabled: false` as missing MFA without checking the IdP.
- `isServiceUser: true` identifies API service accounts. These should have a documented purpose and owner.

---

### Endpoint 6: `GET /web/api/v2.1/rbac/roles`

| Attribute | Detail |
|-----------|--------|
| **ISO control** | A.8.2 (Privileged Access Rights — RBAC inventory) |
| **Required scope** | Viewer |
| **Pagination** | Cursor (if large role set) |
| **Time filter** | None |
| **Poll interval** | Every 24 hours |
| **Key response fields** | `id`, `name`, `description`, `permissions[]`, `scope`, `builtIn` |

```bash
curl -s -H "Authorization: ApiToken $S1_TOKEN" \
  "$S1_URL/web/api/v2.1/rbac/roles?limit=50" | python3 -m json.tool
```

> **Path note:** RBR-529 specifies `GET /accounts/account-management/roles`. The RBAC roles endpoint in S1 API v2.1 is `GET /web/api/v2.1/rbac/roles`. Verify your tenant's API documentation for the exact path. The role inventory is the important data regardless of exact path.

**Pitfalls:**
- `builtIn: true` roles (Admin, Viewer, IR Team) cannot be modified. Evidence should flag any custom roles with broad permissions.
- `permissions[]` is an array of permission strings. Review for roles that grant write access (`actions.*`, `policies.*`, `exclusions.*`).

---

### Endpoint 7: `GET /web/api/v2.1/system/status`

| Attribute | Detail |
|-----------|--------|
| **ISO control** | A.5.30 (ICT Readiness — cloud console health) |
| **Required scope** | Viewer |
| **Paginated** | No |
| **Time filter** | None |
| **Poll interval** | Every 1 hour (operational health) |
| **Key response fields** | `health` (overall), `components[]` (per-service health) |

```bash
curl -s -H "Authorization: ApiToken $S1_TOKEN" \
  "$S1_URL/web/api/v2.1/system/status" | python3 -m json.tool
```

**Pitfalls:**
- `/system/status` returns the cloud console status, not endpoint health. For endpoint health, use `GET /agents?isActive=true`.
- If the S1 console itself is degraded, API responses may be delayed or return 5xx. The connector should treat consecutive 5xx errors as a console health indicator.
- Some tenant versions may require `/system/health` instead of `/system/status`. Verify against your tenant's API docs.

---

### Endpoint 8: `GET /web/api/v2.1/activities`

| Attribute | Detail |
|-----------|--------|
| **ISO control** | A.8.16 (Monitoring Activities — admin audit log), A.8.15 (Logging) |
| **Required scope** | Viewer |
| **Pagination** | Cursor |
| **Time filter** | `createdAt__gte=<ISO8601>`, `createdAt__lte=<ISO8601>` |
| **Poll interval** | Every 1 hour |
| **Key response fields** | `id`, `createdAt`, `activityType`, `userId`, `userName`, `accountId`, `accountName`, `siteId`, `description`, `data` (context object), `primaryDescription`, `secondaryDescription`, `agentId`, `groupId` |

```bash
# Admin activities in last 24 hours
curl -s -H "Authorization: ApiToken $S1_TOKEN" \
  "$S1_URL/web/api/v2.1/activities?createdAt__gte=2026-07-15T00:00:00Z&limit=100&sortBy=createdAt&sortOrder=desc" \
  | python3 -m json.tool
```

**Potential SIEM integration (A.8.16):** This is the primary feed for admin action auditing. Activity types include `user.login`, `user.logout`, `policy.updated`, `agent.actions`, `threat.mitigation_status_changed`, `exclusion.created`, `service_user.created`. The activity log should be relayed to a SIEM for retention.

**Pitfalls:**
- The activities endpoint can return very large payloads if the time window is wide. Use narrow intervals (≤24h) and cursor pagination.
- `data` is a polymorphic object whose shape depends on `activityType`. The connector should store it as a JSON blob, not attempt to normalize all activity types.
- Some activity types may include user IPs or agent hostnames in the `data` field. Review for PII before ingesting to Drata.

---

### Endpoint 9: `GET /web/api/v2.1/dns/events`

| Attribute | Detail |
|-----------|--------|
| **ISO control** | A.8.23 (Web Filtering — DNS-layer protection) |
| **Required scope** | Viewer |
| **Pagination** | Cursor |
| **Time filter** | `fromDate`, `toDate` (query parameters) |
| **Poll interval** | Every 1 hour with 5-15 min time windows |
| **Key response fields** | `eventId`, `eventTime`, `agentUuid`, `computerName`, `dnsRequest`, `dnsResponse`, `dnsResponseType`, `siteName`, `policyName`, `matchedRule`, `eventCategory` |

```bash
# DNS events in a time window
curl -s -H "Authorization: ApiToken $S1_TOKEN" \
  "$S1_URL/web/api/v2.1/dns/events?fromDate=2026-07-16T00:00:00Z&toDate=2026-07-16T01:00:00Z&limit=100" \
  | python3 -m json.tool
```

> **API structure note:** DNS events may be exposed as a sub-resource under Deep Visibility (`/dv/events` with event type filter) or as a standalone endpoint (`/dns/events`). The connector should support both paths depending on the tenant version. The RBR-523 plan specifies `dns/events` explicitly.

**Pitfalls:**
- DNS events are high-volume. Use narrow time windows and cursor pagination.
- `dnsResponseType` values include `nxdomain`, `blocked`, `allowed`, `redirected`. Flag `blocked` events as control evidence.
- Not all DNS queries are captured; S1 DNS filtering must be enabled on the endpoint policy for events to appear.

---

### Endpoint 10: `GET /web/api/v2.1/url/events`

| Attribute | Detail |
|-----------|--------|
| **ISO control** | A.8.23 (Web Filtering — URL-layer policy enforcement) |
| **Required scope** | Viewer |
| **Pagination** | Cursor |
| **Time filter** | `fromDate`, `toDate` |
| **Poll interval** | Every 1 hour with 5-15 min time windows |
| **Key response fields** | `eventId`, `eventTime`, `agentUuid`, `computerName`, `url`, `method`, `action`, `policyName`, `category`, `siteName`, `userName` |

```bash
curl -s -H "Authorization: ApiToken $S1_TOKEN" \
  "$S1_URL/web/api/v2.1/url/events?fromDate=2026-07-16T00:00:00Z&toDate=2026-07-16T01:00:00Z&limit=100" \
  | python3 -m json.tool
```

**Pitfalls:**
- URL events contain full URLs browsed by endpoints. This is sensitive telemetry. Strip query strings in the connector to avoid capturing credentials-in-URL patterns, session tokens, or PII.
- `action` values include `blocked`, `allowed`, `warned`. Only `blocked` events are control evidence for A.8.23.
- URL filtering must be enabled in the endpoint policy for events to appear.

---

### Endpoint 11: `GET /web/api/v2.1/threat-intelligence/iocs`

| Attribute | Detail |
|-----------|--------|
| **ISO control** | A.5.7 (Threat Intelligence — subscribed IoCs) |
| **Required scope** | Viewer |
| **Pagination** | Cursor |
| **Time filter** | None built-in |
| **Poll interval** | Every 24 hours |
| **Key response fields** | `id`, `type` (domain/url/ip/hash), `value`, `source`, `category`, `confidence`, `severity`, `createdAt`, `updatedAt`, `status`, `description`, `validUntil`, `externalId` |

```bash
# Active IoCs
curl -s -H "Authorization: ApiToken $S1_TOKEN" \
  "$S1_URL/web/api/v2.1/threat-intelligence/iocs?limit=100" | python3 -m json.tool

# IoCs by type
curl -s -H "Authorization: ApiToken $S1_TOKEN" \
  "$S1_URL/web/api/v2.1/threat-intelligence/iocs?limit=100&type=domain" | python3 -m json.tool
```

> **API structure note:** The exact path for threat intelligence may be `/threat-intel` (as specified in RBR-523) or `/threat-intelligence` depending on the tenant API version. The module typically supports `/iocs` as a sub-resource for indicators of compromise. Verify the correct path against your tenant's API documentation. If the shorter path exists, use it.

**Pitfalls:**
- IoCs are ingested from S1's Deep Visibility threat feeds plus any custom IoCs added by the admin. Evidence should distinguish source.
- `validUntil` marks when the IoC expires from the blocklist. Expired IoCs should not be counted as active protection.
- `status` values include `active`, `expired`, `deleted`. Only `active` IoCs are current protection evidence.

---

## Part 3: ISO 27001 Control Mapping Summary

| # | Endpoint | ISO 27001:2022 Controls | Primary Evidence For | Poll Interval |
|---|----------|--------------------------|---------------------|---------------|
| 1 | `GET /agents` | A.8.1, A.8.9, A.8.24, A.8.20 | Asset inventory, configuration, crypto, firewall | 6h |
| 2 | `GET /agents/{id}` | A.8.1, A.8.9 | Per-asset detail | On-demand |
| 3 | `GET /threats` | A.8.7, A.8.16 | Malware protection, monitoring | 1h |
| 4 | `GET /application-risks` | A.8.8, A.6.8 | Vulnerability management | 6h |
| 5 | `GET /users` | A.8.2 | Admin account inventory | 24h |
| 6 | `GET /rbac/roles` | A.8.2 | RBAC role inventory | 24h |
| 7 | `GET /system/status` | A.5.30 | Console health / ICT readiness | 1h |
| 8 | `GET /activities` | A.8.16, A.8.15 | Admin audit log → SIEM | 1h |
| 9 | `GET /dns/events` | A.8.23 | DNS-layer filtering | 1h |
| 10 | `GET /url/events` | A.8.23 | URL-layer filtering | 1h |
| 11 | `GET /threat-intelligence/iocs` | A.5.7 | Threat intelligence | 24h |

---

## Part 4: Evidence Capture Pipeline (S3 + Drata)

### 4.1 — S3 Destination

All evidence objects land in the Aira compliance S3 bucket under a date-partitioned prefix:

```
s3://aira-compliance-evidence/sentinelone/
  YYYY/MM/DD/
    agent_inventory_2026-07-16T14:00:00Z.json
    threats_2026-07-16T14:00:00Z.json
    application_risks_2026-07-16T14:00:00Z.json
    users_2026-07-16T14:00:00Z.json
    rbac_roles_2026-07-16T14:00:00Z.json
    system_status_2026-07-16T14:00:00Z.json
    activities_2026-07-16T14:00:00Z.json
    dns_events_2026-07-16T14:00:00Z.json
    url_events_2026-07-16T14:00:00Z.json
    threat_intel_2026-07-16T14:00:00Z.json
```

### 4.2 — Drata JSON Envelope

Each evidence file uses a consistent envelope that the Drata Custom Connection expects (see [RBR-525](/RBR/issues/RBR-525) for the Drata-side schema):

```json
{
  "evidence_class": "agent_inventory",
  "collector": "sentinelone-connector",
  "collector_version": "1.0.0",
  "collected_at": "2026-07-16T14:00:00Z",
  "collection_window": {
    "from": "2026-07-16T08:00:00Z",
    "to": "2026-07-16T14:00:00Z"
  },
  "control_ids": ["A.8.1", "A.8.9", "A.8.24", "A.8.20"],
  "tenant_url": "https://<subdomain>.sentinelone.net",
  "pagination": {
    "total_items": 42,
    "pages_retrieved": 1
  },
  "rate_limit": {
    "limit": 1000,
    "remaining": 987,
    "reset_at": "2026-07-16T14:10:00Z"
  },
  "records": [
    {
      "dedup_key": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "data": { /* single record — mapped to the evidence class schema */ }
    }
  ]
}
```

**Envelope field rules:**

| Field | Required | Description |
|-------|----------|-------------|
| `evidence_class` | Yes | Matches the Drata evidence class name |
| `collector` | Yes | Identifies the collector service |
| `collector_version` | Yes | Version for schema evolution tracking |
| `collected_at` | Yes | ISO 8601 UTC timestamp of collection run |
| `collection_window` | Yes | Time range this evidence covers |
| `control_ids` | Yes | ISO 27001:2022 control IDs this evidence satisfies |
| `tenant_url` | Yes | S1 tenant identifier (redact the subdomain per policy) |
| `pagination` | Yes | Summary of API pagination for audit trail |
| `rate_limit` | Yes | Rate limit consumption for operational monitoring |
| `records[]` | Yes | Array of evidence records |
| `records[].dedup_key` | Yes | Unique key for Drata deduplication |
| `records[].data` | Yes | The record matching the evidence class schema |

### 4.3 — S3 Upload (Python example)

```python
import json
import boto3
from datetime import datetime, timezone

def capture_to_s3(evidence_class: str, records: list, window_from: str, window_to: str):
    s3 = boto3.client("s3")
    now = datetime.now(timezone.utc).isoformat()

    envelope = {
        "evidence_class": evidence_class,
        "collector": "sentinelone-connector",
        "collector_version": "1.0.0",
        "collected_at": now,
        "collection_window": {"from": window_from, "to": window_to},
        "control_ids": CONTROL_MAP[evidence_class],
        "tenant_url": S1_URL,
        "pagination": {"total_items": len(records), "pages_retrieved": 1},
        "rate_limit": {"limit": 1000, "remaining": 987, "reset_at": "..."},
        "records": [{"dedup_key": r["dedup_key"], "data": r["data"]} for r in records]
    }

    key = f"sentinelone/{datetime.now(timezone.utc).strftime('%Y/%m/%d')}/{evidence_class}_{now}.json"

    s3.put_object(
        Bucket="aira-compliance-evidence",
        Key=key,
        Body=json.dumps(envelope, indent=2),
        ContentType="application/json",
        ServerSideEncryption="AES256"
    )
```

**Security notes:**
- Use SSE-S3 or SSE-KMS for encryption at rest. The example uses AES256 (SSE-S3).
- The S3 bucket should have a lifecycle policy moving evidence to Glacier after 90 days and deleting after 3 years (ISO 27001 evidence retention).
- S3 bucket policy: deny public access, allow only the connector's IAM role.

---

## Part 5: Rate Limit and Backoff

### Rate Limit Headers

Every API response includes:

| Header | Example | Meaning |
|--------|---------|---------|
| `X-RateLimit-Limit` | `1000` | Max requests in current window |
| `X-RateLimit-Remaining` | `987` | Requests left in current window |
| `X-RateLimit-Reset` | `1755868200` | Unix timestamp when window resets |

### Connector Backoff Strategy

```
HTTP 429 → read Retry-After header → wait Retry-After seconds
         → or: exponential backoff with jitter
         → min(2^n * 1s + rand(0,1s), 60s)
         → max 5 retries → alert SecOps

HTTP 5xx → exponential backoff, max 3 retries → alert SecOps

Rate limit at 80% → log warning, stretch next poll interval
Rate limit at 95% → log critical, skip non-critical endpoints until window resets
```

### Python Example (rate-limited request)

```python
import time, random, requests

def rate_limited_get(url: str, token: str, max_retries: int = 5) -> dict:
    headers = {"Authorization": f"ApiToken {token}"}
    for n in range(max_retries):
        resp = requests.get(url, headers=headers)
        if resp.status_code == 429:
            wait = int(resp.headers.get("Retry-After", min(2**n + random.random(), 60)))
            time.sleep(wait)
            continue
        resp.raise_for_status()
        return resp.json()
    raise Exception(f"Rate limit exhausted after {max_retries} retries")
```

---

## Part 6: Gotchas and Tenant-Specific Requirements

### Authentication & Token Gotchas

1. **`ApiToken`, not `Bearer`.** SentinelOne rejects `Bearer` tokens with 401. Every tool/script must use `Authorization: ApiToken <token>`.

2. **Token rotation before expiry.** The S1 console does not send expiry reminders. Set an AWS Secrets Manager rotation schedule with a 30-day warning.

3. **Service user vs. interactive user.** Service users do not have MFA. This is acceptable for API use but must be documented in the access review.

### API Gotchas

4. **Rate limit is per-token, not per-endpoint.** Running all 11 endpoints in parallel consumes the same 1,000 req / 10 min budget. Stagger polls or run sequentially.

5. **Cursor pagination is required for correctness.** Do not use offset-based pagination — results may shift between pages, causing duplicates or gaps. Always use `pagination.nextCursor`.

6. **Time-filtered incremental polls must handle clock skew.** Use `updatedAt__gte=<last_poll_time - 5min>` to account for slight clock differences between the S1 API server and the collector host.

7. **Empty `data[]` is not an error.** An endpoint returning `"data": []` with HTTP 200 is valid. Do not treat empty results as a failure.

8. **Some endpoints are module-gated.** DNS events, URL events, Ranger devices, and Threat Intelligence may require specific S1 subscriptions (Singularity Complete, Singularity Control). If an endpoint returns 404 or empty results, verify the Rambur tenant subscription includes the module.

### Tenant-Specific Gotchas

9. **IP allow-listing.** If the Rambur S1 tenant has API IP allow-listing enabled, the connector's outbound IP must be added to the allowlist. Test this before going live.

10. **Federation / SSO.** If the Rambur tenant uses SSO (Okta, Entra ID) for interactive users, this does NOT apply to service users. Service users authenticate via API token regardless of the SSO configuration.

11. **Multi-site accounts.** If Aira spans multiple S1 sites, the service user needs Account scope. Site-scoped tokens cannot read cross-site users, roles, or activities. The connector must handle site-level filtering in its queries.

12. **Test before production.** Create a test service user with the same Viewer role and verify all 11 endpoints against the Rambur tenant BEFORE creating the production token. This catches subscription gaps, path mismatches, and scope issues.

### S3 Gotchas

13. **S3 eventual consistency (in rare cases).** If the Drata connector reads S3 immediately after the collector writes, use `IfNoneMatch` or versioning to avoid partial reads. Write-then-read within the same second can hit stale reads in some regions.

14. **S3 key naming.** Use UTC timestamps, not local time, in S3 keys. The format `YYYY/MM/DD/evidence_class_ISO8601.json` is partition-friendly for Athena/Glue if querying evidence later.

---

## Part 7: Verification Checklist (Before Handoff to RBR-526)

Run this checklist after the service user exists and the token is stored in AWS Secrets Manager.

```bash
# Load token
S1_TOKEN=$(aws secretsmanager get-secret-value --secret-id "s1/api_token" --region us-east-1 --query SecretString --output text | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
S1_URL=$(aws secretsmanager get-secret-value --secret-id "s1/api_token" --region us-east-1 --query SecretString --output text | python3 -c "import sys,json; print(json.load(sys.stdin)['tenant_url'])")
```

- [ ] 1. `GET /agents?limit=1` → 200, returns agent data
- [ ] 2. `GET /agents/{uuid}` → 200, single-agent detail
- [ ] 3. `GET /threats?limit=1` → 200
- [ ] 4. `GET /application-risks?limit=1` → 200
- [ ] 5. `GET /users?limit=1` → 200
- [ ] 6. `GET /rbac/roles?limit=1` → 200
- [ ] 7. `GET /system/status` → 200
- [ ] 8. `GET /activities?limit=1` → 200
- [ ] 9. `GET /dns/events?limit=1` → 200 (or verify module availability)
- [ ] 10. `GET /url/events?limit=1` → 200 (or verify module availability)
- [ ] 11. `GET /threat-intelligence/iocs?limit=1` → 200 (or verify module availability)
- [ ] Rate limit headers present on all responses
- [ ] Verify token uses `ApiToken` scheme (not `Bearer`)
- [ ] Verify Viewer role — confirm all write endpoints return 403
- [ ] S3 upload test: write a sample evidence envelope, read it back
- [ ] Record actual rate limit values in the connector runbook
- [ ] Document any endpoint path mismatches (verify against tenant's API docs at `https://<tenant>.sentinelone.net/api-doc`)

---

## Part 8: Handoff

When verification is complete, this procedure is ready for:

- [**RBR-526**](/RBR/issues/RBR-526) — Connector build. The developer uses this document as the API reference.
- [**RBR-525**](/RBR/issues/RBR-525) — Drata Custom Connection. The evidence envelope schema in Part 4 matches what the Drata side expects.
- **SecOps** — Operational runbook (token rotation, rate limit monitoring, 401 alerting).

### Residual Risk

- Viewer role can read all endpoint data for the scoped Account (agent inventory, threats, vulnerabilities, admin accounts, roles, URL browsing history, DNS queries). This is inherent to the Drata integration use case and should be documented in the data classification register.
- DNS and URL events may capture PII (hostnames, browsed URLs, usernames). The connector should minimize the surface by stripping query strings from URLs and considering field-level redaction for URL paths before storing in S3/Drata.
- Threat intelligence IoCs include data from S1's global threat feeds. Verify that S1's threat intel license permits storage and re-display in Drata.

### Follow-Up Tasks

- Token rotation schedule: create a recurring task 330 days from creation for token renewal.
- Module availability: verify that DNS events, URL events, and Threat Intelligence modules are included in the Rambur tenant subscription. If not, reassess the evidence coverage for A.8.23 and A.5.7.
- S3 lifecycle policy: configure a lifecycle rule on `s3://aira-compliance-evidence/` to transition to Glacier after 90 days and expire after 3 years.

---

**Security review (SecurityEngineering, RBR-529):**

- **Least Privilege:** Viewer role is the minimum viable privilege. All 11 endpoints are read-only. Confirmed no write or admin endpoints are needed.
- **Minimize Attack Surface:** Token stored in AWS Secrets Manager, not in environment variables, config files, or source code. SDK-based retrieval at runtime.
- **Defense in Depth:** Rate limit handling prevents DoS against the S1 API. Token rotation is documented. gitleaks rules for `ApiToken` pattern are in `.gitleaks.toml`.
- **Secrets:** The JSON secret in AWS Secrets Manager contains the full token. Enable automatic rotation. Never log the `Authorization` header.
- **Input handling:** Time-range parameters must be validated (ISO 8601 format, reasonable window sizes) to avoid backend query errors.
