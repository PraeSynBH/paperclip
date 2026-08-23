# VOY-1685: A/B Test Pricing Page CTA Placement

**Status:** Locked — ready for Phase 1 (frontend variants) immediately  
**Owner:** Founding Engineer  
**Effort:** Small  
**Target:** Sprint Week 3-4  
**Depends on:** PostHog funnels (P2-G) / VOY-1719 (blocked on founder credentials)

---

## Problem

The pricing page has three untapped conversion levers:

1. **CTA Button** — currently a single "Subscribe" + CreditCard icon layout. Color, copy, and urgency can be optimized.
2. **Pricing Tier Layout** — monthly-only display. Annual billing drives higher LTV, but there's no toggle or annual emphasis.
3. **Social Proof** — no testimonials, trust badges, or "companies using" signals near the purchase decision.

We cannot measure the impact of any change without PostHog funnel infrastructure. The PostHog conversion tracking events (`pricing.page_view`, `pricing.subscribe_click`, `pricing.subscription_completed`, etc.) are being implemented in VOY-1707.

## Solution

Three independent PostHog Experiments, each composed of **control** + **2 variant** treatments. The variant React components are built now (Phase 1) and activated via PostHog feature flags when credentials arrive (Phase 2).

---

## Architecture

### Data Flow

```
User browser                        Server (VOY-1707)                  PostHog Cloud
    │                                    │                                  │
    │  1. Pricing page loads ────────────┤                                  │
    │                                    ├── GET /feature-flag/pricing_* ───┤
    │  ←── variant assignment ──────────┤                                  │
    │                                    │                                  │
    │  2. User sees control/variant      │                                  │
    │     CTA, layout, social proof      │                                  │
    │                                    │                                  │
    │  3. User clicks Subscribe ────────→┤                                  │
    │                                    ├── captureMetric("pricing.        │
    │                                    │    subscribe_click") ────────────→│
    │                                    │                                  │
    │  4. User completes checkout        │                                  │
    │                                    ├── captureMetric("pricing.        │
    │                                    │    subscription_completed") ─────→│
    │                                    │                                  │
    │  5. PostHog Funnel Analysis        │                                  │
    │  (post-unblock)                    │        ←── Funnel data ──────────┤
```

**Key principle:** Variant components are rendered client-side. The A/B assignment is fetched via PostHog feature flags (or a mock hook pre-unblock). All conversion events are captured server-side (VOY-1707).

### Component Tree Changes

```
PricingPage (modified)
├── CurrentSubscriptionCard (unchanged)
├── SocialProofBanner           ← NEW (variant, flag: pricing_social_proof)
├── <div class="grid">
│   └── PricingTierCard (modified)
│       ├── BillingPeriodToggle  ← NEW (variant, flag: pricing_tier_layout)
│       ├── TierFeatures (unchanged)
│       └── CTASection           ← NEW (variant, flag: pricing_cta_button)
└── FooterNote (unchanged)
```

### PostHog Feature Flag Schema

| Flag Key | Values | Default | Description |
|---|---|---|---|
| `pricing_cta_button` | `control`, `variant_a`, `variant_b` | `control` | CTA button copy/color/icon |
| `pricing_tier_layout` | `control`, `variant_a`, `variant_b` | `control` | Monthly/annual layout |
| `pricing_social_proof` | `control`, `variant_a`, `variant_b` | `control` | Social proof placement |

---

## Experiment Specifications

### Experiment A: CTA Button Variants

| Variant | Button Text | Icon | Color | Additional |
|---|---|---|---|---|
| **control** | Subscribe | CreditCard | default (bg-primary) | Current behavior |
| **variant_a** | Get Started | ArrowRight | bg-primary hover:bg-primary/90 | Larger font, no icon right-float |
| **variant_b** | Start Free Trial | Sparkles | bg-gradient-to-r from-primary to-accent | Subtle pulse animation on hover, "No credit card required" sub-text |

**PostHog Experiment:** "Pricing CTA Button A/B"  
**Primary metric:** `pricing.subscribe_click` rate per page view  
**Secondary metric:** `pricing.checkout_started` rate per subscribe click

