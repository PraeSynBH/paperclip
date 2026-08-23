---
title: Pricing Page UX Enhancements — Billing Toggle, Usage Bars, Feature Icons,
  Experiment Rendering, GA4 Events
version: voy-1888
date: 2026-08-23
commits: b878783795 (Code Separation Phase 2)
status: Committed via b878783795 on feat/clean-m5-pricing-pr
---

# Pricing Page UX Enhancements

**Branch:** `feat/clean-m5-pricing-pr`
**Commit:** `b878783795` (Code Separation Phase 2)
**Related issues:** VOY-1888, VOY-1685, VOY-1941
**Upstream PR status:** Frozen per CEO VOY-1959. Fork experiment continues.

The pricing page has been redesigned with five major UX enhancements: a monthly/yearly billing toggle, usage consumption progress bars, contextual feature icons, experiment variant-aware rendering, and client-side GA4 event tracking.

---

## What Changed

### 1. Monthly/Yearly Billing Toggle

Users can now switch between monthly and yearly billing directly on the pricing page.

| Aspect | Before | After |
|--------|--------|-------|
| Billing period selection | Not available on pricing page | Toggle switch with "Monthly" / "Yearly" labels |
| Yearly savings visibility | Not shown | Badge: "Save ~20%" shown next to Yearly label |
| Price display | Single monthly price | Price switches between monthly and per-year rates |
| Seasonal/annual pricing | Implicit | Tier card shows "Save X%" badge on the tier name when annual savings > 0 |

**How it works:**
- The `BillingToggle` component renders a switch between Monthly and Yearly
- Toggling updates local state and fires a `billing_period_toggle` GA4 event
- Tier prices switch between `priceMonthlyCents` and `priceYearlyCents` from the tier object
- Annual savings are computed as `formatAnnualSavings(monthlyCents, yearlyCents)` — shown as a percentage badge when savings > 0

### 2. Usage Progress Bars

Subscription tiers now display usage consumption as visual progress bars.

**Displayed metrics:**
- **Seats** — Number of seats used vs. included (`tier.includedSeats`)
- **Agent runs / mo** — Agent run consumption vs. included (`tier.includedAgentRuns`)
- **Storage** — Storage usage vs. included (`tier.includedStorageGb`)

**Behavior:**
- On tier cards: Always shows included quota. No usage bar for unsubscribed companies.
- On the "Current Subscription" card: Shows actual usage bars with `used / included` labels and a filled progress bar at `min(100%, used/included * 100)` width.
- Progress bar is rendered by the `UsageRow` component with a `bg-primary/60` fill on a `bg-muted` track (1.5px height).

### 3. Contextual Feature Icons

Feature list items now show contextual icons instead of a generic checkmark.

| Feature Keyword | Icon | Component |
|-----------------|------|-----------|
| "agent" or "run" | **Zap** (`⚡`) | `Zap` from lucide-react |
| "seat", "member", "user", or "team" | **Users** (`👥`) | `Users` from lucide-react |
| "security", "sso", "audit", or "shield" | **Shield** (`🛡️`) | `Shield` from lucide-react |
| Everything else | **Check** (`✓`) | `Check` from lucide-react |

The `FeatureIcon` component uses case-insensitive string matching on the feature text. Feature labels are auto-capitalized and underscores replaced with spaces.

### 4. Pricing Experiment Variant Rendering

When the A/B pricing experiment (VOY-1685) is active and a company is assigned to variant B, the pricing page renders differently:

| Element | Variant A (control) | Variant B (experiment) |
|---------|--------------------|----------------------|
| Page header | "Pricing" | "Find the Right Plan for Your Team" |
| Subtitle | "Choose the plan that fits your needs. All plans include a 14-day free trial." | "Start with a 14-day free trial. No credit card required. Cancel anytime." |
| Recommended tier badge | "Most Popular" with Sparkles icon | "Best Value" with Sparkles icon |
| CTA label (non-recommended tiers) | "Subscribe" | "Get Started" |
| CTA label (recommended tier) | "Subscribe" | "Start Free Trial" |
| CTA icon | CreditCard icon (before label) | ArrowRight icon (after label) |
| Experiment indicator | Not shown (unless variant B) | Shows subtle "Experiment variant B · 3 tiers loaded" at page bottom |

Variant detection: The page queries `GET /api/companies/:id/billing/experiment-variant` and uses both the `variant` ("A"|"B") and `enabled` flag to determine rendering.

### 5. Client-Side GA4 Event Tracking

The pricing page now fires Google Analytics 4 events client-side via a `ga4()` helper function:

