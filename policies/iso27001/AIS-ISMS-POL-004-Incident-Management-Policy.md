# Incident Management Policy

**Document ID:** AIS-ISMS-POL-004
**Version:** 1.2
**Effective Date:** [Pending ISMS Owner approval]
**Review Cycle:** Annual
**Classification:** Internal

## 1. Purpose

This policy defines the framework for planning, detecting, assessing, responding to, and learning from information security incidents to minimize impact and prevent recurrence. It also defines the channel and process for reporting concerns about AI systems (ISO/IEC 42001:2023 A.11.3), including the AI incident categories and submission procedure used by personnel, stakeholders, and automated pipeline monitors.

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

### 4.8 AI Concern Reporting (ISO/IEC 42001:2023 A.11.3)

Aira operates an AI subsystem (`src/ai/`) used by all internal agents and exposed to internal stakeholders. This subsection establishes a formal channel and process for any person — personnel, contractors, stakeholders, or automated pipeline monitors — to report concerns about the AI system's behavior, safety, fairness, transparency, or compliance. It satisfies ISO/IEC 42001:2023 control A.11.3 (Reporting of concerns) and the related ISO/IEC 27001:2022 controls A.5.23 (Information security for use of cloud services) and A.6.8 (Information security event reporting).

#### 4.8.1 AI Concern Categories

Concerns shall be classified using the following category codes. Multiple categories may apply to a single report.

| Code | Category | Description | Example |
|------|----------|-------------|---------|
| `AI-HAL` | Hallucination / Factual Error | Model produces plausible but incorrect or fabricated output | Cites a regulation that does not exist; invents a CVE id |
| `AI-BIA` | Bias / Unfair Treatment | Output reflects demographic, cultural, or other bias | Disparate recommendations across user groups |
| `AI-PRI` | Privacy / Data Leakage | PII or confidential data exposed in prompt, response, or log | SSN, API key, customer data not redacted |
| `AI-INJ` | Prompt Injection / Jailbreak | Bypass of guardrails, system prompt, or safety filters | New injection pattern that the 43-pattern set missed |
| `AI-EXA` | Excessive Agency | Model performs an action outside its authorized scope | Agent triggers a destructive command without approval |
| `AI-UNS` | Unsafe / Harmful Content | Output that is harassing, hateful, dangerous, or sexually explicit | Safety settings fail to block a prohibited category |
| `AI-TRN` | Transparency / Attribution Failure | Output is presented without required AI-system disclosure | User is unaware output is AI-generated |
| `AI-DRF` | Model Drift / Quality Degradation | Parity, latency, or accuracy has regressed from baseline | Gemini parity score drops below 85% for one week |
| `AI-BDG` | Budget / Cost Anomaly | Spend or token usage is abnormal for the workload | Daily cap hit by 09:00 local time |
| `AI-INC` | Provider Incident | Outage, safety-filter misfire, or policy violation by upstream AI provider | Gemini safety filter blocks legitimate content; OpenRouter outage |
| `AI-OTH` | Other AI Concern | Concern that does not fit the categories above (free-text description required) | — |

#### 4.8.2 Submission Channels

The following channels are officially designated for AI concern reports. Submissions may be made by any person regardless of role.

| Channel | Address / Location | Use Case | Anonymity |
|---------|--------------------|---------|-----------|
| **Primary — Email** | `ai-concerns@rambur.com` | All human-initiated reports | Reporter may self-identify or remain anonymous |
| **Secondary — GitHub Issue** | `ramburco/Aira` repository, label `ai-concern` | Reports that benefit from public discussion and code-level tracking | GitHub account; not anonymous |
| **Automated — Pipeline Hook** | `guardrail.blocked` events with `category` ≥ `AI-INJ` severity `HIGH`/`CRITICAL` | Auto-generated by the AI governance pipeline when a guardrail fires | N/A (system-generated) |
| **Anonymous — Email** | `ai-concerns@rambur.com` with subject prefix `[ANON]` | Whistleblower-style reports where retaliation risk exists | Reporter identity is stripped before triage |

All channels feed a single triage queue managed by the **SecOps Agent** (with CISO oversight). Submissions are acknowledged within one (1) business day. Anonymous reports receive the same triage and investigation standard as identified reports; reporter identity (when known) is protected from disclosure beyond the triage team and is not stored alongside the report record.

#### 4.8.3 AI Concern Severity Classification

Concerns shall be triaged into the following severity tiers. Tiers map to the Section 4.3 incident severity table for response time and escalation.

| Severity | Criteria | Response Time | Escalation |
|----------|----------|---------------|------------|
| **Critical** | Confirmed safety-filter bypass producing harmful content; mass PII disclosure; model exfiltration; provider-wide outage affecting production | 1 hour | CISO, ISMS Owner, Legal |
| **High** | Confirmed bias in a production output; novel prompt-injection bypass; parity score below 85% for 24+ hours; excessive-agency action that was blocked but indicates a control failure | 4 hours | CISO, Engineering Lead |
| **Medium** | Single-instance hallucination in a non-safety-critical context; data-classification warning that was not blocked; transparency attribution gap | 24 hours | Engineering Lead, SecOps |
| **Low** | Suspected issue that requires reproduction; minor drift in cost or latency; informational concern from a stakeholder | 5 business days | SecOps |