#### Implementation: `ui/src/pages/pricing/CTASection.tsx` (NEW)

```tsx
interface CTASectionProps {
  tierId: string;
  isCurrentTier: boolean;
  isPending: boolean;
  onSubscribe: (tierId: string) => void;
  variant: 'control' | 'variant_a' | 'variant_b';
}

function CTASection({ tierId, isCurrentTier, isPending, onSubscribe, variant }: CTASectionProps) {
  if (isCurrentTier) {
    return (
      <Button className="w-full" variant="outline" disabled>
        <Check className="h-4 w-4 mr-2" /> Current Plan
      </Button>
    );
  }

  switch (variant) {
    case 'variant_a':
      return (
        <Button className="w-full text-base" onClick={() => onSubscribe(tierId)} disabled={isPending}>
          Get Started <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      );
    case 'variant_b':
      return (
        <div className="space-y-1">
          <Button
            className="w-full bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 animate-pulse-on-hover"
            onClick={() => onSubscribe(tierId)}
            disabled={isPending}
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Start Free Trial
          </Button>
          <p className="text-xs text-center text-muted-foreground">No credit card required</p>
        </div>
      );
    default: // control
      return (
        <Button className="w-full" onClick={() => onSubscribe(tierId)} disabled={isPending}>
          <CreditCard className="h-4 w-4 mr-2" />
          {isPending ? "Loading..." : "Subscribe"}
        </Button>
      );
  }
}
```

### Experiment B: Pricing Tier Layout

| Variant | Display | Annual Emphasis | Badges |
|---|---|---|---|
| **control** | Monthly price only | None | None |
| **variant_a** | Monthly/Annual toggle switch | "Save 20%" badge on annual prices | Save badge on each card's annual price |
| **variant_b** | Annual default with monthly option | Annual shown first, monthly link below | "Most Popular" on mid-tier, "Best Value" on highest tier |

**Implementation:** `ui/src/pages/pricing/BillingPeriodToggle.tsx` (NEW)

The tier card price display region becomes:

```tsx
// Inside PricingTierCard
const { billingPeriod } = useBillingPeriod(); // from context or prop
const priceCents = billingPeriod === 'yearly' ? tier.priceYearlyCents : tier.priceMonthlyCents;
const periodLabel = billingPeriod === 'yearly' ? '/year' : '/month';
const isAnnualDiscount = billingPeriod === 'yearly' && tier.priceYearlyCents < tier.priceMonthlyCents * 12;
```

For `variant_a` — Add a toggle at the top of the pricing grid:

```tsx
<div className="flex items-center justify-center gap-3 mb-8">
  <span className={billingPeriod === 'monthly' ? 'font-semibold' : 'text-muted-foreground'}>Monthly</span>
  <Switch checked={billingPeriod === 'yearly'} onCheckedChange={toggleBilling} />
  <span className={billingPeriod === 'yearly' ? 'font-semibold' : 'text-muted-foreground'}>
    Annual <Badge variant="success">Save 20%</Badge>
  </span>
</div>
```

For `variant_b` — Always show annual as primary, add a small "or pay monthly" text below:

### Experiment C: Social Proof Placement

| Variant | Type | Position | Content |
|---|---|---|---|
| **control** | None | — | — |
| **variant_a** | Trust bar | Between page heading and tier grid | "Trusted by 500+ engineering teams" with company logos |
| **variant_b** | Testimonial card | Below tier grid | Quote card with avatar, name, title, and company |

**Implementation:** `ui/src/pages/pricing/SocialProof.tsx` (NEW)

Static seeded content (update once real data exists):
- 3-4 testimonials in a carousel or single highlight
- Trust bar showing logo placeholders and user count

---

## Feature Flag Hook

Use a shared hook that abstracts PostHog's `isFeatureEnabled()` / `getFeatureFlag()`.

**Phase 1 (mock, no PostHog needed):**

`ui/src/hooks/useFeatureFlag.ts` (NEW)

