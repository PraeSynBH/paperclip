# Founding Engineer Status — 2026-08-24 ~16:30 UTC

## Completed This Session

### VOY-2117 — CRITICAL: Trial-to-paid conversion fails (ON CONFLICT bug)
- **Status:** Fix already committed in `3885b6b5f0` (by prior agent run)
- **Change:** ON CONFLICT target changed from `stripe_subscription_id` to `company_id` in both `handleCheckoutSessionCompleted` and `handleSubscriptionUpdated`
- **Why:** Trial rows have `stripe_subscription_id = NULL`; SQL NULL comparison semantics meant `NULL = 'sub_abc'` never matched, causing duplicate-row attempts
- API update not possible (Paperclip 500 error) — needs manual status change to `done`

### VOY-2119 — HIGH: startTrial empty catch block masks real Stripe/DB errors
- **Files:** `server/src/services/billing.ts:1390-1413`
- **Fix:** Changed bare `catch {` to `catch (err)` with `logger.warn()` including err and companyId
- Previously all errors from `getOrCreateStripeCustomer` were silently swallowed

### VOY-2118 — HIGH: Trial reaper concurrency guard missing + dynamic import on every tick
- **Files:** `server/src/index.ts:1580-1620`
- **Fix 1:** Cached the billing service import result so `import("./services/billing.js")` runs only once instead of every 30 minutes
- **Fix 2:** Added `trialReaperRunning` boolean guard — skips a tick if previous run is still in-flight
- Both the `setInterval` tick and the startup sweep now call a shared `runTrialReaper()` function

## Current Blockers

- **GitHub Actions billing** (VOY-2088) — blocks M6 production deploy; needs human with GitHub admin access
- **Paperclip API 500 errors** — cannot update issue statuses or add comments from this session

## Next Available Work (Assigned to Me in Backlog)

| Issue | Title | Priority |
|-------|-------|----------|
| VOY-2023 | GA4 Phase 3: Wire server-side signup events to GA4 | High |
| VOY-2022 | GA4 Phase 2: Front-end gtag.js page view tracking | High |
| VOY-1794 | M2: Define user event taxonomy and identification scheme | High |
| VOY-1783 | M8: Implement email notification system | High |
| VOY-1780 | M3: Instrument signup → first-value funnel | High |
