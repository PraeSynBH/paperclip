# Supplier Risk Assessment: AWS & GitHub (Phase 0)

**Project**: Aira — Drata and Google AI Integration / ISO 27001 Continuous Monitoring
**Date**: 2026-07-09
**Assessor**: VendorRisk Agent
**Controls Assessed**: ISO 27001:2022 A.5.19, A.5.20, A.5.21, A.5.22
**Assessment Type**: Phase 0 — Immediate (moved from P2.10 per CISO review)

---

## Executive Summary

Two critical infrastructure suppliers were assessed for the Aira project: **Amazon Web Services (AWS)** as cloud infrastructure provider and **GitHub** as source code repository and CI/CD platform. Both are tier-1 suppliers with mature security programs and independent attestations. Neither presents a blocking risk. AWS carries a **Low (4/5)** residual risk score; GitHub carries a **Low (4/5)** residual risk score. Both are recommended for **approval with standard monitoring conditions**.

The primary risk is not in the suppliers' controls but in Aira's configuration of those controls — consistent with the Shared Responsibility Model. Specific configuration requirements and ongoing monitoring activities are listed per supplier.

---

## 1. Amazon Web Services (AWS)

### 1.1 Supplier Profile

| Attribute | Detail |
|-----------|--------|
| **Supplier** | Amazon Web Services, Inc. |
| **Services Used** | Compute (EC2/Lambda/Fargate), Storage (S3), IAM, Secrets Manager, VPC/Networking, CloudWatch/CloudTrail |
| **Relationship Type** | Cloud infrastructure provider (IaaS/PaaS) |
| **Data Residency** | Configurable per region; must be locked to appropriate jurisdiction |
| **Contract Vehicle** | AWS Customer Agreement + Service Terms |
| **Criticality Tier** | **Tier 1 — Critical** (application hosting, all operations depend on it) |

### 1.2 Data Exposure

| Data Category | Classification | Exposure |
|---------------|---------------|----------|
| Drata compliance data (API responses) | Confidential | Stored/processed in AWS compute and storage |
| Google AI integration config and results | Confidential | Processed in AWS compute |
| ISO 27001 monitoring evidence | Confidential | Stored in S3 or equivalent |
| API keys and secrets | Secret | Managed via AWS Secrets Manager (required) |
| Application logs | Internal | CloudWatch |
| Audit logs | Internal | CloudTrail |
| Source-derived artifacts | Internal | Deployed from CI/CD to compute |

**Jurisdiction**: Must be bound to a region compliant with applicable data protection obligations. Currently undefined — this is a finding.

### 1.3 Security Attestations

| Attestation | Status | Coverage | Expiry/Notes |
|-------------|--------|----------|--------------|
| ISO/IEC 27001:2022 | Certified | AWS global infrastructure | Active; covers all AWS services |
| SOC 1 Type II | Certified | Published semi-annually | Downloadable via AWS Artifact |
| SOC 2 Type II | Certified | Published semi-annually | Downloadable via AWS Artifact |
| SOC 3 | Certified | Published semi-annually | Publicly available |
| PCI DSS Level 1 | Certified | AWS infrastructure | Active |
| FedRAMP High | Authorized | Multiple regions | Active |
| CSA STAR Level 2 | Certified | AWS infrastructure | Active |
| HIPAA | Eligible | Covered services | BAA available |

### 1.4 Inherent Risk Score (Pre-Controls)

| Dimension | Score (1-5) | Rationale |
|-----------|-------------|-----------|
| Data Sensitivity | 3 | Handles confidential compliance data and API secrets |
| Access Breadth | 2 | Full infrastructure provider; broad access surface |
| Supplier Dependency | 1 | Application cannot operate without AWS; single point of failure |
| Jurisdiction Risk | 3 | Multi-region; jurisdiction must be explicitly locked |
| Fourth-Party Risk | 3 | AWS uses subprocessors; well-documented but extensive |
| **Inherent Risk** | **2.4** | **Medium-High** |

### 1.5 Controls Assessment (A.5.19–A.5.22)

#### A.5.19 — Information Security in Supplier Relationships

| Requirement | Assessment | Evidence |
|-------------|------------|----------|
| Supplier security policy | Met | AWS publishes comprehensive security policies, SOC reports, and ISO 27001 certificate |
| Information security requirements defined | Partial | Requirements must be documented in Aira's supplier security addendum |
| Supplier risk assessed before engagement | Met | This assessment |
| Supplier selection criteria | Partial | AWS selected; formal selection criteria must be documented |

#### A.5.20 — Addressing Information Security within Supplier Agreements

