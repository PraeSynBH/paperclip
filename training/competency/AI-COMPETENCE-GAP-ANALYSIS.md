# AI Competence Gap Analysis — ISO 42001 A.7.3

**Document**: AI Competence Gap Analysis Report
**Version**: 1.0 — Baseline Framework
**Date**: 2026-07-09
**Author**: Awareness Agent
**Source**: [RBR-149](/RBR/issues/RBR-149) AI Role Competency Matrix
**Issue**: [RBR-187](/RBR/issues/RBR-187)

---

## 1. Executive Summary

This gap analysis framework evaluates AI competence across 14 roles, 10 competency domains, and 3 proficiency levels as defined in the RBR-149 AI Role Competency Matrix. It maps required proficiency levels per role, identifies the training modules that close each gap, and provides a per-person gap template for use once baseline self-assessments are collected.

**Current status**: Framework delivered. Phases 1 (personnel-to-role mapping by CISO + HR) and 2 (self-assessments by role-holders) are prerequisites for per-person gap analysis. This document enables immediate gap analysis once those inputs are available.

**Key finding**: No baseline assessments exist. The framework is ready but cannot produce per-person gaps until CISO completes Phase 1 and role-holders complete Phase 2 self-assessments.

---

## 2. Role-Competency-Proficiency Matrix

### 2.1 Proficiency Level Definitions

| Level | Code | Definition | Training Implication |
|-------|------|-----------|---------------------|
| Awareness | L1 | Knows core concepts; can identify AI issues in their domain; can follow AI policies | Foundation training (AI-101 to AI-103) |
| Practitioner | L2 | Can apply AI knowledge in daily work; can operate AI systems; can contribute to AI governance | Intermediate training + hands-on labs |
| Expert | L3 | Can design AI systems/governance; can lead AI initiatives; can teach/mentor others | Advanced training + certification |

### 2.2 Competency Domains

| ID | Domain | ISO 42001 Reference | Description |
|----|--------|---------------------|-------------|
| D1 | AI Fundamentals & Terminology | A.7.3 | Core AI/ML concepts, model types, training/inference, LLM architecture |
| D2 | AI Ethics & Responsible AI | A.5.3, A.7.2 | Bias, fairness, transparency, explainability, human oversight |
| D3 | AI Governance & Compliance | A.4, A.5, A.7.3 | ISO 42001 framework, AI policies, regulatory landscape, audit readiness |
| D4 | AI Risk Management | A.6.1, A.6.2 | AI risk assessment, risk treatment, residual risk, third-party AI risk |
| D5 | Data Quality & Management for AI | A.7.4, A.8.2 | Training data quality, data provenance, data classification, PII in AI |
| D6 | AI/ML Technical Skills | A.8.1, A.8.3 | Model development, training pipelines, evaluation, deployment |
| D7 | AI Security & Adversarial Threats | A.8.25, A.8.26 | Prompt injection, model inversion, data poisoning, adversarial examples |
| D8 | AI Operations (MLOps, Monitoring) | A.8.1, A.8.6 | Model deployment, monitoring, drift detection, incident response |
| D9 | AI Procurement & Vendor Management | A.5.19-A.5.22 | Third-party AI assessment, vendor AI policies, contract review |
| D10 | AI Impact Assessment | A.6.2, A.6.3 | AI system impact analysis, stakeholder consultation, documentation |

### 2.3 Role Categories

| Category | Roles |
|----------|-------|
| **Governance** (5) | AI System Owner, AI Governance Lead, AI Ethics Officer, Compliance Officer, Procurement/Vendor Manager |
| **Technical** (6) | AI/ML Engineer, Data Scientist, MLOps Engineer, Data Engineer, AI Security Specialist, AI QA/Tester |
| **Operational** (3) | Business Stakeholder, AI User, HR/People Partner |

### 2.4 Required Proficiency per Role per Domain

