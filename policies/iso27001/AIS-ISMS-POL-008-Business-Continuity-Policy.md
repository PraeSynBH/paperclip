# Business Continuity Policy

**Document ID:** AIS-ISMS-POL-008
**Version:** 1.0
**Effective Date:** [Pending ISMS Owner approval]
**Review Cycle:** Annual or upon significant business change
**Classification:** Internal

## 1. Purpose

This policy establishes the framework for maintaining information security during disruptions and ensuring ICT readiness for business continuity.

## 2. Scope

This policy applies to all information systems, services, and processes critical to Rambur's business operations. It covers disruptions of any cause including cyber incidents, infrastructure failures, natural disasters, and supplier failures.

## 3. Definitions

| Term | Definition |
|------|-----------|
| **Business Continuity (BC)** | Capability to continue delivery of products/services at acceptable predefined levels following disruption |
| **ICT Readiness** | State of ICT systems and services to support business continuity objectives |
| **Recovery Time Objective (RTO)** | Maximum acceptable time to restore a service after disruption |
| **Recovery Point Objective (RPO)** | Maximum acceptable data loss measured in time |
| **Maximum Tolerable Period of Disruption (MTPD)** | Maximum time a service can be unavailable before causing unacceptable impact |

## 4. Policy Statements

### 4.1 Business Continuity Planning (A.5.29)

- Rambur shall develop, implement, and maintain business continuity plans (BCP) for critical services
- Business impact analysis (BIA) shall be conducted to identify critical services, dependencies, RTOs, RPOs, and MTPDs
- BCP shall address: incident response, crisis management, operational continuity, ICT recovery, and communications
- BCP shall be reviewed and updated at least annually or after significant changes

### 4.2 Information Security During Disruption (A.5.29)

- Security controls shall continue to operate or have documented compensating controls during disruption events
- During recovery operations, security controls shall not be bypassed or weakened without documented risk acceptance
- Emergency access procedures shall be documented for scenarios where normal access controls are unavailable
- Confidentiality and integrity of data shall be maintained throughout disruption and recovery

### 4.3 ICT Readiness (A.5.30)

- ICT continuity plans shall be developed for all critical systems
- ICT continuity requirements shall be derived from BIA results
- Each critical system shall have documented:
  - RTO and RPO
  - Backup strategy and frequency
  - Recovery procedures and dependencies
  - Failover and redundancy architecture
- Backup integrity shall be verified at least monthly
- Recovery procedures shall be tested at least annually

### 4.4 Testing and Exercising (A.5.29, A.5.30)

- BCP and ICT recovery plans shall be tested at least annually
- Test types shall rotate between: tabletop exercises, simulation/walkthrough, technical recovery tests, and full-scale exercises
- Test results shall be documented, reviewed, and used to improve plans
- Testing shall include scenarios for: critical system failure, data center/cloud region loss, ransomware, and key personnel unavailability

### 4.5 Backup and Recovery (A.5.30, A.8.13)

- All critical systems and data shall have documented backup configurations
- Backup frequency shall meet defined RPOs
- Backups shall be stored in a physically or logically separate location from primary systems
- Backups shall be protected from unauthorized access, modification, and deletion
- Backup restoration shall be tested at least quarterly
- Immutable or air-gapped backups shall be maintained for ransomware protection

### 4.6 Redundancy and Resilience (A.5.29, A.5.30)

- Critical systems shall be designed with appropriate redundancy to meet RTO targets
- Single points of failure shall be identified and mitigated
- Cloud services shall be configured for high availability across availability zones where RTO requires it
- Supplier dependencies affecting continuity shall be assessed and documented

### 4.7 Crisis Communication (A.5.29)

- A crisis communication plan shall be maintained
- Communication templates shall be prepared for: internal notification, customer notification, regulatory notification, and media response
- Communication roles and authorities shall be defined
- Communication channels shall be tested during BCP exercises

### 4.8 Post-Disruption Review (A.5.27)

- A post-disruption review shall be conducted within 15 business days of any invocation of BCP
- Review shall identify: effectiveness of response, gaps in planning, lessons learned, and corrective actions
- Findings shall be tracked to closure with owners and dates

## 5. Responsibilities

| Role | Responsibility |
|------|---------------|
| ISMS Owner | BCP approval, crisis communication authority |
| CISO | BCP oversight, security during disruption |
| Engineering Lead | ICT continuity plans, backup verification, recovery testing |
| All Personnel | Familiarity with BCP, participation in exercises |

## 6. Mapped Controls

| Control | Description | Policy Section |
|---------|-------------|---------------|
| A.5.29 | Information security during disruption | 4.1, 4.2, 4.4, 4.6, 4.7 |
| A.5.30 | ICT readiness for business continuity | 4.3, 4.4, 4.5, 4.6 |
| A.8.13 | Information backup | 4.5 |
| A.5.27 | Learning from incidents (applied to disruptions) | 4.8 |

## 7. Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jul 2026 | Compliance Agent (RBR-27) | Initial draft for ISO 27001:2022 certification |

## 8. Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| ISMS Owner | [Pending RBR-20] | _______________ | ________ |

*Approval pending ISMS Owner appointment per [RBR-20](/RBR/issues/RBR-20).*