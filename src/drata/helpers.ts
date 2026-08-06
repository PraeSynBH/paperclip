import type { DrataControl, DrataUser } from "./types.js";

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
