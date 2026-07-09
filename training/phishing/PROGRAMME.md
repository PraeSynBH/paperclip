# Arrowhead Phishing Simulation Programme

**Owner:** Security Awareness & Training Agent (CISO org)
**Project:** Aira — Arrowhead personnel
**Version:** 1.0
**Status:** Draft — pending CISO scope approval
**Created:** 2026-07-09

---

## Programme Scope

| Field | Value |
|-------|-------|
| Target Audience | All Arrowhead/Aira project personnel (4 segments: All Personnel, Management, Technical Staff, ISMS Personnel) |
| Simulation Types | Email-based phishing simulations with tracked landing pages |
| Cadence | Baseline (pre-training), Follow-up (post-training), then quarterly |
| Ethical Boundaries | No real credential capture. No individual shaming. Aggregate reporting only. Pre-approved sender domains. No external domain spoofing without explicit CISO approval. |
| Data Retention | Aggregate metrics retained indefinitely. Individual simulation results purged 90 days after report. No PII in reports. |
| ISO Controls | A.6.3 (awareness and training), A.5.4 (management responsibilities), A.8.4 (incident reporting) |

---

## 1. Three Simulation Scenario Designs

Each scenario is designed to test a specific threat vector relevant to Aira's context (Drata integration, Google AI integration, ISO 27001 compliance). Scenarios escalate in sophistication across the programme.

### Scenario 1: "Google AI Platform — Credential Verification"
**Threat Vector:** Credential harvesting via platform impersonation
**Relevance:** Aira is actively integrating Google Deepmind AI
**Difficulty:** Basic — recognizable phishing indicators present

**Email Lure:**

```
From: google-ai-platform@[simulation-domain]
Subject: Action Required: Verify your Google AI Console credentials

Hi {{first_name}},

Your Google AI Platform credentials require re-verification due to a recent
API key rotation. Please confirm your access within 48 hours to avoid
interruption to your Deepmind AI integrations.

Verify Credentials: [tracked-link]

This is an automated notification from Google AI Platform.
```

**Landing Page:** Branded page mimicking Google AI Console login. Contains:
- Google-style header with "Sign in to AI Platform"
- Email and password fields (no real credential capture — form submits to a "This was a simulation" training page)
- Subtle indicators: generic greeting text, minor URL mismatch in footer

**Tracking:**
- Link click → redirect to tracker, log click
- Form submit → redirect to training page, log submit
- Report rate → tracked by "Report phishing" button present in email client or forwarded to security@

**Training Page (post-click):** Explains the phishing indicators they missed, shows the real vs. fake URL comparison, links to Module 1 (ISO 27001 fundamentals).

---

### Scenario 2: "Drata — Urgent Compliance Alert"
**Threat Vector:** Authority impersonation + urgency
**Relevance:** Aira uses Drata for compliance monitoring
**Difficulty:** Intermediate — better-crafted, fewer obvious indicators

**Email Lure:**

```
From: compliance@[simulation-domain]
Subject: ISO 27001: Action Required — Drata evidence gap detected

{{first_name}},

Drata has detected a compliance gap in your assigned control evidence.
ISO 27001 Control A.8.5 requires this to be resolved within 24 hours.

Click below to review the gap and submit your attestation:
[tracked-link]

This is an automated alert from the Drata Continuous Monitoring Platform.
Reply-to: drata-compliance-noreply@[simulation-domain]
```

**Landing Page:** Drata-styled dashboard alert page. Contains:
- "Evidence Gap Detected" banner
- A fake control listing: "A.8.5 — Secure Authentication — Missing Attestation"
- "Submit Attestation" button → redirects to training page

**Tracking:**
- Link click → logged
- "Submit" button → logged as action taken
- Report rate → tracked

**Training Page (post-click):** Explains urgency manipulation tactics, shows how to verify compliance alerts through Drata directly (not email links), links to Module 2 (ISMS policies).

---

### Scenario 3: "IT Support — Password Expiry"
**Threat Vector:** Internal IT impersonation + account compromise
**Relevance:** Universal threat, tests resistance to authority-based social engineering
**Difficulty:** Advanced — personalized, low-visibility indicators

**Email Lure:**

