# Host Firewall Remediation — MDM Deployment Guide (RBR-106)

**Issue:** [RBR-106](/RBR/issues/RBR-106)
**Parent:** [RBR-86](/RBR/issues/RBR-86)
**ISO 27001:2022 control:** A.8.1 (endpoint protection)
**Drata control:** Host firewall enabled (425 agent-installed devices, 110 failing)

## 1. Scope

Drata reports 110 agent-installed devices without a host firewall:

| OS       | Failing | Total agent-installed | % failing |
|----------|--------:|----------------------:|----------:|
| macOS    |      92 |                   119 |     77.3% |
| Windows  |      17 |                   305 |      5.6% |
| Unknown  |       1 |                     1 |    100.0% |
| **Total**| **110** |               **425** |  **25.9%** |

The "Unknown" device is a single Linux/ChromeOS agent host with no macOS/Windows
firewall mechanism. See Section 5.

## 2. Delivery channels

Use whichever channel reaches the device. Prefer MDM because the change is
idempotent and re-asserted on every check-in.

| Channel                 | Best for                                  | Files                               |
|-------------------------|-------------------------------------------|-------------------------------------|
| Jamf (macOS)            | All 92 macOS devices                      | `scripts/host-firewall-remediation-macos.sh` |
| Kandji (macOS, alt)     | Aira macOS fleet (if Kandji)              | Same script as Jamf                 |
| Intune / GPO (Windows)  | All 17 Windows devices                    | `scripts/host-firewall-remediation-windows.ps1` |
| Manual / break-glass    | Devices outside MDM coverage (e.g. Linux) | Same scripts, run elevated          |

## 3. macOS deployment (92 devices)

### 3.1 Jamf — preferred

Upload `scripts/host-firewall-remediation-macos.sh` as a Jamf **Script** (Settings → Computer Management → Scripts). Recommended settings:

- **Trigger:** Recurring Check-in
- **Frequency:** Once per computer (script is idempotent; the "Once per computer" frequency is a Jamf primitive, not a hard guarantee, so re-runs are safe and fast)
- **Run as:** Root
- **Parameters:** *(none — environment overrides for `EVIDENCE_DIR` are optional)*

After upload, scope the script to the **Smart Group** `Firewall - Non-Compliant` and click **Update**.

### 3.2 Kandji — alternative

Kandji's **Custom Script** library item accepts the same `.sh` file. Configure:

- **Execution:** Root
- **Trigger:** Daily check-in
- **Smart group scope:** `Devices with firewallDisabled == true`

### 3.3 Configuration profile alternative (no script)

If you cannot run shell scripts, deploy a **Configuration Profile** with this payload (place in a custom `.mobileconfig` or import via Jamf/Kandji profile editor):

```xml
<key>PayloadContent</key>
<array>
  <dict>
    <key>PayloadType</key><string>com.apple.security.firewall</string>
    <key>PayloadVersion</key><integer>1</integer>
    <key>PayloadIdentifier</key>
    <string>com.aira.firewall.RBR106</string>
    <key>PayloadUUID</string>
    <string>1A2B3C4D-5E6F-7890-ABCD-EF0123456789</string>
    <key>EnableFirewall</key><true/>
    <key>EnableStealthMode</key><true/>
    <key>EnableLogging</key><true/>
    <key>BlockAllIncoming</key><false/>
  </dict>
</array>
```

Profile-only deployment is sufficient for the Drata "Host firewall enabled"
control but does not log structured evidence to `data/evidence/`. Use the
script if you need an audit trail.

## 4. Windows deployment (17 devices)

### 4.1 Intune — preferred

Upload `scripts/host-firewall-remediation-windows.ps1` as a **Win32 app** or
**PowerShell script** (Devices → Scripts and remediations → Add → Windows 10
and later).

- **Run this script using the logged on credentials:** No
- **Enforce script signature check:** No
- **Run script in 64 bit PowerShell Host:** Yes

Assign to a **device group** filtered on `firewallEnabled == false`. The
script self-elevates when launched from a non-elevated context.

### 4.2 Group Policy (no Intune)

Open `gpedit.msc` (or the GPO editor on a domain controller) and enable:

- Computer Configuration → Administrative Templates → Network → Network Connections → **Windows Defender Firewall: Domain Profile: Enable firewall** = Enabled
- Computer Configuration → Administrative Templates → Network → Network Connections → **Windows Defender Firewall: Private Profile: Enable firewall** = Enabled
- Computer Configuration → Administrative Templates → Network → Network Connections → **Windows Defender Firewall: Public Profile: Enable firewall** = Enabled

Run `gpupdate /force` on each device, or wait for the next GPO refresh (90
± 30 minutes by default).

### 4.3 Local break-glass

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\host-firewall-remediation-windows.ps1
```

## 5. The single "Unknown" device

The 1 Unknown-OS failing device is a Linux/ChromeOS agent host. It does not
report an OS to Drata and is not reachable by either script. Hand off to
`RBR-108` ([data/scripts/triage-unknown-devices.py](../../data/scripts/triage-unknown-devices.py))
for OS identification, then remediate with the platform-appropriate
firewall (e.g. `ufw` on Ubuntu, `nftables`/`iptables` on RHEL).

## 6. Verification

After remediation, wait one Drata sync window (≤ 24 h) and re-run:

```bash
npx tsx src/drata/compliance-diagnostic.ts
```

Expected result: `aggregateControlFailure["Host firewall enabled"].failing`
drops from 110 to ≤ 1. If it does not:

1. Check `data/evidence/host-firewall-*.json` for the latest run record.
2. Re-run the script manually on the device to confirm exit code 0.
3. Verify the Drata agent process is running and reporting.

## 7. Rollback

Both scripts are intentionally additive and **never disable a working
firewall or delete existing rules**. Rollback is unnecessary for
"firewall enabled" remediation. If a firewall change is later linked to a
service disruption:

- **macOS:** `sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate off` (requires change-management approval)
- **Windows:** `netsh advfirewall set allprofiles state off` (requires change-management approval)

## 8. Audit trail

Every successful run writes a JSON evidence file:

```
data/evidence/host-firewall-<os>-<hostname>-<utc>.json
```

Files contain the before/after firewall state, host, timestamp, and exit
code. Collect these for ISO 27001 A.8.1 evidence on demand.