Each cell shows the **minimum** required proficiency level for that role in that domain.
`—` = No requirement (out of scope for this role).

| Role | D1 | D2 | D3 | D4 | D5 | D6 | D7 | D8 | D9 | D10 |
|------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:---:|
| **Governance** |
| AI System Owner | L2 | L2 | L3 | L3 | L1 | L1 | L2 | L2 | L2 | L3 |
| AI Governance Lead | L2 | L3 | L3 | L3 | L1 | L1 | L2 | L1 | L2 | L2 |
| AI Ethics Officer | L2 | L3 | L2 | L2 | L1 | — | L1 | — | L1 | L2 |
| Compliance Officer | L1 | L2 | L3 | L2 | L1 | — | L1 | — | L2 | L2 |
| Procurement/Vendor Mgr | L1 | L1 | L2 | L2 | L1 | — | L1 | — | L3 | L2 |
| **Technical** |
| AI/ML Engineer | L3 | L2 | L1 | L1 | L3 | L3 | L2 | L3 | — | L1 |
| Data Scientist | L3 | L2 | L1 | L1 | L3 | L3 | L1 | L2 | — | L1 |
| MLOps Engineer | L2 | L1 | L1 | L1 | L2 | L2 | L2 | L3 | — | L1 |
| Data Engineer | L2 | L1 | L1 | L1 | L3 | L2 | L1 | L1 | — | — |
| AI Security Specialist | L2 | L2 | L2 | L2 | L2 | L2 | L3 | L2 | L1 | L1 |
| AI QA/Tester | L2 | L2 | L1 | L1 | L2 | L2 | L2 | L1 | — | L1 |
| **Operational** |
| Business Stakeholder | L1 | L1 | L1 | L1 | — | — | — | — | L1 | L1 |
| AI User | L1 | L1 | — | — | — | — | — | — | — | — |
| HR/People Partner | L1 | L1 | L1 | L1 | — | — | — | — | L1 | L1 |

---

## 3. Training Module Mapping

### 3.1 Module Catalog

| Module | Title | Target Domain | Target Level | Duration | Format |
|--------|-------|---------------|--------------|----------|--------|
| AI-101 | AI Fundamentals | D1 | L1→L2 | 2h | Self-paced + assessment |
| AI-102 | AI Ethics & Responsible AI | D2 | L1→L2 | 2h | Self-paced + case studies |
| AI-103 | AI Governance (ISO 42001) | D3 | L1→L2 | 3h | Self-paced + policy review |
| AI-104 | AI Risk Management | D4 | L1→L2 | 2h | Self-paced + risk exercise |
| AI-105 | Data Management for AI | D5 | L1→L2 | 2h | Self-paced + hands-on lab |
| AI-106 | AI/ML Technical Foundations | D6 | L2→L3 | 4h | Instructor-led + project |
| AI-107 | AI Security | D7 | L1→L2 | 3h | Self-paced + threat labs |
| AI-108 | MLOps & AI Operations | D8 | L1→L2 | 3h | Self-paced + pipeline lab |
| AI-109 | AI Procurement & Vendor Risk | D9 | L1→L2 | 2h | Self-paced + assessment template |
| AI-110 | AI Impact Assessment | D10 | L1→L2 | 2h | Self-paced + impact exercise |
| AI-111 | AI for Business Leaders | D3,D4 | L1→L2 | 2h | Executive briefing + workshop |

### 3.2 Domain-to-Module Gap Closure Map

For each domain, which training modules close gaps at each level transition:

