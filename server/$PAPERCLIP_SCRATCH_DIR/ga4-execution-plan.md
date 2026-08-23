# VOY-2009: GA4 Tracking — Technical Execution Plan

## Status: Final — Approving for Implementation

## Overview
Activate GA4 as the PostHog fallback analytics pipeline on voyonder.com (Paperclip Cloud).

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   voyonder.com                      │
│                                                     │
│  ┌─────────────┐   ┌───────────────────────────┐     │
│  │ Frontend    │   │ Server                    │     │
│  │ (React/Vite)│   │                          │     │
│  │             │   │  ┌─────────────────────┐  │     │
│  │ gtag.js     │───│▶│  ga4-analytics.ts   │  │     │
│  │ page_view   │   │  │  Service Layer      │  │     │
│  │ events      │   │  │                     │  │     │
│  └─────────────┘   │  │  buildSignupEvent() │  │     │
│                     │  │  buildOnboarding...│  │     │
│                     │  │  buildTrialStart() │  │     │
│                     │  │  buildApproval...()│  │     │
│                     │  └────────┬──────────┘  │     │
│                     └───────────┼──────────────┘     │
│                                 │                    │
└─────────────────────────────────┼────────────────────┘
                                  │ HTTP POST
                                  ▼
              ┌──────────────────────────────┐
              │  GA4 Measurement Protocol    │
              │  https://www.google-analytics│
              │  .com/mp/collect             │
              └──────────────────────────────┘
```

## What Exists (Already Committed)

| Component | Status | File |
|-----------|--------|------|
| GA4 Analytics Service | ✅ Committed | `server/src/services/ga4-analytics.ts` |
| Service exports | ✅ Committed | `server/src/services/index.ts` (line 197) |
| Approval event wiring | ✅ Committed | `server/src/routes/approvals.ts` |
| trackPricingEvent helper | ✅ Committed | `server/src/services/billing.ts` (line 1403) |
| Health check script | ✅ Committed | `scripts/ga4-health-check.sh` |
| Documentation | ✅ Committed | `docs/documentation/ga4-analytics.md` |

## What Needs Implementation

### 1. Wire signup event (server-side)
- Location: `server/src/services/onboarding-seed.ts` — inside `apply()`
- After the seed is successfully applied, call `ga4AnalyticsService.send(buildSignupEvent(companyId, email?))`
- Edge case: email may not be available in the seed payload — only send when present
- Edge case: the seed may be a no-op (revision already applied) — don't re-fire signup event

### 2. Wire onboarding completion event (server-side)
- Location: `server/src/services/onboarding.ts` — inside `selectRole()`
- Add `buildOnboardingCompletedEvent()` helper to `ga4-analytics.ts`
- Call it after role selection succeeds
- Edge case: onboarding skip should NOT fire this event (user didn't complete onboarding)

### 3. Wire trial start event (server-side)
- Location: `server/src/services/billing.ts` — inside `handleSubscriptionUpdated()`
- Add `buildTrialStartEvent()` helper to `ga4-analytics.ts`
- Fire when a subscription is created with `trial_end > now` and was previously in `incomplete` or is newly created
- Edge case: only fire on first trial creation, not on subsequent webhook replays (use idempotency via dedup)

### 4. Add frontend GA4 tracking (client-side)
- Add gtag.js snippet to the UI HTML template
- Wire measurement ID from `VITE_GA4_MEASUREMENT_ID` env var (Vite convention)
- Include page_view automatic tracking via gtag config
- No additional frontend event wiring in this issue scope

### 5. Environment variable documentation
- Ensure `.env.example` has the four GA4 vars documented
- Verify server config loading works for all four vars

## Data Flow & Events

| Event | Trigger | Payload | Route/Service |
|-------|---------|---------|---------------|
| `signup` | User creates account + seed applied | `{method, email_domain}` | `onboardingSeedService.apply()` |
| `onboarding_completed` | User completes role selection | `{role, company_id}` | `onboardingService.selectRole()` |
| `trial_started` | Subscription created with trial | `{tier_id, billing_period, company_id}` | `billingService.handleSubscriptionUpdated()` |
| `approval` | Approval approved | `{approval_id, approval_type, company_id}` | `routes/approvals.ts` ✅ |
| `approval_rejected` | Approval rejected | `{approval_id, approval_type, company_id}` | `routes/approvals.ts` ✅ |
| `page_view` | Any page navigation | Automatic (gtag.js) | Frontend ✅ (this plan) |

## Test Coverage

| Test | What It Covers |
|------|---------------|
| GA4 service unit tests | `createGa4AnalyticsService`, `event()`, `send()` - **needs creation** |
| Signup event wiring | Verify `buildSignupEvent` called in seed apply path |
| Onboarding completion event | Verify `onboarding_completed` fires on role selection |
| Trial start event | Verify `trial_started` fires on subscription with trial |

## Implementation Order
1. Add event helpers to `ga4-analytics.ts` (onboarding_completed, trial_started)
2. Wire signup → onboarding-seed.ts
3. Wire onboarding_completed → onboarding.ts
4. Wire trial_started → billing.ts
5. Add gtag.js to frontend HTML
6. Update documentation

## Child Issues

| ID | Title | Assignee | Depends On |
|----|-------|----------|------------|
| VOY-2010 | Wire server-side GA4 events (signup, onboarding, trial) | Founding Engineer | - |
| VOY-2011 | Add frontend GA4 gtag.js tracking | Founding Engineer | - |
| VOY-2012 | Review VOY-2010 GA4 event wiring | Staff Engineer | VOY-2010 |
| VOY-2013 | Review VOY-2011 frontend GA4 tracking | Staff Engineer | VOY-2011 |
| VOY-2014 | Release GA4 tracking | Release Engineer | VOY-2012, VOY-2013 |
| VOY-2015 | QA verify GA4 tracking | QA Engineer | VOY-2014 |