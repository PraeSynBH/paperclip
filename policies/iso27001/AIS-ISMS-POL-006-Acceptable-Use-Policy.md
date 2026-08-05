# Acceptable Use Policy

**Document ID:** AIS-ISMS-POL-006
**Version:** 1.1
**Effective Date:** [Pending ISMS Owner approval]
**Review Cycle:** Annual
**Classification:** Internal — to be acknowledged by all personnel

## 1. Purpose

This policy defines the acceptable and unacceptable use of Rambur's information systems, networks, devices, and data. It establishes user responsibilities and prohibited activities to protect the confidentiality, integrity, and availability of Rambur's information assets. This policy extends to the use of AI systems (LLM APIs, AI-augmented workflows) in alignment with ISO/IEC 42001:2023 controls for responsible AI use (A.12.2) and AI-generated content provision (A.12.3).

## 2. Scope

This policy applies to all personnel, contractors, temporary staff, and any other individual or entity granted access to Rambur's information assets. It covers all Rambur-owned and Rambur-managed devices, networks, systems, applications, and data, whether accessed on-premise, remotely, or via personal devices. This scope explicitly includes Aira's AI-augmented agent workflows that interact with Google Gemini and OpenRouter APIs.

## 3. Policy Statements

### 3.1 General Use Principles (A.5.10)

All users shall:
- Use Rambur information assets only for authorized business purposes
- Protect assets from unauthorized access, disclosure, modification, or destruction
- Exercise reasonable care to prevent damage, loss, or theft
- Comply with all applicable laws, regulations, and Rambur policies
- Report security incidents, suspicious activity, and policy violations immediately

### 3.2 Prohibited Activities (A.5.10, A.8.1)

The following activities are expressly prohibited:

**System and Network Use:**
- Unauthorized access to any system, network, or data
- Attempting to bypass, disable, or circumvent security controls
- Network scanning, penetration testing, or vulnerability exploitation without explicit written authorization
- Installing unauthorized software, services, or hardware
- Connecting unauthorized devices to Rambur networks
- Using Rambur resources to attack, probe, or compromise external systems

**Data Handling:**
- Storing Confidential or Restricted data on unapproved locations (personal devices, personal cloud accounts, unencrypted media)
- Transferring Rambur data to personal email accounts or unauthorized external services
- Removing, copying, or transmitting Rambur data without authorization
- Destroying or altering data outside of authorized procedures

**Communication and Conduct:**
- Using Rambur resources for harassment, discrimination, or illegal activities
- Sending unauthorized bulk or unsolicited communications
- Impersonating other users or concealing identity
- Accessing, creating, storing, or transmitting offensive, obscene, or illegal content

**Authentication and Access:**
- Sharing passwords, tokens, or access credentials
- Using another person's account or allowing others to use your account
- Leaving authenticated sessions unattended without locking
- Using default, vendor-supplied, or weak credentials

### 3.3 Asset Handling (A.5.10)

- Portable devices (laptops, mobile devices, removable media) containing Rambur data shall be encrypted
- Devices shall be locked when unattended
- Physical documents containing Confidential or Restricted information shall be stored in locked cabinets when not in use
- Clean desk principle: sensitive information shall not be left visible on desks or in unsecured areas

### 3.4 Software and Services (A.8.1)

- Only authorized and licensed software shall be installed on Rambur systems
- Free, open-source, and trial software shall be reviewed before installation
- Cloud services and SaaS applications require prior approval per the Supplier Management Policy
- Browser extensions and plugins shall be limited to approved, business-necessary tools
- Software shall be kept current with vendor-supported versions and security patches

### 3.5 Network and Internet Use (A.8.1)

- Internet access is provided for business purposes
- Use of anonymizing proxies, VPNs (other than Rambur-approved), or tor to access Rambur systems is prohibited
- Peer-to-peer file sharing is prohibited unless specifically authorized
- Access to known malicious, illegal, or inappropriate websites is prohibited
- Excessive personal use of internet bandwidth that interferes with business operations is prohibited

### 3.6 Email and Messaging (A.5.10, A.8.1)

- Rambur email shall be used for business communications
- Personal email accounts shall not be used for Rambur business
- External transmission of Confidential or Restricted data shall be encrypted
- Users shall verify recipient addresses before sending sensitive information
- Suspicious emails (phishing, malware) shall be reported and not interacted with

### 3.7 Remote Working (A.6.7)

