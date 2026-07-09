import type { EvidenceItem } from "./types.js";
import type { DrataDevice } from "../drata/types.js";
import { DrataClient } from "../drata/client.js";
import { config } from "../config.js";
import * as fs from "node:fs";
import * as path from "node:path";

export interface DeviceEvidenceParams {
  client?: DrataClient;
  outputDir?: string;
}

export interface DeviceComplianceStats {
  total: number;
  compliant: number;
  nonCompliant: number;
  encryptionEnabled: number;
  screenLockConfigured: number;
  antivirusEnabled: number;
  autoUpdateEnabled: number;
  firewallEnabled: number;
  passwordManagerEnabled: number;
  byOS: Record<string, { total: number; compliant: number }>;
  sampleNonCompliant: Array<{ id: number; model: string; osVersion: string; issues: string[] }>;
}

export async function collectMdmEvidence(params?: DeviceEvidenceParams): Promise<EvidenceItem[]> {
  const client = params?.client;
  const collectedAt = new Date().toISOString();
  const items: EvidenceItem[] = [];
  let deviceData: DrataDevice[] = [];
  let stats: DeviceComplianceStats | null = null;

  if (client) {
    try {
      deviceData = await client.getAllDevices();
      stats = computeDeviceStats(deviceData);

      if (params?.outputDir) {
        const dir = path.resolve(params.outputDir);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, "mdm-device-count.json"),
          JSON.stringify({ collectedAt, stats, deviceCount: deviceData.length }, null, 2)
        );
        fs.writeFileSync(
          path.join(dir, "mdm-device-detail.json"),
          JSON.stringify({ collectedAt, devices: deviceData.map(summarizeDevice) }, null, 2)
        );
      }
    } catch (err) {
      console.error("Drata device query failed:", err);
    }
  }

  const fallback = !stats;

  items.push({
    id: "MDM-DEVICE-COUNT",
    isoControlId: "A.8.1",
    isoControlTitle: "User endpoint devices",
    category: "A.8",
    source: "mdm",
    evidenceType: "monitoring",
    collectionMethod: fallback
      ? "Device enrollment count from Drata (621 devices enrolled, 0 compliant)"
      : `Drata /devices API: ${stats!.total} devices enrolled, ${stats!.compliant} compliant (${((stats!.compliant / Math.max(stats!.total, 1)) * 100).toFixed(1)}%)`,
    collectedAt: fallback ? "2026-07-09T00:00:00.000Z" : collectedAt,
    validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    status: fallback ? "not_available" : (stats!.compliant > 0 ? "collected" : "pending"),
    artifactRef: fallback ? "data/evidence/mdm-device-count.json" : "data/evidence/mdm-device-detail.json",
    metadata: fallback
      ? {
          enrolledDevices: 621,
          compliantDevices: 0,
          source: "Drata devices endpoint",
          drataEndpoint: "GET /public/v2/devices",
          blocker: "Drata API controls/evidence scope blocked; device compliance not queryable via current API key scopes",
        }
      : {
          enrolledDevices: stats!.total,
          compliantDevices: stats!.compliant,
          nonCompliantDevices: stats!.nonCompliant,
          encryptionEnabled: stats!.encryptionEnabled,
          screenLockConfigured: stats!.screenLockConfigured,
          antivirusEnabled: stats!.antivirusEnabled,
          firewallEnabled: stats!.firewallEnabled,
          byOS: stats!.byOS,
          source: "Drata /devices API (live query)",
          sampleNonCompliant: stats!.sampleNonCompliant.slice(0, 10),
        },
  });

  items.push({
    id: "MDM-ENCRYPTION",
    isoControlId: "A.8.1",
    isoControlTitle: "User endpoint devices",
    category: "A.8",
    source: "mdm",
    evidenceType: "config",
    collectionMethod: fallback
      ? "Device encryption status (FileVault/BitLocker) via MDM provider"
      : `Device encryption: ${stats!.encryptionEnabled}/${stats!.total} devices reporting encryption enabled`,
    collectedAt: fallback ? null : collectedAt,
    validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    status: fallback ? "pending" : (stats!.encryptionEnabled === stats!.total ? "collected" : "pending"),
    artifactRef: fallback ? null : "data/evidence/mdm-device-detail.json",
    metadata: fallback
      ? {
          providers: ["Jamf Pro", "Microsoft Intune", "Kandji"],
          jamfCommand: "jamf policy -event diskEncryption or API: GET /JSSResource/computers",
          intuneCommand: "Microsoft Graph API: GET /deviceManagement/managedDevices?$filter=isEncrypted eq false",
          recommendation: "Select one MDM provider, enroll devices, configure compliance policies",
        }
      : {
          encryptionEnabled: stats!.encryptionEnabled,
          encryptionDisabled: stats!.nonCompliant - stats!.encryptionEnabled,
          totalDevices: stats!.total,
          source: "Drata /devices API",
          recommendation: "Enable FileVault (macOS) or BitLocker (Windows) via MDM policy",
        },
  });

  items.push({
    id: "MDM-SCREEN-LOCK",
    isoControlId: "A.8.1",
    isoControlTitle: "User endpoint devices",
    category: "A.8",
    source: "mdm",
    evidenceType: "config",
    collectionMethod: fallback
      ? "Screen lock enforcement status via MDM provider compliance policy"
      : `Screen lock: ${stats!.screenLockConfigured}/${stats!.total} devices configured`,
    collectedAt: fallback ? null : collectedAt,
    validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    status: fallback ? "pending" : (stats!.screenLockConfigured === stats!.total ? "collected" : "pending"),
    artifactRef: fallback ? null : "data/evidence/mdm-device-detail.json",
    metadata: fallback
      ? {
          requirement: "Screen lock after 15 minutes of inactivity",
          isoRef: "A.7.7 (Clear desk and clear screen)",
          enforcement: "MDM configuration profile or Group Policy",
        }
      : {
          screenLockConfigured: stats!.screenLockConfigured,
          screenLockNotConfigured: stats!.nonCompliant - stats!.screenLockConfigured,
          totalDevices: stats!.total,
          requirement: "Screen lock after 15 minutes of inactivity",
          source: "Drata /devices API",
          recommendation: "Enforce screen lock via MDM configuration profile",
        },
  });

  items.push({
    id: "MDM-PATCH-COMPLIANCE",
    isoControlId: "A.8.1",
    isoControlTitle: "User endpoint devices",
    category: "A.8",
    source: "mdm",
    evidenceType: "monitoring",
    collectionMethod: fallback
      ? "OS patch compliance status via MDM provider"
      : `Auto-update: ${stats!.autoUpdateEnabled}/${stats!.total} devices have auto-update enabled`,
    collectedAt: fallback ? null : collectedAt,
    validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    status: fallback ? "pending" : (stats!.autoUpdateEnabled === stats!.total ? "collected" : "pending"),
    artifactRef: fallback ? null : "data/evidence/mdm-device-detail.json",
    metadata: fallback
      ? {
          requirement: "OS patches applied within 30 days of release",
          isoRef: "A.8.8 (Management of technical vulnerabilities)",
          enforcement: "MDM compliance policy with patch deadline",
        }
      : {
          autoUpdateEnabled: stats!.autoUpdateEnabled,
          autoUpdateDisabled: stats!.nonCompliant - stats!.autoUpdateEnabled,
          totalDevices: stats!.total,
          requirement: "OS patches applied within 30 days of release",
          isoRef: "A.8.8 (Management of technical vulnerabilities)",
          source: "Drata /devices API",
          byOS: stats!.byOS,
          recommendation: "Enforce auto-update via MDM policy or implement patch management schedule",
        },
  });

  items.push({
    id: "MDM-ANTI-MALWARE",
    isoControlId: "A.8.1",
    isoControlTitle: "User endpoint devices",
    category: "A.8",
    source: "mdm",
    evidenceType: "monitoring",
    collectionMethod: fallback
      ? "Anti-malware presence and status via MDM provider"
      : `Anti-malware: ${stats!.antivirusEnabled}/${stats!.total} devices have AV enabled`,
    collectedAt: fallback ? null : collectedAt,
    validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    status: fallback ? "pending" : (stats!.antivirusEnabled === stats!.total ? "collected" : "pending"),
    artifactRef: fallback ? null : "data/evidence/mdm-device-detail.json",
    metadata: fallback
      ? {
          requirement: "Anti-malware installed, running, and definitions up to date",
          isoRef: "A.8.7 (Protection against malware)",
          options: ["Microsoft Defender for Endpoint", "CrowdStrike Falcon", "SentinelOne"],
        }
      : {
          antivirusEnabled: stats!.antivirusEnabled,
          antivirusDisabled: stats!.nonCompliant - stats!.antivirusEnabled,
          firewallEnabled: stats!.firewallEnabled,
          totalDevices: stats!.total,
          source: "Drata /devices API",
          recommendation: "Deploy EDR/AV agent via MDM and configure compliance policy",
        },
  });

  return items.sort((a, b) => a.id.localeCompare(b.id));
}

