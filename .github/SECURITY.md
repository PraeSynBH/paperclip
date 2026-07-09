# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

**Do not report security vulnerabilities through public GitHub issues.**

Report security vulnerabilities to:

- **Email**: security@rambur.com
- **Expected response**: Within 48 hours (business days)

Please include:

- A description of the vulnerability
- Steps to reproduce or proof-of-concept
- Potential impact
- Suggested remediation (if any)

### Process

1. You receive an acknowledgment within 48 hours.
2. We validate and triage the issue within 5 business days.
3. We develop and test a fix.
4. We release the fix and notify you.
5. We publish an advisory after the fix is deployed.

### Scope

This policy covers vulnerabilities in:

- Aira application code (`src/`)
- AI governance module (`src/ai/`)
- Drata integration client (`src/drata/`)
- ISO 27001 mapping module (`src/iso27001/`)
- CI/CD pipeline definitions (`.github/workflows/`)
- Dependency supply chain

**Out of scope**: Misconfigured local environments, social engineering, physical security, denial-of-service from volumetric attacks.

### Safe Harbor

We will not pursue legal action against researchers who:
- Follow this disclosure policy
- Act in good faith
- Avoid privacy violations, data destruction, and service interruption

## Security Controls

| Control | Status |
|---------|--------|
| Branch protection (PR reviews, signed commits) | Documented (BRANCH-PROTECTION.md), pending org setup |
| Signed commits | Required per CONTRIBUTING |
| Secret scanning push protection | Pending GitHub org setup |
| Code scanning (CodeQL) | Enabled via `.github/workflows/codeql.yml` |
| npm audit (dependency scanning) | CI enforced |
| Dependabot (automated dependency updates) | Configured |
| CODEOWNERS (mandatory review paths) | Enforced |
| gitleaks (pre-commit secret scanning) | Recommended |
| SAML SSO | Pending GitHub org setup |
| 2FA | Pending GitHub org enforcement |

## ISO 27001:2022 Controls Covered

- A.5.19-A.5.22 — Supplier relationship management (GitHub assessed as Tier-1)
- A.5.15-A.5.18 — Access control (branch protection, CODEOWNERS, 2FA)
- A.8.7 — Protection against malware (dependency scanning)
- A.8.8 — Management of technical vulnerabilities (this policy, Dependabot)
- A.8.9 — Configuration management (branch protection rules)
- A.8.28 — Secure coding (CodeQL code scanning, gitleaks secret scanning)
- A.8.25 — Secure development lifecycle (CI security checks, signed commits)

Last reviewed: 2026-07-09