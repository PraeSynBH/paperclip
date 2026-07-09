# Module 3: Role-Based Security Responsibilities

**Audience:** All Personnel (role-specific sections)  
**Duration:** 30 minutes  
**Format:** Self-paced reading with role-specific tracks  
**Prerequisites:** Modules 1 and 2  

---

## 1. Introduction

Security responsibilities vary by role. This module defines what is expected of each role group. Everyone should read the "All Personnel" section plus their specific role section.

---

## 2. All Personnel (Everyone Reads This)

### Daily Security Practices

- **Lock your workstation** when stepping away (Win+L / Cmd+Ctrl+Q).
- **Verify requests** before acting on them — especially urgent requests for money, data, or access changes.
- **Question unusual requests** — social engineering is the most common attack vector.
- **Keep software updated** — install security patches promptly.
- **Use approved tools only** — do not use personal devices or unapproved cloud services for Aira data.

### Reporting Obligations

You must report:
- Phishing emails (report, don't just delete)
- Suspicious system behaviour (unexpected pop-ups, slow performance, unknown processes)
- Lost or stolen devices immediately
- Any request for your password or MFA code
- Unauthorized individuals in secure areas (if physical office)
- Policy violations you witness

### Data Protection

- Know the classification of data you handle.
- Do not store confidential data on local hard drives unless encrypted and approved.
- Use secure file sharing methods (not personal email or unapproved services).
- Verify recipients before sending confidential information.
- Clean desk: no confidential papers or unlocked screens in shared spaces.

---

## 3. Management Responsibilities

**Applies to:** Team Leads, Managers, Directors, Executives

### Training Enforcement

- Ensure all direct reports complete mandatory training within deadlines.
- Track training completion for your team.
- Address non-compliance promptly.

### Security Culture

- Include a security topic in at least one team meeting per month.
- Lead by example — follow all policies visibly.
- Recognize team members who report security issues.
- Do not punish honest reporting of mistakes.

### Access Management

- Review team access rights quarterly.
- Approve access requests based on business need (not convenience).
- Request immediate access revocation when someone leaves or changes role.
- Never approve your own access requests — separation of duties applies.

### Incident Response

- Know the incident reporting procedure.
- Ensure your team knows how to report incidents.
- Support investigations without interference.
- Communicate incident status to your team as authorized.

### Risk Management

- Identify security risks in your area of responsibility.
- Report risks to the CISO or security team.
- Accept residual risks only with CISO authorization.

---

## 4. Technical Staff Responsibilities

**Applies to:** Developers, Engineers, DevOps, IT Staff

### Secure Development

- Follow secure coding practices (OWASP Top 10 awareness).
- Never hard-code secrets (API keys, passwords, tokens) in source code.
- Use environment variables or a secrets manager for credentials.
- Run security scanning tools as part of your workflow.
- Review code for security issues before merging.

### Systems and Infrastructure

- Apply the principle of least privilege to all systems.
- Use service accounts with minimal permissions (not personal accounts) for automation.
- Keep systems patched and updated.
- Monitor for unusual activity in systems you manage.
- Harden systems according to security baselines.

### Data Handling

- Encrypt data at rest and in transit.
- Sanitize logs before sharing — remove secrets and PII.
- Delete data when no longer needed per retention policy.
- Test backups regularly — a backup you can't restore isn't a backup.

### Change Management

- All production changes go through approved change control.
- Test changes in non-production environments first.
- Have a rollback plan for every change.
- Document changes for audit trail.

### Vulnerability Management

- Respond to vulnerability alerts within defined SLAs.
- Apply critical patches within 24 hours.
- Document remediation actions.

---

## 5. ISMS Personnel Responsibilities

**Applies to:** CISO, Compliance Team, Security Team, Internal Audit

### ISMS Governance

- Maintain the ISMS documentation and ensure it reflects current practice.
- Conduct management reviews per the ISMS schedule.
- Track control effectiveness metrics.
- Coordinate internal and external audits.

### Risk Management

- Maintain the risk register and treatment plan.
- Conduct risk assessments for new systems, suppliers, and significant changes.
- Review risk acceptance decisions periodically.
- Report residual risks to management.

### Continuous Improvement

- Review security incidents for root cause and preventative actions.
- Update policies based on lessons learned.
- Track training programme metrics and adjust content.
- Benchmark against industry standards.

### Audit Readiness

- Ensure evidence collection is working (automated where possible).
- Maintain the Statement of Applicability (SoA).
- Prepare audit schedules and coordinate auditor access.
- Track and close audit findings within agreed timelines.

---

## 6. Summary Matrix

| Responsibility | All | Mgmt | Tech | ISMS |
|---------------|-----|------|------|------|
| Complete training | ✓ | ✓ | ✓ | ✓ |
| Report incidents | ✓ | ✓ | ✓ | ✓ |
| Enforce team training | — | ✓ | — | — |
| Access reviews | — | ✓ | — | ✓ |
| Secure development | — | — | ✓ | — |
| Vulnerability mgmt | — | — | ✓ | ✓ |
| ISMS governance | — | — | — | ✓ |
| Audit coordination | — | — | — | ✓ |

---

## Knowledge Check

After completing this module, proceed to the assessment:
`training/assessments/module3-quiz.md`