# ISO 27001 Information Security Awareness & Training Programme

## Programme Overview

| Field | Value |
|-------|-------|
| Programme Name | Aira ISMS Awareness & Training Programme |
| ISO Control | A.6.3 — Information security awareness, education, and training |
| Supporting Control | A.5.4 — Management responsibilities (personnel awareness) |
| Scope | All Arrowhead project personnel |
| Owner | Security Awareness & Training Agent (CISO org) |
| Version | 1.0 |
| Last Updated | 2026-07-09 |
| Review Cycle | Annual |

## Programme Objectives

1. Ensure all personnel understand the Information Security Management System (ISMS) and their role within it.
2. Deliver role-appropriate security awareness training covering ISO 27001:2022 requirements.
3. Measure training effectiveness through assessments and track trends over time.
4. Maintain auditable training completion records.
5. Provide a structured onboarding path for new hires.
6. Deliver annual refresher training with updated threat context.

## Target Audience Segments

| Segment | Roles | Training Depth |
|---------|-------|----------------|
| All Personnel | Everyone with access to Aira systems or information | Foundation |
| Management | Team leads, managers, executives | Foundation + Management Responsibilities |
| Technical Staff | Developers, engineers, DevOps | Foundation + Technical Controls |
| ISMS Personnel | CISO, Compliance, Security team | Full depth |

## Programme Structure

```
Phase 1: Initial Rollout (July 2026)
  ├── Module 1: ISO 27001 Fundamentals & ISMS Overview
  ├── Module 2: Aira ISMS Policies & Acceptable Use
  ├── Module 3: Role-Based Security Responsibilities
  └── Effectiveness Assessment 1 (Post-Training Quiz)

Phase 2: Onboarding (Ongoing)
  └── New-Hire Onboarding Module (assigned within first week)

Phase 3: Reinforcement (Ongoing)
  ├── Monthly micro-learning (5-min refreshes)
  └── Quarterly phishing simulation (if in scope)

Phase 4: Annual Refresher (July 2027)
  ├── Updated threat landscape briefing
  ├── Policy update review
  ├── Lessons learned from incidents
  └── Effectiveness Assessment 2
```

## Success Metrics

| Metric | Baseline | Target (Y1) | Measurement |
|--------|----------|-------------|-------------|
| Training Completion Rate | 0% (new) | 100% within 30 days | Attendance records |
| Assessment Pass Rate | N/A | >= 80% first attempt | Quiz score >= 70% |
| Policy Acknowledgment | 0% (new) | 100% | Signed acknowledgments |
| Refresher Completion | N/A | >= 95% annual | Annual records |
| New-Hire Onboarding Rate | N/A | 100% within week 1 | Onboarding tracker |

## Audit Evidence

This programme generates the following auditable records:

- Training attendance logs (`training/records/attendance.csv`)
- Individual completion certificates (per module)
- Assessment scores and trends (`training/assessments/`)
- Policy acknowledgment records
- Annual refresher completion records
- Programme review and update history

## References

- ISO/IEC 27001:2022 Annex A Control A.6.3
- ISO/IEC 27001:2022 Annex A Control A.5.4
- [RBR-17 — Compliance: Define ISO 27001 certification path](/RBR/issues/RBR-17)
- Aira ISMS Policy Framework (see `docs/`)

## Revision History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-07-09 | 1.0 | Awareness Agent | Initial programme created |