- Remote access shall use Rambur-approved methods (VPN, MFA-protected services)
- Remote work locations shall provide reasonable physical security
- Public Wi-Fi shall not be used without Rambur-approved VPN
- Rambur data shall not be viewed in public places where it may be observed
- Personal devices used for work shall meet Rambur's endpoint security requirements

### 3.9 AI System Use (ISO 42001 A.12.2, A.12.3, A.10.2)

The following rules apply to the use of Aira's AI-augmented agent workflows and any future AI/LLM services:

**Authorized AI Use:**
- AI systems may be used for authorized business purposes through Rambur-approved interfaces (Aira AI governance engine, `src/ai/`)
- AI model access is tiered by role: leadership roles → `gemini-2.5-pro`, IC/specialist roles → `gemini-2.5-flash`
- All AI API calls pass through the Rambur AI governance pipeline with content guardrails, PII detection, and safety settings enforced on every request

**Prohibited AI Activities:**
- Submitting Confidential or Restricted data to AI services outside of Rambur-approved AI pipelines
- Circumventing or attempting to bypass AI content guardrails (prompt injection, jailbreaking)
- Using AI systems to generate or distribute malicious code, phishing content, or deceptive communications
- Using AI systems for unauthorized automated decision-making affecting individuals without documented review and approval
- Accessing Rambur AI services through unauthorized third-party clients or personal API keys
- Uploading Rambur source code, credentials, or proprietary algorithms to public AI services (ChatGPT, Claude web UI, etc.) without explicit CISO authorization
- Using AI to impersonate Rambur personnel, clients, or partners

**Data Classification for AI Prompts:**
- Public and Internal data: may be submitted to Rambur-approved AI services
- Confidential data: may be submitted only through the Aira AI pipeline with data classification guardrails active
- Restricted/Regulated data (PII, credentials, financial): automatically blocked or redacted by AI pipeline guardrails — do not attempt to bypass

**AI-Generated Content:**
- AI-generated content used in Rambur deliverables shall be reviewed by a qualified human before distribution
- AI-generated code shall be reviewed through the standard code review process before merge
- AI system outputs that appear to contain hallucinations, factual errors, or safety violations shall be reported

### 3.10 Monitoring and Privacy (A.5.10, A.8.1)

- Rambur reserves the right to monitor systems, networks, and communications for security and compliance purposes
- Users have no expectation of privacy when using Rambur-owned systems
- Monitoring shall comply with applicable privacy laws and regulations
- Monitoring data shall be protected and accessed only for authorized purposes

## 4. Responsibilities

| Role | Responsibility |
|------|---------------|
| All Personnel | Read, acknowledge, and comply with this policy; report violations |
| Managers | Ensure team awareness and compliance |
| ISMS Owner | Policy approval and exceptions |
| CISO | Policy enforcement and incident response |

## 5. Compliance and Enforcement

- Acknowledgement of this policy is a condition of access to Rambur systems
- Violations may result in access suspension, disciplinary action, termination, and/or legal action
- The disciplinary process is defined in the HR policy framework
- Exceptions to this policy require documented justification and ISMS Owner approval

## 6. Mapped Controls

| Control | Description | Policy Section |
|---------|-------------|---------------|
| A.5.10 | Acceptable use of information and associated assets | 3.1, 3.2, 3.3, 3.6, 3.10 |
| A.8.1 | User endpoint devices | 3.2, 3.4, 3.5, 3.6, 3.10 |
| A.6.7 | Remote working | 3.7 |
| ISO 42001 A.12.2 | Responsible use of AI systems | 3.9 |
| ISO 42001 A.12.3 | Provision of AI-generated content | 3.9 |
| ISO 42001 A.10.2 | Data acquisition for AI systems | 3.9 |

## 7. Acknowledgement

I have read, understand, and agree to comply with the Rambur Acceptable Use Policy. I understand that violations may result in disciplinary action.

| Name | Signature / Electronic Acknowledgment | Date |
|------|---------------------------------------|------|
| | | |

## 8. Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jul 2026 | Compliance Agent (RBR-27) | Initial draft for ISO 27001:2022 certification |
| 1.1 | Jul 2026 | Compliance Agent (RBR-148) | Added AI system acceptable use section (3.9), data classification for AI prompts, prohibited AI activities, ISO 42001 A.12.2/A.12.3/A.10.2 cross-reference (F05) |

## 9. Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| ISMS Owner | [Pending RBR-20] | _______________ | ________ |

*Approval pending ISMS Owner appointment per [RBR-20](/RBR/issues/RBR-20).*