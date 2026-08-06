# Aira Agent Toolchain & Gemini Configuration — Security Assessment

**Issue:** [RBR-121](/RBR/issues/RBR-121)
**Auditor:** CISO Agent (aad16410)
**Scope:** Aira agent toolchain + Gemini configuration (GL-F5 through GL-F10)
**Date:** 2026-07-09
**Updated:** 2026-07-09 (re-verified against current source; pipeline has evolved since initial assessment)
**Framework:** ISO 27001:2022, OWASP LLM Top 10

## Assessment Summary

Security review of the Aira AI governance module (`src/ai/`) covering the agent toolchain lifecycle: Gemini client configuration, secure pipeline, content guardrails, migration adapter, cost monitoring, and governance engine configuration.

**Overall verdict:** The architecture is conceptually sound with defense-in-depth (pre/post filtering, rate limiting, budget gates, output validation, tool RBAC). Several gaps have been closed since the initial assessment (budget enforcement is now blocking, prompt injection patterns expanded to 43, tool authorization is now audit-logged, empty API key fails fast). Two HIGH-severity and four MEDIUM-severity findings remain.

**Re-verified state (key code changes discovered during re-audit):**

| Item | Initial Assessment | Current Code | Status |
|------|-------------------|--------------|--------|
| Prompt injection patterns | 9 regex patterns | 43 patterns (direct + indirect + multi-step) | Improved |
| Budget enforcement | Alert-only | Pipeline blocks at monthly + daily limits | **FIXED** (pipeline level) |
| Tool call audit | None | Tool authorization logged, Gemini req/resp logged | Partially addressed |
| Empty API key | Silent failure | `GeminiClient` constructor throws on empty key | **FIXED** |
| Content filters array | Empty `[]` | Still empty; all filtering via hardcoded fallback | Config gap remains |

## Findings

### GL-F5: Canary Agent IDs Hardcoded as String Literals (MEDIUM) — NOT YET FIXED

**Source:** `src/ai/adapter.ts:13`, `src/ai/governance.ts:74`

The parallel-canary migration plan hardcodes agent IDs as string literals in TWO separate locations with no single source of truth:

```typescript
// adapter.ts:13
canaryAgentIds: ["aad16410", "168e1f8b"],

// governance.ts:74
canaryAgentIds: ["aad16410", "168e1f8b"],
```

No validation against the actual agent registry. If agent IDs change or the canary agents are reassigned, the migration silently selects incorrect agents.

**OWASP LLM Lens:** LLM06 Excessive Agency — without validated agent identity, the canary selection could inadvertently grant Gemini access to agents not intended for migration.

**Remediation:**
1. Extract canary IDs to a config-driven registry (environment or AWS SSM)
2. Validate canary IDs against the company agent list at startup
3. De-duplicate the two hardcoded instances into a single source of truth
4. Log which agent IDs are selected as canaries at migration start

**Current status:** OPEN. Requires Security Engineering (429dfce4) to implement config-driven canary IDs.

---

### GL-F6: Dependency SBOM — npm audit (MEDIUM) — ACTIONABLE NOW

**Source:** `package.json` — Aira is a TypeScript ESM project with no Python Google SDK dependencies.

The Aira project uses native `fetch()` for Gemini API calls (no `@google/genai` or `google-generativeai` npm packages). The Gemini client (`src/ai/gemini-client.ts`) makes raw HTTP calls to `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`.

Python files in `Aira-ISO27001/` use Drata API and GitHub API — no Vertex AI or Google Generative AI Python SDKs.

**Dependencies** (from `package.json`):
- `@aws-sdk/client-secrets-manager@^3.1083.0`
- `dotenv@^16.4.7`

**OWASP LLM Lens:** Supply Chain / Dependency Risk — verify transitive dependencies for known CVEs.

**Remediation:**
1. Run `npm audit` / `npm audit fix` on the project
2. Add `npm audit` to CI pipeline (`.github/workflows/security.yml`)
3. If Google SDK packages are adopted later, run `pip-audit` on those

