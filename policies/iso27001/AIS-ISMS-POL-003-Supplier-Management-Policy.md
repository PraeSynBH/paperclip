# Supplier Management Policy

**Document ID:** AIS-ISMS-POL-003
**Version:** 1.1
**Effective Date:** [Pending ISMS Owner approval]
**Review Cycle:** Annual
**Classification:** Internal

## 1. Purpose

This policy defines the framework for identifying, assessing, managing, and monitoring information security risks associated with Rambur's suppliers and service providers. It includes AI service providers (large language model APIs, machine learning infrastructure) under the same risk management framework, in alignment with ISO/IEC 42001:2023 A.13.2 (Supplier AI services).

## 2. Scope

This policy applies to all third-party suppliers, vendors, contractors, and service providers who access, process, store, or transmit Rambur information assets, or whose services could impact the confidentiality, integrity, or availability of Rambur's information. This scope explicitly includes AI service providers: Google Gemini API, OpenRouter API, and any future AI/ML service providers integrated into Rambur's systems.

## 3. Policy Statements

### 3.1 Supplier Risk Classification (A.5.19)

All suppliers shall be classified based on risk before engagement:

| Tier | Criteria | Assessment Required |
|------|----------|-------------------|
| Critical | Access to production data/systems, processes regulated data, or service unavailability would cause business disruption | Full risk assessment, annual review |
| High | Access to internal systems or confidential data | Risk assessment, annual review |
| Medium | Access to non-sensitive data or limited scope | Questionnaire, biennial review |
| Low | No access to Rambur data or systems | Classification only |

### 3.2 Pre-Engagement Assessment (A.5.19, A.5.20)

- All Critical and High-tier suppliers shall undergo a security risk assessment before contract signing
- Assessment shall evaluate: security certifications (SOC 2, ISO 27001), data handling practices, incident response capability, business continuity, subcontractor management, and geographic data residency
- Risk assessment results shall be documented and retained for the supplier lifecycle
- Suppliers that do not meet minimum security requirements shall not be engaged unless:
  - Compensating controls are implemented and documented
  - A risk acceptance is signed by the ISMS Owner

### 3.3 Contractual Requirements (A.5.20)

Supplier agreements shall include, as applicable:
- Information security obligations aligned with this ISMS
- Right to audit security controls (annually for Critical-tier)
- Data protection and confidentiality requirements
- Incident notification requirements (within 24 hours for security incidents)
- Data handling, retention, and deletion upon contract termination
- Subcontractor management and notification requirements
- Compliance with applicable laws and regulations
- Business continuity and disaster recovery commitments

### 3.4 ICT Supply Chain Security (A.5.21)

- Suppliers shall disclose their own critical subcontractors that handle Rambur data
- Supply chain risks shall be assessed for Critical and High-tier suppliers
- Supplier shall notify Rambur of material changes to their supply chain
- Open-source dependencies and third-party libraries used by Rambur shall be tracked and assessed for known vulnerabilities

### 3.5 Ongoing Monitoring (A.5.22)

- Critical-tier suppliers shall be reviewed annually
- High-tier suppliers shall be reviewed annually
- Medium-tier suppliers shall be reviewed biennially
- Monitoring activities include: security posture changes, certification status, incident history, organizational changes, and contract compliance
- Supplier performance and security posture shall be documented in a supplier risk register
- Significant changes to supplier services shall trigger a reassessment

### 3.6 Cloud Service Providers (A.5.23)

- Cloud service acquisition, use, management, and exit shall follow documented processes
- Cloud services shall be assessed for: data residency, encryption at rest and in transit, access controls, shared responsibility model, and exit strategy
- Cloud service configuration shall align with Rambur security baselines
- A documented cloud exit plan shall exist for Critical-tier cloud services

### 3.7 AI Service Providers (ISO 42001 A.13.2)

AI service providers (LLM APIs, ML infrastructure, AI platforms) shall be assessed under the same tiered framework as other suppliers with the following additional requirements:

- **Pre-engagement assessment**: AI service providers shall be evaluated for: AI-specific certifications (ISO 42001, NIST AI RMF alignment), model training data practices, prompt/response data handling, safety filter capabilities, and AI incident response capability
- **Contractual requirements**: AI provider agreements shall include: data use restrictions (no training on Rambur prompts), data residency guarantees, API key management obligations, and model deprecation notice periods
- **Infrastructure attestations**: AI service providers hosting on certified infrastructure (e.g., GCP ISO 42001:2023 certified data centers) shall have their attestations verified and documented
- **Budget controls**: AI service usage shall be governed by documented budget thresholds with hard limits and kill-switches for cost containment
- **Fallback and continuity**: Critical AI services shall have a documented fallback provider and migration plan (e.g., Gemini → OpenRouter fallback with automated cutover at defined thresholds)
- **Ongoing monitoring**: AI providers shall be monitored for: certification status, model changes, safety incidents, API deprecation notices, and cost anomalies

**Current AI service providers in scope:**

| Provider | Service | Tier | Attestation | Budget Control |
|----------|---------|------|-------------|---------------|
| Google Gemini API | AI inference (`gemini-2.5-pro`, `gemini-2.5-flash`) | Critical | GCP ISO 42001:2023 | $5,000/mo hard limit + $250/day limit |
| OpenRouter API | AI inference (fallback) | High | Provider self-attestation | $2,000/mo hard limit |

### 3.8 Supplier Offboarding (A.5.19)

- Upon contract termination, suppliers shall:
  - Return or securely destroy all Rambur data within 30 days
  - Provide written confirmation of data destruction
  - Revoke all access credentials within 24 hours

## 4. Responsibilities

| Role | Responsibility |
|------|---------------|
| ISMS Owner | Risk acceptance for non-compliant suppliers |
| Vendor Risk Agent | Supplier assessments, risk register maintenance |
| CISO | Supplier risk framework, escalation, AI service provider risk decisions |
| AI Governance Engineer | AI service provider assessment, model lifecycle oversight, AI-specific due diligence |
| Engineering Lead | Technical integration review, access revocation, API key management |
| Procurement/Management | Contractual clause inclusion |

## 5. Mapped Controls

| Control | Description | Policy Section |
|---------|-------------|---------------|
| A.5.19 | Information security in supplier relationships | 3.1, 3.2, 3.8 |
| A.5.20 | Addressing infoSec within supplier agreements | 3.2, 3.3 |
| A.5.21 | Managing infoSec in ICT supply chain | 3.4 |
| A.5.22 | Monitoring and review of supplier services | 3.5 |
| A.5.23 | Information security for cloud services | 3.6 |
| ISO 42001 A.13.2 | Supplier AI services | 3.7 |

## 6. Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jul 2026 | Compliance Agent (RBR-27) | Initial draft for ISO 27001:2022 certification |
| 1.1 | Jul 2026 | Compliance Agent (RBR-148) | Added AI service provider assessment framework, Gemini/OpenRouter to supplier scope, ISO 42001 A.13.2 cross-reference (F05) |

## 7. Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| ISMS Owner | [Pending RBR-20] | _______________ | ________ |
| CISO | [CISO] | _______________ | ________ |

*Approval pending ISMS Owner appointment per [RBR-20](/RBR/issues/RBR-20).*

*Note: Supplier risk assessments for AWS and GitHub are tracked in [RBR-22](/RBR/issues/RBR-22). AWS compliance attestations are tracked in [RBR-23](/RBR/issues/RBR-23).*