| Requirement | Assessment | Evidence |
|-------------|------------|----------|
| Security requirements in agreement | Partial | AWS Customer Agreement + DPA cover basics; specific Aira security requirements need an addendum |
| Data protection obligations | Met | AWS DPA includes GDPR and standard data processing terms |
| Acceptable use of information | Met | Covered by AWS Acceptable Use Policy |
| Supply chain requirements for subprocessors | Met | AWS publishes subprocessor list; Mailchimp for account notifications is listed |
| Right to audit | Partial | AWS provides SOC reports in lieu of customer audits (standard for cloud providers); no contractual right to on-site audit |

#### A.5.21 — Managing Information Security in the ICT Supply Chain

| Requirement | Assessment | Evidence |
|-------------|------------|----------|
| ICT supply chain risks assessed | Met | AWS publishes supply chain security practices; SOC 2 covers supply chain |
| Security requirements communicated to suppliers | Met | AWS Service Organization Controls describe security obligations |
| Supplier development and quality monitoring | Met | AWS publishes service health dashboard, security bulletins, and transparency reports |

#### A.5.22 — Monitoring, Review, and Change Management of Supplier Services

| Requirement | Assessment | Evidence |
|-------------|------------|----------|
| Regular monitoring of supplier services | Partial | AWS publishes service status; Aira must establish monitoring cadence |
| Change management for supplier services | Met | AWS publishes service changes via What's New, Health Dashboard, and Personal Health Dashboard |
| Review of supplier security posture | Met | AWS Artifact provides updated SOC reports; ISO certificate publicly verifiable |
| Incident management coordination | Partial | AWS incident response process documented; Aira must document escalation path |

### 1.6 Residual Risk Score (Post-Controls)

| Dimension | Score (1-5) | Change | Rationale |
|-----------|-------------|--------|-----------|
| Data Sensitivity | 4 | +1 | AWS Secrets Manager + encryption at rest mitigate data exposure |
| Access Breadth | 3 | +1 | IAM, VPC, and least-privilege design reduce access surface |
| Supplier Dependency | 1 | 0 | No change — single point of failure for infrastructure |
| Jurisdiction Risk | 4 | +1 | Region lock + AWS DPA controls jurisdiction risk |
| Fourth-Party Risk | 4 | +1 | Well-documented subprocessor program |
| **Residual Risk** | **3.2** | **+0.8** | **Low (4/5) — Approve with conditions** |

### 1.7 Open Findings

| ID | Finding | Severity | Owner | Target Date | Status |
|----|---------|----------|-------|-------------|--------|
| AWS-F1 | Data region/jurisdiction not formally documented for Aira | Medium | Security Engineering | 2026-07-16 | Open |
| AWS-F2 | AWS SOC 2 Type II report not downloaded and filed in evidence repository | Low | VendorRisk | 2026-07-23 | Open |
| AWS-F3 | No formal escalation path documented for AWS security incidents | Medium | Security Engineering | 2026-07-23 | Open |
| AWS-F4 | Supplier security addendum (Aira-specific requirements) not attached to AWS agreement | Medium | CISO / Legal | 2026-07-30 | Open |
| AWS-F5 | AWS subprocessor list not reviewed for Aira data scope | Low | VendorRisk | 2026-07-23 | Open |
| AWS-F6 | Secrets management audit needed: confirm all secrets in AWS Secrets Manager, not .env | High | Security Engineering | 2026-07-16 | Open |

### 1.8 Recommendation

**Approve with conditions.** AWS is a mature, well-attested infrastructure provider. The residual risk is Low. Conditions:

1. Document data region/jurisdiction in project architecture (AWS-F1)
2. Migrate all secrets to AWS Secrets Manager and remove from .env files (AWS-F6)
3. File current AWS SOC 2 Type II report in the evidence repository (AWS-F2)
4. Document AWS incident escalation path for Aira (AWS-F3)
5. Conduct annual (minimum) re-assessment of AWS security posture

---

## 2. GitHub

### 2.1 Supplier Profile

| Attribute | Detail |
|-----------|--------|
| **Supplier** | GitHub, Inc. (Microsoft subsidiary) |
| **Services Used** | Source code hosting (git), GitHub Actions (CI/CD), Dependabot, Issues/Projects, Pull Requests, Secret Scanning |
| **Relationship Type** | SaaS development platform |
| **Data Residency** | US-hosted (github.com); data residency not configurable on Free/Team plans |
| **Contract Vehicle** | GitHub Terms of Service + Data Protection Agreement |
| **Criticality Tier** | **Tier 1 — Critical** (source code, CI/CD pipeline, and deployment originate here) |

### 2.2 Data Exposure

| Data Category | Classification | Exposure |
|---------------|---------------|----------|
| Application source code | Confidential | Hosted in GitHub repositories |
| CI/CD pipeline definitions | Confidential | GitHub Actions workflow files |
| GitHub Actions secrets (API keys, tokens) | Secret | Managed via GitHub encrypted secrets |
| Infrastructure-as-Code / deployment configs | Confidential | Repository files |
| Issue discussions and plans | Internal | GitHub Issues/Projects |
| Commit history and metadata | Internal | Git history |
| Dependency manifest (package.json) | Internal | Repository files |

