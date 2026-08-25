/**
 * Shared helpers for background job display.
 */

/** Human-readable label for a background job type. */
export function backgroundJobLabel(type: string): string {
  const labels: Record<string, string> = {
    "research.activity_search": "Sage is researching activities\u2026",
    "research.auto_assess": "Sage is reviewing\u2026",
    "research.semantic_search": "Sage is looking deeper\u2026",
    "research.resolve_entities": "Sage is looking into that\u2026",
    "research.gather_citations": "Sage is gathering sources\u2026",
    "research.verify_citations": "Sage is checking freshness\u2026",
    "export.pdf": "PDF Export",
    "export.ics": "Calendar Export",
  };
  return labels[type] ?? type.replace(/_/g, " ").replace(/\./g, ": ");
}

/** Compact duration string: `500ms`, `1.2s`, `45m 12s`, `2h 5m`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}
