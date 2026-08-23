# Support Case Assessment: M5 A/B Pricing Experiment

**Feature**: Server-side A/B pricing test — companies are deterministically assigned to variant A (control — current pricing) or variant B (treatment — adjusted pricing)
**Assessed by**: Support Engineer
**Date**: 2026-08-23
**Related**: VOY-1685, VOY-1888, VOY-1890, VOY-1941
**Branch**: `feat/clean-m5-pricing-pr` (upstream PR halted per CEO directive VOY-1959)
**Committed at**: `f95b738967` — pricing experiment service + GA4 analytics + variant endpoints

## Feature Overview (User Perspective)

Paperclip now supports configurable server-side A/B pricing experiments. Companies are deterministically assigned to either variant A (current pricing) or variant B (adjusted pricing) on first interaction with the pricing system. The assignment is permanent for each company and persists in the database.

**What this means for users:**

- **Some companies see different prices** — Depending on experiment assignment, a company may see adjusted pricing (variant B) or current pricing (variant A)
- **Experiment is configured entirely via environment variable** — No user-facing toggle or UI. Full control: enabled/disabled, traffic percent, variant weights, per-tier price overrides, scheduling, and salt
- **Assignment is deterministic** — A company always sees the same pricing, regardless of which device or browser they use
- **No action required from companies** — The experiment is transparent to end users within each company
- **GA4 Analytics Service is available** — A Google Analytics 4 Measurement Protocol integration is included in the codebase as a fallback analytics service (requires configuration to activate)

## What Changed

### 1. Database Migration (`0230_pricing_experiment_columns.sql`)

Adds two columns to the `companies` table:
- `pricing_experiment_variant` (text) — stores `'A'` or `'B'` for the assigned variant
- `pricing_experiment_enrolled_at` (timestamptz) — timestamp of when the company was assigned

The migration is idempotent (`ADD COLUMN IF NOT EXISTS`) — re-running does not error.

### 2. Pricing Experiment Service (`server/src/services/pricing-experiment.ts`)

A full-featured experiment service:

- **Config schema** (Zod-validated):
  - `enabled` (boolean, default `false`) — master kill-switch
  - `trafficPercent` (0-100, default `50`) — percent of new unassigned traffic to include
  - `variants.B.weight` (0-100, default `50`) — variant split within experiment traffic
  - `variants.B.tierOverrides` (object, default `{}`) — per-tier price overrides (shallow merge)
  - `startDate` / `endDate` (ISO string, optional) — scheduling
  - `salt` (string, default `"m5-pricing-experiment-v1"`) — salt for deterministic hashing

- **Deterministic assignment**: Two-stage SHA-256 hashing (`companyId + salt`):
  1. First hash (% 100) determines if company is within experiment traffic
  2. Second hash (% 100) determines variant split within experiment traffic

- **Persistence**: `getOrAssignVariant(companyId)` reads existing assignment from DB, assigns and persists only if unassigned. Persistent assignments are never overwritten.

- **Tier overrides**: `applyTierOverrides(tiers, variant)` applies variant B's tier overrides as shallow merges over DB tier rows. Variant A returns tiers unchanged.

- **Results aggregation**: `getResults()` returns per-variant enrollment counts.

### 3. Billing Integration

- `listTiers(companyId)` now takes a company ID and applies experiment variant overrides when returning available tiers
- `createCheckoutSession` includes `pricingExperimentVariant` in Stripe metadata for conversion tracking

### 4. GA4 Analytics Service (`server/src/services/ga4-analytics.ts`)

A new Google Analytics 4 Measurement Protocol integration:

- Sends server-side events directly to GA4 via the Measurement Protocol API
- Configurable via environment variables: `GA4_MEASUREMENT_ID`, `GA4_API_SECRET`, `GA4_ENABLED`, `GA4_DEBUG`
- Includes helper functions for standard events: `buildSignupEvent`, `buildApprovalEvent`, `buildApprovalRejectedEvent`
- Singleton service pattern — call `getGa4AnalyticsService()` from anywhere in the server
- Fault-tolerant: failures are logged but never throw; timeouts after 5 seconds