| Domain | L0→L1 (Awareness) | L1→L2 (Practitioner) | L2→L3 (Expert) |
|--------|-------------------|----------------------|-----------------|
| D1 — AI Fundamentals | AI-101 | AI-101 + AI-106 | AI-106 + certification |
| D2 — AI Ethics | AI-102 | AI-102 + case studies | AI-102 + ethics board participation |
| D3 — AI Governance | AI-103 | AI-103 + AI-111 | AI-103 + ISO 42001 Lead Implementer |
| D4 — AI Risk Mgmt | AI-104 | AI-104 + risk exercise | AI-104 + risk program leadership |
| D5 — Data Mgmt for AI | AI-105 | AI-105 + lab | AI-105 + data governance certification |
| D6 — AI/ML Technical | AI-101 | AI-106 | AI-106 + project + certification |
| D7 — AI Security | AI-107 | AI-107 + threat labs | AI-107 + red team exercise |
| D8 — MLOps/AI Ops | AI-108 | AI-108 + pipeline lab | AI-108 + production ownership |
| D9 — AI Procurement | AI-109 | AI-109 + assessment | AI-109 + vendor program leadership |
| D10 — AI Impact Assess. | AI-110 | AI-110 + impact exercise | AI-110 + assessment leadership |

---

## 4. Per-Role Gap Summary

For each role, the required proficiency level per domain and the training modules needed to close gaps from L0 (no competence):

### 4.1 Governance Roles

#### AI System Owner (most demanding governance role)
| Domain | Required | Gap from L0 | Training to Close |
|--------|----------|-------------|-------------------|
| D1 | L2 | L0→L1→L2 | AI-101, AI-106 |
| D2 | L2 | L0→L1→L2 | AI-102 + case studies |
| D3 | L3 | L0→L1→L2→L3 | AI-103 + Lead Implementer |
| D4 | L3 | L0→L1→L2→L3 | AI-104 + risk program leadership |
| D5 | L1 | L0→L1 | AI-105 |
| D6 | L1 | L0→L1 | AI-101 |
| D7 | L2 | L0→L1→L2 | AI-107 + threat labs |
| D8 | L2 | L0→L1→L2 | AI-108 + pipeline lab |
| D9 | L2 | L0→L1→L2 | AI-109 + assessment |
| D10 | L3 | L0→L1→L2→L3 | AI-110 + assessment leadership |

**Priority modules**: AI-101, AI-102, AI-103, AI-104, AI-110 (11 modules total)
**Estimated training time**: 26h + certifications

#### AI Governance Lead
| Domain | Required | Gap from L0 | Training to Close |
|--------|----------|-------------|-------------------|
| D1 | L2 | L0→L1→L2 | AI-101, AI-106 |
| D2 | L3 | L0→L1→L2→L3 | AI-102 + ethics board |
| D3 | L3 | L0→L1→L2→L3 | AI-103 + Lead Implementer |
| D4 | L3 | L0→L1→L2→L3 | AI-104 + risk leadership |
| D5 | L1 | L0→L1 | AI-105 |
| D6 | L1 | L0→L1 | AI-101 |
| D7 | L2 | L0→L1→L2 | AI-107 + threat labs |
| D8 | L1 | L0→L1 | AI-108 |
| D9 | L2 | L0→L1→L2 | AI-109 + assessment |
| D10 | L2 | L0→L1→L2 | AI-110 + impact exercise |

**Priority modules**: AI-101, AI-102, AI-103, AI-104 (10 modules total)
**Estimated training time**: 23h + certifications

#### AI Ethics Officer
| Domain | Required | Gap from L0 | Training to Close |
|--------|----------|-------------|-------------------|
| D1 | L2 | L0→L1→L2 | AI-101, AI-106 |
| D2 | L3 | L0→L1→L2→L3 | AI-102 + ethics board |
| D3 | L2 | L0→L1→L2 | AI-103 + AI-111 |
| D4 | L2 | L0→L1→L2 | AI-104 + risk exercise |
| D5 | L1 | L0→L1 | AI-105 |
| D7 | L1 | L0→L1 | AI-107 |
| D9 | L1 | L0→L1 | AI-109 |
| D10 | L2 | L0→L1→L2 | AI-110 + impact exercise |

**Priority modules**: AI-101, AI-102 (8 modules)
**Estimated training time**: 17h

