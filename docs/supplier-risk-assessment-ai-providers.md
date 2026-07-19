# Supplier Risk Assessment: AI Service Providers (Phase 0)

**Project**: Aira — Drata and Google AI Integration / ISO 27001 Continuous Monitoring
**Date**: 2026-07-10
**Assessor**: SecurityEngineering Agent (RBR-158)
**Controls Assessed**: ISO 27001:2022 A.5.19, A.5.20, A.5.21, A.5.22; OWASP LLM05
**Assessment Type**: Phase 0 — Immediate (per [RBR-158](/RBR/issues/RBR-158))
**Parent**: [RBR-112](/RBR/issues/RBR-112) — AI governance controls and evidence plan

---

## Executive Summary

Two AI service providers are assessed as implicit dependencies for Aira's AI governance pipeline: **Google Generative Language API (Gemini)** as the primary AI model provider and **OpenRouter API** as a migration-source/fallback provider. Both are REST API integrations — not npm SDK packages — used via raw `fetch()` calls. This creates a supply-chain blind spot: no version pinning, no npm audit coverage, no SBOM tracking.

**Google Gemini** is a tier-1 critical dependency (all AI governance depends on it) with strong attestations (ISO 27001, SOC 2/3). Residual risk: **Low (3/5)**, conditional on API version pinning and key rotation.

**OpenRouter API** is a tier-2 transitional dependency (referenced but not actively called). Residual risk: **Medium (2/5)**, primarily due to multi-model aggregation risks and the absence of published attestations.

Both providers are recommended for **approval with monitoring conditions** listed below. The primary risk is not in the providers' controls but in Aira's implicit, unversioned dependency on them.

---

## 1. Google Generative Language API (Gemini)

### 1.1 Supplier Profile

| Attribute | Detail |
|-----------|--------|
| **Supplier** | Google LLC (Alphabet Inc.) |
| **Service** | Generative Language API (Gemini) |
| **API Version** | v1beta |
| **Endpoint** | `https://generativelanguage.googleapis.com/v1beta` |
| **Models Used** | `gemini-2.5-pro` (leadership), `gemini-2.5-flash` (IC/specialist) |
| **Auth Method** | API key via `x-goog-api-key` header |
| **Code Paths** | `src/ai/gemini-client.ts`, `src/config.ts` |
| **Relationship Type** | API service provider (SaaS) |
| **Data Residency** | Google Cloud global infrastructure; configurable |
| **Criticality Tier** | **Tier 1 — Critical** (all AI governance depends on Gemini) |
| **Monthly Budget** | $5,000 (configured in `src/ai/governance.ts`) |

### 1.2 Data Transmitted

| Data Category | Classification | Transmission |
|---------------|---------------|--------------|
| Agent prompts (natural language) | Internal | Sent in request body |
| Agent reasoning chains | Internal | Sent in multi-turn request body |
| System instructions (agent roles) | Internal | Sent as `systemInstruction` |
| Tool definitions (function declarations) | Internal | Sent as `tools` array |
| Safety filter results | Confidential | Returned in response metadata |
| Model generations | Internal | Returned in response body |
| Usage metadata (token counts) | Internal | Returned in response body |

**Data not transmitted**: API keys (not sent in URL), customer PII (redacted by guardrails before any API call), Drata compliance data (not routed through Gemini).

**Jurisdiction**: Google Cloud data processing terms apply. Region not yet explicitly configured — this is a finding.

### 1.3 Security Attestations

| Attestation | Status | Coverage | Notes |
|-------------|--------|----------|-------|
| ISO/IEC 27001:2022 | Certified | Google Cloud infrastructure | Active; covers Generative Language API |
| ISO/IEC 27017 (Cloud Security) | Certified | Google Cloud | Active |
| ISO/IEC 27018 (Privacy) | Certified | Google Cloud | Active |
| SOC 1/2/3 | Yes (annual) | Google Cloud | Active |
| FedRAMP | Authorized | Google Cloud (Moderate, High) | Active |
| PCI DSS | Compliant | Google Cloud | Active |

**Source**: https://cloud.google.com/security/compliance

### 1.4 Risk Assessment

