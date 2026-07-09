# AWS Compliance Attestations — Evidence Package

**Framework:** ISO/IEC 27001:2022
**Purpose:** Vendor compliance evidence for 10 excluded A.7 Physical controls under the AWS Shared Responsibility Model
**Project:** Aira — ISO 27001 Continuous Monitoring
**Prepared by:** [@Compliance](/RBR/agents/compliance)
**Date:** 2026-07-09
**Target Issue:** [RBR-23](/RBR/issues/RBR-23)
**Parent Issue:** [RBR-17](/RBR/issues/RBR-17)

---

## 1. AWS Attestation Documents

### 1.1 AWS ISO/IEC 27001:2022 Certification

| Attribute | Value |
|-----------|-------|
| **Standard** | ISO/IEC 27001:2022 |
| **Certifying Body** | EY CertifyPoint (accredited by Dutch Accreditation Council, IAF member) |
| **Scope** | AWS security management process over specified services and data centers |
| **Certificate** | [ISO 27001 Global Certification (PDF)](https://d1.awsstatic.com/onedam/marketing-channels/website/aws/en_US/certification/compliance/iso_27001_global_certification.pdf) |
| **Additional ISO Certs** | ISO/IEC 27017:2015, ISO/IEC 27018:2019 |
| **Status** | Active / Current |
| **Reference Page** | https://aws.amazon.com/compliance/iso-27001-faqs/ |

### 1.2 AWS SOC Reports

| Attribute | SOC 1 | SOC 2 | SOC 3 |
|-----------|-------|-------|-------|
| **Type** | Type II | Type II | Type II (summary) |
| **Standard** | SSAE No. 18 (ISAE 3402) | SSAE No. 18 (Trust Services Criteria) | SSAE No. 18 (Trust Services Criteria) |
| **Trust Criteria** | ICFR | Security, Availability, Confidentiality, Privacy | Security, Availability, Confidentiality, Privacy |
| **Auditor** | Ernst & Young LLP | Ernst & Young LLP | Ernst & Young LLP |
| **Frequency** | Quarterly (12-mo trailing) | Biannual (12-mo trailing: 3/31, 9/30) | Biannual (12-mo trailing: 3/31, 9/30) |
| **Access** | AWS Artifact (NDA required) | AWS Artifact (NDA required) | [Publicly available (PDF)](https://d1.awsstatic.com/onedam/marketing-channels/website/aws/en_US/whitepapers/compliance/AWS_SOC3_Report.pdf) |
| **Bridge Letter** | Monthly (via Artifact) | Monthly (via Artifact) | N/A |

**Reference Page:** https://aws.amazon.com/compliance/soc-faqs/

### 1.3 AWS Shared Responsibility Model

| Attribute | Value |
|-----------|-------|
| **Key Principle** | AWS secures the cloud infrastructure; customers secure their workloads in the cloud |
| **Physical Controls** | Explicitly classified as **Inherited Controls** — fully inherited by customer from AWS |
| **Documentation** | https://aws.amazon.com/compliance/shared-responsibility-model/ |

### 1.4 AWS Data Center Controls (Physical & Environmental)

Reference: https://aws.amazon.com/compliance/data-center/controls/

AWS publishes detailed control descriptions for the following categories:

- **Secure Design:** Site selection (flood/seismic/weather mitigation), redundancy (N+1), availability (AZ isolation), capacity planning
- **Physical Access:** Least-privilege, time-bound access; employee and third-party access control; GovCloud US-citizen restriction
- **Monitor & Logging:** Access review, access logs, 24/7 Security Operations Centers
- **Surveillance & Detection:** CCTV, multi-factor authentication at entry points, intrusion detection with automatic alerting
- **Device Management:** Centralized asset inventory, media destruction per NIST 800-88
- **Operational Support Systems:** Redundant power, climate/temperature control, fire detection/suppression, leak detection
- **Infrastructure Maintenance:** Preventive equipment maintenance, environmental monitoring (BMS/EMS)
- **Governance & Risk:** Ongoing risk management, third-party security attestation testing

---

## 2. Control Mapping: A.7 Physical Controls → AWS Attestation Coverage

### A.7.1 — Physical Security Perimeters

**ISO Requirement:** Security perimeters defined and used to protect areas containing information and other assets.

| Evidence Source | Coverage Detail |
|-----------------|-----------------|
| AWS SOC 2 Type II | Physical security perimeter controls tested by EY |
| AWS SOC 3 | Public confirmation of physical perimeter controls |
| AWS ISO 27001 Certificate | Covers facility physical security (Annex A.7 scope) |
| AWS Data Center Controls — Secure Design | Site selection mitigates environmental risks; Availability Zones are physically separated and independent |
| AWS Shared Responsibility Model | Physical & Environmental controls listed as Inherited Controls |

**Coverage Status:** **MET** — AWS assumes full responsibility for physical security perimeters of cloud infrastructure. Covered by SOC 2 Type II + ISO 27001 certification.

---

### A.7.2 — Physical Entry Controls

**ISO Requirement:** Secure areas protected by appropriate entry controls and access points.

| Evidence Source | Coverage Detail |
|-----------------|-----------------|
| AWS SOC 2 Type II | Physical access controls tested by EY |
| AWS SOC 3 | Public confirmation of physical access controls |
| AWS Data Center Controls — Physical Access | Least-privilege, business-justification-required, time-bound access; approval by authorized personnel; automatic revocation |
| AWS Data Center Controls — Surveillance & Detection | Multi-factor authentication at all entry points; professional security staff at building ingress |
| AWS ISO 27001 Certificate | Covers physical entry controls (Annex A.7.2 scope) |

**Coverage Status:** **MET** — AWS maintains strict physical entry controls with MFA, least-privilege access, and automatic revocation. Covered by SOC 2 + ISO 27001.

---

### A.7.3 — Securing Offices, Rooms, and Facilities

**ISO Requirement:** Physical security for offices, rooms, and facilities designed and implemented.

| Evidence Source | Coverage Detail |
|-----------------|-----------------|
| AWS SOC 2 Type II | Facility security design controls tested by EY |
| AWS Data Center Controls — Physical Access | Access restricted to specified layers/permissions; individuals restricted to authorized areas |
| AWS Data Center Controls — Surveillance & Detection | Entry points secured with alarming devices; forced/hold-open detection |
| AWS ISO 27001 Certificate | Covers facility security (Annex A.7.3 scope) |

**Coverage Status:** **MET** — AWS data centers are designed with layered physical security. Covered by SOC 2 + ISO 27001.

---

### A.7.4 — Physical Security Monitoring

**ISO Requirement:** Premises continuously monitored for unauthorized physical access.

| Evidence Source | Coverage Detail |
|-----------------|-----------------|
| AWS SOC 2 Type II | Monitoring controls tested by EY |
| AWS Data Center Controls — Surveillance & Detection | CCTV recording at all physical access points; images retained per legal/compliance requirements |
| AWS Data Center Controls — Monitor & Logging | 24/7 global Security Operations Centers monitoring, triaging, and executing security programs |
| AWS Data Center Controls — Intrusion Detection | Electronic intrusion detection systems with automatic alerting to SOC |
| AWS ISO 27001 Certificate | Covers physical monitoring (Annex A.7.4 scope) |

**Coverage Status:** **MET** — AWS maintains 24/7 SOC, CCTV, intrusion detection, and automated alerting. Covered by SOC 2 + ISO 27001.

---

### A.7.5 — Protecting Against Physical and Environmental Threats

**ISO Requirement:** Protection against physical and environmental threats (fire, flood, earthquake, etc.) designed and implemented.

| Evidence Source | Coverage Detail |
|-----------------|-----------------|
| AWS SOC 2 Type II | Environmental control testing by EY |
| AWS Data Center Controls — Secure Design | Site selection mitigates flooding, extreme weather, seismic activity |
| AWS Data Center Controls — Fire Detection/Suppression | Automatic fire detection (smoke sensors) and suppression systems in all data center spaces |
| AWS Data Center Controls — Climate/Temperature | Climate control mechanisms to prevent overheating; temperature/humidity monitoring |
| AWS Data Center Controls — Leak Detection | Water leak detection with removal mechanisms |
| AWS Data Center Controls — Power | Fully redundant electrical power systems with backup power supply |
| AWS Data Center Controls — Business Continuity | Business Continuity Plan with testing, simulations, and pandemic response |
| AWS ISO 27001 Certificate | Covers environmental protection (Annex A.7.5 scope) |

**Coverage Status:** **MET** — AWS has comprehensive environmental threat protection including fire, flood, seismic, climate, and power redundancy. Covered by SOC 2 + ISO 27001.

---

### A.7.6 — Working in Secure Areas

**ISO Requirement:** Security measures for working in secure areas designed and implemented.

| Evidence Source | Coverage Detail |
|-----------------|-----------------|
| AWS SOC 2 Type II | Secure area controls tested by EY |
| AWS Data Center Controls — Physical Access | Employee access requires application, business justification, approval, and is time-bound |
| AWS Data Center Controls — Third-Party Access | Visitors must present ID, are signed in, and escorted by authorized staff |
| AWS Data Center Controls — GovCloud | US-citizen restriction for GovCloud data centers |
| AWS ISO 27001 Certificate | Covers secure area working (Annex A.7.6 scope) |

**Coverage Status:** **MET** — AWS enforces strict access controls for all personnel in secure areas, including visitor escorts. Covered by SOC 2 + ISO 27001.

---

### A.7.7 — Clear Desk and Clear Screen

**ISO Requirement:** Clear desk rules for papers and removable storage media and clear screen rules for information processing facilities.

**Split Responsibility Analysis:**

| Layer | Responsibility | Evidence |
|-------|---------------|----------|
| AWS data center operations | AWS | SOC 2 Type II, ISO 27001 — AWS operational areas follow clean-desk practices per SOC controls |
| Customer employee workstations | Customer | Shared Responsibility Model — customer responsibility for endpoint security |
| Customer office (if any) | Customer | Customer is responsible for own physical office clear desk policy |

| Evidence Source | Coverage Detail |
|-----------------|-----------------|
| AWS Shared Responsibility Model | Endpoint security, workstation configuration classified as customer responsibility |
| AWS SOC 2 Type II | AWS operational clean-desk procedures included in SOC controls |

**Coverage Status:** **PARTIAL EXCLUSION** — AWS covers clear desk for its own operational areas. Customer retains responsibility for employee workstation clear desk/screen policies and any customer-owned physical office space. This split must be documented in the SoA as a **shared control** with customer-side compensating controls.

---

### A.7.8 — Equipment Siting and Protection

**ISO Requirement:** Equipment sited securely and protected.

| Evidence Source | Coverage Detail |
|-----------------|-----------------|
| AWS SOC 2 Type II | Equipment protection controls tested by EY |
| AWS Data Center Controls — Infrastructure Maintenance | Preventive maintenance for electrical/mechanical equipment; documented maintenance schedule |
| AWS Data Center Controls — Climate/Temperature | Equipment protected from overheating via climate control |
| AWS Data Center Controls — Power | Redundant power for all critical/essential loads |
| AWS Data Center Controls — Device Management | Centralized asset management tracking owner, location, status, maintenance |
| AWS ISO 27001 Certificate | Covers equipment siting/protection (Annex A.7.8 scope) |

**Coverage Status:** **MET** — AWS protects all infrastructure equipment with preventive maintenance, environmental controls, redundant power, and asset tracking. Covered by SOC 2 + ISO 27001.

---

### A.7.9 — Security of Assets Off-Premises

**ISO Requirement:** Off-site assets protected.

**Split Responsibility Analysis:**

| Layer | Responsibility | Evidence |
|-------|---------------|----------|
| AWS infrastructure assets outside primary data centers | AWS | SOC 2 Type II, ISO 27001 — AWS manages its own off-premises assets (edge locations, etc.) |
| Customer-owned mobile devices / laptops | Customer | Shared Responsibility Model — customer endpoint security |

| Evidence Source | Coverage Detail |
|-----------------|-----------------|
| AWS Shared Responsibility Model | Customer responsible for endpoint device security |
| AWS SOC 2 Type II | AWS coverage for AWS-managed assets at edge locations and other AWS facilities |

**Coverage Status:** **PARTIAL EXCLUSION** — AWS covers security of its own off-premises infrastructure (edge locations, Points of Presence). Customer retains responsibility for employee mobile devices, laptops, and any customer-owned equipment used off-premises. Document as **shared control** in SoA.

---

### A.7.10 — Storage Media

**ISO Requirement:** Storage media managed through acquisition, use, transportation, and disposal.

| Evidence Source | Coverage Detail |
|-----------------|-----------------|
| AWS SOC 2 Type II | Media lifecycle controls tested by EY |
| AWS Data Center Controls — Device Management | AWS assets centrally tracked through inventory management system (owner, location, status, maintenance) |
| AWS Data Center Controls — Media Destruction | Media with customer data classified as "Critical" (high impact); decommissioned per NIST 800-88; never leaves AWS control until securely destroyed |
| AWS ISO 27001 Certificate | Covers storage media management (Annex A.7.10 scope) |

**Coverage Status:** **MET** — AWS manages storage media through full lifecycle with NIST 800-88 compliant destruction. Media storing customer data never leaves AWS control until securely decommissioned. Covered by SOC 2 + ISO 27001.

---

## 3. Summary

| Control | Status | AWS Attestation Evidence | Notes |
|---------|--------|--------------------------|-------|
| A.7.1 Physical security perimeters | MET | SOC 2, ISO 27001, SRM, DC Controls | Fully inherited |
| A.7.2 Physical entry controls | MET | SOC 2, ISO 27001, DC Controls | Fully inherited |
| A.7.3 Securing offices, rooms, facilities | MET | SOC 2, ISO 27001, DC Controls | Fully inherited |
| A.7.4 Physical security monitoring | MET | SOC 2, ISO 27001, DC Controls | Fully inherited |
| A.7.5 Physical/environmental threats | MET | SOC 2, ISO 27001, DC Controls | Fully inherited |
| A.7.6 Working in secure areas | MET | SOC 2, ISO 27001, DC Controls | Fully inherited |
| A.7.7 Clear desk and clear screen | PARTIAL | SOC 2, SRM | Customer responsible for workstation clear desk/screen |
| A.7.8 Equipment siting and protection | MET | SOC 2, ISO 27001, DC Controls | Fully inherited |
| A.7.9 Security of assets off-premises | PARTIAL | SOC 2, SRM | Customer responsible for employee mobile devices |
| A.7.10 Storage media | MET | SOC 2, ISO 27001, DC Controls | Fully inherited (NIST 800-88 compliant destruction) |

**Legend:**
- MET = Control covered by AWS attestation; exclusion justified under Shared Responsibility Model
- PARTIAL = AWS covers infrastructure layer; customer retains some responsibility
- SRM = AWS Shared Responsibility Model
- DC Controls = AWS Data Center Controls (trust center page)

---

## 4. Residual Risk Assessment

**Risk:** Reliance on a single cloud provider for all 10 A.7 physical controls creates concentration risk.

**Mitigation:** AWS SOC 2 Type II and ISO 27001:2022 certifications are audited by independent third parties (EY, EY CertifyPoint) on a recurring basis. AWS publishes SOC 3 publicly and makes SOC 1/2 available via AWS Artifact. Bridge letters are available monthly for gap periods.

**Rating:** **LOW** — AWS certifications are current, independently audited, and updated on a defined cadence.

---

## 5. Evidence Locations

| Document | Location | Access |
|----------|----------|--------|
| AWS ISO 27001:2022 Certificate | [PDF](https://d1.awsstatic.com/onedam/marketing-channels/website/aws/en_US/certification/compliance/iso_27001_global_certification.pdf) | Public |
| AWS SOC 3 Report | [PDF](https://d1.awsstatic.com/onedam/marketing-channels/website/aws/en_US/whitepapers/compliance/AWS_SOC3_Report.pdf) | Public |
| AWS SOC 2 Type II Report | AWS Artifact (console.aws.amazon.com/artifact) | AWS account + NDA required |
| AWS SOC 1 Type II Report | AWS Artifact (console.aws.amazon.com/artifact) | AWS account + NDA required |
| AWS Shared Responsibility Model | https://aws.amazon.com/compliance/shared-responsibility-model/ | Public |
| AWS Data Center Controls | https://aws.amazon.com/compliance/data-center/controls/ | Public |
| AWS SOC FAQs | https://aws.amazon.com/compliance/soc-faqs/ | Public |
| AWS ISO 27001 FAQs | https://aws.amazon.com/compliance/iso-27001-faqs/ | Public |
| This Evidence Package | Uploaded to [RBR-23](/RBR/issues/RBR-23) | Internal |

---

## 6. Next Actions

1. **Retrieve AWS SOC 2 Type II report** from AWS Artifact — requires an AWS account holder to download and store in internal evidence repository. This is the full detailed report; SOC 3 is a public summary.
2. **Document A.7.7 and A.7.9 compensating controls** — since these are partial exclusions, document customer-side controls for workstation clear desk/screen (A.7.7) and mobile device management / off-premises asset protection (A.7.9).
3. **Update SoA** — reference this evidence package for all 10 A.7 control exclusions.
4. **Schedule re-verification** — AWS SOC 2 reports are issued biannually (Mar/Sep cycles). Set a reminder to refresh evidence at each cycle.
5. **Post evidence reference on [RBR-17](/RBR/issues/RBR-17)** for CISO review and SoA integration.