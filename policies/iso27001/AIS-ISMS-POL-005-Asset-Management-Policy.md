# Asset Management Policy

**Document ID:** AIS-ISMS-POL-005
**Version:** 1.0
**Effective Date:** [Pending ISMS Owner approval]
**Review Cycle:** Annual
**Classification:** Internal

## 1. Purpose

This policy defines the requirements for identifying, classifying, handling, and protecting Rambur's information assets throughout their lifecycle.

## 2. Scope

This policy applies to all information assets (data, software, hardware, services, and personnel information) owned, managed, or used by Rambur, regardless of location or format.

## 3. Definitions

| Term | Definition |
|------|-----------|
| **Information Asset** | Any information, system, service, or supporting asset that has value to Rambur |
| **Asset Owner** | Individual accountable for the asset's classification, protection, and lifecycle |
| **Asset Custodian** | Individual responsible for implementing asset protection controls |

## 4. Policy Statements

### 4.1 Asset Inventory (A.5.9)

- A centralized inventory of all information assets shall be maintained
- Each asset record shall include at minimum: unique identifier, name, type, owner, classification, location, and status
- The inventory shall be reviewed and updated at least quarterly
- Assets shall be tracked from acquisition through disposal
- All hardware, software licenses, data stores, cloud resources, and API keys shall be inventoried

### 4.2 Asset Ownership (A.5.9)

- Every information asset shall have a designated owner
- Asset owners are responsible for: classification, access decisions, protection requirements, and lifecycle management
- Asset ownership shall be reviewed upon role changes and at least annually

### 4.3 Acceptable Use (A.5.10)

- All users shall comply with the Acceptable Use Policy (AIS-ISMS-POL-006)
- Assets shall be used only for authorized business purposes
- Personal use of Rambur assets is limited to incidental use that does not: consume significant resources, interfere with business operations, violate other policies, or introduce security risks

### 4.4 Return of Assets (A.5.11)

- All Rambur assets shall be returned upon termination of employment or contract
- The offboarding process shall include an asset return verification step
- Returned assets shall be inspected and securely wiped before reuse or disposed of securely
- Asset return shall be documented and confirmed by the departing individual's manager

### 4.5 Information Classification (A.5.12)

All information shall be classified according to the following scheme:

| Classification | Definition | Examples | Handling Requirements |
|---------------|------------|----------|----------------------|
| **Public** | Approved for public release | Marketing materials, public documentation | No restrictions |
| **Internal** | For Rambur personnel and authorized parties | Policies, procedures, internal communications | Access controlled, not for public distribution |
| **Confidential** | Sensitive business information | Financial data, contracts, IP, source code | Encrypted at rest and in transit, need-to-know access, audit logging |
| **Restricted** | Highly sensitive or regulated data | PII, auth secrets, encryption keys, customer data | Highest protection, encryption required, access logging, data residency controls |

### 4.6 Information Labelling (A.5.13)

- All information shall be labelled according to its classification
- Digital labelling: metadata, document headers/footers, email classification markers
- Physical labelling: cover sheets, labels on removable media
- Automated classification and labelling tools should be used where available

### 4.7 Information Transfer (A.5.14)

- Transfer of Confidential and Restricted information shall use encrypted channels
- External transfer of Confidential or Restricted data requires documented business justification
- Data transfer agreements or procedures shall exist for all transfer methods (email, file sharing, API, physical media)
- Transfer of data across jurisdictional boundaries shall comply with applicable data residency and cross-border transfer regulations

### 4.8 Asset Disposal (A.5.9, A.5.11)

- Assets containing information shall be securely sanitized before disposal
- Disposal methods:
  - Digital media: cryptographic erasure or physical destruction
  - Paper records: cross-cut shredding
  - Cloud resources: verified deletion of all data and backups
- Disposal shall be documented in the asset inventory

## 5. Responsibilities

| Role | Responsibility |
|------|---------------|
| Asset Owners | Classification, lifecycle management, access decisions |
| Engineering Lead | Technical inventory, asset tracking tooling |
| All Personnel | Return assets on departure, comply with classification handling, report lost or stolen assets |
| ISMS Owner | Classification scheme approval |

## 6. Mapped Controls

| Control | Description | Policy Section |
|---------|-------------|---------------|
| A.5.9 | Inventory of information and associated assets | 4.1, 4.2, 4.8 |
| A.5.10 | Acceptable use of information and associated assets | 4.3 |
| A.5.11 | Return of assets | 4.4, 4.8 |
| A.5.12 | Classification of information | 4.5 |
| A.5.13 | Labelling of information | 4.6 |
| A.5.14 | Information transfer | 4.7 |

## 7. Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jul 2026 | Compliance Agent (RBR-27) | Initial draft for ISO 27001:2022 certification |

## 8. Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| ISMS Owner | [Pending RBR-20] | _______________ | ________ |

*Approval pending ISMS Owner appointment per [RBR-20](/RBR/issues/RBR-20).*