#### Compliance Officer
| Domain | Required | Gap from L0 | Training to Close |
|--------|----------|-------------|-------------------|
| D1 | L1 | L0→L1 | AI-101 |
| D2 | L2 | L0→L1→L2 | AI-102 + case studies |
| D3 | L3 | L0→L1→L2→L3 | AI-103 + Lead Implementer |
| D4 | L2 | L0→L1→L2 | AI-104 + risk exercise |
| D5 | L1 | L0→L1 | AI-105 |
| D7 | L1 | L0→L1 | AI-107 |
| D9 | L2 | L0→L1→L2 | AI-109 + assessment |
| D10 | L2 | L0→L1→L2 | AI-110 + impact exercise |

**Priority modules**: AI-101, AI-103 (8 modules)
**Estimated training time**: 16h + Lead Implementer

#### Procurement/Vendor Manager
| Domain | Required | Gap from L0 | Training to Close |
|--------|----------|-------------|-------------------|
| D1 | L1 | L0→L1 | AI-101 |
| D2 | L1 | L0→L1 | AI-102 |
| D3 | L2 | L0→L1→L2 | AI-103 + AI-111 |
| D4 | L2 | L0→L1→L2 | AI-104 + risk exercise |
| D5 | L1 | L0→L1 | AI-105 |
| D7 | L1 | L0→L1 | AI-107 |
| D9 | L3 | L0→L1→L2→L3 | AI-109 + vendor program lead |
| D10 | L2 | L0→L1→L2 | AI-110 + impact exercise |

**Priority modules**: AI-101, AI-109 (8 modules)
**Estimated training time**: 16h

### 4.2 Technical Roles

#### AI/ML Engineer
| Domain | Required | Gap from L0 | Training to Close |
|--------|----------|-------------|-------------------|
| D1 | L3 | L0→L1→L2→L3 | AI-101 + AI-106 + certification |
| D2 | L2 | L0→L1→L2 | AI-102 + case studies |
| D3 | L1 | L0→L1 | AI-103 |
| D4 | L1 | L0→L1 | AI-104 |
| D5 | L3 | L0→L1→L2→L3 | AI-105 + data governance cert |
| D6 | L3 | L0→L1→L2→L3 | AI-106 + project + certification |
| D7 | L2 | L0→L1→L2 | AI-107 + threat labs |
| D8 | L3 | L0→L1→L2→L3 | AI-108 + production ownership |
| D10 | L1 | L0→L1 | AI-110 |

**Priority modules**: AI-101, AI-106 (9 modules)
**Estimated training time**: 21h + certifications

#### Data Scientist
| Domain | Required | Gap from L0 | Training to Close |
|--------|----------|-------------|-------------------|
| D1 | L3 | L0→L1→L2→L3 | AI-101 + AI-106 + certification |
| D2 | L2 | L0→L1→L2 | AI-102 + case studies |
| D3 | L1 | L0→L1 | AI-103 |
| D4 | L1 | L0→L1 | AI-104 |
| D5 | L3 | L0→L1→L2→L3 | AI-105 + data governance cert |
| D6 | L3 | L0→L1→L2→L3 | AI-106 + project + certification |
| D7 | L1 | L0→L1 | AI-107 |
| D8 | L2 | L0→L1→L2 | AI-108 + pipeline lab |
| D10 | L1 | L0→L1 | AI-110 |

**Priority modules**: AI-101, AI-106, AI-105 (9 modules)
**Estimated training time**: 21h + certifications

#### MLOps Engineer
| Domain | Required | Gap from L0 | Training to Close |
|--------|----------|-------------|-------------------|
| D1 | L2 | L0→L1→L2 | AI-101, AI-106 |
| D2 | L1 | L0→L1 | AI-102 |
| D3 | L1 | L0→L1 | AI-103 |
| D4 | L1 | L0→L1 | AI-104 |
| D5 | L2 | L0→L1→L2 | AI-105 + lab |
| D6 | L2 | L0→L1→L2 | AI-106 |
| D7 | L2 | L0→L1→L2 | AI-107 + threat labs |
| D8 | L3 | L0→L1→L2→L3 | AI-108 + production ownership |
| D10 | L1 | L0→L1 | AI-110 |

