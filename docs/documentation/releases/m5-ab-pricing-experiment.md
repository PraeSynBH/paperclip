# M5 — A/B Pricing Experiment

**Release status:** Branch — `feat/clean-m5-pricing-pr` (upstream PR halted per CEO directive VOY-1959)
**Branch commits:** `f95b738967` — pricing experiment service, GA4 analytics, variant endpoints
**Related issues:** VOY-1685, VOY-1888, VOY-1890, VOY-1941

Paperclip now supports server-side A/B pricing testing with deterministic variant assignment, configurable experiment parameters, and a built-in analytics fallback service. This release enables pricing experiments to compare how different price points affect conversion, without any code changes from companies.

## What's New

### Full-featured A/B pricing experiment engine

Pricing experiments are now driven by a configuration object (JSON via `PRICING_EXPERIMENT_CONFIG` environment variable) with the following controls:

- **Master kill-switch** (`enabled`) — When disabled, all companies see standard pricing (variant A). No code deploy required to toggle.
- **Traffic percent** (`trafficPercent`) — Controls what percentage of new (unassigned) companies are included in the experiment. The rest automatically see control pricing.
- **Per-variant configuration** — Each variant can have its own weight (splitting traffic within the experiment) and per-tier price overrides.
- **Scheduling** (`startDate`, `endDate`) — Experiment can be configured to activate at a future date or automatically stop.
- **Salt rotation** (`salt`) — Deterministic assignment uses SHA-256 of `companyId + salt`. Rotating the salt reassigns all new companies (existing assignments are unchanged).

### Deterministic, persistent assignment

Companies are assigned to variant A (control) or B (treatment) on first interaction with the pricing system. The assignment is:

- **Deterministic** — A two-stage SHA-256 hash of `companyId + salt` determines inclusion in the experiment and variant split. The same company always sees the same pricing.
- **Persistent** — Once assigned, the variant is stored in the `companies` table (`pricing_experiment_variant` + `pricing_experiment_enrolled_at`). The assignment is never overwritten.
- **Server-side** — The experiment runs entirely on the server. There is no client-side flag or toggle.

### GA4 Analytics Service

A Google Analytics 4 Measurement Protocol integration is included as a fallback analytics service for the PostHog contingency (VOY-1941). When configured, it can send server-side events (signups, approvals, checkout starts) directly to GA4. This service is part of the committed codebase but requires environment variable configuration to activate.

### New API endpoints

| Endpoint | Access | Description |
|---|---|---|
| `GET /api/companies/:id/billing/experiment-variant` | Company members | Returns the company's assigned variant and whether the experiment is enabled |
| `GET /api/companies/:id/billing/experiment-results` | Board only | Returns per-variant enrollment counts and aggregate statistics |

## How It Works

1. An administrator sets `PRICING_EXPERIMENT_CONFIG` as a JSON environment variable with the desired configuration
2. When a company's billing page loads, the server checks if the company has an existing variant assignment
3. If unassigned, the service deterministically assigns the company using SHA-256 (`companyId + salt`)
4. The assigned variant is persisted in the database
5. Tier pricing is adjusted based on the variant's configured overrides before being returned to the frontend
6. Checkout sessions include `pricingExperimentVariant` in Stripe metadata for conversion analysis

## What Changed

| Aspect | Before | After |
|--------|--------|-------|
| Pricing page | Static pricing for everyone | Dynamic pricing based on experiment assignment |
| Pricing configuration | Single set of prices | Configurable per-variant tier overrides via `PRICING_EXPERIMENT_CONFIG` |
| Checkout metadata | No experiment tracking | Session includes `pricingExperimentVariant` tag in Stripe metadata |
| Experiment control | N/A | Full config with enabled flag, traffic percent, scheduling, salt rotation |
| Analytics | PostHog only | GA4 Measurement Protocol available as fallback |
| Companies table | No experiment columns | `pricing_experiment_variant` + `pricing_experiment_enrolled_at` |

## Configuration Reference

The `PRICING_EXPERIMENT_CONFIG` environment variable accepts a JSON object:

```json
{
  "enabled": false,
  "trafficPercent": 50,
  "variants": {
    "B": {
      "weight": 50,
      "tierOverrides": {
        "<tier-uuid>": {
          "priceMonthlyCents": 1900,
          "priceYearlyCents": 19000,
          "name": "Adventurer",
          "features": ["unlimited_agents", "priority_support"]
        }
      }
    }
  },
  "startDate": "2026-09-01T00:00:00Z",
  "endDate": "2026-10-01T00:00:00Z",
  "salt": "m5-pricing-experiment-v1"
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `false` | Master kill-switch. When false, all companies see control pricing. |
| `trafficPercent` | number (0-100) | `50` | Percent of new (unassigned) traffic to include in the experiment. |
| `variants.B.weight` | number (0-100) | `50` | Within experiment traffic, percent that receives variant B. |
| `variants.B.tierOverrides` | object | `{}` | Per-tier overrides: keyed by tier UUID, values are shallow merges over the DB tier row. |
| `startDate` | ISO string | optional | Experiment activation date. Before this, all companies see control. |
| `endDate` | ISO string | optional | Experiment end date. After this, all companies see control. |
| `salt` | string | `"m5-pricing-experiment-v1"` | Salt for deterministic hashing. Rotate to reassign all new companies. |

## Impact

- **No action required from companies** — The experiment runs server-side and is transparent to users
- **Potential pricing changes for some companies** — Companies in the treatment group see adjusted pricing on the pricing page and during checkout
- **Conversion analytics** — Checkout metadata enables comparison of conversion rates between pricing variants
- **GA4 available as analytics fallback** — If PostHog is unavailable, GA4 can be activated as an alternative analytics channel

---

*Paperclip Platform — Pricing Release (branch: feat/clean-m5-pricing-pr)*