```
From: it-support@[simulation-domain]
Subject: Your Aira password expires in 24 hours

Hi {{first_name}},

Our identity management system shows your Aira account password is set to
expire tomorrow at 18:00 UTC. To avoid losing access to Slack, email,
and the developer portal, please reset your password now.

Reset Password: [tracked-link]

If you have already reset your password recently, please ignore this message.

— Aira IT Support
  This is an automated notification from the Aira Identity Management System.
```

**Landing Page:** Internal-looking password reset page. Contains:
- "Aira Identity Management" header
- Current password + new password + confirm password fields (no real credential capture — submits to training page)
- Subtle indicators: domain mismatch, generic "IT Support" signature

**Tracking:**
- Link click → logged
- Any field interaction or submit → logged
- Report rate → tracked

**Training Page (post-click):** Explains internal IT impersonation, shows the real password reset process vs. the fake, links to Module 3 (role-based responsibilities).

---

## 2. Baseline Phishing Simulation Plan

**Purpose:** Establish pre-training click rate and report rate baseline before any awareness training is delivered.

**Timing:** Launch before Module 1 distribution (or capture as "cold open" if training already started).

**Execution:**

| Step | Description | Owner |
|------|-------------|-------|
| 1. CISO Approval | Confirm scope, audience, sender domains, and ethical boundaries | CISO |
| 2. Recipient List | Compile All Personnel roster from project directory | Awareness Agent |
| 3. Scenario Selection | Run **Scenario 1** (lowest difficulty) for baseline | Awareness Agent |
| 4. Send Window | Distribute over 3 business days (staggered morning/midday/afternoon) | Awareness Agent |
| 5. Collection Window | 7 calendar days from last send for clicks and reports | Awareness Agent |
| 6. Report | Produce Baseline Report within 3 business days of collection close | Awareness Agent |

**Success Metrics (Baseline):**

| Metric | Target | Measurement |
|--------|--------|-------------|
| Click Rate | Measure, no target (this is the baseline) | (unique clicks / emails delivered) x 100 |
| Report Rate | Measure, no target (this is the baseline) | (unique reports / emails delivered) x 100 |
| Click-and-Report Rate | Measure | (reported after clicking / total clicks) x 100 |
| Delivery Rate | >= 95% | (delivered / sent) x 100 |

**Result Disposition:**
- Results reported in aggregate only (by role segment, never by individual)
- Baselines recorded for trend comparison
- No remedial action from baseline alone — this is measurement, not intervention

---

## 3. Post-Training Follow-Up Simulation Plan

**Purpose:** Measure training effectiveness by comparing click rate and report rate after training completion.

**Timing:** 30 days after Module 1–3 completion deadline (i.e., after 2026-07-24 + 30 days = ~2026-08-24).

**Execution:**

| Step | Description | Owner |
|------|-------------|-------|
| 1. Verify Training Completion | Confirm >= 80% of personnel completed all three modules | Awareness Agent |
| 2. Run Simulation | Deploy **Scenario 2** ("Drata — Urgent Compliance Alert") | Awareness Agent |
| 3. Collection Window | 7 calendar days | Awareness Agent |
| 4. Compare vs. Baseline | Compute delta: click rate change, report rate change | Awareness Agent |
| 5. Produce Report | Post-Training Report with before/after comparison | Awareness Agent |
| 6. Targeted Re-Training | If any segment's click rate remains > baseline, schedule supplemental training for that segment | Awareness Agent |

**Success Metrics (Post-Training):**

| Metric | Target vs. Baseline | Measurement |
|--------|---------------------|-------------|
| Click Rate | Decrease of >= 50% from baseline | (unique clicks / emails delivered) x 100 |
| Report Rate | Increase of >= 100% from baseline | (unique reports / emails delivered) x 100 |
| Click-and-Report Rate | >= 30% of clickers also reported | (reported after clicking / total clicks) x 100 |

**Result Disposition:**
- If click rate drops >= 50% and report rate doubles: phishing awareness training is effective
- If click rate drops but report rate is flat: add a "how to report" spotlight to next micro-learning cycle
- If click rate is unchanged: escalate to CISO with recommendation for mandatory remedial training per segment
- If click rate increased: escalate to CISO as urgent — possible issue with training delivery or content

---

## Quarterly Cadence (Post-Programme)

After the post-training follow-up, shift to quarterly simulations using a rotating scenario pool:

