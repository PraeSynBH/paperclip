import type { DrataControl, DrataEvidence, DrataUser } from "./types.js";

/**
 * Readiness for a Drata control.
 *
 * The legacy flat-path (`GET /controls`) response carried a `status` string.
 * The workspace-scoped v2 path (`GET /workspaces/{id}/controls`) instead
 * reports readiness under `expand[]=flags` as `flags.isReady`. Prefer the v2
 * field and fall back to the legacy one so cached payloads still work.
 */
export function isControlReady(control: DrataControl): boolean {
  if (typeof control.flags?.isReady === "boolean") return control.flags.isReady;
  return control.status === "ready";
}

/** Human-readable readiness label for logs/reports. */
export function controlStatusLabel(control: DrataControl): string {
  if (typeof control.flags?.isReady === "boolean") {
    return control.flags.isReady ? "ready" : "not_ready";
  }
  return control.status ?? "unknown";
}

/**
 * Framework names a control maps to. v2 exposes these via
 * `expand[]=requirements` (each requirement names its framework); the legacy
 * shape had a flat `frameworks` array.
 */
export function controlFrameworkNames(control: DrataControl): string[] {
  const names = new Set<string>();
  for (const req of control.requirements ?? []) {
    if (req.frameworkName) names.add(req.frameworkName);
  }
  for (const fw of control.frameworks ?? []) {
    if (fw.name) names.add(fw.name);
  }
  return [...names];
}

/** Normalise the v2 `{ data, totalCount }` owners envelope to a flat array. */
export function controlOwners(control: DrataControl): DrataUser[] {
  const owners = control.owners;
  if (!owners) return [];
  return Array.isArray(owners) ? owners : owners.data ?? [];
}

/**
 * Collection timestamp for an evidence-library entry.
 *
 * `GET /workspaces/{id}/evidence-library` carries no flat `lastCollectedAt`.
 * Freshness is the `createdAt` of the version flagged `current: true` under
 * `expand[]=renewalSchemaAndVersions`; fall back to the newest version, then
 * to the entry's own `updatedAt`. See RBR-883.
 */
export function evidenceCollectedAt(evidence: DrataEvidence): string | null {
  const versions = evidence.versions ?? [];
  const current = versions.find((v) => v.current);
  if (current?.createdAt) return current.createdAt;

  const newest = versions
    .map((v) => v.createdAt)
    .filter((d): d is string => Boolean(d))
    .sort()
    .pop();
  return newest ?? evidence.updatedAt ?? null;
}

/**
 * Renewal date for an evidence-library entry. Lives under `renewalSchema`
 * (`expand[]=renewalSchemaAndVersions`); `renewalScheduleType: "NONE"` means
 * the entry never expires and `renewalDate` is null.
 */
export function evidenceRenewalDate(evidence: DrataEvidence): string | null {
  return evidence.renewalSchema?.renewalDate ?? null;
}

/** Control IDs an evidence-library entry links to (`expand[]=controls`). */
export function evidenceControlIds(evidence: DrataEvidence): number[] {
  return (evidence.controls ?? [])
    .map((c) => c.id)
    .filter((id): id is number => typeof id === "number");
}