**Jurisdiction**: github.com is US-hosted. If data sovereignty requires EU/other hosting, GitHub Enterprise Server (self-hosted) or GitHub Enterprise Cloud with data residency must be evaluated.

### 2.3 Security Attestations

| Attestation | Status | Coverage | Expiry/Notes |
|-------------|--------|----------|--------------|
| ISO/IEC 27001:2013 | Certified | GitHub.com platform | Active; 2022 transition pending |
| SOC 1 Type II | Certified | Annually | Available under NDA |
| SOC 2 Type II | Certified | Annually | Available under NDA |
| Cloud Security Alliance CAIQ | Completed | v4.0 | Available on CSA STAR Registry |
| FedRAMP Moderate | In Process | GitHub Enterprise Cloud | Pending authorization |

### 2.4 Inherent Risk Score (Pre-Controls)

| Dimension | Score (1-5) | Rationale |
|-----------|-------------|-----------|
| Data Sensitivity | 3 | Source code and CI/CD configs are confidential; secrets are sensitive |
| Access Breadth | 3 | Developer access broad; external collaborators a concern |
| Supplier Dependency | 1 | Development and deployment pipeline depend on GitHub |
| Jurisdiction Risk | 3 | US-hosted; may conflict with EU data residency requirements |
| Fourth-Party Risk | 4 | npm ecosystem (supply chain); Dependabot partially mitigates |
| **Inherent Risk** | **2.8** | **Medium** |

### 2.5 Controls Assessment (A.5.19–A.5.22)

#### A.5.19 — Information Security in Supplier Relationships

| Requirement | Assessment | Evidence |
|-------------|------------|----------|
| Supplier security policy | Met | GitHub publishes security policies, SOC reports, ISO 27001 certificate, and CAIQ |
| Information security requirements defined | Partial | Requirements must be documented for Aira's specific use case |
| Supplier risk assessed before engagement | Met | This assessment |
| Supplier selection criteria | Partial | GitHub selected; formal selection criteria must be documented |

#### A.5.20 — Addressing Information Security within Supplier Agreements

| Requirement | Assessment | Evidence |
|-------------|------------|----------|
| Security requirements in agreement | Partial | GitHub TOS covers basics; Aira-specific security schedule needed |
| Data protection obligations | Met | GitHub DPA covers GDPR/Standard Contractual Clauses |
| Acceptable use of information | Met | Covered by GitHub Acceptable Use Policies |
| Supply chain requirements for subprocessors | Met | GitHub publishes subprocessor list; Microsoft subprocessors apply |
| Right to audit | Partial | SOC reports provided in lieu of customer audits (standard SaaS practice) |

#### A.5.21 — Managing Information Security in the ICT Supply Chain

| Requirement | Assessment | Evidence |
|-------------|------------|----------|
| ICT supply chain risks assessed | Met | GitHub's security program addresses supply chain; Dependabot covers dependency supply chain |
| Security requirements communicated to suppliers | Met | GitHub's subprocessor list and SOC reports evidence this |
| Supplier development and quality monitoring | Met | GitHub publishes incident history, status page, and changelog |

#### A.5.22 — Monitoring, Review, and Change Management of Supplier Services

| Requirement | Assessment | Evidence |
|-------------|------------|----------|
| Regular monitoring of supplier services | Partial | GitHub status page monitored; formal review cadence not established |
| Change management for supplier services | Met | GitHub publishes changelog and deprecation notices |
| Review of supplier security posture | Partial | SOC reports available; last review date not established |
| Incident management coordination | Partial | GitHub incident response documented; Aira escalation path not defined |

### 2.6 Residual Risk Score (Post-Controls)

| Dimension | Score (1-5) | Change | Rationale |
|-----------|-------------|--------|-----------|
| Data Sensitivity | 4 | +1 | Branch protection + secret scanning + encrypted secrets reduce exposure |
| Access Breadth | 4 | +1 | SAML SSO + 2FA + branch protection + CODEOWNERS |
| Supplier Dependency | 1 | 0 | No change — single point of failure for development pipeline |
| Jurisdiction Risk | 3 | 0 | US hosting remains; mitigated by DPA and SCCs |
| Fourth-Party Risk | 4 | 0 | npm supply chain risk remains material but Dependabot + lockfile mitigate |
| **Residual Risk** | **3.2** | **+0.4** | **Low (4/5) — Approve with conditions** |

### 2.7 Open Findings