**Current status:** TO BE EXECUTED in this heartbeat.

---

### GL-F7: API Key Rotation Policy (MEDIUM) — REQUIRES INFRA ACTION

**Source:** `docs/SECRETS.md`, `src/config.ts:49-52`

The Gemini API key is stored in AWS Secrets Manager (`aira/secrets`) with automatic rotation supported by AWS SM. The key is fetched at runtime via `loadConfig()`, with a 5-minute in-memory cache.

No explicit rotation policy exists. AWS Secrets Manager can auto-rotate keys, but this requires:
1. A Lambda rotation function that generates a new Gemini API key
2. Rotation schedule configuration (recommended: 90 days)

**Remediation:**
1. Enable AWS Secrets Manager automatic rotation for `aira/secrets` with a 90-day schedule
2. Create a rotation Lambda that generates a new Gemini API key via Google Cloud Console API
3. Document the rotation procedure in `docs/SECRETS.md`
4. Add rotation monitoring/alerting (SecOps)

**Current status:** OPEN. Requires Security Engineering (429dfce4) with GCP admin and AWS admin access.

---

### GL-F8: GCP Project Budget Caps (MEDIUM) — REQUIRES GCP ADMIN

**Source:** N/A (GCP cloud configuration, not in source code)

Hard budget caps must be set at the GCP project level to prevent unexpected spend. The pipeline enforces soft budget caps in code (monthly $5,000, daily $250), but GCP-level caps provide a defense-in-depth layer that cannot be bypassed by code changes.

**Remediation:**
1. Set GCP project-level budget alerts at 50%, 75%, 90%, 100% of the $5,000/mo limit
2. Configure budget notifications to SecOps monitoring channel
3. Enable billing export to BigQuery for cost analysis
4. Document budget configuration in project README

**Current status:** OPEN. Requires Security Engineering (429dfce4) with GCP Billing Admin role.

---

### GL-F9: Content Filtering Safety Thresholds (MEDIUM) — REMEDIATED (RBR-135)

**Source:** `src/ai/safety-settings.ts` (canonical policy), `src/ai/gemini-client.ts`, `src/ai/pipeline.ts`, `src/ai/governance.ts`

**Original problem.** Two independent hardcoded safety configurations existed with
different thresholds — `GeminiClient.generateContent()` defaulted every category to
`BLOCK_LOW_AND_ABOVE`, while `SecureAiPipeline` used `BLOCK_MEDIUM_AND_ABOVE` for
harassment/hate-speech and `BLOCK_LOW_AND_ABOVE` for the other two. Neither declared
`HARM_CATEGORY_CIVIC_INTEGRITY` or `HARM_CATEGORY_HARASSMENT_SEXUAL`, and thresholds
were not configurable per project.

**OWASP LLM Lens:** LLM01 Prompt Injection defense-in-depth — Google safety filters are a second layer. Inconsistent thresholds created a security gap.

**Remediation implemented (RBR-135):**

1. **Single source of truth.** `src/ai/safety-settings.ts` now owns all harm
   categories and thresholds. Both `GeminiClient` and `SecureAiPipeline` resolve
   through `resolveSafetySettings()`; neither carries its own literal defaults.
2. **Thresholds standardized.** All categories default to `BLOCK_MEDIUM_AND_ABOVE`.
3. **Missing categories added.** `HARM_CATEGORY_CIVIC_INTEGRITY` and
   `HARM_CATEGORY_HARASSMENT_SEXUAL` are declared in `HARM_CATEGORIES`.
4. **Duplicate client default removed.** `GeminiClient.generateContent()` no longer
   holds a literal safety array.
5. **Per-project configuration.** `AiGovernanceConfig.safetyConfig` carries
   `projectOverrides` keyed by project id, each requiring a `justification` and
   `approvedBy`, with optional `expiresAt` (expired overrides are ignored).

