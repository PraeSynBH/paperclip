# Support Case Assessment — M5 A/B Pricing Experiment

**Feature**: A/B pricing experiment with PostHog feature flags and server-side deterministic fallback
**Version**: m5-v1
**Applies to**: VOY-1742 (M5 Pricing Experiment — PostHog Phase 2), VOY-2314 (M5 Pricing Page A/B Tests)
**Status**: PRE-SHIP DRAFT — code is uncommitted working tree on the server/UI (FE-owned, VOY-1742 in progress); NOT deployed. R1a (which does not include the M5 experiment) is merged to master at `6b1d841658` (2026-08-25) but **NOT live in production** — redeploy tracked by VOY-2344. Publish this assessment when the M5 experiment deploys.
**Maintained by**: Support Engineer (88b72065)

## Feature Overview (User Perspective)

The M5 A/B Pricing Experiment modifies the `/pricing` page based on which experiment variant a company is assigned to. The experiment tests three UX dimensions via PostHog feature flags, with a server-side deterministic fallback when PostHog is not configured.

### Experiment Variants

| Variant | Description |
|---------|-------------|
| **A (Control)** | Existing pricing page — direct-to-Stripe checkout on "Subscribe" button click |
| **B (Treatment)** | Modified pricing page with confirmation dialog, savings badges, billing period toggle, and social proof section |

### Three Experiment Dimensions (PostHog Feature Flags)

The variant B experience is composed of three independently controlled PostHog feature flags, each with its own variants:

| Flag Key | Values | Behavior |
|----------|--------|----------|
| `pricing_cta_button` | `control` / `confirmation_dialog` / `hero_cta` | CTA button behavior: control = direct checkout, confirmation_dialog = show confirm modal first, hero_cta = prominent hero-style CTA |
| `pricing_tier_layout` | `control` / `savings_badges` / `comparison_table` | Tier card layout: control = standard cards, savings_badges = yearly savings percentage badges, comparison_table = side-by-side comparison rows |
| `pricing_social_proof` | `control` / `testimonials` / `stats` | Social proof section below header: control = hidden, testimonials = customer quote cards, stats = usage statistics (10x faster, 99.9% uptime, 50k+ agents) |

A company is considered "Variant B" when **any** of its PostHog flags resolves to a non-control value.

### How Variants Are Assigned

1. **Primary: PostHog feature flags** — When `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST` are configured in the UI environment, PostHog's `getFeatureFlag()` determines each company's variant for each experiment dimension. PostHog handles targeting, rollout percentage, and flag persistence.
2. **Fallback: Server-side deterministic hash** — When PostHog is not configured, the server assigns a variant using SHA-256(companyId + salt) modulo 100. The assignment is persisted on the `companies` table (`pricingExperimentVariant`, `pricingExperimentEnrolledAt` columns) and is idempotent (same company always gets the same variant as long as the salt stays the same).
3. **Kill-switch** — The experiment can be fully disabled via the `PRICING_EXPERIMENT_CONFIG` environment variable or by setting `enabled: false`. When disabled, all companies see Variant A (control) pricing.

### What Users See

**All users:**
- Pricing page with tier cards showing name, description, price, and features
- Current subscription status card (if subscribed)
- Billing period toggle (monthly/yearly — visible only for variant B)

**Variant B additional elements:**
- **Confirmation dialog** — Clicking "Start Free Trial" shows a modal confirming the plan choice, trial terms, and price before proceeding to Stripe checkout
- **Savings badges** — Yearly pricing shows a green "Save X%" badge; monthly view shows a "Save X% with yearly billing" hint
- **Price comparison** — Yearly view shows "X/month normally · Y/year" price comparison
- **Social proof section** — Either customer testimonials or usage statistics below the page header (depending on PostHog flag value)
- **Billing period toggle** — Monthly/Yearly toggle buttons below the subscription status card

**Internal users** (instance admins, company owners/admins) additionally see an experiment variant badge next to the page title showing which variant they're assigned to.