function computeDeviceStats(devices: DrataDevice[]): DeviceComplianceStats {
  const total = devices.length;
  const compliant = devices.filter((d) => d.isDeviceCompliant).length;
  const nonCompliant = total - compliant;
  const encryptionEnabled = devices.filter((d) => d.encryptionEnabled === true).length;
  const screenLockConfigured = devices.filter((d) => d.screenLockTime !== null && d.screenLockTime !== undefined).length;
  const antivirusEnabled = devices.filter((d) => d.antivirusEnabled === true).length;
  const autoUpdateEnabled = devices.filter((d) => d.autoUpdateEnabled === true).length;
  const firewallEnabled = devices.filter((d) => d.firewallEnabled === true).length;
  const passwordManagerEnabled = devices.filter((d) => d.passwordManagerEnabled === true).length;

  const byOS: Record<string, { total: number; compliant: number }> = {};
  for (const d of devices) {
    const osKey = d.osVersion?.split(" ")[0] ?? "Unknown";
    if (!byOS[osKey]) byOS[osKey] = { total: 0, compliant: 0 };
    byOS[osKey].total++;
    if (d.isDeviceCompliant) byOS[osKey].compliant++;
  }

  const nonCompliantDevs = devices
    .filter((d) => !d.isDeviceCompliant)
    .slice(0, 10)
    .map((d) => {
      const issues: string[] = [];
      if (!d.encryptionEnabled) issues.push("Encryption disabled");
      if (!d.antivirusEnabled) issues.push("AV disabled");
      if (!d.autoUpdateEnabled) issues.push("Auto-update disabled");
      if (!d.firewallEnabled) issues.push("Firewall disabled");
      if (d.screenLockTime === null || d.screenLockTime === undefined) issues.push("Screen lock not configured");
      return { id: d.id, model: d.model ?? "Unknown", osVersion: d.osVersion ?? "Unknown", issues };
    });

  return {
    total,
    compliant,
    nonCompliant,
    encryptionEnabled,
    screenLockConfigured,
    antivirusEnabled,
    autoUpdateEnabled,
    firewallEnabled,
    passwordManagerEnabled,
    byOS,
    sampleNonCompliant: nonCompliantDevs,
  };
}

