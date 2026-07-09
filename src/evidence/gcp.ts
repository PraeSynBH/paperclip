import type { EvidenceItem } from "./types.js";

const GCP_IAM_CONTROLS: Array<{ id: string; title: string }> = [
  { id: "A.8.2", title: "Privileged access rights" },
  { id: "A.8.3", title: "Information access restriction" },
  { id: "A.8.5", title: "Secure authentication" },
];

const GCP_INFRA_CONTROLS: Array<{ id: string; title: string }> = [
  { id: "A.8.6", title: "Capacity management" },
  { id: "A.8.7", title: "Protection against malware" },
  { id: "A.8.8", title: "Management of technical vulnerabilities" },
  { id: "A.8.9", title: "Configuration management" },
  { id: "A.8.10", title: "Information deletion" },
  { id: "A.8.11", title: "Data masking" },
  { id: "A.8.12", title: "Data leakage prevention" },
  { id: "A.8.13", title: "Information backup" },
  { id: "A.8.14", title: "Redundancy of information processing facilities" },
];

const GCP_OBSERVABILITY_CONTROLS: Array<{ id: string; title: string }> = [
  { id: "A.8.15", title: "Logging" },
  { id: "A.8.16", title: "Monitoring activities" },
  { id: "A.8.17", title: "Clock synchronization" },
];

const GCP_NETWORK_CONTROLS: Array<{ id: string; title: string }> = [
  { id: "A.8.20", title: "Networks security" },
  { id: "A.8.21", title: "Security of network services" },
  { id: "A.8.22", title: "Segregation of networks" },
  { id: "A.8.23", title: "Web filtering" },
  { id: "A.8.24", title: "Use of cryptography" },
];

const GCP_OPERATIONS_CONTROLS: Array<{ id: string; title: string }> = [
  { id: "A.8.18", title: "Use of privileged utility programs" },
  { id: "A.8.19", title: "Installation of software on operational systems" },
];

export async function collectGcpEvidence(): Promise<EvidenceItem[]> {
  const items: EvidenceItem[] = [];
  const collectedAt = new Date().toISOString();

  for (const control of GCP_IAM_CONTROLS) {
    items.push({
      id: `GCP-${control.id.replace(".", "-")}-IAM`,
      isoControlId: control.id,
      isoControlTitle: control.title,
      category: "A.8",
      source: "gcp",
      evidenceType: "config",
      collectionMethod: "gcloud CLI: IAM policy export and analysis",
      collectedAt: null,
      validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      status: "pending",
      artifactRef: "data/evidence/gcp-iam-policies.json",
      metadata: {
        gcloudCommand: "gcloud organizations get-iam-policy ORGANIZATION_ID --format=json > data/evidence/gcp-iam-policies.json",
        requires: "GCP Organization IAM viewer role or project owner on Aira GCP project",
        autoCollect: "Run `npm run evidence:gcp:iam`",
      },
    });
  }

  for (const control of GCP_INFRA_CONTROLS) {
    items.push({
      id: `GCP-${control.id.replace(".", "-")}-INFRA`,
      isoControlId: control.id,
      isoControlTitle: control.title,
      category: "A.8",
      source: "gcp",
      evidenceType: "config",
      collectionMethod: "gcloud CLI: Project config, SCC findings, and resource inventory",
      collectedAt: null,
      validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      status: "pending",
      artifactRef: `data/evidence/gcp-${control.id.replace(".", "-")}.json`,
      metadata: {
        gcloudCommand: getInfraCommand(control.id),
        requires: "GCP project viewer, SCC viewer on Aira project",
        autoCollect: "Run `npm run evidence:gcp:infra`",
      },
    });
  }

  for (const control of GCP_OBSERVABILITY_CONTROLS) {
    items.push({
      id: `GCP-${control.id.replace(".", "-")}-OBS`,
      isoControlId: control.id,
      isoControlTitle: control.title,
      category: "A.8",
      source: "gcp",
      evidenceType: "monitoring",
      collectionMethod: "gcloud CLI: Cloud Logging, Monitoring, and NTP config export",
      collectedAt: null,
      validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      status: "pending",
      artifactRef: `data/evidence/gcp-${control.id.replace(".", "-")}.json`,
      metadata: {
        gcloudCommand: getObservabilityCommand(control.id),
        requires: "GCP Logging Viewer, Monitoring Viewer on Aira project",
        autoCollect: "Run `npm run evidence:gcp:obs`",
      },
    });
  }

  for (const control of GCP_NETWORK_CONTROLS) {
    items.push({
      id: `GCP-${control.id.replace(".", "-")}-NET`,
      isoControlId: control.id,
      isoControlTitle: control.title,
      category: "A.8",
      source: "gcp",
      evidenceType: "config",
      collectionMethod: "gcloud CLI: VPC, firewall, and TLS config export",
      collectedAt: null,
      validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      status: "pending",
      artifactRef: `data/evidence/gcp-${control.id.replace(".", "-")}.json`,
      metadata: {
        gcloudCommand: getNetworkCommand(control.id),
        requires: "GCP Compute Network Viewer on Aira project",
        autoCollect: "Run `npm run evidence:gcp:net`",
      },
    });
  }

  for (const control of GCP_OPERATIONS_CONTROLS) {
    items.push({
      id: `GCP-${control.id.replace(".", "-")}-OPS`,
      isoControlId: control.id,
      isoControlTitle: control.title,
      category: "A.8",
      source: "gcp",
      evidenceType: "config",
      collectionMethod: "gcloud CLI: OS Login, instance metadata, and software inventory",
      collectedAt: null,
      validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      status: "pending",
      artifactRef: `data/evidence/gcp-${control.id.replace(".", "-")}.json`,
      metadata: {
        gcloudCommand: getOperationsCommand(control.id),
        requires: "GCP Compute Viewer on Aira project",
        autoCollect: "Run `npm run evidence:gcp:ops`",
      },
    });
  }

  return items.sort((a, b) => a.isoControlId.localeCompare(b.isoControlId));
}

