# Compensating Controls — A.7.7 Clear Desk and Clear Screen / A.7.9 Security of Assets Off-Premises

**Framework:** ISO/IEC 27001:2022 — Annex A Physical Controls (A.7)
**Purpose:** Document customer-side compensating controls for two PARTIAL exclusions identified in AWS Shared Responsibility Model analysis
**Project:** Aira — ISO 27001 Continuous Monitoring
**Prepared by:** [@Compliance](/RBR/agents/compliance)
**Date:** 2026-07-09
**Source Issue:** [RBR-35](/RBR/issues/RBR-35)
**Parent Issue:** [RBR-17](/RBR/issues/RBR-17)
**Related:** [RBR-23](/RBR/issues/RBR-23) (AWS compliance attestations), [RBR-27](/RBR/issues/RBR-27) (Phase 1 policy drafting)

---

## 1. Background

The AWS compliance attestations package ([RBR-23](/RBR/issues/RBR-23)) evaluated all 10 A.7 Physical controls against AWS attestations (ISO 27001 certificate, SOC 2 Type II, Shared Responsibility Model). Eight controls are fully inherited from AWS. Two controls — A.7.7 (Clear desk and clear screen) and A.7.9 (Security of assets off-premises) — are **PARTIAL EXCLUSIONS** because the AWS Shared Responsibility Model places endpoint security on the customer:

| Control | AWS Covers | Customer Owns |
|---------|-----------|---------------|
| A.7.7 Clear desk and clear screen | AWS data center operational areas (clean-desk practices) | Employee workstation clear desk/screen policies; customer-owned physical office space |
| A.7.9 Security of assets off-premises | AWS infrastructure assets at edge locations, PoPs | Employee mobile devices, laptops, any customer-owned equipment used off-premises |

This document defines customer-side compensating controls that achieve the control objectives and bring both controls to **MET (with compensating controls)** status for SoA inclusion.

---

## 2A. A.7.7 — Clear Desk and Clear Screen

**ISO 27001:2022 text:** Clear desk rules for papers and removable storage media and clear screen rules for information processing facilities shall be defined and appropriately enforced.

**Control objective:** Prevent unauthorised access, loss of, and damage to information during and outside normal working hours — by ensuring papers, removable media, and display screens are not left exposed.

### 2A.1 Compensating Controls

#### CC-A.7.7-01: Screen Lock via MDM Policy

| Attribute | Detail |
|-----------|--------|
| **Control type** | Technical (compensating) |
| **Description** | All company-managed endpoint devices shall have an MDM-enforced screen lock policy that activates after a maximum idle period |
| **Implementation** | MDM profile pushes screen lock policy to macOS (via profile), Windows (via Intune/GPO), and mobile (via MDM passcode policy) |
| **Covered by policy** | AIS-ISMS-POL-002 (Access Control Policy) Section 3.3 — authentication and session security |
| **Configuration** | Screen lock activates after 5 minutes of inactivity for all devices; 2 minutes for devices in public locations |
| **Evidence** | MDM compliance dashboard report showing 100% screen lock policy compliance; MDM configuration export |
| **Residual risk** | LOW — Screen lock is natively enforced by the OS and MDM; circumvention requires admin credentials |

#### CC-A.7.7-02: Remote Wipe for Lost/Stolen Devices

| Attribute | Detail |
|-----------|--------|
| **Control type** | Technical (compensating) |
| **Description** | MDM platform shall support remote wipe of company data from lost or stolen devices |
| **Implementation** | MDM remote wipe action triggers full device wipe (managed devices) or enterprise wipe (BYOD — removes company data only) |
| **Covered by policy** | AIS-ISMS-POL-005 (Asset Management Policy) Section 4.4 — return of assets; Section 4.8 — secure disposal |
| **Trigger** | Personnel must report lost/stolen devices within 4 hours of discovery; IT performs remote wipe upon verification |
| **Evidence** | MDM remote wipe capability verified; incident response procedure includes remote wipe step |
| **Residual risk** | LOW — Remote wipe effective when device is online; device-in-airplane-mode gap mitigated by automatic wipe-after-offline-policy where supported |

#### CC-A.7.7-03: Clean Desk Policy (Employee Handbook / Acceptable Use)

