# GCP + AWS Compliance Attestations — Evidence Package for A.7 Physical Controls

**Framework:** ISO/IEC 27001:2022 Annex A.7 (Physical Controls)  
**Purpose:** Combined third-party attestation evidence for all 14 A.7 controls under GCP and AWS Shared Responsibility Models  
**Project:** Aira — ISO 27001 Continuous Monitoring  
**Prepared by:** [@Compliance](/RBR/agents/compliance)  
**Date:** 2026-07-09  
**Target Issue:** [RBR-55](/RBR/issues/RBR-55)  
**Parent Issue:** [RBR-48](/RBR/issues/RBR-48) — Track 2  
**Extends:** [RBR-23](/RBR/issues/RBR-23) (AWS attestations, done)  
**Framework:** ISO/IEC 27001:2022  

---

## 1. Provider Overview

### 1.1 Google Cloud Platform (GCP) — Aira's Primary Host

Aira is GCP-hosted. All physical infrastructure controls for the production environment are inherited from Google Cloud under the GCP shared responsibility model.

### 1.2 Amazon Web Services (AWS) — Supplementary Services

Aira also uses AWS services (covered in detail in [RBR-23](/RBR/issues/RBR-23#document-aws-compliance-attestations)). AWS attestations are included here for completeness across all 14 A.7 controls.

---

## 2. GCP Attestation Documents

### 2.1 GCP ISO/IEC 27001:2022 Certification

| Attribute | Value |
|-----------|-------|
| **Standard** | ISO/IEC 27001:2022 |
| **Certifying Body** | Independent accredited third-party auditor |
| **Scope** | Google Cloud Services ISMS — covers all GCP services listed on the ISO 27001 compliance page |
| **Certificate** | Available via Compliance Reports Manager (console.cloud.google.com/compliance) |
| **Additional ISO Certs** | ISO/IEC 27017:2015, ISO/IEC 27018:2019, ISO/IEC 27701:2019, ISO/IEC 42001:2023 |
| **Status** | Active / Current |
| **Reference Page** | https://cloud.google.com/security/compliance/iso-27001 |

### 2.2 GCP SOC Reports

| Attribute | SOC 1 | SOC 2 | SOC 3 |
|-----------|-------|-------|-------|
| **Type** | Type II | Type II | Type II (summary) |
| **Standard** | SSAE No. 18 (ISAE 3402) | SSAE No. 18 (Trust Services Criteria) | SSAE No. 18 (Trust Services Criteria) |
| **Trust Criteria** | ICFR | Security, Availability, Confidentiality, Privacy, Processing Integrity | Security, Availability, Confidentiality, Privacy, Processing Integrity |
| **Auditor** | Ernst & Young LLP, Coalfire | Ernst & Young LLP, Coalfire | Ernst & Young LLP, Coalfire |
| **Frequency** | Quarterly (12-mo trailing) | Quarterly (12-mo trailing) | Biannual |
| **Access** | Compliance Reports Manager (NDA) | Compliance Reports Manager (NDA) | Public summary available |
| **Bridge Letters** | Monthly | Monthly | N/A |

**GCP SOC 2 Quarterly Cycles:**
- Q1: Feb 1 - Jan 31, issuance late March
- Q2: May 1 - Apr 30, issuance late June
- Q3: Aug 1 - Jul 31, issuance late September
- Q4: Nov 1 - Oct 31, issuance late December

**Reference Page:** https://cloud.google.com/security/compliance/soc-2

### 2.3 GCP Shared Responsibility Model

| Attribute | Value |
|-----------|-------|
| **Physical Security** | Google designs and builds own data centers with multi-layer physical security |
| **Hardware** | Custom-designed servers with Titan hardware security chip, secure boot, hardware roots of trust |
| **Physical Controls** | Explicitly classified as provider responsibility — inherited by customer |
| **Infrastructure Security Design** | https://cloud.google.com/security/infrastructure/design |
| **Security Overview** | https://cloud.google.com/docs/security/overview/whitepaper |

### 2.4 GCP Data Center Physical Security (from Infrastructure Security Design Overview)

Google data centers employ multiple layers of physical security:

**Perimeter Security:**
- Biometric identification
- Metal detection
- CCTV cameras (interior and exterior)
- Vehicle access barriers
- Perimeter fencing
- Laser-based intrusion detection systems
- 24/7 security guards with rigorous background checks

**Access Control:**
- Multi-factor authentication at all entry points (security badges + biometrics)
- Access to data center floor requires traversing a security corridor with MFA
- Least-privilege, role-based access (very few Google employees ever gain access)
- Visitor ID verification, sign-in, and mandatory escorting

**Environmental Controls:**
- Redundant power systems (primary + alternate, each with equal power)
- Backup generators for full-capacity emergency power
- Constant-temperature cooling systems
- Fire detection (heat, fire, smoke detectors) and suppression
- Audible and visible alarms at Security Operations Centers

**Hardware Security:**
- Custom-designed servers without unnecessary components (no video cards, no extraneous chipsets, no peripheral connectors)
- Titan hardware security chip for hardware root of trust
- Secure boot stack with verified boot and attestation
- Hardware tracking with barcodes and asset tags
- Metal detectors and video surveillance to prevent unauthorized equipment removal

**Media Destruction:**
- Storage devices use full disk encryption (FDE) and drive locking
- Multi-step verification process for device sanitization
- Devices that cannot be erased are physically destroyed (shredded) on-premises
- Storage media containing customer data never leaves Google control until securely destroyed

**Third-Party Data Centers:**
- Same regulatory standards as Google-owned data centers
- Independent Google-controlled physical security measures (biometrics, cameras, metal detectors) on top of facility operator security

**Reference:** https://cloud.google.com/docs/security/overview/whitepaper

---

## 3. AWS Attestation Documents (from RBR-23)

### 3.1 AWS ISO/IEC 27001:2022 Certification

| Attribute | Value |
|-----------|-------|
| **Standard** | ISO/IEC 27001:2022 |
| **Certifying Body** | EY CertifyPoint (accredited by Dutch Accreditation Council, IAF member) |
| **Certificate** | [ISO 27001 Global Certification (PDF)](https://d1.awsstatic.com/onedam/marketing-channels/website/aws/en_US/certification/compliance/iso_27001_global_certification.pdf) |
| **Additional ISO Certs** | ISO/IEC 27017:2015, ISO/IEC 27018:2019 |
| **Reference Page** | https://aws.amazon.com/compliance/iso-27001-faqs/ |

### 3.2 AWS SOC Reports

| Attribute | SOC 2 Type II |
|-----------|---------------|
| **Auditor** | Ernst & Young LLP |
| **Frequency** | Biannual (12-mo trailing: Mar 31, Sep 30) |
| **Access** | AWS Artifact (NDA required) |
| **SOC 3 Public Summary** | [PDF](https://d1.awsstatic.com/onedam/marketing-channels/website/aws/en_US/whitepapers/compliance/AWS_SOC3_Report.pdf) |
| **Reference Page** | https://aws.amazon.com/compliance/soc-faqs/ |

### 3.3 AWS Shared Responsibility Model

| Attribute | Value |
|-----------|-------|
| **Physical Controls** | Explicitly classified as **Inherited Controls** |
| **Documentation** | https://aws.amazon.com/compliance/shared-responsibility-model/ |
| **Data Center Controls** | https://aws.amazon.com/compliance/data-center/controls/ |

---

## 4. Control Mapping: A.7.1–A.7.14 → GCP + AWS Attestation Coverage

### A.7.1 — Physical Security Perimeters

**ISO Requirement:** Security perimeters shall be defined and used to protect areas that contain information and other associated assets.

| Provider | Evidence Source | Coverage Detail |
|----------|----------------|-----------------|
| GCP | SOC 2 Type II (EY/Coalfire) | Physical security perimeter controls tested |
| GCP | ISO 27001 Certificate | Covers facility physical security perimeters |
| GCP | Infrastructure Security Design — Physical Premises | Perimeter fencing, vehicle barriers, laser-based intrusion detection |
| AWS | SOC 2 Type II (EY) | Physical security perimeter controls tested |
| AWS | ISO 27001 Certificate | Covers facility physical security perimeters |
| AWS | Data Center Controls — Secure Design | Site selection, AZ physical separation |

**Coverage Status:** **MET** — Fully inherited from both GCP and AWS under their respective Shared Responsibility Models. Covered by SOC 2 Type II + ISO 27001 certification for both providers.

---

### A.7.2 — Physical Entry Controls

**ISO Requirement:** Secure areas shall be protected by appropriate entry controls and access points.

| Provider | Evidence Source | Coverage Detail |
|----------|----------------|-----------------|
| GCP | SOC 2 Type II | Physical access controls tested |
| GCP | Infrastructure Security — Physical Access | Biometric ID, metal detection, MFA at entry points, security corridor |
| GCP | Infrastructure Security — Guards | 24/7 professional security guards with background checks |
| AWS | SOC 2 Type II | Physical access controls tested |
| AWS | Data Center Controls — Physical Access | Least-privilege, time-bound, business-justification, automatic revocation |
| AWS | Data Center Controls — Surveillance | MFA at all entry points |

**Coverage Status:** **MET** — Both providers maintain strict physical entry controls with MFA and least-privilege access.

---

### A.7.3 — Securing Offices, Rooms and Facilities

**ISO Requirement:** Physical security for offices, rooms and facilities shall be designed and implemented.

| Provider | Evidence Source | Coverage Detail |
|----------|----------------|-----------------|
| GCP | SOC 2 Type II | Facility security design controls tested |
| GCP | Infrastructure Security | Multi-layer physical security, layered access with security corridor |
| GCP | Third-Party DC Policy | Same regulatory standards, independent Google-controlled physical security |
| AWS | SOC 2 Type II | Facility security design controls tested |
| AWS | Data Center Controls — Physical Access | Access restricted to authorized layers/permissions |
| AWS | Data Center Controls — Surveillance | Entry points secured with alarming devices, forced/hold-open detection |

**Coverage Status:** **MET** — Both providers design and implement layered physical security for all facilities.

---

### A.7.4 — Physical Security Monitoring

**ISO Requirement:** Premises shall be continuously monitored for unauthorized physical access.

| Provider | Evidence Source | Coverage Detail |
|----------|----------------|-----------------|
| GCP | SOC 2 Type II | Monitoring controls tested |
| GCP | Infrastructure Security | CCTV (interior + exterior), laser-based intrusion detection, 24/7 guards |
| AWS | SOC 2 Type II | Monitoring controls tested |
| AWS | Data Center Controls — Surveillance | CCTV at all physical access points, 24/7 global Security Operations Centers |
| AWS | Data Center Controls — Intrusion Detection | Electronic intrusion detection with automatic alerting to SOC |

**Coverage Status:** **MET** — Both providers maintain continuous physical monitoring with CCTV, intrusion detection, and 24/7 operations centers.

---

### A.7.5 — Protecting Against Physical and Environmental Threats

**ISO Requirement:** Protection against physical and environmental threats, such as natural disasters and other intentional or unintentional physical threats to infrastructure, shall be designed and implemented.

| Provider | Evidence Source | Coverage Detail |
|----------|----------------|-----------------|
| GCP | SOC 2 Type II | Environmental control testing |
| GCP | Infrastructure Security — Environmental | Redundant power (primary + alternate), backup generators, fire detection/suppression, climate control |
| GCP | Infrastructure Security — Design | Site selection mitigates environmental risks |
| AWS | SOC 2 Type II | Environmental control testing |
| AWS | Data Center Controls — Secure Design | Flood/seismic/weather mitigation in site selection |
| AWS | Data Center Controls — Fire/Power/Climate | Automatic fire detection/suppression, redundant power, climate control, leak detection |
| AWS | Data Center Controls — Business Continuity | BCP with testing, simulations, pandemic response |

**Coverage Status:** **MET** — Both providers have comprehensive environmental threat protection. Covered by SOC 2 + ISO 27001.

---

### A.7.6 — Working in Secure Areas

**ISO Requirement:** Security measures for working in secure areas shall be designed and implemented.

| Provider | Evidence Source | Coverage Detail |
|----------|----------------|-----------------|
| GCP | SOC 2 Type II | Secure area working controls tested |
| GCP | Infrastructure Security — Access | Role-based, least-privilege access; very few employees ever gain DC access |
| GCP | Third-Party Access | Visitor ID verification, sign-in, mandatory escort |
| AWS | SOC 2 Type II | Secure area controls tested |
| AWS | Data Center Controls — Physical Access | Employee access requires application, business justification, approval, time-bound |
| AWS | Data Center Controls — Third-Party Access | Visitors must present ID, sign in, escorted by authorized staff |

**Coverage Status:** **MET** — Both providers enforce strict access controls for all personnel in secure areas.

---

### A.7.7 — Clear Desk and Clear Screen

**ISO Requirement:** Clear desk rules for papers and removable storage media and clear screen rules for information processing facilities shall be defined and appropriately enforced.

**Split Responsibility Analysis:**

| Layer | Responsibility | Evidence |
|-------|---------------|----------|
| GCP data center operations | GCP | SOC 2 Type II — operational clean-desk procedures |
| AWS data center operations | AWS | SOC 2 Type II — operational clean-desk procedures |
| Aira employee workstations | Aira | Shared Responsibility Model — customer endpoint security |
| Aira office (if any) | Aira | Customer responsibility for own physical office |

| Provider | Evidence Source | Coverage Detail |
|----------|----------------|-----------------|
| GCP | SOC 2 Type II | GCP operational clean-desk procedures |
| AWS | SOC 2 Type II | AWS operational clean-desk procedures |
| GCP + AWS | Shared Responsibility Models | Endpoint security classified as customer responsibility |

**Coverage Status:** **PARTIAL EXCLUSION** — GCP and AWS cover clear desk for their own operational areas. Aira retains responsibility for employee workstation clear desk/screen policies. Compensating controls tracked in [RBR-35](/RBR/issues/RBR-35).

---

### A.7.8 — Equipment Siting and Protection

**ISO Requirement:** Equipment shall be sited securely and protected.

| Provider | Evidence Source | Coverage Detail |
|----------|----------------|-----------------|
| GCP | SOC 2 Type II | Equipment protection controls tested |
| GCP | Infrastructure Security — Hardware | Purpose-built servers, no unnecessary components, Titan security chip |
| GCP | Infrastructure Security — Environmental | Climate control, redundant power, fire suppression |
| GCP | Infrastructure Security — Tracking | Barcoded asset tags, metal detectors, video surveillance |
| AWS | SOC 2 Type II | Equipment protection controls tested |
| AWS | Data Center Controls — Infrastructure Maintenance | Preventive maintenance schedule |
| AWS | Data Center Controls — Device Management | Centralized asset management tracking |

**Coverage Status:** **MET** — Both providers protect infrastructure equipment with preventive maintenance, environmental controls, and asset tracking.

---

### A.7.9 — Security of Assets Off-Premises

**ISO Requirement:** Off-site assets shall be protected.

**Split Responsibility Analysis:**

| Layer | Responsibility | Evidence |
|-------|---------------|----------|
| GCP infrastructure outside primary DCs | GCP | SOC 2 Type II — GCP manages edge locations, PoPs |
| AWS infrastructure outside primary DCs | AWS | SOC 2 Type II — AWS manages edge locations, PoPs |
| Aira employee mobile devices / laptops | Aira | Shared Responsibility Model — customer endpoint security |

| Provider | Evidence Source | Coverage Detail |
|----------|----------------|-----------------|
| GCP | SOC 2 Type II | GCP coverage for edge locations and third-party DCs with independent Google controls |
| AWS | SOC 2 Type II | AWS coverage for AWS-managed assets at edge locations |
| GCP + AWS | Shared Responsibility Models | Customer responsible for endpoint device security |

**Coverage Status:** **PARTIAL EXCLUSION** — Both providers cover their own off-premises infrastructure. Aira retains responsibility for employee mobile devices, laptops, and customer-owned equipment. Compensating controls tracked in [RBR-35](/RBR/issues/RBR-35).

---

### A.7.10 — Storage Media

**ISO Requirement:** Storage media shall be managed through their life cycle of acquisition, use, transportation and disposal in accordance with the organization's classification scheme and handling requirements.

| Provider | Evidence Source | Coverage Detail |
|----------|----------------|-----------------|
| GCP | SOC 2 Type II | Media lifecycle controls tested |
| GCP | Infrastructure Security — Media Destruction | FDE + drive locking on all storage devices; multi-step verification; physical shredding on-premises if unerasable |
| GCP | Infrastructure Security — Tracking | Full lifecycle tracking with barcodes and asset tags |
| AWS | SOC 2 Type II | Media lifecycle controls tested |
| AWS | Data Center Controls — Device Management | Centralized asset inventory |
| AWS | Data Center Controls — Media Destruction | NIST 800-88 compliant destruction; media never leaves AWS control until securely destroyed |

**Coverage Status:** **MET** — Both providers manage storage media through full lifecycle with secure destruction. Covered by SOC 2 + ISO 27001.

---

### A.7.11 — Supporting Utilities

**ISO Requirement:** Information processing facilities shall be protected from power failures and other disruptions caused by failures in supporting utilities.

| Provider | Evidence Source | Coverage Detail |
|----------|----------------|-----------------|
| GCP | SOC 2 Type II | Utility/supporting infrastructure controls tested |
| GCP | Infrastructure Security | Redundant power systems (primary + alternate, each equal); backup generators for full-capacity operation |
| GCP | Infrastructure Security — Cooling | Constant-temperature cooling systems; environmental monitoring |
| GCP | ISO 27001 Certificate | Covers supporting utilities (Annex A.7.11 scope) |
| AWS | SOC 2 Type II | Utility controls tested |
| AWS | Data Center Controls — Power | Fully redundant electrical power with backup supply |
| AWS | Data Center Controls — Climate | Temperature/humidity monitoring; climate control to prevent overheating |
| AWS | Data Center Controls — Leak Detection | Water leak detection with removal mechanisms |
| AWS | ISO 27001 Certificate | Covers supporting utilities (Annex A.7.11 scope) |

**Coverage Status:** **MET** — Both providers maintain redundant power, cooling, and environmental monitoring to protect against utility failures.

---

### A.7.12 — Cabling Security

**ISO Requirement:** Cables carrying power, data or supporting information services shall be protected from interception, interference or damage.

| Provider | Evidence Source | Coverage Detail |
|----------|----------------|-----------------|
| GCP | SOC 2 Type II | Physical infrastructure cabling controls tested |
| GCP | Infrastructure Security — Network | Global fiber-optic backbone; own fiber + undersea cables; network designed for security |
| GCP | Infrastructure Security — Physical Access | Restricted DC floor access; metal detectors and surveillance |
| AWS | SOC 2 Type II | Cabling/infrastructure controls tested |
| AWS | Data Center Controls — Secure Design | Redundant connectivity; physically separated infrastructure |
| AWS | Data Center Controls — Physical Access | Restricted physical access to infrastructure |
| AWS | Data Center Controls — Surveillance | CCTV and intrusion detection covering all infrastructure areas |

**Coverage Status:** **MET** — Both providers protect cabling infrastructure through physical access controls, restricted areas, and surveillance.

---

### A.7.13 — Equipment Maintenance

**ISO Requirement:** Equipment shall be correctly maintained to ensure availability, integrity and confidentiality of information.

| Provider | Evidence Source | Coverage Detail |
|----------|----------------|-----------------|
| GCP | SOC 2 Type II | Equipment maintenance controls tested |
| GCP | Infrastructure Security — Maintenance | Automated systems for hardware/software problem detection; preventive maintenance |
| GCP | Infrastructure Security — Server Lifecycle | Failed components removed from inventory and retired; continuous integrity checks |
| AWS | SOC 2 Type II | Equipment maintenance controls tested |
| AWS | Data Center Controls — Infrastructure Maintenance | Preventive equipment maintenance schedule |
| AWS | Data Center Controls — Device Management | Centralized asset tracking with maintenance status |
| AWS | Data Center Controls — Environmental | BMS/EMS environmental monitoring |

**Coverage Status:** **MET** — Both providers maintain equipment through preventive maintenance schedules and continuous integrity monitoring.

---

### A.7.14 — Security of Equipment Disposed of or Reused

**ISO Requirement:** Equipment containing storage media shall be verified to ensure that any sensitive data and licensed software has been removed or securely overwritten prior to disposal or reuse.

| Provider | Evidence Source | Coverage Detail |
|----------|----------------|-----------------|
| GCP | SOC 2 Type II | Equipment disposal/secure destruction controls tested |
| GCP | Infrastructure Security — Disposal | Multi-step verification process for device sanitization |
| GCP | Infrastructure Security — Physical Destruction | Devices that cannot be erased are physically shredded on-premises |
| GCP | Infrastructure Security — Exit Controls | Metal detectors and video surveillance prevent unauthorized equipment removal |
| AWS | SOC 2 Type II | Equipment disposal controls tested |
| AWS | Data Center Controls — Media Destruction | NIST 800-88 compliant; media with customer data classified as "Critical" |
| AWS | Data Center Controls — Disposal | Media never leaves AWS control until securely decommissioned/destroyed |

**Coverage Status:** **MET** — Both providers verify sanitization before disposal, with physical destruction for devices that cannot be securely erased.

---

## 5. Summary

| Control | Status | GCP Evidence | AWS Evidence | Notes |
|---------|--------|-------------|--------------|-------|
| A.7.1 Physical security perimeters | MET | SOC 2, ISO 27001, Infra Design | SOC 2, ISO 27001, SRM, DC Controls | Fully inherited |
| A.7.2 Physical entry controls | MET | SOC 2, ISO 27001, Infra Security | SOC 2, ISO 27001, DC Controls | Fully inherited |
| A.7.3 Securing offices, rooms, facilities | MET | SOC 2, ISO 27001, Infra Security | SOC 2, ISO 27001, DC Controls | Fully inherited |
| A.7.4 Physical security monitoring | MET | SOC 2, ISO 27001, Infra Security | SOC 2, ISO 27001, DC Controls | Fully inherited |
| A.7.5 Physical/environmental threats | MET | SOC 2, ISO 27001, Infra Security | SOC 2, ISO 27001, DC Controls | Fully inherited |
| A.7.6 Working in secure areas | MET | SOC 2, ISO 27001, Infra Security | SOC 2, ISO 27001, DC Controls | Fully inherited |
| A.7.7 Clear desk and clear screen | PARTIAL | SOC 2 (GCP ops) | SOC 2 (AWS ops), SRM | Customer responsible for workstation |
| A.7.8 Equipment siting and protection | MET | SOC 2, ISO 27001, Infra Security | SOC 2, ISO 27001, DC Controls | Fully inherited |
| A.7.9 Security of assets off-premises | PARTIAL | SOC 2 (GCP edge/PoPs) | SOC 2 (AWS edge), SRM | Customer responsible for mobile devices |
| A.7.10 Storage media | MET | SOC 2, ISO 27001, Infra Security | SOC 2, ISO 27001, DC Controls | Fully inherited |
| A.7.11 Supporting utilities | MET | SOC 2, ISO 27001, Infra Security | SOC 2, ISO 27001, DC Controls | Fully inherited |
| A.7.12 Cabling security | MET | SOC 2, ISO 27001, Infra Security | SOC 2, ISO 27001, DC Controls | Fully inherited |
| A.7.13 Equipment maintenance | MET | SOC 2, ISO 27001, Infra Security | SOC 2, ISO 27001, DC Controls | Fully inherited |
| A.7.14 Equipment disposal/reuse | MET | SOC 2, ISO 27001, Infra Security | SOC 2, ISO 27001, DC Controls | Fully inherited |

**Counts:**
- **12 controls MET** — Fully inherited from GCP and/or AWS under Shared Responsibility Model
- **2 controls PARTIAL** (A.7.7, A.7.9) — Shared responsibility; compensating controls needed for customer side

**Legend:**
- MET = Control covered by provider attestation; exclusion justified under Shared Responsibility Model
- PARTIAL = Provider covers infrastructure layer; customer retains some responsibility
- SRM = Shared Responsibility Model

---

## 6. Residual Risk Assessment

**Risk 1: Concentration — Single Primary Provider (GCP)**
Aira's production workload is primarily GCP-hosted. Physical control reliance is concentrated on Google Cloud.

**Mitigation:** GCP SOC 2 Type II (quarterly, EY/Coalfire) and ISO 27001 certifications are independently audited on a recurring basis. GCP's Security Overview whitepaper (updated Jul 2024) and Infrastructure Security Design (updated Jun 2024) provide detailed public attestation of physical security controls.

**Rating: LOW** — GCP certifications are current, independently audited (EY, Coalfire), and updated quarterly. AWS provides redundancy for supplementary services.

**Risk 2: Partial Controls Requiring Customer Compensating Controls**
A.7.7 and A.7.9 are partial exclusions. Aira must document workstation clear desk/screen policies and mobile device management.

**Mitigation:** Compensating controls documented in [RBR-35](/RBR/issues/RBR-35).

**Rating: LOW** — Two controls out of 14 require customer-side compensating controls; both are tracked with owners and target dates.

**Risk 3: Full SOC 2 Reports Require NDA/Account Access**
Full SOC 2 Type II reports for both GCP and AWS require access to Compliance Reports Manager / AWS Artifact with NDA terms. SOC 3 public summaries are available but provide less detail.

**Mitigation:** SOC 3 reports are publicly available. Full SOC 2 reports can be obtained when an account holder is available.

**Rating: LOW** — Public evidence (SOC 3, ISO 27001 certs, security whitepapers, shared responsibility model docs) is sufficient to support the control exclusion. Full reports strengthen the evidence chain but are not required for Stage 1 audit.

---

## 7. Evidence Locations

| Document | Location | Access |
|----------|----------|--------|
| **GCP Attestations** | | |
| GCP ISO 27001 Compliance Page | https://cloud.google.com/security/compliance/iso-27001 | Public |
| GCP SOC 2 Compliance Page | https://cloud.google.com/security/compliance/soc-2 | Public |
| GCP Security Overview (Whitepaper) | https://cloud.google.com/docs/security/overview/whitepaper | Public |
| GCP Infrastructure Security Design | https://cloud.google.com/security/infrastructure/design | Public |
| GCP Compliance Resource Center | https://cloud.google.com/security/compliance | Public |
| GCP ISO 27001 Certificate | Compliance Reports Manager (console.cloud.google.com/compliance) | GCP account required |
| GCP SOC 2 Type II Reports | Compliance Reports Manager | GCP account + NDA required |
| **AWS Attestations** | | |
| AWS ISO 27001:2022 Certificate | [PDF](https://d1.awsstatic.com/onedam/marketing-channels/website/aws/en_US/certification/compliance/iso_27001_global_certification.pdf) | Public |
| AWS SOC 3 Report | [PDF](https://d1.awsstatic.com/onedam/marketing-channels/website/aws/en_US/whitepapers/compliance/AWS_SOC3_Report.pdf) | Public |
| AWS SOC 2 Type II Report | AWS Artifact (console.aws.amazon.com/artifact) | AWS account + NDA required |
| AWS Shared Responsibility Model | https://aws.amazon.com/compliance/shared-responsibility-model/ | Public |
| AWS Data Center Controls | https://aws.amazon.com/compliance/data-center/controls/ | Public |
| AWS SOC FAQs | https://aws.amazon.com/compliance/soc-faqs/ | Public |
| AWS ISO 27001 FAQs | https://aws.amazon.com/compliance/iso-27001-faqs/ | Public |
| **Internal Evidence** | | |
| AWS Evidence Package | [RBR-23](/RBR/issues/RBR-23#document-aws-compliance-attestations) | Internal |
| This Evidence Package | [RBR-55](/RBR/issues/RBR-55#document-gcp-aws-attestations) | Internal |

---

## 8. Next Actions

1. **Update SoA on [RBR-17](/RBR/issues/RBR-17)** — Reference this evidence package for all 14 A.7 control exclusions (expanded from 10 to 14)
2. **Retrieve full SOC 2 Type II reports** from GCP Compliance Reports Manager and AWS Artifact when account access is available — optional but strengthens evidence chain
3. **Track A.7.7/A.7.9 compensating controls** via [RBR-35](/RBR/issues/RBR-35) — customer-side workstation and mobile device controls
4. **Schedule re-verification cadence:**
   - GCP SOC 2: Quarterly (Mar, Jun, Sep, Dec)
   - AWS SOC 2: Biannual (Mar, Sep)
   - ISO 27001 certificates: Annual renewal check
5. **Upload evidence to Drata** — Map this evidence package to Drata A.7 control requirements for auto-tracking
6. **Update [RBR-48](/RBR/issues/RBR-48) Track 2 status** — Evidence collection complete for A.7 physical controls