# Drata Agent Installation — Personnel Communication

**To:** All active personnel (144 employees)
**Subject:** ACTION REQUIRED: Install Drata Device Agent for compliance

---

Hello,

As part of our ISO 27001 compliance program, please install the Drata Device Agent on your work computer. This lightweight, read-only application verifies that required security settings (disk encryption, screen lock, antivirus) are active on your device.

## Instructions (5 minutes)

1. Log in to **https://app.drata.com** via SSO
2. Go to **My Drata** → **Install the Drata Agent**
3. Download the installer for your OS (macOS/Windows/Linux)
4. Open the installer and follow the prompts
5. Click **Register Drata Agent** on the Drata page
6. Check your email for the verification message and click **Verify**

The agent runs silently in the background and checks in daily. It has read-only access to system settings and does not monitor personal activity.

**Deadline:** Please complete by end of this week (August 1, 2026).

Contact SecOps with any issues.

---

## Targeted Follow-Up (2026-07-27)

As of July 27, 428/626 devices (68.4%) have the Drata Agent installed. The following 9 employees still need to complete installation:

| Name | Email | Action Needed |
|---|---|---|
| Jeff Wissel | jeff@aira.io | Install agent on device |
| Austin Doubleday | austin.doubleday@aira.io | Install agent on device |
| Ben Hamilton | ben.hamilton@aira.io | Install agent on device |
| James Schwarz | james.schwarz@aira.io | Install agent on device |
| Sara Meldrum | pendingGoogleProvisioning@aira.io | Install agent on device |
| bobs bookkeeping | bobs@aira.io | Install agent on device |
| Namus Itnagunak | namus@aira.io | Install agent on device |
| Miles Landry | miles.landry@aira.io | Install agent on device |

Note: Aira Mailbot (donotreplay@aira.io) is a service account and can be excluded.

### Compliance Configuration Issue (Blocking 0% Compliance)

Despite 428 agent installs, device compliance remains at 0% because critical Drata test fields are not being evaluated:
- `antivirusEnabled`: ALL null
- `autoUpdateEnabled`: ALL null
- `passwordManagerEnabled`: ALL null
- `screenLockTime`: 145 null
- `encryptionEnabled`: 308 null

**Root cause**: The Drata workspace "Automated via Drata Agent" toggle or security test definitions likely need reconfiguration. SecOps must verify Settings > Internal Security > Automated via Drata Agent is enabled, and that all required security tests are active in the Drata control framework.

---

## Distribution Channels

| Channel | Method | Owner |
|---|---|---|
| Email blast | Bulk email to all active personnel | SecOps |
| Slack #general | Announce + pinned instructions | SecOps |
| Drata notifications | Via Drata My Drata page | Auto |