| Event | Trigger | Parameters |
|-------|---------|------------|
| `checkout_started` | User clicks a CTA button (calls `createCheckoutSession`) | `tier_id`, `billing_period`, `experiment_variant`, `company_id` |
| `billing_period_toggle` | User toggles monthly/yearly switch | `period` ("monthly"|"yearly"), `company_id` |
| `subscription_cancellation_started` | User confirms cancellation | `company_id` |
| `cta_clicked` | User clicks any CTA button | `tier_id`, `tier_name`, `billing_period`, `experiment_variant`, `company_id` |

**Implementation notes:**
- The `ga4()` helper wraps `globalThis.gtag()` with a try/catch — failures are silently dropped
- Events are best-effort; ad-blockers or missing gtag script will not break the pricing page
- The global `gtag` function must be loaded separately (e.g., via Google Tag Manager or the GA4 snippet)
- All events include `company_id` in parameters for server-side correlation

---

## Architecture Changes

### Routes
- Experiment variant/results endpoints have been moved from `billingWebhookRoute` (unauthenticated webhook router) to `billingRoutes` (authenticated API router), where they belong
- `billingRoutes` now receives an optional `PricingExperimentService` parameter for experiment-aware billing operations

### Services
- `billingService(db)` now accepts an optional `experiment?: PricingExperimentService` parameter
- When present, `listTiers(companyId)` calls `experiment.getOrAssignVariant()` to determine the company's variant and applies `applyTierOverrides()` before returning tiers
- `createCheckoutSession` includes the `pricingExperimentVariant` in Stripe metadata

### GA4 Analytics
- Named singleton export `ga4AnalyticsService` added to `server/src/services/ga4-analytics.ts`
- `getGa4AnalyticsService()` returns a shared singleton instance usable from any service

---

## Known Limitations

1. **GA4 client-side events require gtag.js** — The `ga4()` helper needs the global `gtag` function loaded separately. If gtag is not present, events are silently dropped.
2. **Yearly savings badge is a static estimate** — The "Save ~20%" badge on the billing toggle is hardcoded text, not computed from actual tier prices.
3. **Usage bars show actual consumption only for subscribed companies** — Tier cards show included quotas without usage bars unless the company has a subscription.
4. **Experiment variant indicator is subtle** — The variant label at page bottom uses 10px muted text — may be missed by support staff during troubleshooting.
5. **No calendar-based annual savings month** — The annual savings percentage shown on tier cards is computed as `monthlyCents * 12 vs yearlyCents`. This works for the standard case but may show 0% for custom pricing configurations.

## Troubleshooting

### Pricing page shows wrong billing period
1. Check `billingPeriod` state — toggle fires `setBillingPeriod()` with the opposite value
2. Verify tier objects have both `priceMonthlyCents` and `priceYearlyCents`
3. If tier has only monthly pricing, the "Save X%" badge won't appear

### Usage bars not appearing on Current Subscription
1. Verify the company has an active subscription
2. Check that `subscription.usage` is a non-empty array
3. Each usage row must have `metric`, `included`, and `usage` properties
4. The metric must be one of: `seats`, `agent_runs`, `storage_gb`

### Experiment variant rendering looks wrong
1. Verify `GET /api/companies/:id/billing/experiment-variant` returns `{ variant: "B", enabled: true }`
2. If `enabled: false`, the page renders variant A styling regardless of variant
3. Check browser console for GA4 errors — gtag failures are non-blocking but logged
4. Verify `PRICING_EXPERIMENT_CONFIG` is set and has `"enabled": true`

### GA4 events not firing
1. Check browser console for `gtag is not a function` — the GA4 snippet/GTM must be loaded
2. The `ga4()` helper silently catches errors — enable verbose logging to see failures
3. Verify browser has not blocked analytics scripts (ad-blockers)

## Escalation Path

| Issue | First Response | Escalation |
|-------|---------------|------------|
| Billing toggle not working (doesn't switch prices) | Support Engineer verifies tier data has both monthly/yearly prices | CTO — verify tier schema and API response |
| Usage progress bars incorrect | Support Engineer checks subscription usage data in DB | CTO — subscription usage aggregation logic |
| Feature icons don't match feature text | Support Engineer verifies the feature string contains expected keywords | CTO — feature string naming conventions |
| Experiment variant rendering not matching config | Support Engineer checks variant endpoint response | CTO — pricing experiment service logic |
| GA4 events not appearing in GA4 dashboard | Support Engineer verifies gtag is loaded and browser isn't blocking | CTO — GA4 property configuration |

---

*Paperclip Platform — Pricing Page UX Release (branch: feat/clean-m5-pricing-pr)*