```tsx
// Phase 1: Mock implementation — returns hardcoded default values.
// Phase 2: Replace with real posthog.getFeatureFlag() after PostHog credentials arrive.

type FeatureFlag = 'pricing_cta_button' | 'pricing_tier_layout' | 'pricing_social_proof';
type FlagValue = string;

const FLAG_DEFAULTS: Record<FeatureFlag, FlagValue> = {
  pricing_cta_button: 'control',
  pricing_tier_layout: 'control',
  pricing_social_proof: 'control',
};

// Enable local override for development:
// localStorage.setItem('ff_pricing_cta_button', 'variant_a')
function getLocalOverride(key: FeatureFlag): FlagValue | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(`ff_${key}`);
}

export function useFeatureFlag(key: FeatureFlag): FlagValue {
  const override = getLocalOverride(key);
  if (override) return override;
  return FLAG_DEFAULTS[key];
}
```

**Phase 2 (PostHog enabled):**

Replace the default map with real PostHog calls:

```tsx
import { usePostHog } from 'posthog-js/react';

export function useFeatureFlag(key: FeatureFlag): FlagValue {
  const posthog = usePostHog();
  const [flag, setFlag] = useState<FlagValue>(FLAG_DEFAULTS[key]);

  useEffect(() => {
    if (!posthog) return;
    const value = posthog.getFeatureFlag(key);
    if (value) setFlag(value as FlagValue);
  }, [posthog, key]);

  return flag;
}
```

---

## PostHog Client-Side Integration (Phase 2)

1. **Add `posthog-js` to `ui/package.json`:**
   ```json
   "posthog-js": "^1.200.0"
   ```
   (Check latest version at npm when implementing.)

2. **Initialize in app bootstrap (`ui/src/App.tsx` or `ui/src/main.tsx`):**
   ```tsx
   import posthog from 'posthog-js';
   import { PostHogProvider } from 'posthog-js/react';

   if (import.meta.env.VITE_POSTHOG_KEY) {
     posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
       api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.posthog.com',
       person_profiles: 'identified_only',
     });
   }

   root.render(
     <PostHogProvider client={posthog}>
       <App />
     </PostHogProvider>
   );
   ```

3. **Add env vars:** `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST` to deployment.

---

## Edge Cases & Failure Modes

| Scenario | Behavior |
|---|---|
| **PostHog not configured (Phase 1)** | `useFeatureFlag` returns `'control'` for all flags. Page renders the current (control) UI. No errors. |
| **PostHog returns unknown flag value** | Fall through to `control` in the switch-case. Page renders safely. |
| **PostHog flag evaluation fails** | `useFeatureFlag` returns default value (no PostHog dependency). |
| **New tier added** | Tiers are server-driven — Experiments A and B render independently of tier count. Experiment C's trust bar is static (update via deployment). |
| **`priceYearlyCents` is null for a tier** | Don't show annual price. Fall back to monthly-only for that tier. |
| **User has already subscribed** | CTA shows "Current Plan" (disabled) regardless of variant — mutation's `isCurrentTier` flag takes precedence. |
| **localStorage override present (dev)** | `useFeatureFlag` returns the override value. Enables QA to test all variants without PostHog. |
| **Multiple experiments interact** | Experiments are independent flags — a user gets one variant from each experiment simultaneously. Cardinality: 3 × 3 × 3 = 27 possible combinations. Each combination is valid. |

---

## Test Coverage

| Test | Scope | File |
|---|---|---|
| CTASection renders control variant | Verify CreditCard icon + "Subscribe" text | `Pricing.test.tsx` (extend) |
| CTASection renders variant_a | Verify ArrowRight icon + "Get Started" text | `Pricing.test.tsx` (extend) |
| CTASection renders variant_b | Verify Sparkles icon + "Start Free Trial" text + sub-text | `Pricing.test.tsx` (extend) |
| CTASection shows "Current Plan" for current tier | All variants | `Pricing.test.tsx` (extend) |
| Pricing page renders switch in variant_a layout | Toggle rendered, switching updates prices | `Pricing.test.tsx` (NEW test block) |
| Pricing page uses annual prices in yearly mode | Verify `priceYearlyCents` displayed when toggle is yearly | `Pricing.test.tsx` (extend) |
| Social proof renders trust bar in variant_a | Trust bar visible above grid | `Pricing.test.tsx` (extend) |
| Social proof renders testimonial in variant_b | Testimonial card visible below grid | `Pricing.test.tsx` (extend) |
| `useFeatureFlag` returns defaults when no PostHog | Mock hook returns `'control'` | `useFeatureFlag.test.ts` (NEW) |
| `useFeatureFlag` respects localStorage override | Set `ff_pricing_cta_button` and verify override | `useFeatureFlag.test.ts` (NEW) |
| PostHog provider initialization (Phase 2) | Verify `posthog.init` called with env vars | Integration test |