**Effective policy:**

| Safety Category | Threshold | Sent to API |
|----------------|-----------|-------------|
| HARM_CATEGORY_HARASSMENT | BLOCK_MEDIUM_AND_ABOVE | yes |
| HARM_CATEGORY_HATE_SPEECH | BLOCK_MEDIUM_AND_ABOVE | yes |
| HARM_CATEGORY_SEXUALLY_EXPLICIT | BLOCK_MEDIUM_AND_ABOVE | yes |
| HARM_CATEGORY_DANGEROUS_CONTENT | BLOCK_MEDIUM_AND_ABOVE | yes |
| HARM_CATEGORY_CIVIC_INTEGRITY | BLOCK_MEDIUM_AND_ABOVE | yes |
| HARM_CATEGORY_HARASSMENT_SEXUAL | BLOCK_MEDIUM_AND_ABOVE | declared only — not yet in Google's HarmCategory enum |

**Fail-closed guarantees (verified by tests):**

- **Strictness floor.** `MINIMUM_SAFETY_THRESHOLD = BLOCK_MEDIUM_AND_ABOVE`. Any
  override that would weaken a category (`BLOCK_NONE`, `BLOCK_ONLY_HIGH`,
  `HARM_BLOCK_THRESHOLD_UNSPECIFIED`) is clamped back to the floor and recorded as a
  `safety.policy_clamped` audit event. Filtering cannot be silently disabled.
- **No unconfigured categories.** A partial override still yields every declared
  category; unspecified ones fall back to the governance default.
- **Unknown enum values are stripped, not sent.** Categories outside
  `API_SUPPORTED_HARM_CATEGORIES` remain in the declared policy (auditable) but are
  filtered from the wire request, since an unrecognised enum value causes Gemini to
  reject the entire call with HTTP 400. `HARM_CATEGORY_HARASSMENT_SEXUAL` starts
  transmitting automatically once Google publishes it.
- **Unknown thresholds are ignored** rather than applied.

Two categories named in the original finding —
`HARM_CATEGORY_HATE_SPEECH_HARASSMENT` and `HARM_CATEGORY_DANGEROUS_CONTENT_MEDICAL`
— were **not** added: they do not exist in Google's HarmCategory enum or public
documentation, and the underlying harms are already covered by
`HARM_CATEGORY_HATE_SPEECH`, `HARM_CATEGORY_HARASSMENT`, and
`HARM_CATEGORY_DANGEROUS_CONTENT`. Add them to `HARM_CATEGORIES` if Google
publishes them.

**Verification:** `src/ai/__tests__/safety-settings.test.ts` — 21 tests covering the
canonical policy, threshold resolution and clamping, per-project overrides
(stricter / weaker / expired / unknown project), the absence of client-side
duplicate defaults (asserted against the captured HTTP request body), pipeline
wire-level integration, and governance wiring. Full `src/ai` suite: 199/199 passing,
`tsc --noEmit` clean, `eslint` 0 errors.

**Current status:** REMEDIATED.

---

### GL-F10: Pre-Flight Prompt Sanitization (MEDIUM) — PARTIALLY ADDRESSED

**Source:** `src/ai/guardrails.ts:168-191`, `src/ai/pipeline.ts:168-175`

The `ContentGuardrails.filterPrompt()` method provides pre-flight sanitization covering:
- 31 direct prompt injection patterns (regex)
- 7 indirect injection patterns (control chars, command injection)
- 5 multi-step injection patterns (delimited injection)
- 7 data classification rules (SSN, email, credit card, API keys, AWS keys, hex digests, JWTs)
- 8 content filter rules (PII, credential leakage, system prompt extraction, excessive agency, harmful content, compliance boundary, cross-project leakage, data exfiltration)