**Priority modules**: AI-101, AI-108 (9 modules)
**Estimated training time**: 19h + certifications

#### Data Engineer
| Domain | Required | Gap from L0 | Training to Close |
|--------|----------|-------------|-------------------|
| D1 | L2 | L0→L1→L2 | AI-101, AI-106 |
| D2 | L1 | L0→L1 | AI-102 |
| D3 | L1 | L0→L1 | AI-103 |
| D4 | L1 | L0→L1 | AI-104 |
| D5 | L3 | L0→L1→L2→L3 | AI-105 + data governance cert |
| D6 | L2 | L0→L1→L2 | AI-106 |
| D7 | L1 | L0→L1 | AI-107 |
| D8 | L1 | L0→L1 | AI-108 |

**Priority modules**: AI-101, AI-105 (8 modules)
**Estimated training time**: 17h + certifications

#### AI Security Specialist
| Domain | Required | Gap from L0 | Training to Close |
|--------|----------|-------------|-------------------|
| D1 | L2 | L0→L1→L2 | AI-101, AI-106 |
| D2 | L2 | L0→L1→L2 | AI-102 + case studies |
| D3 | L2 | L0→L1→L2 | AI-103 + AI-111 |
| D4 | L2 | L0→L1→L2 | AI-104 + risk exercise |
| D5 | L2 | L0→L1→L2 | AI-105 + lab |
| D6 | L2 | L0→L1→L2 | AI-106 |
| D7 | L3 | L0→L1→L2→L3 | AI-107 + red team exercise |
| D8 | L2 | L0→L1→L2 | AI-108 + pipeline lab |
| D9 | L1 | L0→L1 | AI-109 |
| D10 | L1 | L0→L1 | AI-110 |

**Priority modules**: AI-107, AI-101 (10 modules)
**Estimated training time**: 22h + red team exercise

#### AI QA/Tester
| Domain | Required | Gap from L0 | Training to Close |
|--------|----------|-------------|-------------------|
| D1 | L2 | L0→L1→L2 | AI-101, AI-106 |
| D2 | L2 | L0→L1→L2 | AI-102 + case studies |
| D3 | L1 | L0→L1 | AI-103 |
| D4 | L1 | L0→L1 | AI-104 |
| D5 | L2 | L0→L1→L2 | AI-105 + lab |
| D6 | L2 | L0→L1→L2 | AI-106 |
| D7 | L2 | L0→L1→L2 | AI-107 + threat labs |
| D8 | L1 | L0→L1 | AI-108 |
| D10 | L1 | L0→L1 | AI-110 |

**Priority modules**: AI-101, AI-102, AI-107 (9 modules)
**Estimated training time**: 19h

### 4.3 Operational Roles

#### Business Stakeholder
| Domain | Required | Gap from L0 | Training to Close |
|--------|----------|-------------|-------------------|
| D1 | L1 | L0→L1 | AI-101 |
| D2 | L1 | L0→L1 | AI-102 |
| D3 | L1 | L0→L1 | AI-103 |
| D4 | L1 | L0→L1 | AI-104 |
| D9 | L1 | L0→L1 | AI-109 |
| D10 | L1 | L0→L1 | AI-110 |

**Priority modules**: AI-101, AI-103 (6 modules)
**Estimated training time**: 12h

#### AI User
| Domain | Required | Gap from L0 | Training to Close |
|--------|----------|-------------|-------------------|
| D1 | L1 | L0→L1 | AI-101 |
| D2 | L1 | L0→L1 | AI-102 |

**Priority modules**: AI-101, AI-102 (2 modules)
**Estimated training time**: 4h

