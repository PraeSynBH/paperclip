/**
 * Canonical Gemini content-safety configuration.
 *
 * Single source of truth for harm categories and block thresholds, introduced to
 * close security audit finding GL-F9 (RBR-135, parent RBR-121):
 *
 *  - `GeminiClient.generateContent()` and `SecureAiPipeline` previously carried two
 *    *different* hardcoded safety defaults. Both now resolve through this module.
 *  - The four standard categories are standardized on `BLOCK_MEDIUM_AND_ABOVE`.
 *  - Previously missing categories (`HARM_CATEGORY_CIVIC_INTEGRITY`,
 *    `HARM_CATEGORY_HARASSMENT_SEXUAL`) are now declared explicitly.
 *  - Thresholds are configurable per project via the AI governance config, with a
 *    hard strictness floor so a project override cannot silently disable filtering.
 */

/** Harm categories Aira declares policy for. */
export const HARM_CATEGORIES = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
  "HARM_CATEGORY_CIVIC_INTEGRITY",
  "HARM_CATEGORY_HARASSMENT_SEXUAL",
] as const;

export type GeminiHarmCategory = (typeof HARM_CATEGORIES)[number];

export type GeminiHarmBlockThreshold =
  | "HARM_BLOCK_THRESHOLD_UNSPECIFIED"
  | "BLOCK_LOW_AND_ABOVE"
  | "BLOCK_MEDIUM_AND_ABOVE"
  | "BLOCK_ONLY_HIGH"
  | "BLOCK_NONE";

export interface GeminiSafetySetting {
  category: string;
  threshold: GeminiHarmBlockThreshold;
}

/**
 * Harm categories accepted by the Gemini `v1beta` `generateContent` HarmCategory
 * enum. Categories declared in {@link HARM_CATEGORIES} but absent here are kept in
 * the governance policy (so the control is documented and auditable) but stripped
 * from the wire request, because sending an unknown enum value makes the API reject
 * the whole call with HTTP 400.
 *
 * `HARM_CATEGORY_HARASSMENT_SEXUAL` is required by the GL-F9 remediation but is not
 * yet part of Google's published HarmCategory enum — it is declared and tracked
 * here, and will start being transmitted as soon as it is added to this set.
 */
export const API_SUPPORTED_HARM_CATEGORIES: ReadonlySet<string> = new Set<string>([
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
  "HARM_CATEGORY_CIVIC_INTEGRITY",
]);

/**
 * Strictness rank — lower is stricter. `BLOCK_NONE` and the unspecified value both
 * fall back to the provider default, so they are treated as the weakest setting.
 */
const THRESHOLD_STRICTNESS: Record<GeminiHarmBlockThreshold, number> = {
  BLOCK_LOW_AND_ABOVE: 0,
  BLOCK_MEDIUM_AND_ABOVE: 1,
  BLOCK_ONLY_HIGH: 2,
  BLOCK_NONE: 3,
  HARM_BLOCK_THRESHOLD_UNSPECIFIED: 3,
};

/** GL-F9 remediation step 1: one threshold for every standard category. */
export const DEFAULT_SAFETY_THRESHOLD: GeminiHarmBlockThreshold = "BLOCK_MEDIUM_AND_ABOVE";

/**
 * Strictness floor. A per-project override may be equal or stricter; anything
 * weaker is clamped back to this value and reported as a violation.
 */
export const MINIMUM_SAFETY_THRESHOLD: GeminiHarmBlockThreshold = "BLOCK_MEDIUM_AND_ABOVE";

/** Per-project safety threshold override. Requires justification + approver for audit. */
export interface ProjectSafetyOverride {
  categoryThresholds: Partial<Record<GeminiHarmCategory, GeminiHarmBlockThreshold>>;
  justification: string;
  approvedBy: string;
  /** ISO-8601. `null` means no expiry. Expired overrides are ignored. */
  expiresAt?: string | null;
}

/** Project-configurable safety policy, carried on the AI governance config. */
export interface AiSafetyConfig {
  defaultThreshold: GeminiHarmBlockThreshold;
  minimumThreshold: GeminiHarmBlockThreshold;
  categoryThresholds: Partial<Record<GeminiHarmCategory, GeminiHarmBlockThreshold>>;
  projectOverrides: Record<string, ProjectSafetyOverride>;
}

export interface SafetyPolicyViolation {
  category: string;
  requested: GeminiHarmBlockThreshold;
  applied: GeminiHarmBlockThreshold;
  reason: string;
}

export interface SafetyResolution {
  /** Full declared policy, including categories not yet supported by the API. */
  declared: GeminiSafetySetting[];
  /** Wire-safe subset to send to Gemini. */
  settings: GeminiSafetySetting[];
  /** Declared categories dropped because the API enum does not accept them. */
  droppedCategories: string[];
  /** Overrides that were clamped back to the strictness floor. */
  violations: SafetyPolicyViolation[];
  /** Project id whose override was applied, if any. */
  appliedProjectOverride: string | null;
}

export const DEFAULT_SAFETY_CONFIG: AiSafetyConfig = {
  defaultThreshold: DEFAULT_SAFETY_THRESHOLD,
  minimumThreshold: MINIMUM_SAFETY_THRESHOLD,
  categoryThresholds: {},
  projectOverrides: {},
};