#### Strengths
- Mature security program with independent third-party attestations (ISO 27001, SOC 2, FedRAMP)
- API key auth over TLS 1.3 — encrypted in transit
- Safety filters (harassment, hate speech, sexual, dangerous content) enforced by default
- Prompt feedback blockReason surfaced in responses for transparency
- Usage metadata returned per request for cost monitoring integration

#### Risks

| Risk ID | Risk | Likelihood | Impact | Rating |
|---------|------|-----------|--------|--------|
| R1 | API key exposure in code/logs/CI | Medium | High | **Medium** |
| R2 | v1beta API version instability (breaking changes, deprecations without notice) | Medium | Medium | **Medium** |
| R3 | Safety filter escalation (over-blocking) disrupting legitimate use | Low | Medium | **Low** |
| R4 | Data processed in non-approved jurisdiction (Google Cloud region not pinned) | Low | High | **Medium** |
| R5 | Supplier concentration risk (only Gemini supports the pipeline) | Medium | High | **Medium** |

#### Residual Risk Score: **Low (3/5)** — approved with conditions

**Conditions**:
1. Pin API version explicitly (v1beta → v1 when GA) in `src/ai/gemini-client.ts`
2. Ensure API key resides exclusively in AWS Secrets Manager, never in `.env` files or CI variables
3. Monitor Google Cloud status dashboard for API deprecation notices
4. Configure Google Cloud region/data residency for compliance
5. Implement API key rotation procedure (90-day cycle per ISO 27001 A.5.18)
6. Track Gemini API in CycloneDX SBOM (`scripts/generate-sbom.sh`)

---

## 2. OpenRouter API

### 2.1 Supplier Profile

| Attribute | Detail |
|-----------|--------|
| **Supplier** | OpenRouter Inc. |
| **Service** | OpenRouter REST API (multi-model AI aggregation) |
| **API Version** | v1 |
| **Endpoint** | `https://openrouter.ai/api/v1` |
| **Auth Method** | Bearer token (`Authorization: Bearer sk-or-...`) |
| **Code Paths** | `src/config.ts` (openrouter), `src/ai/types.ts` (mappings) |
| **Relationship Type** | API service provider (SaaS) |
| **Data Residency** | Not published (OpenRouter does not disclose infrastructure details) |
| **Criticality Tier** | **Tier 2 — Transitional** (referenced but not actively called) |
| **Status** | Migration source — agents being migrated from OpenRouter to Gemini via `MigrationAdapter` in `src/ai/adapter.ts`. Currently `pending` for 3 agents (CEO, CTO, CISO). |
| **Monthly Budget** | $2,000 (configured in `src/ai/governance.ts` as fallback) |

### 2.2 Data Transmitted

Same data categories as Gemini (Section 1.2) when active. OpenRouter is a proxy to multiple model providers (DeepSeek, MiniMax, Moonshot AI, OpenAI) — each provider may have different data handling practices.

**Current active models mapped** (via `src/ai/types.ts` `OPENROUTER_MODEL_MAP`):
- `openrouter/deepseek/deepseek-v4-pro` → `gemini-2.5-pro`
- `openrouter/minimax/minimax-m3` → `gemini-2.5-flash`
- `openrouter/moonshotai/kimi-k2.7-code` → `gemini-2.5-pro`
- `openrouter/openai/gpt-5.5` → `gemini-2.5-pro`

### 2.3 Security Attestations

| Attestation | Status | Notes |
|-------------|--------|-------|
| ISO/IEC 27001 | **Not found** | OpenRouter does not publish independent attestations |
| SOC 2 | **Not found** | No SOC report available |
| Privacy Policy | Published | https://openrouter.ai/privacy |
| Terms of Service | Published | https://openrouter.ai/terms |

**Source**: Manual assessment; OpenRouter does not maintain a public compliance page.

### 2.4 Risk Assessment

#### Strengths
- Bearer token auth over TLS 1.3 — encrypted in transit
- OpenAI-compatible API format simplifies integration
- Multi-model fallback capability provides provider diversity
- API key scoped to OpenRouter account (not shared with upstream providers)

#### Risks

