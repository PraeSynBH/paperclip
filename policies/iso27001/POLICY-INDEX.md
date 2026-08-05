# ISO 27001:2022 ISMS Policy Index

**Generated:** 2026-07-09
**Updated:** 2026-07-10 — AI governance cross-reference (F05 / ISO 42001 A.5.3) + F11 AI Concern Reporting procedure
**Project:** Aira: Drata and Google AI Integration
**Sprint:** Phase 1 (RBR-27)
**Status:** Draft — pending ISMS Owner approval

## Policy Inventory

| # | Policy | Document ID | Primary Controls | Status |
|---|--------|-------------|-----------------|--------|
| 1 | Information Security Policy | AIS-ISMS-POL-001 | A.5.1, A.5.2, A.5.3, A.5.4, A.6.4, A.5.36 | Draft |
| 2 | Access Control Policy | AIS-ISMS-POL-002 | A.5.15, A.5.16, A.5.17, A.5.18, A.6.7 | Draft |
| 3 | Supplier Management Policy | AIS-ISMS-POL-003 | A.5.19, A.5.20, A.5.21, A.5.22, A.5.23 | Draft |
| 4 | Incident Management Policy | AIS-ISMS-POL-004 v1.2 | A.5.24, A.5.25, A.5.26, A.5.27, A.5.28, A.5.5, A.6.8, A.5.23, ISO/IEC 42001 A.11.3 | Draft |
| 5 | Asset Management Policy | AIS-ISMS-POL-005 | A.5.9, A.5.10, A.5.11, A.5.12, A.5.13, A.5.14 | Draft |
| 6 | Acceptable Use Policy | AIS-ISMS-POL-006 | A.5.10, A.8.1, A.6.7 | Draft |
| 7 | Change Management Policy | AIS-ISMS-POL-007 | A.8.32, A.5.3, A.5.22 | Draft |
| 8 | Business Continuity Policy | AIS-ISMS-POL-008 | A.5.29, A.5.30, A.8.13 | Draft |

## Procedure Inventory

| # | Procedure | Document ID | Parent Policy | Primary Controls | Status |
|---|-----------|-------------|---------------|-----------------|--------|
| 1 | AI Concern Reporting Procedure | AIS-ISMS-PROC-001 v1.0 | AIS-ISMS-POL-004 v1.2 §4.8 | ISO/IEC 42001 A.11.3, A.5.23, A.6.8 | Draft |

## Control Coverage Summary

### Organizational Controls (A.5)

| Control | Policy Coverage |
|---------|----------------|
| A.5.1 | POL-001 (Information Security Policy) |
| A.5.2 | POL-001 (Information Security Policy) |
| A.5.3 | POL-001, POL-007 (Change Management) |
| A.5.4 | POL-001 (Information Security Policy) |
| A.5.5 | POL-004 (Incident Management) |
| A.5.9 | POL-005 (Asset Management) |
| A.5.10 | POL-005, POL-006 (Acceptable Use) |
| A.5.11 | POL-005 (Asset Management) |
| A.5.12 | POL-005 (Asset Management) |
| A.5.13 | POL-005 (Asset Management) |
| A.5.14 | POL-005 (Asset Management) |
| A.5.15 | POL-002 (Access Control) |
| A.5.16 | POL-002 (Access Control) |
| A.5.17 | POL-002 (Access Control) |
| A.5.18 | POL-002 (Access Control) |
| A.5.19 | POL-003 (Supplier Management) |
| A.5.20 | POL-003 (Supplier Management) |
| A.5.21 | POL-003 (Supplier Management) |
| A.5.22 | POL-003, POL-007 |
| A.5.23 | POL-003 (Supplier Management), POL-004 §4.8 (Incident Management — AI concern reporting) |
| A.5.24 | POL-004 (Incident Management) |
| A.5.25 | POL-004 (Incident Management) |
| A.5.26 | POL-004 (Incident Management) |
| A.5.27 | POL-004, POL-008 (Business Continuity) |
| A.5.28 | POL-004 (Incident Management) |
| A.5.29 | POL-008 (Business Continuity) |
| A.5.30 | POL-008 (Business Continuity) |
| A.5.36 | POL-001 (Information Security Policy) |

### Technological Controls (A.8)

| Control | Policy Coverage |
|---------|----------------|
| A.8.1 | POL-006 (Acceptable Use) |
| A.8.13 | POL-008 (Business Continuity) |
| A.8.32 | POL-007 (Change Management) |

### People Controls (A.6)

| Control | Policy Coverage |
|---------|----------------|
| A.6.4 | POL-001 (Information Security Policy) |
| A.6.7 | POL-002, POL-006 |
| A.6.8 | POL-004 (Incident Management) |

**Total controls covered by Phase 1 policies:** 31 of 82 applicable controls (38%)

## AI Governance Alignment (ISO/IEC 42001:2023 A.5.3)

The ISMS policy framework has been updated to cross-reference AI governance controls applicable to Aira's AI integration (`src/ai/`). This satisfies ISO 42001:2023 A.5.3 (Alignment of AI policies with ISMS) and ensures a unified governance posture.

