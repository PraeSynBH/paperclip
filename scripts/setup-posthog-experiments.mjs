#!/usr/bin/env node
/**
 * PostHog Experiment Setup — VOY-1742 Phase 2
 *
 * Creates (or updates) the 3 pricing A/B experiments in PostHog:
 *   pricing_cta_button  — CTA copy + button styling (LIVE in Pricing.tsx)
 *   pricing_tier_layout — tier card layout (future use)
 *   pricing_social_proof — social proof elements (future use)
 *
 * Traffic split: 50% control (A), 25% test (B), 25% no flag (treated as
 * control by frontend fallback).
 *
 * Idempotent — safe to re-run. Existing experiments are updated in-place.
 *
 * Requires:
 *   POSTHOG_PERSONAL_API_KEY or POSTHOG_API_KEY
 *   POSTHOG_PROJECT_ID (numeric, e.g. 556864 for Voyonder)
 *   POSTHOG_HOST (default: https://us.posthog.com)
 *
 * Usage:
 *   POSTHOG_API_KEY=phx_... POSTHOG_PROJECT_ID=556864 \
 *     node scripts/setup-posthog-experiments.mjs
 */

const API_HOST = process.env.POSTHOG_HOST || "https://us.posthog.com";
const PERSONAL_API_KEY =
  process.env.POSTHOG_PERSONAL_API_KEY || process.env.POSTHOG_API_KEY;
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID;

if (!PERSONAL_API_KEY || !PROJECT_ID) {
  console.error(
    "Missing required env vars:\n" +
      "  POSTHOG_PERSONAL_API_KEY (or POSTHOG_API_KEY)\n" +
      "  POSTHOG_PROJECT_ID (e.g. 556864)\n",
  );
  process.exit(1);
}

// ── Experiment definitions ─────────────────────────────────────────────

const EXPERIMENTS = [
  {
    name: "Pricing CTA Button (VOY-1742)",
    key: "pricing_cta_button",
    description:
      "Tests CTA copy and button styling on the pricing page. " +
      "control → 'Subscribe' / default variant / card icon. " +
      "test → 'Get Started' / cta variant / arrow icon.",
    variants: [
      { key: "control", name: "Control (A)", rollout_percentage: 50 },
      { key: "test", name: "Test (B)", rollout_percentage: 25 },
    ],
  },
  {
    name: "Pricing Tier Layout (VOY-1742)",
    key: "pricing_tier_layout",
    description:
      "Tests tier card layout on the pricing page. " +
      "control → standard grid layout. " +
      "test → alternative layout (future use).",
    variants: [
      { key: "control", name: "Control (A)", rollout_percentage: 50 },
      { key: "test", name: "Test (B)", rollout_percentage: 25 },
    ],
  },
  {
    name: "Pricing Social Proof (VOY-1742)",
    key: "pricing_social_proof",
    description:
      "Tests social proof elements on the pricing page. " +
      "control → no social proof elements. " +
      "test → testimonial cards / usage stats (future use).",
    variants: [
      { key: "control", name: "Control (A)", rollout_percentage: 50 },
      { key: "test", name: "Test (B)", rollout_percentage: 25 },
    ],
  },
];

// ── API helpers ────────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  const url = `${API_HOST}/api/projects/${PROJECT_ID}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${PERSONAL_API_KEY}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  });
  const body = await res.json();
  if (!res.ok) {
    const msg = body.detail || body.type || JSON.stringify(body);
    throw new Error(`POSTHOG API ${res.status}: ${msg}`);
  }
  return body;
}

async function findFlag(key) {
  const result = await apiFetch(
    `/feature_flags/?key=${encodeURIComponent(key)}`,
  );
  return result.results?.[0] ?? null;
}

async function findExperiment(flagKey) {
  const result = await apiFetch(
    `/experiments/?feature_flag_key=${encodeURIComponent(flagKey)}`,
  );
  return result.results?.[0] ?? null;
}

// ── Core operations ────────────────────────────────────────────────────

async function ensureFeatureFlag(exp) {
  const existing = await findFlag(exp.key);

  const payload = {
    name: exp.name,
    description: exp.description,
    filters: {
      multivariate: { variants: exp.variants },
      groups: [{ properties: [], rollout_percentage: 100 }],
      aggregation_group_type_index: 0,
    },
    active: true,
    ensure_experience_continuity: true,
  };

  if (existing) {
    console.log(`  [flag] Exists (${existing.id}) — updating config`);
    await apiFetch(`/feature_flags/${existing.id}/`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    return existing;
  }

  const created = await apiFetch("/feature_flags/", {
    method: "POST",
    body: JSON.stringify({ ...payload, key: exp.key }),
  });
  console.log(`  [flag] Created (${created.id})`);
  return created;
}

async function ensureExperiment(exp) {
  const existing = await findExperiment(exp.key);

  if (existing) {
    // Update if needed (name or description changed)
    if (existing.name !== exp.name || existing.description !== exp.description) {
      console.log(`  [exp]  Exists (${existing.id}) — updating metadata`);
      await apiFetch(`/experiments/${existing.id}/`, {
        method: "PATCH",
        body: JSON.stringify({ name: exp.name, description: exp.description }),
      });
    } else {
      console.log(`  [exp]  Exists (${existing.id}) — up to date`);
    }

    // Start if still in draft
    if (existing.status === "draft" && !existing.start_date) {
      console.log(`  [exp]  Starting experiment...`);
      await apiFetch(`/experiments/${existing.id}/`, {
        method: "PATCH",
        body: JSON.stringify({ start_date: new Date().toISOString() }),
      });
      console.log(`  [exp]  → Status: running`);
    } else {
      console.log(`  [exp]  → Status: ${existing.status}`);
    }
    return existing;
  }

  // Create experiment referencing the existing flag key
  const created = await apiFetch("/experiments/", {
    method: "POST",
    body: JSON.stringify({
      name: exp.name,
      description: exp.description,
      feature_flag_key: exp.key,
      start_date: new Date().toISOString(),
    }),
  });
  console.log(`  [exp]  Created (${created.id}) — running`);
  return created;
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log("=== PostHog Experiment Setup — VOY-1742 ===\n");
  console.log(`Host:    ${API_HOST}`);
  console.log(`Project: ${PROJECT_ID}\n`);

  for (const exp of EXPERIMENTS) {
    try {
      console.log(`── ${exp.key} ──`);
      await ensureFeatureFlag(exp);
      await ensureExperiment(exp);
      console.log("");
    } catch (err) {
      console.error(`[ERROR] ${exp.key}: ${err.message}\n`);
    }
  }

  console.log("=== Done ===");
  console.log(
    `\nDashboard: ${API_HOST}/project/${PROJECT_ID}/experiments\n`,
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});