export interface EvidenceItem {
  id: string;
  isoControlId: string;
  isoControlTitle: string;
  category: string;
  source: EvidenceSource;
  evidenceType: EvidenceType;
  collectionMethod: string;
  collectedAt: string | null;
  validUntil: string | null;
  status: EvidenceStatus;
  artifactRef: string | null;
  metadata: Record<string, unknown>;
}

export type EvidenceSource = "github" | "gcp" | "mdm" | "drata" | "manual";
export type EvidenceType = "config" | "log" | "scan_result" | "policy" | "attestation" | "monitoring" | "screenshot" | "document";
export type EvidenceStatus = "collected" | "ready" | "pending" | "not_available" | "expired" | "error";

export interface EvidenceManifest {
  generatedAt: string;
  framework: string;
  frameworkVersion: string;
  totalControls: number;
  evidenceItems: EvidenceItem[];
  coverageSummary: CoverageSummary;
}

export interface CoverageSummary {
  controlsWithEvidence: number;
  controlsWithoutEvidence: number;
  totalEvidenceItems: number;
  bySource: Record<string, number>;
  byStatus: Record<string, number>;
}

export interface EvidenceCollector {
  name: string;
  source: EvidenceSource;
  collectEvidence: () => Promise<EvidenceItem[]>;
}