## What Changed

### New API endpoint

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/companies/:companyId/billing/experiment-variant` | Any company member | Get the server-side experiment variant and enabled status for this company |

### New environment variables

| Variable | Required? | Description |
|----------|-----------|-------------|
| `VITE_POSTHOG_KEY` | Optional — for PostHog integration | PostHog project API key (public, client-side safe) |
| `VITE_POSTHOG_HOST` | Optional — for PostHog integration | PostHog host URL (default: https://us.posthog.com) |
| `PRICING_EXPERIMENT_CONFIG` | Optional — for server-side fallback | JSON config: `{"enabled":true,"trafficPercent":50,"variants":{"B":{"weight":50}}}` |

### New schema columns

| Column | Table | Type | Description |
|--------|-------|------|-------------|
| `pricing_experiment_variant` | `companies` | `text` | Assigned experiment variant ("A" or "B"), or null if not yet assigned |
| `pricing_experiment_enrolled_at` | `companies` | `timestamp with time zone` | When the company was enrolled in the experiment |

### New files

| File | Purpose |
|------|---------|
| `server/src/services/pricing-experiment.ts` | Server-side experiment service: deterministic variant assignment, tier overrides, config parsing, results aggregation |
| `ui/src/lib/posthog.ts` | PostHog client initialization (lazy singleton), event capture, feature flag access, identity management |
| `ui/src/hooks/useFeatureFlag.ts` | React hook for PostHog feature flags with `useSyncExternalStore` reactivity |
| `ui/src/api/billing.ts` | Billing API client with experiment variant endpoint and subscription/tier types |
| `scripts/setup-posthog-experiments.mjs` | Script to create pricing experiments in PostHog dashboard |

### Modified files

| File | Change |
|------|--------|
| `packages/db/src/schema/companies.ts` | Added `pricingExperimentVariant`, `pricingExperimentEnrolledAt` columns |
| `server/src/routes/billing.ts` | Added experiment-variant endpoint, imported pricing experiment service |
| `ui/src/api/index.ts` | Added billing API export |
| `ui/src/lib/queryKeys.ts` | Added billing query keys including `experimentVariant` |
| `ui/src/pages/Pricing.tsx` | Added experiment-aware UI: PostHog flag resolution, confirmation dialog, savings badges, social proof section, billing period toggle, experiment variant badge for internal users, checkout event tracking |
| `ui/package.json` | Added `posthog-js` dependency |

## Potential User Confusion Points

1. **"I see different pricing than my colleague"** — This is expected. The pricing experiment randomly assigns companies to variant A or B. Users in the same company see the same variant (assignment is per-company, not per-user).

2. **"The pricing page looks different than yesterday"** — The experiment may have been enabled/disabled or the PostHog flag configuration may have changed. Check with the product team for current experiment status.

3. **"I clicked Subscribe and nothing happened"** — Variant B shows a confirmation dialog first. Look for the "Confirm Your Plan" modal. If it doesn't appear, check browser popup blockers or console errors.

4. **"The 'Start Free Trial' button doesn't do anything"** — The confirmation dialog may be blocked by a popup blocker. Allow popups for the site, or try clicking the button again.

5. **"I'm seeing testimonials but they look fake"** — Testimonials in the social proof section are placeholder content controlled by the PostHog feature flag payload. They will be replaced with real customer data in a future update.

6. **"Yearly savings badge says I'm saving money but the prices look the same"** — The server-side tier overrides in the experiment config can modify prices per variant. If no overrides are configured, prices remain the same and the savings badge shows 0% (hidden when savings is 0).

7. **"The billing period toggle disappeared"** — The monthly/yearly toggle is only visible for variant B companies. Variant A (control) uses the server-configured default billing period.

## Known Limitations

1. **PostHog is optional** — The pricing experiment works with or without PostHog. When PostHog is not configured, the server-side deterministic assignment is used, which provides only a single A/B split without per-flag dimension control.

2. **No real-time flag updates** — PostHog flags are fetched on page load and cached for 5 minutes (`staleTime`). Changes to PostHog flag configuration may take up to 5 minutes to propagate to existing sessions.

3. **Client-side only** — Experiment decisions are made on the client side. There is no server-side enforcement of variant-specific pricing (e.g., the Stripe checkout session does not vary by variant).

4. **Social proof content is placeholder** — Testimonials and statistics are hardcoded in the UI and controlled by PostHog flags. They are not yet driven by real customer data.

5. **No experiment results dashboard** — The server has a `getResults()` endpoint that returns variant assignment counts, but there is no UI for viewing experiment results. PostHog should be used for analysis.

6. **Assignment is per-company, not per-user** — All users in the same company see the same variant. This prevents confusion within a company but means per-user A/B testing is not supported.

7. **Salt rotation reassigns all companies** — Changing the `salt` in the experiment config will re-assign all unassigned companies to potentially different variants. Already-assigned companies keep their existing variant.

## Troubleshooting Guide

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| Pricing page shows no experiment effects | Experiment disabled in config, or PostHog not configured | Check `PRICING_EXPERIMENT_CONFIG` on server; check `VITE_POSTHOG_KEY` on client; verify experiment `enabled` is `true` |
| "Experiment: Variant B" badge not showing for internal users | User is not an instance admin, company owner, or company admin | Badge is only shown to internal users; regular users don't see it |
| Confirmation dialog doesn't appear on "Start Free Trial" click | Popup blocker; or user is variant A (which goes directly to Stripe) | Check popup blocker settings; check experiment variant assignment |
| "Failed to create checkout session" error | Missing `STRIPE_SECRET_KEY` on server; or invalid tier ID | Verify Stripe configuration; check server logs for details |
| Pricing page shows variant B elements but colleague sees variant A | Company ID mismatch (different companies); or PostHog flags not loaded for one user | Verify both users are in the same company; check PostHog flag status |
| Social proof section shows both testimonials AND stats | PostHog flag `pricing_social_proof` returned unexpected value | Check PostHog dashboard for flag configuration; the component only shows one variant at a time |
| Yearly savings badge shows "Save 0%" | No tier overrides configured for variant B; or prices are identical | Expected when experiment has no price modifications; the badge is hidden when savings is 0% |
| API returns 404 for `/billing/experiment-variant` | Server code not deployed; endpoint not yet available | Verify deployment includes the pricing experiment server changes |

## Support Escalation Path

| Issue | Severity | Action |
|-------|----------|--------|
| Pricing experiment incorrectly assigns variant (e.g., all companies get variant B) | High | Check `PRICING_EXPERIMENT_CONFIG` and PostHog flag configuration. If misconfigured, disable experiment and notify Engineering |
| PostHog flags not loading (all users see control) | Medium | Verify `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST` are correctly set in the UI build environment. Check PostHog dashboard for project status |
| Confirmation dialog fails to proceed to Stripe | High | Check Stripe configuration (`STRIPE_SECRET_KEY`). If Stripe is working, the issue is likely a failed checkout session creation — escalate to Engineering |
| Users reporting inconsistent pricing page experiences | Medium | Verify experiment variant assignment for the affected companies via the API. If inconsistent within the same company, check for company ID mismatches |
| Server-side experiment endpoint returning errors | High | Check server logs; verify `PRICING_EXPERIMENT_CONFIG` is valid JSON if set. Escalate to Engineering if the error persists |

## Related Documentation

- [Billing System Support Case Assessment](support-case-billing-system.md)
- [Stripe Billing Robustness Fixes Support Case Assessment](support-case-stripe-billing-fixes.md)

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| m5-v1 | 2026-08-25 | Support Engineer | Initial assessment for M5 A/B Pricing Experiment. Covers PostHog feature flags, server-side deterministic fallback, three experiment dimensions (CTA button, tier layout, social proof), confirmation dialog, savings badges, billing period toggle, troubleshooting guide, and escalation path. |
