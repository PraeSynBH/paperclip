import type { EvidenceItem, EvidenceManifest, CoverageSummary } from "./types.js";

export function buildManifest(
  controlIds: Array<{ id: string; title: string }>,
  evidenceItems: EvidenceItem[]
): EvidenceManifest {
  const controlsWithEvidence = new Set(evidenceItems.map((e) => e.isoControlId));

  const bySource: Record<string, number> = {};
  const byStatus: Record<string, number> = {};

  for (const item of evidenceItems) {
    bySource[item.source] = (bySource[item.source] ?? 0) + 1;
    byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
  }

  const coverageSummary: CoverageSummary = {
    controlsWithEvidence: controlsWithEvidence.size,
    controlsWithoutEvidence: controlIds.length - controlsWithEvidence.size,
    totalEvidenceItems: evidenceItems.length,
    bySource,
    byStatus,
  };

  return {
    generatedAt: new Date().toISOString(),
    framework: "ISO 27001:2022",
    frameworkVersion: "2022",
    totalControls: controlIds.length,
    evidenceItems,
    coverageSummary,
  };
}

export function generateMarkdownReport(manifest: EvidenceManifest): string {
  const lines = [
    `# ISO 27001:2022 A.8 Evidence Manifest`,
    `Generated: ${manifest.generatedAt}`,
    ``,
    `## Coverage Summary`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Controls covered | ${manifest.coverageSummary.controlsWithEvidence}/${manifest.totalControls} (${((manifest.coverageSummary.controlsWithEvidence / manifest.totalControls) * 100).toFixed(1)}%) |`,
    `| Controls without evidence | ${manifest.coverageSummary.controlsWithoutEvidence} |`,
    `| Total evidence items | ${manifest.coverageSummary.totalEvidenceItems} |`,
    ``,
    `### By Source`,
  ];

  for (const [source, count] of Object.entries(manifest.coverageSummary.bySource)) {
    lines.push(`- ${source}: ${count}`);
  }

  lines.push(``, `### By Status`);
  for (const [status, count] of Object.entries(manifest.coverageSummary.byStatus)) {
    lines.push(`- ${status}: ${count}`);
  }

  lines.push(``, `## Evidence Items`, ``);

  const byControl = new Map<string, EvidenceItem[]>();
  for (const item of manifest.evidenceItems) {
    const key = `${item.isoControlId}: ${item.isoControlTitle}`;
    if (!byControl.has(key)) byControl.set(key, []);
    byControl.get(key)!.push(item);
  }

  for (const [controlKey, items] of [...byControl.entries()].sort()) {
    lines.push(`### ${controlKey}`);
    lines.push(``);
    for (const item of items) {
      const statusIcon = item.status === "collected" ? "✅" :
        item.status === "ready" ? "🔵" :
        item.status === "pending" ? "🟡" :
        item.status === "expired" ? "🔴" :
        item.status === "error" ? "❌" : "⬜";
      lines.push(`- ${statusIcon} **${item.id}** (${item.source}/${item.evidenceType}) — ${item.collectionMethod}`);
      if (item.artifactRef) lines.push(`  - Artifact: \`${item.artifactRef}\``);
      if (item.collectedAt) lines.push(`  - Collected: ${item.collectedAt}`);
      if (item.validUntil) lines.push(`  - Valid until: ${item.validUntil}`);
    }
    lines.push(``);
  }

  return lines.join("\n");
}