| Quarter | Scenario | Purpose |
|---------|----------|---------|
| Q3 2026 | Scenario 3 (IT Support) | Test after programme completion |
| Q4 2026 | New variant (CISO-chosen threat) | Keep lures fresh |
| Q1 2027 | Scenario 1 replay | Measure decay over 6 months |
| Q2 2027 | New variant | Pre-refresher baseline for annual cycle |

Each quarterly run produces a 1-page report with: click rate, report rate, trend line from baseline, and a "reinforcement needed?" recommendation.

---

## 4. Report Template

### Phishing Simulation Report — [Run Identifier]
**Date:** [YYYY-MM-DD]
**Simulation Phase:** [Baseline / Post-Training / Quarterly Q#]
**Scenario:** [Scenario 1/2/3/Custom]
**Owner:** Security Awareness & Training Agent

---

#### 1. Executive Summary

[2–3 sentence summary: what was tested, key findings, trend]

| Metric | This Run | Previous Run | Delta |
|--------|----------|-------------|-------|
| Click Rate | X% | Y% | +Zpp / -Zpp |
| Report Rate | X% | Y% | +Zpp / -Zpp |
| Click-and-Report Rate | X% | N/A or Y% | — |

---

#### 2. Run Details

| Detail | Value |
|--------|-------|
| Scenario | [Name] |
| Emails Sent | N |
| Emails Delivered | N |
| Sending Window | YYYY-MM-DD to YYYY-MM-DD |
| Collection Close | YYYY-MM-DD |
| Audience Segments | All Personnel / per role |

---

#### 3. Results by Segment

| Segment | Delivered | Clicked | Click Rate | Reported | Report Rate | Clicked+Reported |
|---------|-----------|---------|------------|----------|-------------|------------------|
| All Personnel | N | N | X% | N | X% | X% |
| Management | N | N | X% | N | X% | X% |
| Technical Staff | N | N | X% | N | X% | X% |
| ISMS Personnel | N | N | X% | N | X% | X% |

---

#### 4. Trend Analysis

| Run | Date | Scenario | Click Rate | Report Rate |
|-----|------|----------|------------|-------------|
| Baseline | YYYY-MM-DD | Scenario 1 | X% | X% |
| Post-Training | YYYY-MM-DD | Scenario 2 | X% | X% |
| Q3 2026 | YYYY-MM-DD | Scenario 3 | X% | X% |

---

#### 5. Recommendations

- [ ] [Actionable recommendation based on results]
- [ ] [Targeted re-training for segment(s) if needed]
- [ ] [Micro-learning content update if knowledge gaps found]

---

#### 6. Next Simulation

| Detail | Value |
|--------|-------|
| Next Run | [YYYY-MM-DD or quarter] |
| Scenario | [Name] |
| Phase | [Baseline / Post-Training / Quarterly] |

---

## CISO Approval Required

Before any simulation is launched, the CISO must approve:

1. **Scope:** Arrowhead/Aira project personnel (All Personnel, Management, Technical Staff, ISMS Personnel)
2. **Sender Domains:** Simulation domain(s) to be used for email sending
3. **Scenario Content:** All three scenario designs approved for use
4. **Ethical Boundaries Confirmed:** No real credential capture, aggregate-only reporting, bounded campaign window
5. **Launch Timing:** Baseline simulation timing relative to training rollout
6. **Remediation Policy:** What happens if post-training click rate does not improve (remedial training, not disciplinary)

---

## Programme Timeline

| Milestone | Date | Status |
|-----------|------|--------|
| Programme Design Complete | 2026-07-09 | Done |
| CISO Scope Approval | TBD — pending | Blocked |
| Baseline Simulation (Scenario 1) | +5 business days after approval | Pending |
| Baseline Report | +3 business days after collection | Pending |
| Post-Training Simulation (Scenario 2) | ~2026-08-24 | Pending |
| Post-Training Report | +3 business days after collection | Pending |
| First Quarterly Simulation (Scenario 3) | Q3 2026 | Pending |

---

## References

- [RBR-25 — A.6.3 Training Programme](/RBR/issues/RBR-25)
- [RBR-37 — Phishing Simulation Programme](/RBR/issues/RBR-37)
- [Aira ISMS Training Programme](/RBR/issues/RBR-25#document-programme)
- ISO/IEC 27001:2022 Annex A Controls A.6.3, A.5.4, A.8.4
- NIST Phish Scale (for scenario difficulty calibration reference)