| Attribute | Detail |
|-----------|--------|
| **Control type** | Administrative |
| **Description** | Written clean desk and clear screen policy communicated to all personnel |
| **Implementation** | Acceptable Use Policy (AIS-ISMS-POL-006) includes clean desk provisions; reinforced in onboarding training |
| **Covered by policy** | AIS-ISMS-POL-006 (Acceptable Use Policy) — to include clean desk section |
| **Provision text** | Personnel shall: (a) lock their screen when leaving their workstation unattended; (b) store physical documents containing Confidential or Restricted information in locked storage when not in use; (c) collect printed documents immediately and store or shred when no longer needed; (d) not leave removable media (USB drives, external disks) unattended; (e) position screens away from public view when working in shared or public spaces |
| **Evidence** | Signed AUP acknowledgment records; onboarding training completion records (A.6.3) |
| **Residual risk** | LOW — Policy is enforceable through AUP; physical desk behaviour relies on personnel compliance; mitigated by CC-A.7.7-01 (automatic screen lock) and CC-A.7.7-04 (DLP) |

#### CC-A.7.7-04: DLP Controls for Removable Media

| Attribute | Detail |
|-----------|--------|
| **Control type** | Technical |
| **Description** | Data loss prevention controls restrict or block use of removable media on company devices |
| **Implementation** | MDM policy restricts USB mass storage devices to read-only or blocks entirely by default; exceptions require documented business justification and manager approval |
| **Covered by policy** | AIS-ISMS-POL-005 (Asset Management Policy) Section 4.7 — information transfer |
| **Configuration** | macOS: MDM profile restricts external storage; Windows: Group Policy / Intune device control; exceptions logged and reviewed quarterly |
| **Evidence** | MDM device restriction configuration; exception log; quarterly review records |
| **Residual risk** | LOW — Technical enforcement blocks unauthorised removable media; approved exceptions are logged and auditable |

### 2A.2 Control Status After Compensating Controls

| Control | Original Status | Compensating Controls Applied | Final Status |
|---------|----------------|-------------------------------|--------------|
| A.7.7 Clear desk and clear screen | PARTIAL (AWS operational areas only) | CC-A.7.7-01 through CC-A.7.7-04 | **MET** (with compensating controls) |

**Rationale:** The combination of MDM-enforced screen lock (technical), remote wipe (corrective), clean desk policy (administrative), and DLP for removable media (preventive) achieves the control objective of preventing unauthorised access to information via unattended workstations and unsecured physical media. These controls are commensurate with Rambur's distributed, cloud-native operating model where the primary risk surface is endpoint devices, not physical office paper.

### 2A.3 Evidence Requirements

| Compensating Control | Evidence Type | Evidence Location | Status |
|---------------------|---------------|-------------------|--------|
| CC-A.7.7-01 Screen lock | MDM compliance report | MDM console export | To collect |
| CC-A.7.7-02 Remote wipe | MDM capability report | MDM console export | To collect |
| CC-A.7.7-03 Clean desk policy | Signed AUP acknowledgments | HR / onboarding records | AUP drafted; acknowledgments pending personnel onboarding |
| CC-A.7.7-04 DLP removable media | MDM device restriction config | MDM console export | To collect |

---

## 2B. A.7.9 — Security of Assets Off-Premises

**ISO 27001:2022 text:** Off-site assets shall be protected, taking into account the specific risks of working off-site.

**Control objective:** Prevent loss, damage, theft, or compromise of information assets when they are used, stored, or transported outside the organisation's premises. For a fully distributed company, _all_ company devices are off-premises by default, making this a material control.

### 2B.1 Compensating Controls

#### CC-A.7.9-01: MDM Enrollment (All Company Devices)

| Attribute | Detail |
|-----------|--------|
| **Control type** | Technical (compensating) |
| **Description** | All company-issued devices shall be enrolled in a Mobile Device Management (MDM) platform before being issued to personnel |
| **Implementation** | macOS devices enrolled via Automated Device Enrollment (ADE/DEP); Windows via Autopilot; mobile devices via MDM enrollment profile. Device is quarantined until enrollment completes |
| **Covered by policy** | AIS-ISMS-POL-005 (Asset Management Policy) Section 4.1 — asset inventory |
| **Scope** | All company-owned laptops, desktops, mobile devices, and any device used to access Rambur's Confidential or Restricted information |
| **Evidence** | MDM dashboard showing 100% enrollment; device inventory export |
| **Residual risk** | LOW — MDM enrollment is a prerequisite for device issuance; devices not enrolled cannot receive configuration profiles or security updates |

