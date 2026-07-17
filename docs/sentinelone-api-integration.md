# SentinelOne API Integration — Step-by-Step Implementation Guide

**Issue:** [RBR-524](/RBR/issues/RBR-524)  
**Parent plan:** [RBR-523](/RBR/issues/RBR-523#document-plan)  
**Project:** Aira — ISO 27001 Continuous Monitoring  
**Billing code:** SECOPS  
**Security lens:** Least Privilege, Minimize Attack Surface, Secure Defaults

---

## Overview

This guide covers Phase 1 (steps 1, 3) and Phase 2 (step 6) of the [RBR-523](/RBR/issues/RBR-523#document-plan) plan: creating a read-only SentinelOne service account, verifying API access across 5 evidence surfaces, and drafting JSON Schemas for Drata Custom Connection configuration.

**Prerequisite:** You must have **SentinelOne Management Console admin access** (Account Admin or Site Admin role) for the Aira tenant. The tenant URL is typically `https://<subdomain>.sentinelone.net`.

---

## Phase 1: Service Account and API Token

### Step 1.1 — Log into SentinelOne Management Console

Navigate to your SentinelOne tenant URL (e.g., `https://usea1-partners.sentinelone.net`) and authenticate with your admin credentials.

### Step 1.2 — Create a read-only Service User

1. Go to **Settings** → **Users** → **Service Users** tab.
2. Click **Create Service User**.
3. Configure as follows:

| Field | Value | Notes |
|-------|-------|-------|
| **Name** | `Drata Integration (read-only)` | Descriptive; makes audit log clear |
| **Role** | **Viewer** | Read-only. Do NOT use Admin or IR Team. |
| **Scope** | **Site** (select the in-scope site) | Scopes to the specific site containing Aira endpoints. If Aira spans multiple sites, use **Account** scope. |
| **Expiration** | Set to 365 days (or per policy) | Requires token rotation before expiry |

4. Click **Create**. SentinelOne displays the API token **once**. Copy it immediately.

### Step 1.3 — Store the API Token

Store the token in the secrets manager under the key `sentinel-one-api-token`:

**Option A — 1Password:**
1. Open 1Password and find the `Aira - Production` vault (or `Aira - Shared`).
2. Create a new item → **API Credential**.
3. Set title: `SentinelOne API Token (Drata Integration)`.
4. Set credential: the copied API token.
5. Add field: `S1_TENANT_URL` = the tenant URL (e.g., `https://usea1-partners.sentinelone.net`).
6. Add field: `S1_SITE_ID` = the site ID this token is scoped to.
7. Save.

**Option B — Doppler:**
```bash
doppler secrets set SENTINELONE_API_TOKEN --project aira --config prd
doppler secrets set SENTINELONE_TENANT_URL --project aira --config prd
doppler secrets set SENTINELONE_SITE_ID --project aira --config prd
```

**Security note:** The token has read-only scope (Viewer role). It cannot modify policies, trigger scans, or change configuration. However:
- It can read **all** endpoint data for the scoped Site/Account (agent inventory, threats, vulnerabilities, network devices).
- Treat it as a secret — do not commit it, log it, or share it outside the secrets manager.
- Token rotation is required before the configured expiry.

---

## Phase 2: Verify API Access

Run the following verification commands from the integration host (the machine that will run the connector — typically the Drata agent host or a dedicated integration VM). Replace placeholders with actual values.

```bash
export S1_TOKEN="<token-from-secrets-manager>"
export S1_URL="https://<tenant>.sentinelone.net"
```

### Step 2.1 — Agents endpoint (endpoint inventory)

```bash
curl -s -H "Authorization: ApiToken $S1_TOKEN" \
  -H "Content-Type: application/json" \
  "$S1_URL/web/api/v2.1/agents?limit=1" | python3 -m json.tool
```

**Expected:** HTTP 200 with a JSON body containing `data[]` array and `pagination` object. Verify the returned agents belong to the expected site.

### Step 2.2 — Threats endpoint (threat events)

```bash
curl -s -H "Authorization: ApiToken $S1_TOKEN" \
  -H "Content-Type: application/json" \
  "$S1_URL/web/api/v2.1/threats?limit=1" | python3 -m json.tool
```

**Expected:** HTTP 200. Response includes `data[]` with threat objects (may be empty if no recent threats).

### Step 2.3 — Application Risks endpoint (vulnerability findings)

```bash
curl -s -H "Authorization: ApiToken $S1_TOKEN" \
  -H "Content-Type: application/json" \
  "$S1_URL/web/api/v2.1/application-risks?limit=1" | python3 -m json.tool
```

**Expected:** HTTP 200. Response includes `data[]` with CVE findings per agent.

### Step 2.4 — Deep Visibility events endpoint

```bash
curl -s -H "Authorization: ApiToken $S1_TOKEN" \
  -H "Content-Type: application/json" \
  "$S1_URL/web/api/v2.1/dv/events?limit=1" | python3 -m json.tool
```

**Expected:** HTTP 200. Response includes `data[]` with Deep Visibility telemetry events.

### Step 2.5 — Ranger devices endpoint

```bash
curl -s -H "Authorization: ApiToken $S1_TOKEN" \
  -H "Content-Type: application/json" \
  "$S1_URL/web/api/v2.1/ranger/devices?limit=1" | python3 -m json.tool
```

**Expected:** HTTP 200. Response includes `data[]` with network-discovered devices.

### Step 2.6 — Retrieve and record rate limit headers

For each endpoint, capture the rate limit headers:

```bash
curl -s -i -H "Authorization: ApiToken $S1_TOKEN" \
  "$S1_URL/web/api/v2.1/agents?limit=1" 2>&1 | grep -i 'x-ratelimit'
```

**Expected headers:**

| Header | Meaning |
|--------|---------|
| `X-RateLimit-Limit` | Max requests per window |
| `X-RateLimit-Remaining` | Remaining requests in current window |
| `X-RateLimit-Reset` | Unix timestamp when window resets |

Record these values for each endpoint in the connector runbook. Default rate limit is approximately **1,000 requests per 10 minutes per token**, but verify against actual headers.

### Step 2.7 — Verify site scope (agents)

Confirm the token is correctly scoped to only Aira endpoints:

```bash
curl -s -H "Authorization: ApiToken $S1_TOKEN" \
  "$S1_URL/web/api/v2.1/agents?limit=100&siteIds=<expected-site-id>" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Agents in scope: {d[\"pagination\"][\"totalItems\"]}')"
```

If the result returns agents outside the expected scope, the token has broader scope than intended — revoke and recreate with tighter scope.

---

## Phase 3: Evidence Schemas and Handoff

### Step 3.1 — Review the JSON Schemas

The [JSON Schema drafts](./sentinelone-api-schemas.md) cover all five evidence classes. Each schema includes:
- Field definitions with types and descriptions
- Deduplication keys
- ISO 27001 control mappings
- Example payloads

### Step 3.2 — Validate schemas against live responses

For each endpoint, capture a sample response at `limit=5` and validate it against the draft schema:

```bash
# Capture sample data
curl -s -H "Authorization: ApiToken $S1_TOKEN" \
  "$S1_URL/web/api/v2.1/agents?limit=5" > /tmp/s1_agents_sample.json

# Validate against schema (requires ajv or similar)
# npx ajv validate -s docs/sentinelone-schemas/agent_inventory.schema.json \
#   -d /tmp/s1_agents_sample.json
```

**If actual response fields differ from the schema:** update the schema to match reality. The schema must reflect what the S1 API actually returns, not what we expect. Field additions are safe; field removals or type changes may break the connector.

### Step 3.3 — Commit to the CISO runbook repo

```bash
git add docs/sentinelone-api-integration.md
git add docs/sentinelone-api-schemas.md
git add docs/sentinelone-connector-runbook.md
git commit -m "docs: SentinelOne API integration guide, schemas, and runbook (RBR-524)"
```

---

## Handoff Checklist

When all steps are complete, hand off to [RBR-526](/RBR/issues/RBR-526) (connector build):

- [ ] SentinelOne service user exists with **Viewer** role, scoped to the in-scope Site/Account.
- [ ] API token stored in secrets manager under key `sentinel-one-api-token`.
- [ ] All 5 API surfaces verified — return 200 with valid JSON.
- [ ] Rate limit headers recorded and documented in [connector runbook](./sentinelone-connector-runbook.md).
- [ ] JSON Schemas drafted and validated against live responses.
- [ ] S1 tenant URL and token scope documented.
- [ ] Token expiry date noted for rotation schedule.

---

## Security Review Notes (SecurityEngineering)

**Lens: Least Privilege**
- Viewer role is the correct minimum: read-only, no policy modification, no scan initiation, no agent actions.
- Scope the token to the specific Site (not Account/Global) unless Aira endpoints span multiple sites.

**Lens: Minimize Attack Surface**
- The token should only be accessible from the integration host / Drata agent host. Network-level restriction (IP allowlist or firewall) should be considered at the S1 API gateway level.
- Token rotation: schedule rotation before expiry (recommend 30-day warning via secrets manager expiry alert).

**Lens: Secrets**
- The API token must never appear in source code, logs, error messages, or environment variables on shared hosts. Use the secrets manager exclusively for retrieval at runtime.
- gitleaks/trufflehog scanning should be configured on the connector repo.

**Residual risk:**
- Viewer role can read all endpoint data for the scoped site, including hostnames, IPs, OS versions, installed software (via Application Risks), and threat data. This is inherent in the Drata integration use case but should be noted in the data classification register.
- Ranger device discovery may reveal non-Aira devices on the same network segment. Consider scoping Ranger to specific subnets.

**Follow-up tasks:**
- [RBR-526](/RBR/issues/RBR-526): SentinelOne ↔ Drata connector build — now unblocked once the service account exists and schemas are validated.
- Token rotation schedule: create a recurring reminder (60-day window with 30-day warning before expiry) in the secrets manager.