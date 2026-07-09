# Incident Management Policy

**Document ID:** AIS-ISMS-POL-004
**Version:** 1.0
**Effective Date:** [Pending ISMS Owner approval]
**Review Cycle:** Annual
**Classification:** Internal

## 1. Purpose

This policy defines the framework for planning, detecting, assessing, responding to, and learning from information security incidents to minimize impact and prevent recurrence.

## 2. Scope

This policy applies to all information security events and incidents affecting Rambur information assets, regardless of cause (malicious, accidental, environmental). It covers all personnel, systems, networks, and third-party services.

## 3. Definitions

| Term | Definition |
|------|-----------|
| **Security Event** | An observed occurrence in a system, service, or network indicating a possible breach of security policy |
| **Security Incident** | A security event that has been assessed as having actual or potential adverse impact on confidentiality, integrity, or availability |
| **Major Incident** | An incident causing significant business disruption, data breach, or regulatory notification obligation |

## 4. Policy Statements

### 4.1 Incident Management Planning (A.5.24)

- An incident response plan (IRP) shall be maintained and tested at least annually
- The IRP shall define: incident classification criteria, escalation paths, communication templates, containment procedures, evidence handling, and recovery steps
- Roles and responsibilities for incident response shall be documented
- Contact lists for internal teams, authorities, and critical suppliers shall be maintained and tested
- Incident response tools and communication channels shall be identified and available

### 4.2 Event Detection and Reporting (A.5.25, A.6.8)

- All personnel shall report suspected or observed security events immediately through designated channels
- Reporting channels shall be published and accessible to all personnel
- Anonymous reporting shall be available and protected from retaliation
- Automated monitoring and alerting shall be configured for critical systems
- Events shall be triaged within 4 hours of detection during business hours

### 4.3 Incident Assessment and Classification (A.5.25)

Incidents shall be classified by severity:

| Severity | Criteria | Response Time | Escalation |
|----------|----------|--------------|------------|
| Critical | Confirmed data breach, system compromise, regulatory notification required | Immediate (1 hour) | CISO, ISMS Owner, Legal |
| High | Potential data exposure, service compromise, malware outbreak | 4 hours | CISO, Engineering Lead |
| Medium | Policy violation, suspicious activity, single-user compromise | 24 hours | Engineering Lead |
| Low | Minor policy deviation, informational event | 5 business days | Team lead |

### 4.4 Incident Response (A.5.26)

Response shall follow a structured process:

1. **Containment:** Isolate affected systems, revoke compromised credentials, block malicious traffic
2. **Investigation:** Determine root cause, scope, impact, and timeline
3. **Remediation:** Remove threat, patch vulnerability, restore from clean backup
4. **Recovery:** Return systems to normal operation with verified integrity
5. **Closure:** Document incident in the incident register

All response actions shall be logged with timestamps and actor identification.

### 4.5 Evidence Collection (A.5.28)

- Evidence shall be collected, preserved, and handled in a forensically sound manner
- Chain of custody shall be documented for all evidence
- Evidence collection shall follow documented procedures to ensure admissibility
- Digital evidence shall be hashed and stored with integrity verification
- Evidence retention period: minimum 3 years or as required by law

### 4.6 Post-Incident Review (A.5.27)

- A post-incident review shall be conducted within 10 business days of incident closure
- Review shall identify: root cause, control failures, response effectiveness, and lessons learned
- Corrective actions shall be tracked with owners and target dates
- Results shall inform policy updates, control improvements, and training

### 4.7 External Communication (A.5.5, A.5.25)

- Regulatory notifications shall be made within legally required timeframes
- Customer and stakeholder communication shall be coordinated by ISMS Owner and CISO
- Law enforcement engagement shall follow documented procedures
- All external communications shall be approved by ISMS Owner or CISO

## 5. Responsibilities

| Role | Responsibility |
|------|---------------|
| ISMS Owner | Major incident decision authority, external communication approval |
| CISO | Incident response coordination, severity classification |
| SecOps Agent | Detection, containment, investigation, evidence handling |
| Engineering Lead | Technical remediation, system recovery |
| All Personnel | Event reporting, cooperation with investigation |

## 6. Mapped Controls

| Control | Description | Policy Section |
|---------|-------------|---------------|
| A.5.24 | Incident management planning and preparation | 4.1 |
| A.5.25 | Assessment and decision on security events | 4.2, 4.3, 4.7 |
| A.5.26 | Response to information security incidents | 4.4 |
| A.5.27 | Learning from information security incidents | 4.6 |
| A.5.28 | Collection of evidence | 4.5 |
| A.5.5 | Contact with authorities | 4.7 |
| A.6.8 | Information security event reporting | 4.2 |

## 7. Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jul 2026 | Compliance Agent (RBR-27) | Initial draft for ISO 27001:2022 certification |

## 8. Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| ISMS Owner | [Pending RBR-20] | _______________ | ________ |
| CISO | [CISO] | _______________ | ________ |

*Approval pending ISMS Owner appointment per [RBR-20](/RBR/issues/RBR-20).*