| Risk ID | Risk | Likelihood | Impact | Rating |
|---------|------|-----------|--------|--------|
| R6 | **No independent security attestations** (ISO 27001, SOC 2) | Moderate | High | **High** |
| R7 | Multi-model proxy — data flows to DeepSeek, MiniMax, Moonshot AI, OpenAI with unknown sub-processing agreements | High | High | **High** |
| R8 | Infrastructure and data residency not disclosed | High | Medium | **High** |
| R9 | API key exposure in code/logs/CI (same risk class as R1) | Medium | High | **Medium** |
| R10 | OpenRouter as proxy introduces a new trust boundary between Aira and every upstream provider | High | Medium | **High** |

#### Residual Risk Score: **Medium (2/5)** — approved with conditions, migration required

**Conditions**:
1. **Complete migration from OpenRouter to Gemini** — OpenRouter is a transitional dependency. Target: all agents migrated by Aug 15.
2. Remove OpenRouter API key from config when migration is complete and no fallback is needed.
3. While active: log all requests through OpenRouter's proxy chain for audit trail.
4. Include OpenRouter API in CycloneDX SBOM as a transitional implicit dependency.
5. If OpenRouter fallback is retained post-migration: escalate to Vendor Risk for formal Phase 1 assessment with sub-processor disclosure request.
6. Vendor Risk should request: (a) list of sub-processors, (b) data residency options, (c) security attestations or compensating controls documentation.

---

## 3. AWS Secrets Manager (Secrets Backend for AI Keys)

### 3.1 Context

Both Gemini and OpenRouter API keys are stored in AWS Secrets Manager (`aira/secrets` secret, `src/config.ts`). This is already assessed in the AWS supplier risk assessment (`docs/supplier-risk-assessment-aws-github-phase0.md`). AWS carries a **Low (4/5)** residual risk. The AI-specific concern is:

- **Key rotation**: No automated rotation procedure exists for `GEMINI_API_KEY` or `OPENROUTER_API_KEY`.
- **Finding**: Manual key rotation is not auditable. Recommend implementing automated rotation via `@aws-sdk/client-secrets-manager` `rotateSecret` call in a scheduled CI job or Lambda, with a 90-day rotation cycle per ISO 27001 A.5.18.

---

## 4. SBOM Coverage via CycloneDX

Starting with [RBR-158](/RBR/issues/RBR-158), all three implicit API dependencies are tracked in the CycloneDX SBOM generated by `scripts/generate-sbom.sh`:

| Component | PURL | Tracking |
|-----------|------|----------|
| `google-generative-language-api@v1beta` | `pkg:generic/google-generative-language-api@v1beta` | Active (primary AI provider) |
| `openrouter-api@v1` | `pkg:generic/openrouter-api@v1` | Transitional (migration source) |
| `aws-secrets-manager-api@2017-10-17` | `pkg:generic/aws-secrets-manager@2017-10-17` | Active (secrets backend) |

These appear alongside 25 npm-tracked components in the combined SBOM. The SBOM CI job validates that implicit deps are present on every push and uploads the SBOM as a 90-day retention artifact.

---

## 5. Recommendations

| # | Recommendation | Owner | Priority | Target |
|---|---------------|-------|----------|--------|
| 1 | Complete OpenRouter → Gemini migration | CISO (CTO chain) | High | Aug 15 |
| 2 | Implement automated API key rotation (90-day) | SecurityEngineering | Medium | Sept 1 |
| 3 | Pin Gemini API version to stable (v1 when GA) | SecurityEngineering | Medium | When available |
| 4 | Configure Google Cloud region pinning | CTO | Medium | Sept 1 |
| 5 | Formal Vendor Risk Phase 1 assessment for OpenRouter if fallback retained | VendorRisk | Low | Only if needed |
| 6 | Monitor Google Cloud and OpenRouter status pages for incidents/CVEs | SecOps | Ongoing | Immediate |

---

## 6. Approval

| Role | Decision | Date | Notes |
|------|----------|------|-------|
| SecurityEngineering | APPROVED with conditions | 2026-07-10 | This assessment; conditions in Sections 1-5 |
| Vendor Risk | Pending | — | Phase 0 complete; Phase 1 not required unless OpenRouter fallback retained |
| CISO | APPROVED with conditions | 2026-07-19 | Conditions accepted: (1) OpenRouter migration by Aug 15, (2) API key rotation by Sept 1, (3) region pinning by Sept 1. SBOM regenerated and validated 2026-07-19. |