#### HR/People Partner
| Domain | Required | Gap from L0 | Training to Close |
|--------|----------|-------------|-------------------|
| D1 | L1 | L0→L1 | AI-101 |
| D2 | L1 | L0→L1 | AI-102 |
| D3 | L1 | L0→L1 | AI-103 |
| D4 | L1 | L0→L1 | AI-104 |
| D9 | L1 | L0→L1 | AI-109 |
| D10 | L1 | L0→L1 | AI-110 |

**Priority modules**: AI-101, AI-102 (6 modules)
**Estimated training time**: 12h

---

## 5. Aggregate Gap Summary (L0 baseline)

| Category | Roles | Total Module Assignments | Estimated Hours | Priority Modules |
|----------|-------|-------------------------|-----------------|------------------|
| Governance | 5 | 44 | 98h + certifications | AI-101, AI-103, AI-104 |
| Technical | 6 | 54 | 119h + certifications | AI-101, AI-106, AI-107 |
| Operational | 3 | 14 | 28h | AI-101, AI-102 |
| **Total** | **14** | **112** | **245h** | |

### Module Demand (how many roles need each module, L0 baseline)

| Module | Roles Needing It | Priority |
|--------|:-----------------:|----------|
| AI-101 (AI Fundamentals) | 14 | **Critical** — every role |
| AI-102 (AI Ethics) | 13 | **Critical** — all except AI User have some req |
| AI-103 (AI Governance) | 12 | **Critical** |
| AI-104 (AI Risk Mgmt) | 12 | **Critical** |
| AI-105 (Data Mgmt for AI) | 10 | High |
| AI-106 (AI/ML Technical) | 8 | High (Technical + Governance L2) |
| AI-107 (AI Security) | 11 | High |
| AI-108 (MLOps/AI Ops) | 8 | Medium |
| AI-109 (AI Procurement) | 8 | Medium |
| AI-110 (AI Impact Assess.) | 11 | High |
| AI-111 (AI for Biz Leaders) | 4 | Medium |

---

## 6. Per-Person Gap Analysis Template

Use this template for each person once Phase 1 (role assignment) and Phase 2 (self-assessment) are complete.

### Template

```
## Person: <Name/ID>
**Role**: <Role Name>
**Category**: <Governance | Technical | Operational>
**Assessment Date**: <YYYY-MM-DD>
**Assessor**: <Self-assessment | Manager assessment>

### Gap Table

| Domain | Required Level | Self-Assessed | Gap | Training Module(s) | Priority |
|--------|:---:|:---:|:---:|--------------------|:--------:|
| D1 — AI Fundamentals | L2 | L1 | L1→L2 | AI-106 | High |
| D2 — AI Ethics | L2 | L0 | L0→L2 | AI-102 + case studies | Critical |
| ... | ... | ... | ... | ... | ... |

### Gap Severity

- **Critical** (L2+ gap or missing required domain): escalate to manager
- **High** (L1 gap in a required domain): schedule training within 4 weeks
- **Medium** (partial gap, e.g. L1.5 vs L2): schedule within 8 weeks
- **Low** (no gap or exceeds requirement): annual refresher only

### Training Plan

| Module | Target Date | Format | Status |
|--------|-------------|--------|--------|
| ... | ... | ... | ... |

### Verification

| Check | Date | Result |
|-------|------|--------|
| Post-training assessment | | |
| Manager sign-off | | |
| Evidence registered | | |
```

---

## 7. Prioritized Training Delivery Plan

Based on L0 baseline (Phase 3 analysis, independent of personnel):

### Phase 3A: Foundation (Week 1-3) — All roles

| Module | Audience | When |
|--------|----------|------|
| AI-101 | All 14 roles | Week 1 |
| AI-102 | 13 roles | Week 2 |
| AI-103 | 12 roles | Week 3 |

### Phase 3B: Role-Specific (Week 4-8) — By category

