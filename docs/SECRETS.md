# Aira Secrets Management

## Architecture

Aira uses a **defense-in-depth** secrets strategy:

| Layer | Location | Purpose | Scope |
|-------|----------|---------|-------|
| **AWS Secrets Manager** | `aira/secrets` JSON secret | Primary source at runtime | Production |
| **GitHub Actions** | `Settings > Secrets and variables > Actions` | CI/CD pipeline secrets | CI/CD only |
| **Environment / .env** | `process.env` / local `.env` | Local development fallback | Dev only |

## Secret Inventory

| Secret | Key in Secrets Manager | Environment Variable | Purpose |
|--------|----------------------|---------------------|---------|
| Drata API Key | `DRATA_API_KEY` | `DRATA_API_KEY` | Drata API v2 authentication |
| Gemini API Key | `GEMINI_API_KEY` | `GEMINI_API_KEY` | Google Gemini (Vertex AI) API |
| OpenRouter API Key | `OPENROUTER_API_KEY` | `OPENROUTER_API_KEY` | OpenRouter fallback AI provider |

All three keys are stored in a single AWS Secrets Manager JSON secret named `aira/secrets`:

```json
{
  "DRATA_API_KEY": "sk_...",
  "GEMINI_API_KEY": "AIza...",
  "OPENROUTER_API_KEY": "sk-or-..."
}
```

Or each as individual secrets (`aira/secrets/DRATA_API_KEY`, etc.) for IAM-scoped access.

## Resolution Order

`src/config.ts` resolves each secret in this order:

1. **AWS Secrets Manager** (`loadConfig()` via `getSecretValue()`) — production path
2. **Environment variable** (`process.env`) — GitHub Actions, container, or local override
3. **Sync fallback** (`config` object from `process.env` only) — for quick-start scripts that can't await

The sync `config` object and `assertConfigSync()` are available for scripts that cannot use async init. For production paths and server startup, use `await loadConfig()` or `await assertConfig()`.

## AWS Setup

### 1. Create the secret

```bash
aws secretsmanager create-secret \
  --name aira/secrets \
  --secret-string '{"DRATA_API_KEY":"sk_...","GEMINI_API_KEY":"AIza...","OPENROUTER_API_KEY":"sk-or-..."}' \
  --region us-east-1
```

### 2. IAM policy (least privilege)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "arn:aws:secretsmanager:us-east-1:<account-id>:secret:aira/secrets*"
    }
  ]
}
```

The `*` suffix covers both the JSON secret and individual sub-keys (`aira/secrets/DRATA_API_KEY`).

### 3. Environment configuration

Set these env vars on the compute environment (EC2, Lambda, Fargate):

```
AWS_REGION=us-east-1
AWS_SECRET_ID=aira/secrets
```

For Lambda, attach the IAM policy above to the execution role. For EC2/Fargate, use an instance role or task role.

## GitHub Actions Secrets

For CI/CD workflows, configure these in repository settings:

| GitHub Secret Name | Value |
|-------------------|-------|
| `DRATA_API_KEY` | Drata API key (for integration tests) |
| `GEMINI_API_KEY` | Gemini API key (for AI tests) |
| `OPENROUTER_API_KEY` | OpenRouter API key (for fallback tests) |
| `GITLEAKS_LICENSE` | Gitleaks license key (for secret scanning) |

Workflows reference these via `${{ secrets.DRATA_API_KEY }}`.

## Local Development

1. Copy `.env.example` to `.env`
2. Fill in actual secret values
3. `.env` is gitignored — never commit it

For developers without AWS access, all secrets load from `.env` as a fallback.

## Secret Rotation

### Drata API Key
- Generate new key in Drata Admin > API Keys
- Update in AWS Secrets Manager (new version)
- Update in GitHub Actions secrets
- Revoke old key after confirming new key works

### Gemini / OpenRouter
- Rotate via respective provider consoles
- Update in AWS Secrets Manager
- Update in GitHub Actions secrets

Rotation should be performed every 90 days per the Access Control Policy (AIS-ISMS-POL-002).

## Automated Scanning

### CI/CD (every push + weekly)

- **Gitleaks**: Scans all commits for secret patterns
- **npm audit**: Checks dependencies for known CVEs
- **Dependency review**: Reviews new dependencies in PRs

### Local pre-commit

```bash
brew install gitleaks
gitleaks detect --source . --config .gitleaks.toml
```

## Audit Results (2026-07-09)

### Git History Scan
- **Result**: Clean — no secrets found in commit history (1 commit)
- **Method**: Pattern-based scan for API keys, AWS keys, JWT tokens, and generic credential patterns

### Source Code Scan
- **Result**: No hardcoded secrets in source
- `.env.example`: Contains placeholder values only (`sk_your_drata_api_key_here`, etc.)
- `src/ai/guardrails.ts`: Contains regex patterns for detecting leaked secrets (not actual secrets)
- `.gitleaks.toml`: Allowlisted `guardrails.ts` and `supplier-risk-assessment*` from false positives

### Dependency Audit
- **Result**: 0 known vulnerabilities (`npm audit`)

### Findings

| ID | Finding | Severity | Status |
|----|---------|----------|--------|
| SEC-01 | DRATA_API_KEY loaded from .env only; no Secrets Manager | Resolved | AWS Secrets Manager integration added via `src/secrets/aws.ts` |
| SEC-02 | No AI provider API keys configured | Resolved | GEMINI_API_KEY + OPENROUTER_API_KEY added to config and .env.example |
| SEC-03 | No GitHub Actions CI/CD pipeline | Resolved | `.github/workflows/ci-security.yml` created with secret scanning + audit |
| SEC-04 | No automated secret scanning | Resolved | Gitleaks configured with `.gitleaks.toml` |
| SEC-05 | No dependency vulnerability scanning in CI | Resolved | npm audit step in CI workflow |
| AWS-F6 | Secrets management audit (from supplier assessment) | Resolved | This document is the audit deliverable |
| GH-F4 | Repository secrets audit (from supplier assessment) | Resolved | This document is the audit deliverable |
| GH-F5 | npm dependency audit (from supplier assessment) | Resolved | CI pipeline includes npm audit |

### Residual Risk

- **Secrets Manager connectivity**: If AWS API is unreachable, the application falls back to environment variables. This is acceptable for a recovery path but requires the compute environment to have env vars configured as a backup.
- **.env file on developer machines**: Acceptable risk — developers must follow the Acceptable Use Policy (AIS-ISMS-POL-006) which prohibits storing credentials outside approved locations.
- **GitHub Actions secrets**: Gitleaks license key and API keys stored in GitHub encrypted secrets. Standard residual risk for GitHub-hosted CI.

## References

- ISO 27001 Policy: [AIS-ISMS-POL-002 Access Control Policy](../policies/iso27001/AIS-ISMS-POL-002-Access-Control-Policy.md)
- ISO 27001 Policy: [AIS-ISMS-POL-005 Asset Management Policy](../policies/iso27001/AIS-ISMS-POL-005-Asset-Management-Policy.md)
- Supplier Risk Assessment: [AWS & GitHub Phase 0](../docs/supplier-risk-assessment-aws-github-phase0.md)
- AWS Compliance: [Compliance Attestations](../docs/aws-compliance-attestations.md)