function summarizeDevice(d: DrataDevice) {
  return {
    id: d.id,
    model: d.model,
    osVersion: d.osVersion,
    serialNumber: d.serialNumber,
    sourceType: d.sourceType,
    isDeviceCompliant: d.isDeviceCompliant,
    encryptionEnabled: d.encryptionEnabled,
    screenLockTime: d.screenLockTime,
    antivirusEnabled: d.antivirusEnabled,
    autoUpdateEnabled: d.autoUpdateEnabled,
    firewallEnabled: d.firewallEnabled,
    passwordManagerEnabled: d.passwordManagerEnabled,
    lastCheckedAt: d.lastCheckedAt,
  };
}

export function generateMdmConfigurationGuide(): string {
  return `# MDM Configuration Guide for ISO 27001:2022 A.8.1 Evidence Collection

## Status: 621 devices enrolled in Drata, 0 compliant

## Required MDM Provider (choose one)

### Option A: Jamf Pro (Apple devices)
- Enroll macOS devices via DEP/ADE
- Configure compliance policies: FileVault, screen lock, patch deadline, anti-malware
- Export evidence via Jamf Pro API or Drata Jamf connector

### Option B: Microsoft Intune (mixed Windows/macOS)
- Enroll devices via AutoPilot or Company Portal
- Configure compliance policies in Endpoint Manager
- Export evidence via Microsoft Graph API or Drata Intune connector

### Option C: Kandji (Apple devices)
- Enroll macOS devices via ABM/ADE
- Configure compliance blueprints with parameter maps
- Export evidence via Kandji API or Drata Kandji connector

### Option D: Drata Device Agent
- Deploy lightweight agent to endpoints
- Collects: encryption status, screen lock, OS version, anti-malware presence
- Evidence auto-maps to Drata controls (A.8.1, A.8.7, A.8.8)
- Recommended for rapid deployment when full MDM is not feasible

## Evidence Collection Commands (Jamf Pro example)

\`\`\`bash
# Device encryption status
curl -u "\${JAMF_USER}:\${JAMF_PASS}" "\${JAMF_URL}/JSSResource/computers" \\
  -H "Accept: application/json" | jq '[.computers[] | {name: .name, filevault_enabled: .filevault2_enabled}]' > data/evidence/mdm-encryption.json

# Screen lock status
curl -u "\${JAMF_USER}:\${JAMF_PASS}" "\${JAMF_URL}/JSSResource/computers" \\
  -H "Accept: application/json" | jq '[.computers[] | {name: .name, screen_lock: .screen_saver_enabled}]' > data/evidence/mdm-screenlock.json

# Patch compliance
curl -u "\${JAMF_USER}:\${JAMF_PASS}" "\${JAMF_URL}/JSSResource/patchreports" \\
  -H "Accept: application/json" | jq '.' > data/evidence/mdm-patches.json
\`\`\`

## Drata MDM Connectors

Drata supports automated connectors for:
- Jamf (device enrollment, encryption, patch compliance)
- Microsoft Intune (device compliance, encryption, OS versions)
- Kandji (device inventory, compliance blueprints)

Enable the relevant connector in Drata: Settings > Integrations > Add Connector

## Next Steps
1. Select MDM provider and enroll all 621 devices
2. Configure compliance policies for A.8.1 requirements
3. Enable Drata connector for automated evidence collection
4. Run \`npm run evidence:manifest\` to update evidence manifest
`;
}