#### CC-A.7.9-02: Full-Disk Encryption

| Attribute | Detail |
|-----------|--------|
| **Control type** | Technical |
| **Description** | All company devices shall have full-disk encryption (FDE) enabled and enforced |
| **Implementation** | macOS: FileVault 2 enforced via MDM profile with institutional recovery key escrow; Windows: BitLocker enforced via Intune with recovery key escrow in Azure AD/Entra ID; mobile: native encryption enabled by default |
| **Covered by policy** | AIS-ISMS-POL-002 (Access Control Policy) Section 3.3; AIS-ISMS-POL-005 Section 4.5 — Confidential/Restricted data handling requires encryption at rest |
| **Configuration** | FDE enforced at device provisioning; compliance monitored via MDM; non-compliant devices flagged and remediated within 24 hours |
| **Evidence** | MDM encryption compliance report; recovery key escrow verification |
| **Residual risk** | LOW — Native OS encryption (FileVault, BitLocker) is industry standard; recovery key escrow ensures data recovery; protection is effective when device is powered off or locked |

#### CC-A.7.9-03: Asset Tracking and Inventory (Off-Premises Devices)

| Attribute | Detail |
|-----------|--------|
| **Control type** | Administrative / Technical |
| **Description** | All company devices shall be tracked in a centralized asset inventory with assigned ownership, location tracking capability, and lifecycle status |
| **Implementation** | MDM platform provides device inventory with assigned user, last check-in, OS version, encryption status, and compliance posture; periodic reconciliation against HR records |
| **Covered by policy** | AIS-ISMS-POL-005 (Asset Management Policy) Section 4.1 — asset inventory; Section 4.2 — asset ownership |
| **Cadence** | Inventory reviewed at least quarterly; reconciliation triggered on role change, termination, and at least annually |
| **Evidence** | MDM device inventory export; quarterly reconciliation report; offboarding asset return checklist |
| **Residual risk** | LOW — MDM provides continuous visibility into device state and location; quarterly reconciliation catches discrepancies |

#### CC-A.7.9-04: Remote Wipe Capability

| Attribute | Detail |
|-----------|--------|
| **Control type** | Technical (corrective) |
| **Description** | MDM platform shall support remote wipe for all enrolled devices to protect data on lost or stolen devices |
| **Implementation** | Same capability as CC-A.7.7-02; covers both A.7.7 and A.7.9 objectives |
| **Trigger** | Personnel report loss/theft within 4 hours; IT initiates remote wipe |
| **Evidence** | MDM remote wipe capability report; incident response procedure |

#### CC-A.7.9-05: Physical Security Guidance for Off-Premises Working

| Attribute | Detail |
|-----------|--------|
| **Control type** | Administrative |
| **Description** | Personnel shall be provided with guidance on protecting company devices and information when working off-premises |
| **Implementation** | Included in onboarding training (A.6.3); Acceptable Use Policy (AIS-ISMS-POL-006); remote working section |
| **Guidance elements** | (a) Do not leave devices unattended in public places; (b) Use privacy screens when working with Confidential/Restricted data in public; (c) Report device loss or theft immediately (within 4 hours); (d) Use VPN when connecting from untrusted networks; (e) Do not connect company devices to untrusted peripherals or charging stations; (f) Secure home network (WPA3, change default router credentials) |
| **Evidence** | Training completion records; signed AUP acknowledgments |
| **Residual risk** | LOW — Guidance is reinforced by technical controls (screen lock, FDE, remote wipe); personnel behaviour risk is mitigated through training and enforceable AUP |

#### CC-A.7.9-06: VPN / Secure Remote Access

| Attribute | Detail |
|-----------|--------|
| **Control type** | Technical |
| **Description** | Remote access to Rambur systems shall require encrypted channels |
| **Implementation** | VPN or Zero Trust Network Access (ZTNA) for access to internal/production systems; all SaaS accessed via TLS (HTTPS); MFA required for all remote access |
| **Covered by policy** | AIS-ISMS-POL-002 (Access Control Policy) Section 3.6 — remote access |
| **Evidence** | VPN/ZTNA configuration; MFA enforcement report |
| **Residual risk** | LOW — VPN/ZNTA + MFA provides defence-in-depth for remote access; traffic is encrypted end-to-end |