/** Canonical default settings: every declared category at the standard threshold. */
export const DEFAULT_SAFETY_SETTINGS: readonly GeminiSafetySetting[] = HARM_CATEGORIES.map(
  category => ({ category, threshold: DEFAULT_SAFETY_THRESHOLD }),
);

/**
 * Hardened preset for projects handling regulated or high-sensitivity data.
 * Stricter than the floor, so it is always accepted as a project override.
 */
export const STRICT_SAFETY_SETTINGS: readonly GeminiSafetySetting[] = HARM_CATEGORIES.map(
  category => ({ category, threshold: "BLOCK_LOW_AND_ABOVE" as GeminiHarmBlockThreshold }),
);

export function isHarmCategory(value: string): value is GeminiHarmCategory {
  return (HARM_CATEGORIES as readonly string[]).includes(value);
}

export function isBlockThreshold(value: string): value is GeminiHarmBlockThreshold {
  return Object.prototype.hasOwnProperty.call(THRESHOLD_STRICTNESS, value);
}

/** `true` when `candidate` is at least as strict as `floor`. */
export function isAtLeastAsStrict(
  candidate: GeminiHarmBlockThreshold,
  floor: GeminiHarmBlockThreshold,
): boolean {
  return THRESHOLD_STRICTNESS[candidate] <= THRESHOLD_STRICTNESS[floor];
}

/** Returns the stricter of the two thresholds. */
export function strictestThreshold(
  a: GeminiHarmBlockThreshold,
  b: GeminiHarmBlockThreshold,
): GeminiHarmBlockThreshold {
  return THRESHOLD_STRICTNESS[a] <= THRESHOLD_STRICTNESS[b] ? a : b;
}

function isOverrideActive(override: ProjectSafetyOverride, now: number): boolean {
  if (!override.expiresAt) return true;
  const expiry = Date.parse(override.expiresAt);
  return Number.isNaN(expiry) ? false : expiry > now;
}

export interface ResolveSafetySettingsOptions {
  config?: Partial<AiSafetyConfig>;
  projectId?: string;
  /**
   * Explicit caller-supplied settings (e.g. `PipelineConfig.safetySettings`).
   * These are merged over the resolved policy and subject to the same floor.
   */
  overrides?: readonly GeminiSafetySetting[];
  now?: number;
}

/**
 * Resolve the effective safety settings for a request.
 *
 * Precedence (later wins, floor always enforced):
 *   config default threshold -> config category thresholds -> project override -> explicit overrides
 *
 * Every declared harm category is always present in the result, so a partial
 * override can never leave a category unconfigured (fail-closed).
 */
export function resolveSafetySettingsDetailed(
  options: ResolveSafetySettingsOptions = {},
): SafetyResolution {
  const config: AiSafetyConfig = {
    ...DEFAULT_SAFETY_CONFIG,
    ...options.config,
    categoryThresholds: { ...options.config?.categoryThresholds },
    projectOverrides: { ...options.config?.projectOverrides },
  };
  const floor = config.minimumThreshold;
  const violations: SafetyPolicyViolation[] = [];
  const resolved = new Map<string, GeminiHarmBlockThreshold>();

  for (const category of HARM_CATEGORIES) {
    resolved.set(category, config.defaultThreshold);
  }

  const apply = (category: string, requested: GeminiHarmBlockThreshold, source: string): void => {
    if (!isBlockThreshold(requested)) {
      violations.push({
        category,
        requested,
        applied: resolved.get(category) ?? config.defaultThreshold,
        reason: `${source}: unknown threshold "${requested}" ignored`,
      });
      return;
    }
    if (!isAtLeastAsStrict(requested, floor)) {
      resolved.set(category, floor);
      violations.push({
        category,
        requested,
        applied: floor,
        reason: `${source}: threshold weaker than policy floor ${floor}; clamped`,
      });
      return;
    }
    resolved.set(category, requested);
  };

  for (const [category, threshold] of Object.entries(config.categoryThresholds)) {
    if (threshold) apply(category, threshold, "governance config");
  }

  const now = options.now ?? Date.now();
  let appliedProjectOverride: string | null = null;
  const projectOverride = options.projectId
    ? config.projectOverrides[options.projectId]
    : undefined;

  if (projectOverride && isOverrideActive(projectOverride, now)) {
    appliedProjectOverride = options.projectId ?? null;
    for (const [category, threshold] of Object.entries(projectOverride.categoryThresholds)) {
      if (threshold) apply(category, threshold, `project override ${options.projectId}`);
    }
  }

  for (const setting of options.overrides ?? []) {
    apply(setting.category, setting.threshold, "explicit safetySettings");
  }

  const declared: GeminiSafetySetting[] = [...resolved.entries()].map(([category, threshold]) => ({
    category,
    threshold,
  }));
  const settings = declared.filter(s => API_SUPPORTED_HARM_CATEGORIES.has(s.category));
  const droppedCategories = declared
    .filter(s => !API_SUPPORTED_HARM_CATEGORIES.has(s.category))
    .map(s => s.category);

  return { declared, settings, droppedCategories, violations, appliedProjectOverride };
}

/** Convenience wrapper returning only the wire-safe settings. */
export function resolveSafetySettings(
  options: ResolveSafetySettingsOptions = {},
): GeminiSafetySetting[] {
  return resolveSafetySettingsDetailed(options).settings;
}