| Module | Primary Audience | When |
|--------|-----------------|------|
| AI-104 | Governance + Technical | Week 4 |
| AI-107 | Security Specialist + all Technical | Week 5 |
| AI-110 | Governance + QA + Operational | Week 6 |
| AI-105 | Technical + Governance (D5 reqs) | Week 7 |
| AI-108 | Engineers + MLOps | Week 8 |

### Phase 3C: Advanced (Week 9-12) — Role-specific

| Module | Primary Audience | When |
|--------|-----------------|------|
| AI-106 | ML Engineers, Data Scientists, AI Security | Week 9-10 |
| AI-109 | Procurement, Compliance, Vendor Mgmt | Week 11 |
| AI-111 | Business Stakeholders, Governance | Week 12 |

---

## 8. Implementation Prerequisites

### What Must Happen Before Per-Person Gap Analysis

| Phase | Action | Owner | Status |
|-------|--------|-------|--------|
| 1 | Map existing personnel to AI roles | CISO + HR | **Not started** |
| 2 | Baseline competence self-assessment | Role-holders | **Not started** (blocked on Phase 1) |
| 3 | Gap analysis vs. required levels | Awareness | **Framework ready** (this doc) |
| 4 | Training delivery (11 modules) | Awareness | Blocked on Phase 3 completion |
| 5 | Post-training verification | Awareness | Blocked on Phase 4 |
| 6 | Evidence registration | Awareness | Blocked on Phase 5 |
| 7 | Annual review cycle | CISO + AI Gov Lead | Scheduled |

### Blockers

- **Phase 1 (personnel mapping)**: No Rambur personnel have been assigned to AI roles. CISO must map existing agents/people to the 14 roles.
- **Phase 2 (self-assessments)**: Cannot run until Phase 1 assigns role-holders.

---

## 9. Recommendation

1. **CISO to drive Phase 1** — Map existing Rambur agents/personnel to the 14 AI roles defined in the matrix. This is the critical path.
2. **Distribute self-assessment template** — Once role assignments exist, distribute the self-assessment form (per-person gap template in §6).
3. **Run per-person gap analysis** — Populate §6 for each person. This heartbeat's framework enables that immediately.
4. **Schedule foundation modules** — AI-101/102/103 can begin even before per-person gaps are complete, since every role requires them.

---

## Appendix A: Self-Assessment Form

```
## AI Competence Self-Assessment

**Name**: _______________
**Role**: _______________
**Date**: _______________

For each domain, rate your current proficiency:

| Domain | L0 (None) | L1 (Awareness) | L2 (Practitioner) | L3 (Expert) |
|--------|:---:|:---:|:---:|:---:|
| D1 — AI Fundamentals | ☐ | ☐ | ☐ | ☐ |
| D2 — AI Ethics | ☐ | ☐ | ☐ | ☐ |
| D3 — AI Governance (ISO 42001) | ☐ | ☐ | ☐ | ☐ |
| D4 — AI Risk Management | ☐ | ☐ | ☐ | ☐ |
| D5 — Data Quality & Mgmt for AI | ☐ | ☐ | ☐ | ☐ |
| D6 — AI/ML Technical Skills | ☐ | ☐ | ☐ | ☐ |
| D7 — AI Security & Adversarial Threats | ☐ | ☐ | ☐ | ☐ |
| D8 — AI Operations (MLOps/Monitoring) | ☐ | ☐ | ☐ | ☐ |
| D9 — AI Procurement & Vendor Mgmt | ☐ | ☐ | ☐ | ☐ |
| D10 — AI Impact Assessment | ☐ | ☐ | ☐ | ☐ |

**Evidence of current competence** (certifications, projects, prior training):
_______________________________________________

**Signature**: _______________
```

---

## Appendix B: Framework Version Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-07-09 | Awareness Agent | Baseline gap analysis framework — L0 baseline for all 14 roles, 10 domains, 11 training modules |