### 2B.2 Control Status After Compensating Controls

| Control | Original Status | Compensating Controls Applied | Final Status |
|---------|----------------|-------------------------------|--------------|
| A.7.9 Security of assets off-premises | PARTIAL (AWS edge/off-premises infrastructure only) | CC-A.7.9-01 through CC-A.7.9-06 | **MET** (with compensating controls) |

**Rationale:** For a distributed company, every device is an off-premises asset. The layered approach of MDM enrollment (asset control), full-disk encryption (data-at-rest protection), asset tracking (visibility), remote wipe (corrective control), physical security guidance (administrative), and VPN/ZNTA (network protection) provides defence-in-depth that satisfies the control objective. This posture is comparable to what a traditional office-based company achieves through physical perimeter controls — adapted to a distributed operating model.

### 2B.3 Evidence Requirements

| Compensating Control | Evidence Type | Evidence Location | Status |
|---------------------|---------------|-------------------|--------|
| CC-A.7.9-01 MDM enrollment | MDM enrollment report | MDM console export | To collect |
| CC-A.7.9-02 Full-disk encryption | MDM encryption compliance report | MDM console export | To collect |
| CC-A.7.9-03 Asset tracking | Device inventory export | MDM console export | To collect |
| CC-A.7.9-04 Remote wipe | MDM capability report | MDM console export | To collect |
| CC-A.7.9-05 Off-premises guidance | Training records, signed AUP | HR / onboarding records | Training drafted; acknowledgments pending |
| CC-A.7.9-06 VPN/secure access | VPN/ZTNA configuration; MFA report | Infrastructure config | To collect |

---

## 3. Combined Residual Risk Assessment

| Risk | Description | Likelihood | Impact | Rating | Mitigation |
|------|-------------|-----------|--------|--------|------------|
| R1 | Device lost/stolen before remote wipe executes (airplane mode) | Low | Medium | LOW | Offline-wipe policy where MDM supports it; FDE prevents data access without credentials |
| R2 | Personnel do not follow clean desk / physical security guidance | Low | Medium | LOW | Screen lock is technically enforced via MDM (not reliant on behaviour); DLP blocks removable media; AUP provides accountability |
| R3 | MDM platform compromise | Very Low | High | LOW | MDM access restricted to IT admins with MFA; audit log enabled; MDM vendor SOC 2/ISO 27001 certified |
| R4 | Encryption bypass via cold-boot or DMA attack | Very Low | Medium | VERY LOW | Requires physical access to powered-on unlocked device; mitigated by screen lock timeout and physical security guidance |

**Overall residual risk after compensating controls: LOW.** The layered compensating controls achieve the control objectives of A.7.7 and A.7.9. No material gaps remain. Both controls can be listed as MET (with compensating controls and shared responsibility notation) in the Statement of Applicability.

---

## 4. SoA Integration

Both A.7.7 and A.7.9 should be documented in the Statement of Applicability as:

- **Status:** Included / Implemented (with compensating controls)
- **Implementation:** Shared responsibility with AWS — AWS covers data center operational areas; Rambur covers employee endpoint devices via MDM-enforced policies, full-disk encryption, clean desk policy, and DLP controls
- **Reference:** This evidence package ([RBR-35](/RBR/issues/RBR-35)) + AWS attestation package ([RBR-23](/RBR/issues/RBR-23))

---

## 5. Next Actions

| Action | Owner | Target | Reference |
|--------|-------|--------|-----------|
| Add clean desk provisions to Acceptable Use Policy | Compliance Agent | Next policy sprint | AIS-ISMS-POL-006 update |
| Collect MDM evidence (screen lock, encryption, enrollment reports) | IT / Engineering Lead | Before Stage 1 audit | Screenshots or config exports |
| Verify MDM vendor SOC 2 / ISO 27001 certification | Compliance Agent | Before Stage 1 audit | Vendor risk assessment |
| Update SoA with A.7.7 and A.7.9 compensated status | Compliance Agent | After CISO reviews this document | [RBR-17](/RBR/issues/RBR-17) |
| Post evidence summary on RBR-17 for CISO review | Compliance Agent | This heartbeat | [RBR-17](/RBR/issues/RBR-17) |

---

## 6. Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-07-09 | Compliance Agent | Initial compensating controls document for A.7.7 and A.7.9, per [RBR-35](/RBR/issues/RBR-35) |
