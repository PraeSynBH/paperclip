# Drata Device Agent — Deployment Guide

**Issue:** [RBR-86](/RBR/issues/RBR-86) — Deploy Drata Device Agent to 621 Endpoints
**Target:** All 144 active personnel
**Source:** [Drata Install Guide](https://help.drata.com/en/articles/13612377)

## Prerequisites

- Active Drata account (SSO login)
- Admin rights on your device (to install software)
- Supported OS: macOS 15+, Windows 10/11 (latest stable), Ubuntu 22.04/24.04 LTS

## Installation Steps

### Step 1: Log in to Drata

Navigate to `https://app.drata.com` and log in via SSO.

### Step 2: Open My Drata

From the dashboard, go to **My Drata** → Locate **Install the Drata Agent** task.

Alternatively, use the direct link: `https://app.drata.com/employee/install-agent`

### Step 3: Download & Install

1. Select your operating system (macOS, Windows, or Linux)
2. Download the installer file
3. Open the downloaded file and follow the installation prompts

### Step 4: Register the Agent

1. Return to Drata and click **Register Drata Agent**
2. Check your email inbox for the **Verify Drata Agent** message
3. Click **Verify Drata Agent** in the email
4. Follow any remaining prompts

Once verified, the agent runs automatically in the background. It checks in daily.

## What the Agent Collects (Read-Only)

| Data Point | Purpose |
|---|---|
| Disk encryption status | A.8.1 endpoint protection evidence |
| Screen lock timeout | A.8.1 endpoint protection evidence |
| OS version | A.8.8 vulnerability management |
| Antivirus status | A.8.7 malware protection |
| Password manager usage | A.8.1 access control |
| Auto-update status | A.8.8 patch management |

The agent **does not** modify system settings, monitor personal activity, or access files.

## Troubleshooting

| Issue | Resolution |
|---|---|
| Agent not reporting | Verify email registration was confirmed |
| Auto-update prompt | Approve the update — required for compliance |
| Ubuntu disk encryption | Must be uploaded manually (see Drata KB) |
| Wrong OS detected | Re-download the correct installer |

## Current Status (2026-07-27)

- **626 devices** enrolled in Drata (up from 621)
- **428/626 agents installed** (68.4% coverage, up from 0%)
- **0 fully compliant** — compliance fields not being evaluated by Drata
- **138 active personnel** (129 fully agent-covered, 9 need agent install)
- **9 employees without agent** — targeted outreach needed:
  - Jeff Wissel (jeff@aira.io)
  - Austin Doubleday (austin.doubleday@aira.io)
  - Ben Hamilton (ben.hamilton@aira.io)
  - James Schwarz (james.schwarz@aira.io)
  - Sara Meldrum (pendingGoogleProvisioning@aira.io)
  - bobs bookkeeping (bobs@aira.io)
  - Namus Itnagunak (namus@aira.io)
  - Miles Landry (miles.landry@aira.io)
  - Aira Mailbot (donotreplay@aira.io) — likely a service account, can skip
- **OS fleet composition:** Windows 308 (72%), macOS 119 (28%), Linux 1 (<1%)
- **Compliance field gaps:** antivirusEnabled, autoUpdateEnabled, passwordManagerEnabled are ALL null on 428 agent devices — likely a Drata workspace configuration issue (the Automated via Drata Agent toggle or test definitions may need updating)

## ISO 27001 Controls Satisfied

| Control | Requirement |
|---|---|
| A.8.1 | Endpoint device protection evidence |
| A.8.7 | Malware protection verification |
| A.8.8 | OS/software version tracking |

## CISO Coordination Checklist

- **Confirm automation toggle:** SecOps must verify the Drata workspace setting at *Settings > Internal Security > Automated via Drata Agent* is enabled before every wave so the install links and telemetry regions stay in sync with the rollout plan.
- **Communications:** Publish the email copy in `docs/drata-agent-communication.md` via the SecOps distribution channels (email, Slack, Drata notification) on the morning of each wave; include the install link and per-OS instructions so the self-service steps stay predictable.
- **Support queue:** SecOps owns tier-1 triage for macOS, Windows, and Ubuntu installs. Log every request in `training/logs/drata-agent-support.csv` (see `data/training/` for format), escalate unresolved issues to Security Engineering with the OS, error, and CI logs that explain why the agent did not verify.
- **Ubuntu encryption evidence:** After each Ubuntu install, the device owner must upload manual disk encryption proof per Drata KB `https://help.drata.com/en/articles/13609999-ubuntu-disk-encryption-proof` (reference the KB article when documenting the manual evidence so Drata credits A.8.1).
- **Monitoring windows:** The CISO/Compliance pair will monitor the Drata Personnel > Device Compliance dashboard every weekday morning. Track two metrics: `Coverage % = (installed agents / 621) * 100` and `Compliance % = (Drata compliant count / 621) * 100`. Record the daily totals in `data/evidence/mdm-compliance-log.csv` (add a row for today's readings).
- **Non-compliant follow-up:** Flag any device that remains non-compliant for 48 hours after install; route follow-up to the device owner’s manager and the regional support contact, then document the flag in `docs/drata-agent-communication.md#monitoring` (append a short note so the playbook stays current).
- **Reporting cadence:** Summarize coverage/compliance to Compliance by July 14 (pilot wave result) and again by July 18 (full fleet status). Paste the metrics into the RBR-89 issue comment with the date, coverage, compliance, and outstanding blockers so Compliance can match the deliverable dates.

## Next Steps (this heartbeat)

1. **Check pilot readiness (RBR-95):** Confirm SecOps and Awareness have run through the pilot checklist for the select subset of endpoints; capture the pilot start date/time so we can compare the 48-hour follow-up window.
2. **Secure the support channels:** Remind SecOps to publish the install instructions (email + Slack) with the `https://app.drata.com/employee/install-agent` link and to staff an escalation window for the next two waves.
3. **Update the compliance tracker:** Add today’s snapshot to `data/evidence/mdm-compliance-log.csv` with the current enrolled/ compliant counts (still 621 enrolled / 0 compliant as of this heartbeat) so the history is preserved for the Jul 14/18 metrics.
4. **Plan follow-up:** Watch for RBR-95 → RBR-96 status transitions; once we finish pilot communications, block 2 will depend on on-time compliance reports.
