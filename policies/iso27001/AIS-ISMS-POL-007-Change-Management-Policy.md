# Change Management Policy

**Document ID:** AIS-ISMS-POL-007
**Version:** 1.0
**Effective Date:** [Pending ISMS Owner approval]
**Review Cycle:** Annual
**Classification:** Internal

## 1. Purpose

This policy defines the framework for managing changes to Rambur's information systems, services, and infrastructure in a controlled manner that preserves security, stability, and compliance.

## 2. Scope

This policy applies to all changes affecting production information systems, networks, applications, cloud infrastructure, security controls, and ISMS documentation. It covers both technical changes (code, configuration, infrastructure) and procedural changes (policies, processes).

## 3. Definitions

| Term | Definition |
|------|-----------|
| **Change** | Any addition, modification, or removal affecting an information system, service, or process |
| **Standard Change** | Pre-approved, low-risk, routine change with documented procedure |
| **Normal Change** | Change requiring assessment, approval, and scheduled implementation |
| **Emergency Change** | Change required to resolve a critical incident or imminent threat |
| **Change Advisory Board (CAB)** | Group responsible for reviewing and approving changes |

## 4. Policy Statements

### 4.1 Change Management Process (A.8.32)

All changes shall follow a documented change management process with these phases:

1. **Request:** Change is formally requested with description, justification, risk assessment, and rollback plan
2. **Review:** Change is reviewed for security impact, operational risk, and compliance implications
3. **Approval:** Change is approved by authorized personnel before implementation
4. **Implementation:** Change is executed per plan, with communication to affected parties
5. **Validation:** Change is verified to have achieved intended outcome without unintended effects
6. **Closure:** Change record is updated with outcomes and documented for audit

### 4.2 Change Classification

| Type | Approval Required | Lead Time | Emergency Process |
|------|------------------|-----------|-------------------|
| Standard | Pre-approved by CAB | Per procedure | N/A |
| Normal | Engineering Lead + affected system owner | 2 business days | N/A |
| Emergency | CISO or ISMS Owner (retrospective CAB review within 24h) | Immediate | Emergency process |
| ISMS Documentation | ISMS Owner | 5 business days | N/A |

### 4.3 Security Impact Assessment (A.8.32)

Every normal and emergency change shall include a security impact assessment:
- Does the change affect security controls?
- Does the change introduce new data flows or access patterns?
- Does the change modify authentication or authorization?
- Does the change involve third-party components or services?
- Does the change affect regulatory compliance?

Changes with security impact shall be reviewed by the CISO or delegate.

### 4.4 Segregation of Duties (A.8.32, A.5.3)

- The change requester shall not be the sole approver of their own change
- For production changes: development, approval, and implementation shall be performed by different individuals where feasible
- Emergency changes by a single individual require retrospective review by a second person within 24 hours

### 4.5 Testing and Rollback (A.8.32)

- All non-emergency changes shall be tested in a non-production environment before deployment
- Every change shall include a documented rollback plan
- Rollback procedures shall be verified during testing
- Failed changes shall be rolled back or remediated within the defined change window

### 4.6 Change Records (A.8.32)

- All changes shall be recorded in a change log with at minimum: unique ID, requestor, date, description, risk assessment, approvers, implementation notes, validation results, and closure status
- Change records shall be retained for a minimum of 3 years
- The change log shall be available for audit upon request

### 4.7 Supplier Changes (A.5.22, A.8.32)

- Changes made by suppliers or affecting supplier services shall follow this policy
- Suppliers shall notify Rambur of planned changes that could affect security or availability
- Supplier-initiated changes shall be reviewed for security impact before acceptance

### 4.8 Emergency Changes (A.8.32)

- Emergency changes may bypass normal approval but shall be documented and retrospectively reviewed within 24 hours
- Emergency change authority is limited to CISO, Engineering Lead, or designated incident responders
- All emergency changes shall be converted to full change records within 2 business days

## 5. Responsibilities

| Role | Responsibility |
|------|---------------|
| Engineering Lead | CAB chair, technical review, implementation oversight |
| CISO | Emergency change approval, security impact review |
| System Owners | Normal change approval for their systems |
| ISMS Owner | ISMS documentation change approval |
| All Personnel | Follow change process, do not make unauthorized changes |

## 6. Mapped Controls

| Control | Description | Policy Section |
|---------|-------------|---------------|
| A.8.32 | Change management | All sections |
| A.5.3 | Segregation of duties | 4.4 |
| A.5.22 | Supplier service change monitoring | 4.7 |

## 7. Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jul 2026 | Compliance Agent (RBR-27) | Initial draft for ISO 27001:2022 certification |

## 8. Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| ISMS Owner | [Pending RBR-20] | _______________ | ________ |
| Engineering Lead | [Engineering Lead] | _______________ | ________ |

*Approval pending ISMS Owner appointment per [RBR-20](/RBR/issues/RBR-20).*