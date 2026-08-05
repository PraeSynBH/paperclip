# ISO 27001:2022 Annex A Control Evidence Map — SentinelOne

**Issue:** [RBR-548](/RBR/issues/RBR-548)
**Parent:** [RBR-545](/RBR/issues/RBR-545) — Read Only Access and Assessment of SentinelOne data
**Phase:** 3 of 4
**Status:** Complete
**Sources:** RBR-523 plan (rev 2), RBR-524 schemas + implementation guide, RBR-529 API procedure

---

## 1. Purpose

Map SentinelOne Singularity Platform data to ISO 27001:2022 Annex A controls. For each control determine:

- **Coverage** — Full / Partial / None: how much of the control's evidence requirement can S1 directly satisfy
- **Evidence strength** — Strong / Moderate / Weak: how reliable and complete the S1 data is as audit evidence
- **Gaps** — what S1 cannot provide, and which system fills the gap

This map is the authoritative input for Phase 4 (assessment report, RBR-549) and for the Drata integration configuration (RBR-530, RBR-531).

---

## 2. Primary Controls (10) — Detailed Mapping

### A.5.7 — Threat intelligence

| Attribute | Value |
|-----------|-------|
| **ISO title** | Threat intelligence |
| **Control text** | The organisation shall establish and maintain processes to collect, analyse and evaluate threat intelligence. |
| **S1 endpoint** | `GET /web/api/v2.1/threat-intelligence/iocs` |
| **S1 data** | IoC count, type (domain/url/ip/hash), source, category, confidence, severity, validUntil, status (active/expired/deleted) |
| **Coverage** | **Full** — S1 provides a complete inventory of subscribed IoCs with metadata, sources, and lifecycle status |
| **Evidence strength** | **Strong** — IoC list is authoritative (S1 ingests from commercial + open-source feeds); each IoC has source attribution and confidence scoring |
| **Gap** | S1 provides IoC feeds but not the organisation's own threat intelligence *process* (who reviews feeds, how they are actioned, risk assessment methodology). Fill: CISO security policy document + risk register |
| **Fill system** | CISO policy (Confluence/Google Docs), Risk register (Drata or GRC tool) |
| **Drata evidence class** | `threat_event` (static Custom Connection — snapshot of active IoCs) |
| **Poll interval** | 24h |

---

### A.5.30 — ICT readiness

| Attribute | Value |
|-----------|-------|
| **ISO title** | ICT readiness for business continuity |
| **Control text** | The organisation shall plan, implement, maintain and test ICT readiness for business continuity. |
| **S1 endpoint** | `GET /web/api/v2.1/system/status` |
| **S1 data** | `health` (overall), `components[]` (per-service health of the S1 cloud console) |
| **Coverage** | **Partial** — S1 reports console-side health (cloud platform uptime), not endpoint-side readiness. Console health proves the EDR management plane is available. |
| **Evidence strength** | **Moderate** — Console health is a component of ICT readiness (EDR platform must be operational to protect endpoints), but does not cover network infrastructure, identity providers, email, or other business-critical SaaS |
| **Gap** | (1) Endpoint readiness — whether agents are active, online, and at current version. (2) Non-EDR ICT components (Google Workspace, GCP, networking). Fill: `GET /agents?isActive=true` for endpoint dimension; Google Workspace admin reports; GCP Cloud Monitoring for infrastructure |
| **Fill system** | SentinelOne `/agents` endpoint (endpoint dimension), Google Workspace Admin SDK reports, GCP Cloud Monitoring |
| **Drata evidence class** | `agent_inventory` (MT: hourly check on active-agent count and console health) |
| **Poll interval** | 1h |

---

### A.6.8 — Technical vulnerability management