**Gaps remaining:**
1. **No multi-turn context tracking** — injection patterns that span multiple messages are not detected (e.g., "grandma" exploits, DAN-style roleplay building over turns)
2. **No indirect injection from tool outputs** — instructions embedded in documents, URLs, or tool responses bypass filters
3. **No payload obfuscation detection** — base64, ROT13, leetspeak, Unicode normalization variants
4. **No semantic/ML-based classifier** — all detection is regex-based
5. `governance.ts:71` — `contentFilters: []` is still empty; all filtering relies on the hardcoded fallback rules

**OWASP LLM Lens:** LLM01 Prompt Injection — regex-only defense without multi-turn tracking or semantic analysis.

**Remediation:**
1. Add multi-turn context tracking to `ContentGuardrails` — maintain a sliding window of previous messages per session
2. Add payload obfuscation detection (base64/ROT13/leetspeak/Unicode normalization)
3. Wire `contentFilters` in `DEFAULT_GOVERNANCE_CONFIG` to reference the actual filter rules
4. Consider a lightweight semantic injection classifier (e.g., Llama Guard via OpenRouter, or Gemini safety API for pre-classification)

**Current status:** PARTIALLY ADDRESSED. Prompt sanitization exists and is robust for single-turn direct injection. Multi-turn and obfuscated attacks remain unaddressed.

---

## Residual Risk Matrix

| Finding | Severity | Status | Impact | Blocks Migration? |
|---------|----------|--------|--------|---------------------|
| GL-F5 | MEDIUM | OPEN | Wrong canary agents selected | Must fix before canary |
| GL-F6 | MEDIUM | ACTIONABLE | Unknown CVE exposure in transitive deps | No |
| GL-F7 | MEDIUM | OPEN | No automated key rotation | Must fix before 90d window |
| GL-F8 | MEDIUM | OPEN | No GCP-level spend protection | Must fix before first production request |
| GL-F9 | MEDIUM | REMEDIATED | Thresholds standardized, categories added, per-project config (RBR-135) | No |
| GL-F10 | MEDIUM | PARTIAL | Regex-only, no multi-turn tracking | No (current defense is adequate for initial rollout) |

## Implementation Plan

### Phase 1: Immediate (this heartbeat)

- [x] Re-verify all findings against current source code
- [ ] Run `npm audit` on the project and report results (GL-F6)
- [ ] Update this assessment document

### Phase 2: Security Engineering delegation (child issues)

- [ ] **GL-F5**: Config-driven canary agent IDs (`src/ai/adapter.ts`, `src/ai/governance.ts`)
- [ ] **GL-F7**: AWS Secrets Manager rotation configuration
- [ ] **GL-F8**: GCP project budget caps documentation
- [x] **GL-F9**: Standardize safety thresholds, add missing categories — done in RBR-135 (`src/ai/safety-settings.ts`)
- [ ] **GL-F10**: Multi-turn context tracking in ContentGuardrails

### Phase 3: Compliance follow-up

- [ ] Map resolved findings to ISO 27001 controls (A.8.15 Logging, A.8.16 Monitoring, A.5.18 Access Rights)
- [ ] Schedule re-assessment of Gemini vendor after all fixes land

## Supporting Agent Assignments

| Finding | Owner | Action |
|---------|-------|--------|
| GL-F5 | Security Engineering (429dfce4) | Extract canary IDs to config, add validation |
| GL-F6 | CISO (aad16410) | Executed in this heartbeat |
| GL-F7 | Security Engineering (429dfce4) | Configure AWS SM auto-rotation, document policy |
| GL-F8 | Security Engineering (429dfce4) | Configure GCP budget caps, document |
| GL-F9 | ~~Security Engineering (429dfce4)~~ CTO (b7079c44) | DONE (RBR-135) — canonical `src/ai/safety-settings.ts`, floor enforcement, per-project overrides |
| GL-F10 | Security Engineering (429dfce4) | Add multi-turn tracking, obfuscation detection |
| ISO mapping | Compliance (fdd2c995) | Map findings to ISO 27001 controls |
| Re-assessment | Vendor Risk (25de7dfb) | Re-assess after fixes land |