### 5. API Endpoints

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/companies/:id/billing/experiment-variant` | Company members | Returns `{ variant: "A"|"B", enabled: boolean }` |
| `GET /api/companies/:id/billing/experiment-results` | Board only | Returns `{ enabled, totalAssigned, variantA: { count }, variantB: { count } }` |

### 6. Companies Schema

Added to `packages/db/src/schema/companies.ts`:
- `pricingExperimentVariant: text("pricing_experiment_variant")`
- `pricingExperimentEnrolledAt: timestamp("pricing_experiment_enrolled_at", { withTimezone: true })`

## Known Limitations

1. **Variant assignment cannot be changed manually** — Once assigned, a company's variant is fixed. There is no admin UI or API to reassign. (Salt rotation affects new companies only.)
2. **Experiment results are aggregate-only** — Individual company-level experiment data is not exposed via API. Subscription-level analysis requires a manual JOIN.
3. **No automatic rollback** — If the experiment causes issues, it must be disabled via environment variable (`{"enabled": false}`) and a re-deploy.
4. **Checkout metadata persists** — Stripe checkout sessions created during the experiment include `pricingExperimentVariant` in metadata, which remains even after the experiment ends.
5. **Traffic percent is global** — The same `trafficPercent` applies to all companies. There is no per-tier or per-region targeting.
6. **Experiment config changes require re-deploy** — Changing the config requires updating the environment variable and re-deploying the server. No hot-reload.
7. **GA4 is not pre-configured** — The GA4 service is included in the codebase but requires explicit environment variable configuration to activate. It is off by default.
8. **Deterministic but not perfectly balanced** — At low company counts, the variant split may deviate from configured weights. Balance improves as sample size grows.
9. **Variant B price overrides require Stripe price IDs** — Setting `priceMonthlyCents` or `priceYearlyCents` in `variants.B.tierOverrides` without also setting the corresponding `stripePriceMonthlyId` and `stripePriceYearlyId` **will cause checkout session creation to fail** for that tier. The server logs a warning at startup (`applyTierOverrides`) if this mismatch is detected, but the error only surfaces when a user attempts to subscribe.

## Troubleshooting

### A company sees unexpected pricing
1. Query the DB: `SELECT pricing_experiment_variant FROM companies WHERE id = '<company-id>'`
2. If `NULL`, the company hasn't visited the pricing page since the experiment was enabled (or the experiment was disabled when they first visited)
3. If `'A'`, they see control pricing (expected unless they should be in the treatment group)
4. If `'B'`, check that tier overrides are correctly configured in `PRICING_EXPERIMENT_CONFIG`
5. Verify the environment variable is set and valid JSON, and the server was re-deployed after setting it

### Checkout session creation fails for a tier in variant B
1. Check server logs for `"Variant B tier override sets price without corresponding Stripe price ID"` warning
2. If present, add the missing `stripePriceMonthlyId` and `stripePriceYearlyId` fields to the tier override config
3. The tier's Stripe price IDs can be found in the Stripe Dashboard under Products → [product] → [price] → "ID" field (prefixed with `price_`)
4. Re-deploy the server after updating the config

### Experiment appears disabled for all companies
1. Check that `PRICING_EXPERIMENT_CONFIG` environment variable is set
2. Verify the JSON includes `"enabled": true`
3. Verify the server was re-deployed after setting the variable
4. Check server logs for PRICING_EXPERIMENT_CONFIG parse errors (logged at `warn` level)

### A company that should be in the experiment is seeing control pricing
1. Check if the company already has a variant assigned (DB query). If assigned while the experiment was disabled, they got `'A'` permanently
2. If unassigned, verify `trafficPercent` is sufficiently high to include them
3. Verify `salt` hasn't been changed (changing salt only affects new assignments, not re-assignments)

### Checkout session missing `pricingExperimentVariant` metadata
1. Verify the company has been enrolled (`pricing_experiment_variant` is not NULL)
2. This is non-critical — the metadata is informational only and does not affect the checkout flow

### Variant distribution appears uneven
1. Use `GET /api/companies/:id/billing/experiment-results` to check aggregate counts
2. At low sample sizes (e.g., fewer than 50 companies), random variation is expected
3. The split converges to the configured weights as the sample size grows
4. Verify `variants.B.weight` is set correctly in the config

### GA4 events not appearing in Google Analytics
1. Verify `GA4_ENABLED=true`, `GA4_MEASUREMENT_ID`, and `GA4_API_SECRET` are all set
2. Check server logs for GA4 request failures (logged at `warn` level)
3. Test with `GA4_DEBUG=true` — sends to the GA4 debug endpoint for validation
4. Note: GA4 events are fire-and-forget with a 5-second timeout. Failures are non-blocking.

## GA4 Configuration Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `GA4_MEASUREMENT_ID` | Yes (when enabled) | `""` | GA4 measurement ID (e.g., G-XXXXXXXXXX) |
| `GA4_API_SECRET` | Yes (when enabled) | `""` | GA4 Measurement Protocol API secret |
| `GA4_ENABLED` | No | `false` | Set to `"true"` to activate GA4 event sending |
| `GA4_DEBUG` | No | `false` | Set to `"true"` to use GA4 debug endpoint for validation |

## Escalation Path

| Issue | First Response | Escalation |
|---|---|---|
| Incorrect pricing displayed | Support Engineer verifies variant assignment and tier config | CTO — pricing service logic review |
| Checkout session fails for variant B tier | Support Engineer checks server logs for Stripe price ID warnings | CTO — verify Stripe product configuration and tier override schema |
| Experiment cannot be enabled | Support Engineer checks env var and server deployment | Release Engineer — verify deployment and restart |
| Strange experiment results (e.g., all companies in one variant) | Support Engineer checks per-variant counts via API | CTO — data integrity / assignment logic review |
| Stripe checkout metadata issues | Support Engineer confirms variant was persisted in DB | CTO — billing integration review |
| GA4 events not arriving | Support Engineer verifies GA4 env vars | CTO — server connectivity / GA4 property config |

## Monitoring Checklist

- [ ] Server logs show no `PRICING_EXPERIMENT_CONFIG` parse errors
- [ ] Experiment variant endpoint returns `{"variant":"A"|"B","enabled":true|false}` for enrolled companies
- [ ] Experiment results endpoint shows non-zero counts for both variants (when enabled)
- [ ] New Stripe checkout sessions include `pricingExperimentVariant` metadata
- [ ] GA4 events are arriving (if GA4 is configured): check GA4 debug/realtime reports
- [ ] DB has companies with non-null `pricing_experiment_variant` after first pricing page loads

## Rollback

To disable the experiment:
1. Set `PRICING_EXPERIMENT_CONFIG={"enabled":false}` (or remove the env var entirely)
2. Re-deploy the server
3. All companies will see control (variant A) pricing, regardless of stored assignment
4. Existing `pricing_experiment_variant` and `pricing_experiment_enrolled_at` data remains in the database — if re-enabled, previously assigned companies keep their existing variant

To disable GA4 analytics:
1. Set `GA4_ENABLED=false` or remove all `GA4_*` environment variables
2. Re-deploy the server

## Related Documentation

- [M5 Release Notes](../documentation/releases/m5-ab-pricing-experiment.md)
- [GA Fallback Planning (PostHog Contingency) — VOY-1941](../../doc/plans/ga-fallback-planning.md) (if available)