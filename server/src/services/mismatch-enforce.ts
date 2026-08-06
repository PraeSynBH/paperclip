export type MismatchEnforcementMode = 'detect_ignore' | 'enforce_reject';

let cachedMode: MismatchEnforcementMode | null = null;

export function resolveMismatchMode(): MismatchEnforcementMode {
  if (cachedMode) return cachedMode;

  const globalDisable = process.env.RUN_ID_MISMATCH_ENFORCE_GLOBAL_DISABLE;
  if (globalDisable === 'true') {
    cachedMode = 'detect_ignore';
    return cachedMode;
  }

  const enforce = process.env.RUN_ID_MISMATCH_ENFORCE;
  cachedMode = enforce === 'true' ? 'enforce_reject' : 'detect_ignore';
  return cachedMode;
}

export function resetMismatchModeCache(): void {
  cachedMode = null;
}