| Attribute | Value |
|-----------|-------|
| **ISO title** | Technical vulnerability management |
| **Control text** | The organisation shall establish and maintain processes to identify, evaluate and manage technical vulnerabilities in a timely manner. |
| **S1 endpoint** | `GET /web/api/v2.1/application-risks` |
| **S1 data** | CVE ID, application name/version/vendor, severity (CVSS), detected_at, mitigated_at, is_mitigated, exploit_available, remediation advice |
| **Coverage** | **Full** — S1 Application Risk provides complete CVE-by-endpoint inventory with CVSS scoring, exploit status, and remediation tracking |
| **Evidence strength** | **Strong** — CVE data is sourced from NVD with S1 enrichment; exploit_available flag adds practical risk context; mitigated/unmitigated tracking satisfies "manage in a timely manner" |
| **Gap** | S1 covers endpoint application vulnerabilities. Does not cover: (1) Infrastructure vulnerabilities (GCP, network devices, cloud services). (2) Vulnerability management *process* documentation (triage SLAs, patching policy). Fill: GCP Security Command Center for infra vulns; CISO vulnerability management policy for process evidence |
| **Fill system** | GCP Security Command Center (infrastructure CVEs), CISO vulnerability management policy document |
| **Drata evidence class** | `vulnerability_finding` |
| **Poll interval** | 6h |

---

### A.8.1 — User endpoint devices

| Attribute | Value |
|-----------|-------|
| **ISO title** | User endpoint devices |
| **Control text** | The organisation shall define and implement measures for the management of user endpoint devices. |
| **S1 endpoint** | `GET /web/api/v2.1/agents` (list), `GET /web/api/v2.1/agents/{id}` (detail) |
| **S1 data** | uuid, computerName, osType, osName, osVersion, lastActiveDate, isActive, isDecommissioned, siteName, groupName, externalIp, internalIp, diskEncryptionStatus, firewallEnabled, serialNumber, modelName, agentVersion, scanStatus, threatRebootRequired, registeredAt, updatedAt |
| **Coverage** | **Full** — S1 agent inventory is the authoritative source for all managed endpoints: hardware, OS, agent health, encryption, firewall, scan status |
| **Evidence strength** | **Strong** — S1 agents are installed on every Rambur endpoint; the inventory is continuously updated via heartbeats; serial numbers and hardware models provide hardware asset tracking |
| **Gap** | (1) Unmanaged devices not running S1 agents (BYOD, IoT, printers). Fill: Ranger `/ranger/devices` for network-visible but unmanaged devices. (2) Mobile Device Management (MDM) enrollment status — S1 does not report whether a device is enrolled in the MDM. Fill: Google Workspace MDM or Intune. (3) Asset ownership/assignment (who uses which device). Fill: HRIS + Google Workspace device list |
| **Fill system** | SentinelOne Ranger (unmanaged devices), Google Workspace MDM (enrollment), HRIS (ownership assignment) |
| **Drata evidence class** | `agent_inventory` |
| **Poll interval** | 6h |

---

### A.8.2 — Privileged access rights