---

## Implementation Order

### Phase 1 — Frontend Variants (no PostHog needed)

1. Create `ui/src/pages/pricing/CTASection.tsx` — CTA button component with all 3 variants
2. Create `ui/src/pages/pricing/SocialProof.tsx` — Trust bar + testimonial variants
3. Create `ui/src/pages/pricing/BillingPeriodToggle.tsx` — Monthly/annual toggle
4. Create `ui/src/hooks/useFeatureFlag.ts` — Mock feature flag hook (localStorage override)
5. Refactor `PricingPage` to compose all 3 variant sections via `useFeatureFlag`
6. Extend `Pricing.test.tsx` — test all variant states

### Phase 2 — PostHog Experiment Integration (blocked on VOY-1719)

7. Add `posthog-js` & `posthog-js/react` to `ui/package.json`
8. Initialize PostHog in app bootstrap with `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST`
9. Replace mock `useFeatureFlag` with real PostHog hook
10. Create 3 experiments in PostHog dashboard (manual, founder-trusted account)
11. Activate experiments at 50/25/25 traffic split
12. Monitor conversion funnel via PostHog dashboard

---

## Dependencies

| Dependency | Status | Unblock Action |
|---|---|---|
| `posthog-js` npm package | Not yet added | Phase 2 — add when starting PostHog integration |
| `VITE_POSTHOG_KEY` env var | Blocked (VOY-1719) | Founder provides PostHog credentials |
| `VITE_POSTHOG_HOST` env var | Blocked (VOY-1719) | Founder provides PostHog credentials |
| PostHog account/workspace | Blocked (VOY-1719) | Founder sets up PostHog |
| VOY-1707 conversion tracking events | In progress (Founding Engineer) | Needs `POSTHOG_API_KEY` + `POSTHOG_HOST` as well |

---

## Child Issues

| Issue | Title | Assignee | Blocked On |
|---|---|---|---|
| **VOY-1685.1** | Impl: Pricing page A/B variant components (CTA, layout, social proof) | Founding Engineer (57fa7e0e) | — |
| **VOY-1685.2** | Code Review: Pricing A/B variant components | Staff Engineer (eee825c7) | VOY-1685.1 |
| **VOY-1685.3** | Release: Ship pricing A/B variant components (Phase 1 — inactive by default) | Release Engineer (7a2a259f) | VOY-1685.2 |
| **VOY-1685.4** | Impl: PostHog experiment integration + feature flags (Phase 2) | Founding Engineer (57fa7e0e) | VOY-1719 (PostHog credentials) |
| **VOY-1685.5** | Code Review: PostHog experiment integration | Staff Engineer (eee825c7) | VOY-1685.4 |
| **VOY-1685.6** | QA: Verify A/B experiments in PostHog dashboard | QA Engineer (c3bdfe58) | VOY-1685.3 + VOY-1685.5 |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| PostHog credentials delayed indefinitely | Medium | High (Phase 2 blocked) | Phase 1 ships control-only UI (no regression). variants sit dormant behind localStorage. |
| PostHog experiment framework costs | Low | Medium | PostHog Experiments is included in PostHog Scale plan (~$50-100/mo). Self-serve at posthog.com. |
| Flag evaluation latency adds jank | Low | Low | PostHog flags are cached client-side (localStorage). `useFeatureFlag` falls back to default while loading. |
| Multiple experiments confound results | Low | Medium | Each experiment measures independent metrics. If interaction effects are suspected, run sequential experiments instead of parallel. |

---

*End of plan.*