| Policy | AI Controls Cross-Referenced | ISO 42001 Controls |
|--------|------------------------------|-------------------|
| POL-001 (Information Security Policy) | AI governance scope, roles (AI Governance Engineer), policy framework alignment | A.5.3, A.5.4, A.6.2 |
| POL-002 (Access Control Policy) | No direct AI changes — role-based model tiering covered by AI Governance Engine | — |
| POL-003 (Supplier Management Policy) | AI service provider assessment (Gemini API, OpenRouter), GCP ISO 42001 attestation | A.13.2 |
| POL-004 (Incident Management Policy) | AI concern reporting channel (`ai-concerns@rambur.com`, `ai-concern` GitHub label, pipeline `guardrail.blocked` hook); 11 AI incident categories (AI-HAL, AI-BIA, AI-PRI, AI-INJ, AI-EXA, AI-UNS, AI-TRN, AI-DRF, AI-BDG, AI-INC, AI-OTH); operational procedure AIS-ISMS-PROC-001 | A.11.3 |
| POL-005 (Asset Management Policy) | AI model assets classification (not yet implemented) | A.7.2 |
| POL-006 (Acceptable Use Policy) | AI system acceptable use, prohibited AI activities, data classification for AI prompts | A.12.2, A.12.3, A.10.2 |
| POL-007 (Change Management Policy) | AI model/provider change control, parity evaluation gates | A.9.5 |
| POL-008 (Business Continuity Policy) | AI service continuity (Gemini fallback to OpenRouter) | A.7.2 |

### AI-Specific Policies (Drata Only)

Three AI-specific policies exist in Drata as ACTIVE but have not yet been exported to the local workspace:

| Drata Policy | ISO 42001 Cover | Local Export |
|-------------|-----------------|-------------|
| AI Governance Policy | A.5.2 | BLOCKED — RBR-19 (Drata API scopes), tracked as F04 |
| AI Risk Management Policy | A.5.3, A.8.4 | BLOCKED — RBR-19 (Drata API scopes), tracked as F04 |
| AI System Development and Evaluation Policy | A.5.3, A.9.2, A.9.3 | BLOCKED — RBR-19 (Drata API scopes), tracked as F04 |

### Phase 2 AI Policy Candidates

| # | Policy | Primary AI Controls |
|---|--------|-------------------|
| 17 | AI Governance Policy (local copy) | A.5.2, A.5.3, A.6.2, A.6.4 |
| 18 | AI Risk Management Policy (local copy) | A.5.3, A.8.2, A.8.3, A.8.4 |
| 19 | AI System Development and Evaluation Policy (local copy) | A.5.3, A.9.2, A.9.3, A.9.4, A.9.5 |

**AI governance evidence:** Control mapping at `Aira-ISO27001/docs/ai-governance/control-mapping.md` (RBR-112 v1.1). 17/26 ISO 42001 controls MET (65.4%), 22/26 with policy-based PARTIAL (84.6%).

## Review Schedule

| Policy | Next Review | Reviewer | Trigger |
|--------|-------------|----------|---------|
| AIS-ISMS-POL-001 | Jul 2027 | ISMS Owner | Annual |
| AIS-ISMS-POL-002 | Jul 2027 | ISMS Owner | Annual |
| AIS-ISMS-POL-003 | Jul 2027 | ISMS Owner | Annual |
| AIS-ISMS-POL-004 | Jul 2027 | ISMS Owner | Annual |
| AIS-ISMS-POL-005 | Jul 2027 | ISMS Owner | Annual |
| AIS-ISMS-POL-006 | Jul 2027 | ISMS Owner, all personnel acknowledge | Annual |
| AIS-ISMS-POL-007 | Jul 2027 | ISMS Owner | Annual |
| AIS-ISMS-POL-008 | Jul 2027 | ISMS Owner | Annual |

Review triggers (any of): annual cycle, major organizational change, significant incident, regulatory change, audit finding.

## Phase 2 Policy Candidates (8 remaining)

Policies deferred per CISO risk mitigation guidance. To be produced if Engineering Lead capacity permits.

| # | Policy | Primary Controls |
|---|--------|-----------------|
| 9 | Cryptography and Key Management Policy | A.8.24, A.8.5 |
| 10 | Secure Development Policy | A.8.25, A.8.26, A.8.27, A.8.28, A.8.29 |
| 11 | Data Protection and Privacy Policy | A.5.31, A.5.32, A.5.33, A.5.34 |
| 12 | Physical and Environmental Security Policy | A.7.1-A.7.10 |
| 13 | Operations Security Policy | A.8.8, A.8.9, A.8.10, A.8.11, A.8.12, A.8.14 |
| 14 | Human Resources Security Policy | A.6.1, A.6.2, A.6.5, A.6.6 |
| 15 | Communications Security Policy | A.8.20, A.8.21, A.8.22, A.8.23 |
| 16 | Compliance and Audit Policy | A.5.35, A.5.36, A.5.37, 9.2 |

## Dependencies

| Dependency | Issue | Status |
|-----------|-------|--------|
| ISMS Owner appointment (enables policy sign-off) | [RBR-20](/RBR/issues/RBR-20) | Blocked |
| SoA and risk treatment approval | [RBR-17](/RBR/issues/RBR-17) | Blocked |
| Cert body selection (targets Stage 1 timeline) | [RBR-21](/RBR/issues/RBR-21) | Blocked |