#### 4.8.4 Triage and Investigation Process

The SecOps Agent, with CISO approval, shall follow this structured process for every AI concern:

1. **Acknowledge** — Send an acknowledgment to the reporter (when an address is available) within 1 business day. Assign a unique concern ID of the form `AIC-YYYY-NNNN` and log it in the AI concern register.
2. **Reproduce** — Replay the prompt, re-run the pipeline, and capture the model output. Use the audit log (`AuditLogger`) and the cost-monitor event stream as the primary evidence sources.
3. **Classify** — Assign category code(s) (Section 4.8.1) and severity (Section 4.8.3). If the concern crosses into a Section 4.3 incident (e.g., confirmed PII disclosure), promote the concern to a security incident and link both records.
4. **Investigate** — Determine root cause: guardrail gap, model regression, provider issue, configuration error, or human factor. Cross-reference `guardrails.ts`, `gemini-client.ts`, `governance.ts`, and the `MigrationAdapter` parity records as appropriate.
5. **Mitigate** — Apply short-term mitigation (blocklist pattern, model rollback, budget cap, rate-limit reduction). Engineering Lead owns the fix; SecOps owns verification.
6. **Communicate** — Update the reporter (when reachable) on resolution status. Coordinate with CISO and ISMS Owner on external communication if the concern affects stakeholders beyond Aira.
7. **Close** — Document the full timeline, root cause, mitigation, and lessons learned in the concern record. Mark the concern `closed` once mitigation is verified.
8. **Learn** — Feed verified root causes into the AI risk register ([RBR-150](/RBR/issues/RBR-150)) and the guardrail improvement backlog ([RBR-157](/RBR/issues/RBR-157)). A post-concern review is required for any `Critical` or `High` concern within 10 business days of closure (per Section 4.6).

#### 4.8.5 Protection from Retaliation

Any person who reports an AI concern in good faith — whether identified or anonymous — shall be protected from retaliation. Retaliation in any form (employment action, access removal, public criticism, exclusion from decisions) is itself a reportable concern under category `AI-OTH` and is treated with severity `High` minimum. The ISMS Owner is the escalation owner for retaliation claims and operates independently of the engineering chain of command.

#### 4.8.6 Retention and Audit

AI concern records are retained for a minimum of three (3) years from the closure date, consistent with Section 4.5 evidence retention. Records include: original report (with identity redacted for anonymous submissions), category and severity, investigation notes, evidence captured (prompt, response, log excerpts), mitigation actions, and closure decision. The AI concern register is reviewed quarterly by the CISO and is part of the ISMS internal audit scope.

## 5. Responsibilities

| Role | Responsibility |
|------|---------------|
| ISMS Owner | Major incident decision authority, external communication approval, retaliation-claim escalation owner |
| CISO | Incident response coordination, severity classification, AI concern triage oversight |
| SecOps Agent | Detection, containment, investigation, evidence handling, AI concern triage queue ownership |
| Engineering Lead | Technical remediation, system recovery, guardrail/model fixes |
| All Personnel | Event reporting, cooperation with investigation, AI concern reporting (Section 4.8) |

## 6. Mapped Controls

| Control | Description | Policy Section |
|---------|-------------|---------------|
| A.5.24 | Incident management planning and preparation | 4.1 |
| A.5.25 | Assessment and decision on security events | 4.2, 4.3, 4.7 |
| A.5.26 | Response to information security incidents | 4.4 |
| A.5.27 | Learning from information security incidents | 4.6 |
| A.5.28 | Collection of evidence | 4.5 |
| A.5.5 | Contact with authorities | 4.7 |
| A.5.23 | Information security for use of cloud services | 4.8 |
| A.6.8 | Information security event reporting | 4.2, 4.8 |
| ISO/IEC 42001 A.11.3 | Reporting of concerns about AI systems | 4.8 |

## 7. Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jul 2026 | Compliance Agent (RBR-27) | Initial draft for ISO 27001:2022 certification |
| 1.1 | Jul 2026 | Compliance Agent (RBR-148) | Added A.11.3 cross-reference in Section 1 Purpose |
| 1.2 | Jul 2026 | SecOps Agent (RBR-153) | Added Section 4.8 AI Concern Reporting (ISO/IEC 42001:2023 A.11.3) — categories, submission channels, severity, triage process, retaliation protection, retention; updated Responsibilities and Mapped Controls |

## 8. Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| ISMS Owner | [Pending RBR-20] | _______________ | ________ |
| CISO | [CISO] | _______________ | ________ |

*Approval pending ISMS Owner appointment per [RBR-20](/RBR/issues/RBR-20).*