# GA4 Analytics Service — PostHog Fallback

**Service**: Google Analytics 4 Measurement Protocol integration
**Committed**: `f95b738967` (2026-08-23)
**Related**: VOY-1941 (GA Fallback Planning), VOY-1966 through VOY-1969 (GA4 wiring child issues)
**Status**: Code committed — service available but requires configuration to activate
**Updated**: 2026-08-23 ~17:50 UTC — issue references refreshed to match CEO pulse (VOY-1966→1969)

## Overview

The GA4 Analytics Service is a server-side Google Analytics 4 Measurement Protocol integration that sends business events directly to GA4. It was created as a fallback analytics channel for the PostHog contingency (VOY-1941) — if PostHog credentials are unavailable or PostHog is decommissioned, GA4 provides a drop-in replacement for product analytics.

## How It Works

The service sends HTTP POST requests to the GA4 Measurement Protocol API (`https://www.google-analytics.com/mp/collect`). Events are fire-and-forget with a 5-second timeout — failures are logged but never throw.

### Architecture

- **Singleton pattern** — `getGa4AnalyticsService()` returns a shared service instance. Call from anywhere in the server.
- **Config-driven** — Behavior is controlled by environment variables. No configuration means no events sent.
- **Fault-tolerant** — Network errors, timeouts, and non-2xx responses are logged at `warn` level and silently dropped.

### Event Types

The service includes built-in helpers for standard events:

| Event | Helper | Parameters |
|---|---|---|
| `signup` | `buildSignupEvent(userId, email?)` | `method`, `email_domain` (if email provided) |
| `approval` | `buildApprovalEvent(approvalId, approvalType, companyId)` | `approval_id`, `approval_type`, `company_id` |
| `approval_rejected` | `buildApprovalRejectedEvent(approvalId, approvalType, companyId)` | `approval_id`, `approval_type`, `company_id` |
| `begin_checkout` | Inline in billing service | `company_id`, `tier_id`, `billing_period`, `value`, `currency` |

Arbitrary events can also be sent via the `event(name, params, clientId?, userId?)` method.

## Configuration

| Environment Variable | Required | Default | Description |
|---|---|---|---|
| `GA4_MEASUREMENT_ID` | Yes (when enabled) | `""` | GA4 measurement ID (e.g., `G-XXXXXXXXXX`) |
| `GA4_API_SECRET` | Yes (when enabled) | `""` | GA4 Measurement Protocol API secret (create in GA4 Admin > Data Streams > Measurement Protocol API secrets) |
| `GA4_ENABLED` | No | `false` | Set to `"true"` to activate GA4 event sending |
| `GA4_DEBUG` | No | `false` | Set to `"true"` to use the GA4 debug endpoint for validation |

### Debug mode

When `GA4_DEBUG=true`, events are sent to `https://www.google-analytics.com/debug/mp/collect` instead of the production endpoint. The debug endpoint returns validation errors in the response body, which are logged at `warn` level.

## Current Integration Status

| Component | Status | Notes |
|---|---|---|
| GA4 Analytics Service | **Committed** | `server/src/services/ga4-analytics.ts` — fully implemented |
| Service export from index.ts | **Committed** | `server/src/services/index.ts` line 196 — `getGa4AnalyticsService`, `buildApprovalEvent`, `buildApprovalRejectedEvent` exported |
| Checkout event tracking | **Committed** | `server/src/services/billing.ts` — `trackPricingEvent` helper available for route handlers |
| .env.example configuration | **Committed** | Four GA4 env vars documented (GA4_MEASUREMENT_ID, GA4_API_SECRET, GA4_ENABLED, GA4_DEBUG) |
| Approval event wiring | **In development** | VOY-1967 — CTO wiring approval events |
| Signup event wiring | **In development** | CTO to wire signup events (tracked under VOY-1941) |
| Monitoring/health check | **In development** | VOY-1969 — CTO creating monitoring script |

## What It Replaces (PostHog Comparison)

| Capability | PostHog | GA4 (this service) |
|---|---|---|
| Product analytics (funnels, trends) | ✓ | ✓ (via GA4 web interface) |
| Session recording | ✓ | ✗ (needs HotJar) |
| Feature flags | ✓ | ✗ (build in-app) |
| Heatmaps | ✓ | ✗ (needs HotJar) |
| Self-hosted data | ✓ | ✗ (Google-hosted) |
| Real-time dashboards | Instant | 24-48 hour delay |
| User-level analytics | Full | Limited/sampled for free tier |
| Server-side events | ✓ | ✓ (via Measurement Protocol) |

## Troubleshooting

### Events not appearing in GA4
1. Verify all three env vars are set: `GA4_ENABLED=true`, `GA4_MEASUREMENT_ID`, `GA4_API_SECRET`
2. Check server logs for `GA4 request failed` or `GA4 responded with` warnings
3. Enable `GA4_DEBUG=true` and re-deploy — the debug endpoint provides validation errors
4. Note: GA4 real-time reports have a 24-48 hour delay for the standard Measurement Protocol
5. Use GA4's debug view (in GA4 Admin) to see events arriving in real-time during debug mode

### GA4 request timing out
1. Check server egress to `www.google-analytics.com` (port 443)
2. The timeout is 5 seconds — a slow network connection may cause timeouts
3. Failures are non-blocking — the application continues without errors

## Escalation Path

| Issue | First Response | Escalation |
|---|---|---|
| GA4 events not delivering | Support Engineer verifies env vars and server logs | CTO — connectivity / GA4 property access |
| GA4 event schema questions | Support Engineer checks event payloads in debug mode | CTO — event structure / ga4-analytics.ts review |
| Need to add new event type | Support Engineer documents the requirement | CTO — implement in ga4-analytics.ts + wire into service |

## Related Issues

- **VOY-1941**: GA Fallback Planning (PostHog Contingency) — parent issue
- **VOY-1966**: Export ga4-analytics from server/src/services/index.ts — **Done** (committed in `80086c5937`)
- **VOY-1967**: Wire approval events in server/src/routes/approvals.ts — pending
- **VOY-1968**: Add configuration variables to .env.example — **Done** (four GA4 vars present)
- **VOY-1969**: Create monitoring/health-check script — pending