export function generateGcpCollectionScript(): string {
  const commands = [
    "#!/bin/bash",
    "# GCP Evidence Auto-Collection Script for Aira ISO 27001 A.8 Controls",
    "# Generated by Aira evidence module",
    "# Requires: gcloud CLI authenticated with appropriate IAM roles",
    "# Usage: bash scripts/collect-gcp-evidence.sh [PROJECT_ID]",
    "",
    'PROJECT_ID="${1:-$(gcloud config get-value project)}"',
    'ORG_ID="${2:-}"',
    'OUTPUT_DIR="data/evidence"',
    "",
    'mkdir -p "$OUTPUT_DIR"',
    "",
    'echo "=== Collecting GCP IAM Evidence for A.8.2, A.8.3, A.8.5 ==="',
    '# Organization-level IAM (if ORG_ID provided)',
    '[ -n "$ORG_ID" ] && gcloud organizations get-iam-policy "$ORG_ID" --format=json > "$OUTPUT_DIR/gcp-iam-org.json" 2>/dev/null || echo "ORG_ID not provided, skipping org-level IAM"',
    '# Project-level IAM',
    'gcloud projects get-iam-policy "$PROJECT_ID" --format=json > "$OUTPUT_DIR/gcp-iam-project.json"',
    '# IAM service accounts',
    'gcloud iam service-accounts list --format=json > "$OUTPUT_DIR/gcp-iam-service-accounts.json"',
    '# IAM roles (custom)',
    'gcloud iam roles list --format=json > "$OUTPUT_DIR/gcp-iam-custom-roles.json" 2>/dev/null || echo "No custom roles or permission denied"',
    "",
    'echo "=== Collecting GCP Infrastructure Evidence for A.8.6-A.8.14 ==="',
    '# Security Command Center findings',
    'gcloud scc findings list "$ORG_ID" --format=json > "$OUTPUT_DIR/gcp-scc-findings.json" 2>/dev/null || echo "SCC requires organization-level access"',
    '# Compute Engine instances (OS config, metadata)',
    'gcloud compute instances list --format=json > "$OUTPUT_DIR/gcp-compute-instances.json"',
    '# Cloud KMS key rings',
    'gcloud kms keyrings list --location=global --format=json > "$OUTPUT_DIR/gcp-kms-keyrings.json" 2>/dev/null || echo "No KMS resources"',
    '# Cloud Storage bucket config (retention, encryption)',
    'gcloud storage buckets list --format=json > "$OUTPUT_DIR/gcp-storage-buckets.json" 2>/dev/null || echo "No storage buckets or permission denied"',
    '# Backup/redundancy config',
    'gcloud compute snapshots list --format=json > "$OUTPUT_DIR/gcp-compute-snapshots.json" 2>/dev/null || echo "No snapshots"',
    'gcloud compute disks list --format=json > "$OUTPUT_DIR/gcp-compute-disks.json"',
    '# DLP API config',
    'gcloud alpha dlp inspect-templates list --format=json > "$OUTPUT_DIR/gcp-dlp-inspect-templates.json" 2>/dev/null || echo "DLP API not enabled"',
    '# VPC Service Controls',
    'gcloud access-context-manager perimeters list --format=json > "$OUTPUT_DIR/gcp-vpc-sc.json" 2>/dev/null || echo "Access Context Manager not enabled"',
    "",
    'echo "=== Collecting GCP Observability Evidence for A.8.15-A.8.17 ==="',
    '# Cloud Logging sinks',
    'gcloud logging sinks list --format=json > "$OUTPUT_DIR/gcp-logging-sinks.json"',
    '# Monitoring alert policies',
    'gcloud alpha monitoring policies list --format=json > "$OUTPUT_DIR/gcp-monitoring-policies.json" 2>/dev/null || echo "Monitoring API not enabled or permission denied"',
    '# Monitoring notification channels',
    'gcloud alpha monitoring channels list --format=json > "$OUTPUT_DIR/gcp-monitoring-channels.json" 2>/dev/null || echo "No notification channels"',
    '# Audit log config',
    'gcloud logging logs list --format=json > "$OUTPUT_DIR/gcp-logging-logs.json"',
    "",
    'echo "=== Collecting GCP Network Evidence for A.8.20-A.8.24 ==="',
    '# VPC networks',
    'gcloud compute networks list --format=json > "$OUTPUT_DIR/gcp-networks.json"',
    '# Firewall rules',
    'gcloud compute firewall-rules list --format=json > "$OUTPUT_DIR/gcp-firewall-rules.json"',
    '# SSL policies',
    'gcloud compute ssl-policies list --format=json > "$OUTPUT_DIR/gcp-ssl-policies.json" 2>/dev/null || echo "No SSL policies"',
    '# Cloud DNS',
    'gcloud dns managed-zones list --format=json > "$OUTPUT_DIR/gcp-dns-zones.json" 2>/dev/null || echo "No managed zones"',
    '# Cloud Armor',
    'gcloud compute security-policies list --format=json > "$OUTPUT_DIR/gcp-cloud-armor.json" 2>/dev/null || echo "No Cloud Armor policies"',
    "",
    'echo "=== Collecting GCP Operations Evidence for A.8.18-A.8.19 ==="',
    '# OS Login config',
    'gcloud compute project-info describe --format=json | jq \'.commonInstanceMetadata.items[] | select(.key=="enable-oslogin" or .key=="enable-oslogin-2fa")\' > "$OUTPUT_DIR/gcp-os-login.json" 2>/dev/null || echo "Cannot read project metadata"',
    '# Guest policy / software inventory',
    'gcloud compute instances os-inventory list-instances --format=json > "$OUTPUT_DIR/gcp-os-inventory.json" 2>/dev/null || echo "OS Inventory not enabled"',
    "",
    'echo "=== Evidence collection complete ==="',
    'echo "Output directory: $OUTPUT_DIR"',
    'ls -la "$OUTPUT_DIR"',
    "",
    `echo "Next: run 'npm run evidence:manifest' to generate the evidence manifest"`,
  ];

  return commands.join("\n");
}

