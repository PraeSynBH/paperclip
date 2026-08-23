# M5: Deploy A/B Pricing Test — Technical Execution Plan

**Owner:** CTO
**Parent:** VOY-1685
**Date:** 2026-08-23

---

## 1. Overview

Deploy a server-side A/B pricing test for Paperclip (Voyonder). Companies are deterministically assigned to variant A (control — current pricing) or variant B (treatment — adjusted pricing structure) on first interaction with the pricing system. Conversion is tracked via Stripe checkout metadata and an internal experiment assignment table.

**Goal:** Determine which pricing structure drives higher conversion from signup → paid subscription.

---

## 2. Variant Design

### Variant A (Control) — Current Pricing

| Tier | Monthly | Yearly | Seats | Agent Runs/mo | Storage |
|------|---------|--------|-------|---------------|--------|
| Adventurer | $29 | $290/yr | 2 | 500 | 5 GB |
| Explorer | $79 | $790/yr | 5 | 2000 | 25 GB |
| Elite | $199 | $1,990/yr | 20 | 10000 | 100 GB |

### Variant B (Treatment) — Adjusted Pricing

Lower entry price + rebalanced mid tier to reduce friction:

| Tier | Monthly | Yearly | Seats | Agent Runs/mo | Storage | Changes |
|------|---------|--------|-------|---------------|---------|---------|
| Adventurer | $19 | $190/yr | 2 | 500 | 5 GB | -$10/mo (lower barrier) |
| Explorer | $69 | $690/yr | 5 | 2000 | 25 GB | -$10/mo |
| Elite | $179 | $1,790/yr | 20 | 10000 | 100 GB | -$20/mo |

**Rationale:** Lower entry price ($19) reduces signup friction. Moderate reductions on upper tiers maintain perceived value while improving conversion.

> **Note:** Pricing numbers are initial proposals. CEO/COO can adjust via config without code changes.

---

## 3. Architecture

### 3.1 Data Model

Two columns on `companies` table:
- `pricing_experiment_variant` (text, nullable) — `null` (not assigned), `'A'` (control), `'B'` (treatment)
- `pricing_experiment_enrolled_at` (timestamptz, nullable)

### 3.2 Experiment Configuration

```typescript
interface PricingExperimentConfig {
  enabled: boolean;
  trafficPercent: number; // e.g. 50 = 50% of traffic gets assigned
  variants: {
    A: { weight: number; tiers: TierOverride[] }; // control
    B: { weight: number; tiers: TierOverride[] }; // treatment
  };
  startedAt: string; // ISO date
  endedAt?: string;  // ISO date (null = ongoing)
}
```

Stored as env var `PRICING_EXPERIMENT_CONFIG` (JSON string).

### 3.3 Assignment Flow

1. Company visits pricing page → GET /api/companies/:id/billing/tiers
2. Server checks company.pricing_experiment_variant
3. If null:
   a. SHA-256(company_id + salt) → deterministic variant (50/50 split)
   b. Write variant + enrolled_at to company row
4. Server returns variant-appropriate tier pricing
5. Checkout session metadata includes `pricingExperimentVariant: "A"|"B"`

### 3.4 Tracking & Reporting

- **Stripe metadata**: Each checkout session carries `pricingExperimentVariant`
- **Stripe subscription metadata**: Carries variant from checkout
- **Internal query**: `SELECT pricing_experiment_variant, COUNT(*) FROM companies` JOIN with subscription status
- **API endpoint**: GET /api/companies/:id/billing/experiment-results (board-only)

---

## 4. Implementation Status

### Phase 1: Data Model & Migration ✅ COMPLETE
- Migration `0230_pricing_experiment_columns.sql` — idempotent ADD COLUMN IF NOT EXISTS
- Drizzle schema updated with `pricingExperimentVariant` and `pricingExperimentEnrolledAt`

### Phase 2: Experiment Service & Assignment ✅ COMPLETE
- `server/src/services/pricing-experiment.ts` — deterministic variant assignment, tier overrides, config parsing, results aggregation
- 14 passing unit tests

### Phase 3: API & Stripe Integration ✅ COMPLETE
- `listTiers(companyId)` applies experiment overrides when enabled
- `createCheckoutSession` includes `pricingExperimentVariant` in Stripe metadata
- `GET .../billing/experiment-variant` — returns variant for company
- `GET .../billing/experiment-results` — board-only results endpoint
- `server/src/__tests__/billing-experiment-integration.test.ts` — 14 integration tests covering variant-aware tier listing, checkout metadata, experiment variant/results endpoints, and Stripe metadata propagation
- Bug fix: `getResults` uses `isNotNull()`/`inArray()` from drizzle-orm instead of unsupported column method syntax

### Phase 4: UI Updates ✅ COMPLETE
- No UI changes needed — pricing page reads from server, variant pricing is transparent

### Phase 5: Review 🔄 PENDING (VOY-1897)
- Assigned to Staff Engineer

### Phase 6: Release 🔄 PENDING (VOY-1898)
- Blocked on code review

### Phase 7: QA 🔄 PENDING (VOY-1899)
- Blocked on release

---

## 5. Edge Cases & Failure Modes

| Scenario | Handling |
|----------|----------|
| Company already assigned (e.g., pricing page revisited) | Read existing variant, no reassignment |
| Experiment not enabled | Normal pricing, no variant column needed |
| Variant B tier overrides not configured | No overrides applied, variant B sees control pricing |
| Migration rollback | Remove columns, experiment stops. All existing assignments lost. |
| 50/50 vs other split | Configurable via `trafficPercent` |
| New company created after experiment ends | No variant assigned, normal pricing |
| Stripe checkout without variant metadata | Log warning (in Stripe dashboard), treat as variant A for reporting |
| Concurrent variant assignment | First write wins (deterministic hash = same result for same company) |

---

## 6. Test Coverage

| Test | Coverage |
|------|----------|
| Unit: deterministic assignment (same company_id → same variant) | ✅ |
| Unit: 50/50 distribution over N companies (statistical) | ✅ |
| Unit: tier override application for variant B | ✅ |
| Unit: experiment disabled → normal tiers | ✅ |
| Unit: config validation (bad JSON, missing fields) | ✅ |
| Unit: variant B weight override | ✅ |
| Unit: trafficPercent enforcement | ✅ |
| Unit: loadConfig from env var | ✅ |
