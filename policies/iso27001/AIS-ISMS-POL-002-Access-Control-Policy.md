# Access Control Policy

**Document ID:** AIS-ISMS-POL-002
**Version:** 1.0
**Effective Date:** [Pending ISMS Owner approval]
**Review Cycle:** Annual
**Classification:** Internal

## 1. Purpose

This policy defines the rules for controlling physical and logical access to Rambur information assets, governing identity lifecycle, authentication mechanisms, and access right management.

## 2. Scope

This policy applies to all personnel, contractors, and third parties who access Rambur systems, applications, networks, or data. It covers all environments (production, development, testing) and all hosting models (cloud, on-premise, remote).

## 3. Policy Statements

### 3.1 Access Control Principles (A.5.15)

- Access to information assets shall be based on business requirements and the principle of least privilege
- Access shall be granted only after formal authorization
- Access shall be reviewed at planned intervals (quarterly for privileged access, semi-annually for standard access) and upon role change
- Default access shall be "deny all" — access is granted explicitly
- Segregation of duties shall be enforced in access control design

### 3.2 Identity Management (A.5.16)

- All identities (human and non-human) shall be uniquely identifiable
- Identity lifecycle shall be managed from provisioning through deprovisioning:
  - **Provisioning:** Access granted only after manager approval and identity verification
  - **Modification:** Access modified within 24 hours of role change notification
  - **Deprovisioning:** Access revoked within 24 hours of termination (immediately for critical roles)
- Service accounts and API keys shall be inventoried, have defined ownership, and be reviewed quarterly
- Shared accounts are prohibited except where technically unavoidable, in which case compensating controls (audit trail, password rotation) are required

### 3.3 Authentication (A.5.17)

- Multi-factor authentication (MFA) shall be enforced for:
  - All remote access to Rambur systems
  - Administrative and privileged accounts
  - Access to sensitive or regulated data
- Password requirements:
  - Minimum 12 characters for user accounts
  - Minimum 16 characters for service accounts
  - Complexity: at least one uppercase, one lowercase, one digit, one special character
  - Maximum age: 90 days for user accounts, 60 days for privileged accounts
  - History: prevent reuse of last 12 passwords
  - Accounts shall lock after 5 failed attempts within 15 minutes
- Authentication tokens and secrets shall not be embedded in source code, configuration files, or documentation

### 3.4 Access Rights Management (A.5.18)

- Access rights shall be provisioned based on the principle of least privilege
- Access reviews shall be conducted:
  - **Privileged access:** Quarterly by system owner and manager
  - **Standard access:** Semi-annually by manager
  - **Service accounts:** Quarterly by account owner
- Access review results shall be documented and retained for audit
- Access modifications and removals shall be implemented within:
  - 24 hours for standard account changes
  - 4 hours for privileged account revocation after termination
  - Immediately for emergency/security-triggered revocations

### 3.5 Privileged Access Management (A.5.15, A.5.18)

- A privileged access inventory shall be maintained
- Privileged accounts shall use dedicated accounts separate from daily-use accounts
- Privileged session activity shall be logged and monitored
- Just-in-time (JIT) access shall be used where technically feasible
- Privileged access shall require documented business justification

### 3.6 Remote Access (A.5.15, A.6.7)

- Remote access shall require MFA
- Remote connections shall use encrypted channels (VPN or equivalent)
- Remote access shall be logged and monitored
- Remote access to production systems shall require prior approval

## 4. Responsibilities

| Role | Responsibility |
|------|---------------|
| ISMS Owner | Policy approval, exception authorization |
| System Owners | Access reviews, approval of privileged access |
| Managers | Access reviews for direct reports, role change notification |
| All Personnel | Protect credentials, report unauthorized access, comply with access procedures |

## 5. Mapped Controls

| Control | Description | Policy Section |
|---------|-------------|---------------|
| A.5.15 | Access control | 3.1, 3.5, 3.6 |
| A.5.16 | Identity management | 3.2 |
| A.5.17 | Authentication information | 3.3 |
| A.5.18 | Access rights | 3.4 |
| A.6.7 | Remote working | 3.6 |

## 6. Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jul 2026 | Compliance Agent (RBR-27) | Initial draft for ISO 27001:2022 certification |

## 7. Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| ISMS Owner | [Pending RBR-20] | _______________ | ________ |
| Engineering Lead | [Engineering Lead] | _______________ | ________ |

*Approval pending ISMS Owner appointment per [RBR-20](/RBR/issues/RBR-20).*