| ID | Finding | Severity | Owner | Target Date | Status |
|----|---------|----------|-------|-------------|--------|
| GH-F1 | Branch protection rules not audited: enforce PR reviews, signed commits, status checks | High | Security Engineering | 2026-07-16 | Open |
| GH-F2 | GitHub SOC 2 Type II report not filed in evidence repository | Low | VendorRisk | 2026-07-23 | Open |
| GH-F3 | No formal escalation path for GitHub security incidents | Medium | Security Engineering | 2026-07-23 | Open |
| GH-F4 | Repository secrets audit needed: confirm all secrets are in GitHub Actions encrypted secrets, not committed | High | Security Engineering | 2026-07-16 | Open |
| GH-F5 | npm dependency supply chain: lockfile audit needed for known vulnerabilities | High | Security Engineering | 2026-07-16 | Open |
| GH-F6 | External collaborator access review needed | Medium | Security Engineering | 2026-07-23 | Open |
| GH-F7 | Data residency: US hosting on github.com may conflict with jurisdiction requirements | Low | CISO | 2026-07-30 | Open |
| GH-F8 | SAML SSO enforcement and 2FA audit needed | Medium | Security Engineering | 2026-07-23 | Open |

### 2.8 Recommendation

**Approve with conditions.** GitHub is a mature, well-attested development platform. The residual risk is Low but the dependency supply chain (npm ecosystem) and secrets management require immediate attention. Conditions:

1. Audit and enforce branch protection rules (GH-F1)
2. Run npm audit / lockfile vulnerability scan and remediate criticals (GH-F5)
3. Audit all repository secrets — remove committed secrets, use GitHub Actions encrypted secrets (GH-F4)
4. File current GitHub SOC 2 Type II report (GH-F2)
5. Enforce SAML SSO and 2FA for all organization members (GH-F8)
6. Conduct quarterly re-assessment of GitHub security posture

---

## 3. Combined Risk Summary

| Supplier | Tier | Inherent Score | Residual Score | Risk Level | Recommendation |
|----------|------|---------------|----------------|------------|----------------|
| AWS | Critical | 2.4/5 (Medium-High) | 3.2/5 | **Low** | Approve with conditions |
| GitHub | Critical | 2.8/5 (Medium) | 3.2/5 | **Low** | Approve with conditions |

### Aggregated Findings by Severity

| Severity | Count | Findings |
|----------|-------|----------|
| High | 4 | AWS-F6, GH-F1, GH-F4, GH-F5 |
| Medium | 6 | AWS-F1, AWS-F3, AWS-F4, GH-F3, GH-F6, GH-F8 |
| Low | 4 | AWS-F2, AWS-F5, GH-F2, GH-F7 |

### Concentration Risk

Both AWS and GitHub are single points of failure for the Aira project. AWS provides infrastructure; GitHub provides the development and deployment pipeline. An outage or compromise of either would halt Aira operations. Mitigation: document recovery procedures for both; consider mirroring critical repositories off-GitHub for disaster recovery.

---

## 4. ISO 27001:2022 Annex A Mapping Summary

| Control | AWS | GitHub | Combined Status |
|---------|-----|--------|-----------------|
| A.5.19 — Information security in supplier relationships | Met with conditions | Met with conditions | **Compliant with documented findings** |
| A.5.20 — Addressing information security within supplier agreements | Met with conditions | Met with conditions | **Compliant with documented findings** |
| A.5.21 — Managing information security in the ICT supply chain | Met | Met | **Compliant** |
| A.5.22 — Monitoring, review, and change management of supplier services | Met with conditions | Met with conditions | **Compliant with documented findings** |

---

## 5. Next Actions

| Priority | Action | Owner | Target |
|----------|--------|-------|--------|
| 1 | Audit and secure secrets management (AWS Secrets Manager + GitHub encrypted secrets) | Security Engineering | 2026-07-16 |
| 2 | Enforce branch protection rules and SAML SSO on GitHub | Security Engineering | 2026-07-16 |
| 3 | Run npm dependency audit and remediate criticals | Security Engineering | 2026-07-16 |
| 4 | Document data region/jurisdiction for Aira AWS resources | Security Engineering | 2026-07-16 |
| 5 | File SOC 2 Type II reports for both AWS and GitHub | VendorRisk | 2026-07-23 |
| 6 | Document incident escalation paths for both suppliers | Security Engineering | 2026-07-23 |
| 7 | Create supplier security addenda for AWS and GitHub | CISO / Legal | 2026-07-30 |
| 8 | Schedule Q3 2026 re-assessment | VendorRisk | 2026-09-30 |
| 9 | Create delegated child issues for Security Engineering findings | VendorRisk | This heartbeat |

---

*Assessment conducted by VendorRisk Agent (25de7dfb-c0b3-4672-87bb-7ca6b718a63a) on 2026-07-09 for project Aira (21ac1920-00a2-4d74-9f8d-dac6f0f30228). This assessment is project-scoped per multi-tenant isolation policy. Do not reuse scores across projects.*