| Attribute | Value |
|-----------|-------|
| **ISO title** | Privileged access rights |
| **Control text** | The organisation shall establish and maintain processes for privileged access rights. |
| **S1 endpoints** | `GET /web/api/v2.1/users`, `GET /web/api/v2.1/rbac/roles` |
| **S1 data** | Users: id, fullName, email, role, scope, twoFaEnabled, source (sso/local), isServiceUser, lastLogin. Roles: id, name, description, permissions[], scope, builtIn |
| **Coverage** | **Partial** — S1 provides admin/privileged user inventory and RBAC role definitions *within the SentinelOne platform only*. Does not cover privileged access in other systems (Google Workspace admin, GCP IAM, AWS IAM, Drata, etc.) |
| **Evidence strength** | **Moderate** — S1 user/role data is authoritative for the EDR platform. Useful as corroborating evidence that the org manages privileged access, but only for one system |
| **Gap** | (1) Privileged access in all other systems. (2) Privileged access *policy* (who can approve, review cadence, least-privilege enforcement). (3) Cross-system correlation (same person's privilege across Google, GCP, AWS, S1, Drata). Fill: Google Workspace Admin SDK (Workspace admins), GCP IAM (GCP roles), AWS IAM Access Analyzer (AWS roles), CISO access management policy |
| **Fill system** | Google Workspace Admin reports, GCP IAM, AWS IAM, CISO access management policy |
| **Drata evidence class** | Custom Connection — `s1_user_inventory` (daily snapshot of S1 users + roles) |
| **Poll interval** | 24h |

---

### A.8.7 — Protection against malware

| Attribute | Value |
|-----------|-------|
| **ISO title** | Protection against malware |
| **Control text** | The organisation shall implement measures to detect, prevent and recover from malware. |
| **S1 endpoint** | `GET /web/api/v2.1/threats` |
| **S1 data** | threat_id, detected_at, classification (malware/ransomware/trojan/virus/worm/rootkit/spyware/cryptominer), confidence_level, mitigation_status (mitigated/not_mitigated/partially_mitigated), resolution_status, resolved_by, severity, threat_name, file_hash, initiated_by (agent_policy/user_action/system/api), indicators[] |
| **Coverage** | **Full** — S1 provides comprehensive malware detection, classification, and remediation tracking. Every threat has a mitigation status and resolution record |
| **Evidence strength** | **Strong** — S1's behavioral AI + static + cloud engines provide multi-layer detection; mitigation_status with timestamp demonstrates timely response; resolved_by shows automated vs. manual resolution |
| **Gap** | (1) Anti-malware *policy* documentation (scan schedules, exclusion policy, remediation policy). Fill: CISO endpoint protection policy. (2) Email-borne malware (phishing) — S1 detects on-endpoint execution but email gateway catches it earlier. Fill: Google Workspace / Gmail security reports. (3) Cloud workload malware (server-side). Fill: GCP Security Command Center |
| **Fill system** | CISO endpoint protection policy (Confluence/Google Docs), Google Workspace security reports (email gateway), GCP SCC (server-side) |
| **Drata evidence class** | `threat_event` |
| **Poll interval** | 1h |

---

### A.8.8 — Management of technical vulnerabilities

| Attribute | Value |
|-----------|-------|
| **ISO title** | Management of technical vulnerabilities |
| **Control text** | The organisation shall manage technical vulnerabilities in a timely manner. |
| **S1 endpoint** | `GET /web/api/v2.1/application-risks` (same as A.6.8) |
| **S1 data** | Same as A.6.8: CVE-by-endpoint inventory with CVSS, exploit status, remediation tracking |
| **Coverage** | **Full** — Same evidence class as A.6.8 (A.6.8 is the planning control; A.8.8 is the operational control — both draw from the same S1 vulnerability data) |
| **Evidence strength** | **Strong** — is_mitigated + mitigated_at timestamps demonstrate that vulnerabilities are managed "in a timely manner" |
| **Gap** | Same as A.6.8: infrastructure vulns and process documentation |
| **Fill system** | Same as A.6.8 |
| **Drata evidence class** | `vulnerability_finding` (linked MT — same evidence, different control assertion) |
| **Poll interval** | 6h |

---

### A.8.16 — Monitoring activities

| Attribute | Value |
|-----------|-------|
| **ISO title** | Monitoring activities |
| **Control text** | The organisation shall monitor networks, systems and applications for anomalous behaviour. |
| **S1 endpoints** | `GET /web/api/v2.1/dv/events` (Deep Visibility), `GET /web/api/v2.1/activities` (audit log) |
| **S1 data** | DV: event_id, event_type (Process Creation / File Modification / Network Connection / DNS Request / Registry Key Create / Scheduled Task), process_name/cmd/user, src_ip/dest_ip/dest_port, indicator_name/category, is_flagged. Activities: activity_type (user.login, policy.updated, threat.mitigation_status_changed, etc.), userId, userName, description, timestamp |
| **Coverage** | **Full** — S1 Deep Visibility provides continuous endpoint telemetry (process, file, network, registry events) plus behavioral detection indicators. The activities endpoint provides admin audit trail. Together they satisfy both monitoring dimensions: operational telemetry and administrative oversight |
| **Evidence strength** | **Strong** — DV events provide granular, near-real-time endpoint telemetry with behavioral indicator flagging. Activity log provides immutable admin action audit trail. Both are continuously generated |
| **Gap** | (1) Network-level monitoring (router/switch/firewall traffic). S1 sees endpoint-level network connections but not infrastructure telemetry. Fill: Network device logs → SIEM. (2) Server-side / cloud workload monitoring. Fill: GCP Cloud Logging, Google Workspace audit log. (3) SIEM retention and correlation — S1 data should flow to a SIEM for long-term retention and cross-source correlation. Fill: Chronicle / Google Security Command Center |
| **Fill system** | Chronicle SIEM (GCP/native), GCP Cloud Logging, Google Workspace audit log, network device syslog → SIEM |
| **Drata evidence class** | `dv_event` (operational telemetry), `threat_event` (detection events) |
| **Poll interval** | 1h (DV), 1h (activities) |

---

### A.8.20 — Networks security

| Attribute | Value |
|-----------|-------|
| **ISO title** | Networks security |
| **Control text** | The organisation shall secure networks against unauthorised access and attacks. |
| **S1 endpoints** | `GET /web/api/v2.1/dv/events` (network connections), `GET /web/api/v2.1/ranger/devices` (network discovery) |
| **S1 data** | DV: network connection events (src_ip, dest_ip, dest_port, protocol). Ranger: unmanaged devices, open ports, network segments, VLAN, risk_score. Agent inventory: firewallEnabled per endpoint |
| **Coverage** | **Partial** — S1 provides endpoint-level network telemetry and network discovery (Ranger) but does not manage or report on network infrastructure security (firewall rules, ACLs, VPN, IDS/IPS, network segmentation enforcement) |
| **Evidence strength** | **Moderate** — Endpoint firewall status (firewallEnabled) is direct evidence. Ranger provides network visibility into unmanaged devices and rogue hosts. DV network events show endpoint network connections. But S1 cannot confirm network-level security controls (firewall rule correctness, segmentation enforcement, IDS/IPS configuration) |
| **Gap** | (1) Network infrastructure security posture (firewall rules, ACLs, IPS policies, VPN configuration). (2) Network segmentation enforcement verification. (3) Network intrusion detection/prevention evidence. Fill: Firewall/IPS management console logs, network device configurations, GCP VPC firewall rules, Tailscale ACL policies |
| **Fill system** | GCP VPC Firewall Rules (Security Command Center), Tailscale ACL audit log, network device configurations (routers/switches), cloud firewall management |
| **Drata evidence class** | `dv_event` (network connection subset), `ranger_device` (network discovery) |
| **Poll interval** | 1h (DV), 24h (Ranger) |

---

### A.8.23 — Web filtering

| Attribute | Value |
|-----------|-------|
| **ISO title** | Web filtering |
| **Control text** | The organisation shall manage and control web filtering. |
| **S1 endpoints** | `GET /web/api/v2.1/dns/events`, `GET /web/api/v2.1/url/events` |
| **S1 data** | DNS: dnsRequest, dnsResponse, dnsResponseType (blocked/allowed/redirected/nxdomain), policyName, matchedRule. URL: url, method, action (blocked/allowed/warned), policyName, category |
| **Coverage** | **Full** — S1 provides DNS-layer and URL-layer filtering evidence with policy attribution, category classification, and action outcomes |
| **Evidence strength** | **Strong** — DNS and URL events are generated continuously when S1 DNS/URL filtering policies are active; blocked events directly demonstrate control effectiveness; policyName maps enforcement to the specific security policy |
| **Gap** | (1) Web filtering *policy* documentation (what categories are blocked, exception process). Fill: CISO web filtering policy. (2) Cloud-based web proxy / CASB evidence (if used in addition to S1). Fill: Google Workspace / Cloud Identity browsing reports. (3) DNS/URL filtering must be enabled in endpoint policy — S1 cannot confirm this configuration; the admin must attest. Fill: S1 policy configuration export + CISO attestation |
| **Fill system** | CISO web filtering policy (Confluence/Google Docs), Google Workspace browsing reports, S1 policy configuration export |
| **Drata evidence class** | `dv_event` (DNS/URL event subset) |
| **Poll interval** | 1h |

---

## 3. Extended Controls — Investigation

### A.8.9 — Configuration management

| Attribute | Value |
|-----------|-------|
| **ISO title** | Configuration management |
| **S1 endpoints** | `GET /web/api/v2.1/agents` (agent configuration), `GET /web/api/v2.1/rbac/roles` (role configuration), `GET /web/api/v2.1/groups` (group/site hierarchy) |
| **S1 data** | Agent: diskEncryptionStatus, firewallEnabled, agentVersion, scanStatus, policyName. Roles: permissions[], builtIn. Groups: group hierarchy, policy assignments |
| **Coverage** | **Partial** — S1 provides configuration state for endpoints and the S1 platform itself. Does not cover configuration of other systems |
| **Evidence strength** | **Moderate** — Agent configuration fields (encryption, firewall, agent version) are directly useful. But config management for the broader infrastructure stack is outside S1 scope |
| **Gap** | Infrastructure configuration management (GCP project config, Google Workspace settings, AWS account config). Fill: GCP Asset Inventory, AWS Config, Google Workspace admin settings export |
| **Fill system** | GCP Asset Inventory, AWS Config, Google Workspace Admin SDK |

---

### A.8.15 — Logging

| Attribute | Value |
|-----------|-------|
| **ISO title** | Logging |
| **S1 endpoint** | `GET /web/api/v2.1/activities` (admin audit log), `GET /web/api/v2.1/dv/events` (telemetry) |
| **S1 data** | Activities: full admin action audit log with user attribution and timestamps. DV: endpoint telemetry events |
| **Coverage** | **Partial** — S1 provides logging for its own platform (admin actions, detection events). The activities endpoint is a structured audit log. DV provides operational telemetry. Neither is a centralised log aggregation system |
| **Evidence strength** | **Moderate** — S1 audit log is well-structured and immutable for S1-scope events. However, the ISO control requires that the *organisation* maintain logging across all systems, not just the EDR platform |
| **Gap** | Centralised log aggregation, retention policy enforcement, log integrity verification, cross-system log correlation. Fill: Chronicle SIEM or Google Workspace audit log + GCP Cloud Logging |
| **Fill system** | Chronicle SIEM, GCP Cloud Logging, Google Workspace audit log |

---

### A.8.24 — Use of cryptography

| Attribute | Value |
|-----------|-------|
| **ISO title** | Use of cryptography |
| **S1 endpoint** | `GET /web/api/v2.1/agents` |
| **S1 data** | `diskEncryptionStatus` (encrypted / not_encrypted / encrypting / unknown) |
| **Coverage** | **Partial** — S1 reports disk encryption status per endpoint only. Does not cover: encryption in transit (TLS), key management, cryptographic algorithm choices, certificate management, or encryption of data at rest in cloud services |
| **Evidence strength** | **Weak** — diskEncryptionStatus is a single enum field; it confirms encryption-at-rest on endpoints but provides no detail on algorithm, key management, or compliance with cryptographic standards. The "unknown" state (agents that haven't reported) reduces reliability |
| **Gap** | (1) Encryption in transit (TLS versions, certificate validity). (2) Key management (KMS key rotation, key custody). (3) Cloud data encryption (GCP default encryption, customer-managed keys). (4) Cryptographic policy (approved algorithms, key lengths). Fill: GCP KMS audit log, GCP SSL policies, TLS scanner output, CISO cryptographic policy |
| **Fill system** | GCP KMS, GCP Cloud Security (encryption status), CISO cryptographic policy, SSL/TLS scanning tools |

---

## 4. Summary Table

| # | Control | Coverage | Evidence Strength | Gaps | Fill System |
|---|---------|----------|-------------------|------|-------------|
| 1 | A.5.7 Threat intelligence | **Full** | **Strong** | Process documentation (not data) | CISO policy, risk register |
| 2 | A.5.30 ICT readiness | **Partial** | **Moderate** | Non-EDR ICT components; endpoint readiness dimension | S1 /agents, Google Workspace, GCP Monitoring |
| 3 | A.6.8 Technical vulnerability mgmt | **Full** | **Strong** | Infrastructure vulns; process documentation | GCP SCC, CISO vuln mgmt policy |
| 4 | A.8.1 User endpoint devices | **Full** | **Strong** | Unmanaged devices; MDM enrollment; asset ownership | S1 Ranger, Google Workspace MDM, HRIS |
| 5 | A.8.2 Privileged access rights | **Partial** | **Moderate** | Privileged access in all other systems; cross-system correlation; policy | Google Workspace Admin, GCP IAM, AWS IAM, CISO policy |
| 6 | A.8.7 Protection against malware | **Full** | **Strong** | Anti-malware policy; email gateway; cloud workload | CISO endpoint policy, Google Workspace, GCP SCC |
| 7 | A.8.8 Mgmt of technical vulns | **Full** | **Strong** | Same as A.6.8 | Same as A.6.8 |
| 8 | A.8.16 Monitoring activities | **Full** | **Strong** | Network-level monitoring; server-side/cloud monitoring; SIEM retention | Chronicle SIEM, GCP Logging, Google Workspace audit |
| 9 | A.8.20 Networks security | **Partial** | **Moderate** | Network infrastructure config; segmentation enforcement; IDS/IPS | GCP VPC, Tailscale ACL, network device configs |
| 10 | A.8.23 Web filtering | **Full** | **Strong** | Policy documentation; CASB; DNS/URL filtering enablement attestation | CISO web filter policy, Google Workspace, S1 policy export |
| E1 | A.8.9 Configuration mgmt | **Partial** | **Moderate** | Infrastructure configuration management | GCP Asset Inventory, AWS Config, Google Workspace Admin |
| E2 | A.8.15 Logging | **Partial** | **Moderate** | Centralised log aggregation; retention; integrity; cross-system | Chronicle SIEM, GCP Logging, Google Workspace audit |
| E3 | A.8.24 Cryptography | **Partial** | **Weak** | Encryption in transit; key management; cloud encryption; crypto policy | GCP KMS, CISO crypto policy, TLS scanning |

**Scoring:**
- Full coverage: 7 of 10 primary controls (A.5.7, A.6.8, A.8.1, A.8.7, A.8.8, A.8.16, A.8.23)
- Partial coverage: 3 of 10 primary controls (A.5.30, A.8.2, A.8.20)
- None: 0 of 10
- Strong evidence: 7 of 10
- Moderate evidence: 3 of 10
- Weak evidence: 0 of 10

---

## 5. Gaps Analysis — Fill Systems

### 5.1 Gaps that require complementary tooling

| Gap Category | Affected Controls | Fill System | Status |
|---|---|---|---|
| **Infrastructure vulnerability management** | A.6.8, A.8.8 | GCP Security Command Center | Available (GCP native) |
| **Cross-system privileged access inventory** | A.8.2 | Google Workspace Admin + GCP IAM + AWS IAM | Available (native APIs) |
| **Network infrastructure security** | A.8.20 | GCP VPC Firewall + Tailscale ACL | Available (native APIs) |
| **Centralised logging / SIEM** | A.8.15, A.8.16 | Chronicle SIEM | Available (GCP ecosystem) |
| **Email / cloud workload malware** | A.8.7 | Google Workspace security + GCP SCC | Available (native) |
| **Encryption in transit / key management** | A.8.24 | GCP KMS + TLS scanning + CISO crypto policy | Partial — requires tooling setup |
| **MDM enrollment** | A.8.1 | Google Workspace MDM | Available (native) |
| **Asset ownership** | A.8.1 | HRIS (no current integration) | Gap — requires HRIS integration or manual attestation |

### 5.2 Gaps that require policy/process documentation

| Gap | Affected Controls | Fill | Owner |
|---|---|---|---|
| Threat intelligence review process | A.5.7 | CISO threat intelligence policy | CISO |
| Vulnerability management SLA / triage | A.6.8, A.8.8 | CISO vulnerability management policy | CISO |
| Privileged access approval & review | A.8.2 | CISO access management policy | CISO |
| Anti-malware scan/remediation policy | A.8.7 | CISO endpoint protection policy | CISO |
| Web filtering category policy | A.8.23 | CISO web filtering policy | CISO |
| Cryptographic standards policy | A.8.24 | CISO cryptographic use policy | CISO |

### 5.3 SentinelOne API access blocker

**Finding:** The AIRA_SENTINEL_ONE_API_KEY company secret currently contains a JWT (SSO session token, `iss: authn-us-east-1-prod`, `deployment_id: 91662`) rather than a proper S1 API service token (opaque string, `Authorization: ApiToken <token>` format). The JWT returns 401 on all authenticated S1 API v2.1 endpoints tested against `usea1-partners.sentinelone.net`.

**Impact:** Phase 2 (RBR-547, live API surface inventory) cannot be completed with live data until a proper API service token is provisioned per the RBR-529 procedure (Settings > Users > Service Users > Create Service User with Viewer role). Phase 3 mapping is based on the comprehensive RBR-523/RBR-524/RBR-529 documentation and is complete; Phase 4 (RBR-549) may need live validation.

**Recommendation:** Board/admin should provision a proper S1 API service token per RBR-529 §1.1 and update the AIRA_SENTINEL_ONE_API_KEY secret. This is a prerequisite for the Drata connector build (RBR-531).

---

## 6. Acceptance Criteria Checklist

- [x] All 10 primary controls mapped (§2)
- [x] Extended controls investigated (§3: A.8.9, A.8.15, A.8.24)
- [x] Control evidence map uploaded (this document)
- [x] Gaps analysis identifies fill systems (§5)

---

*Document produced by CISO agent, run c0a779b7-2173-4afe-8d3d-9111f806b57d, 2026-07-17.*