function getInfraCommand(controlId: string): string {
  switch (controlId) {
    case "A.8.6": return "gcloud compute instances list --format=json (capacity/performance)";
    case "A.8.7": return "gcloud scc findings list ORG_ID --filter='category=\"Malware\"' --format=json";
    case "A.8.8": return "gcloud scc findings list ORG_ID --filter='category=\"Vulnerability\"' --format=json";
    case "A.8.9": return "gcloud compute instances list --format=json (OS/config inventory)";
    case "A.8.10": return "gcloud storage buckets describe --format=json (retention/lifecycle)";
    case "A.8.11": return "gcloud alpha dlp inspect-templates list --format=json";
    case "A.8.12": return "gcloud access-context-manager perimeters list --format=json";
    case "A.8.13": return "gcloud compute snapshots list --format=json + gcloud storage buckets describe (versioning)";
    case "A.8.14": return "gcloud compute instances list --format=json (redundancy/HA config)";
    default: return "gcloud resource-manager";
  }
}

function getObservabilityCommand(controlId: string): string {
  switch (controlId) {
    case "A.8.15": return "gcloud logging sinks list --format=json + gcloud logging logs list";
    case "A.8.16": return "gcloud alpha monitoring policies list --format=json";
    case "A.8.17": return "gcloud compute instances describe --format=json (NTP config)";
    default: return "gcloud logging";
  }
}

function getNetworkCommand(controlId: string): string {
  switch (controlId) {
    case "A.8.20": return "gcloud compute networks list --format=json + firewall-rules list";
    case "A.8.21": return "gcloud compute ssl-policies list --format=json";
    case "A.8.22": return "gcloud compute networks list --format=json (subnet/VLAN isolation)";
    case "A.8.23": return "gcloud compute security-policies list --format=json (Cloud Armor)";
    case "A.8.24": return "gcloud kms keyrings list --format=json + gcloud compute ssl-policies list";
    default: return "gcloud compute";
  }
}

function getOperationsCommand(controlId: string): string {
  switch (controlId) {
    case "A.8.18": return "gcloud compute project-info describe --format=json (OS Login, metadata)";
    case "A.8.19": return "gcloud compute instances os-inventory list-instances --format=json";
    default: return "gcloud compute";
  }
}