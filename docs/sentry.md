# Sentry Error Tracking (M10)

This document covers the Sentry integration for Papclip's error tracking, part of the M-series maturity plan.

## Overview

Sentry provides real-time error tracking with:

- Server-side error capture (Express middleware)
- Client-side error capture (React SDK)
- Performance tracing (transactions and spans)
- Session replays (frontend only, privacy-safe)
- Source map integration for readable stack traces
- Error grouping and alerting

## Configuration

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SENTRY_DSN` | Yes (server) | Server-side Sentry DSN |
| `VITE_SENTRY_DSN` | Yes (frontend) | Frontend Sentry DSN (exposed to browser) |
| `SENTRY_ENVIRONMENT` | No | Environment label (default: `NODE_ENV` or `production`) |
| `SENTRY_RELEASE` | No | Release version (default: auto-detected) |
| `SENTRY_AUTH_TOKEN` | CI only | Sentry CLI auth token for source map upload |
| `SENTRY_ORG` | CI only | Sentry org slug for source map upload |
| `SENTRY_PROJECT` | CI only | Sentry project slug for source map upload |

### Server

The server Sentry integration lives at:

- **Initialisation:** `server/src/services/sentry.ts`
- **Middleware:** `server/src/middleware/sentry.ts`

Sentry is initialised during server startup in `index.ts` immediately after telemetry init. It only activates when `SENTRY_DSN` is set; without it all Sentry code paths are no-ops.

Three Express middleware are injected in `app.ts`:

1. **`sentryRequestHandler`** (early, after private hostname guard) — attaches request metadata to the Sentry scope.
2. **`sentryTracingHandler`** — adds performance tracing via the Express integration.
3. **`sentryErrorHandler`** (last, before the app's own `errorHandler`) — captures unhandled errors.

### Frontend

The frontend Sentry integration lives at:

- **Initialisation:** `ui/src/lib/sentry.ts`
- **Entry Point:** `ui/src/main.tsx`

Sentry is initialised during app bootstrap, before any React rendering. It only activates when `VITE_SENTRY_DSN` is set.

Features enabled:
- **Browser tracing** — automatic performance monitoring of page loads and navigation
- **Session replays** — privacy-safe replays (mask all text, block all media), recorded at 10% sample rate, 100% on error
- **Error capture** — automatic capture of unhandled exceptions and promise rejections

## Source Maps

### Frontend (Vite build)

Source maps are generated during the Vite build (`sourcemap: true` in `vite.config.ts`).

Upload to Sentry is handled by `@sentry/vite-plugin`. The plugin is configured with `dryRun: true` by default, meaning it only uploads when `SENTRY_AUTH_TOKEN` and `SENTRY_ORG` are present in the build environment.

### Server (TypeScript compilation)

Server source maps are generated during `tsc` compilation (`sourceMap: true` in `tsconfig.json`). For Sentry to resolve server stack traces, source maps must be uploaded manually or via a CI step:

```bash
# Install sentry-cli
curl -sL https://sentry.io/get-cli/ | bash

# Create a release and upload source maps
sentry-cli releases new "$SENTRY_RELEASE"
sentry-cli releases files "$SENTRY_RELEASE" upload-sourcemaps server/dist/ \
  --url-prefix "~/server" \
  --validate
sentry-cli releases set-commits "$SENTRY_RELEASE" --auto
sentry-cli releases finalize "$SENTRY_RELEASE"
```

## Error Grouping & Alerting

### Server

Error grouping is handled automatically by Sentry based on stack trace fingerprinting. Key customisations:

- **`beforeSend` hook** redacts request bodies from error events to prevent PII leakage
- **`attachStacktrace: true`** ensures stack traces are included on all captured errors
- **Sample rate:** 100% in production, 10% in development

### Alerting (Recommended Setup)

1. **In Sentry:** Navigate to **Alerts → Create Alert**
2. Choose **"Issues"** — alert when an error occurs more than N times in M minutes
3. Set thresholds appropriate for your traffic (e.g. 10 occurrences in 5 minutes for warnings, 1 occurrence for critical errors)
4. Configure notification channels:
   - Slack (#alerts channel)
   - Email (on-call engineer)
   - PagerDuty (for critical errors)

Recommended alert rules:

| Rule | Threshold | Action |
|---|---|---|
| New error (any) | 1 occurrence | Slack notification |
| Error spike | > 10 in 5 minutes | Slack + email |
| Critical error | 500 errors in production | Slack + PagerDuty |

## Dashboard

### Setup Steps

1. Navigate to **Sentry → Dashboards**
2. Create a new dashboard "Paperclip Production"
3. Add widgets:

| Widget | Description |
|---|---|
| Error Rate (p95) | Errors per minute, rolling 24h |
| Top 5 Errors | Most frequent error types |
| Affected Users | Unique users affected by errors |
| Transactions (p50/p95) | API response time percentiles |
| Crash-Free Session Rate | Percentage of sessions without errors |
| Release Health | Error rate per deployment |

### Recommended Dashboard Layout

```
┌───────────────────────────────────────────────────┐
│  Error Rate (24h)           │  Crash-Free Rate    │
├───────────────────────────┼───────────────────────│
│  Top Errors                │  Affected Users      │
├───────────────────────────┴───────────────────────│
│  Transaction Duration (p50, p95, p99)             │
├───────────────────────────────────────────────────│
│  Release Health (last 10 releases)                │
└───────────────────────────────────────────────────┘
```

## Error Response Procedures

### Severity Levels

| Level | Definition | Response Time |
|---|---|---|
| **Critical** | Service unavailable, data loss, security breach | Immediate (< 15 min) |
| **High** | Major feature broken for many users | < 1 hour |
| **Medium** | Feature partially broken, workaround exists | < 4 hours |
| **Low** | Cosmetic issue, minor annoyance | Next business day |

### Response Workflow

1. **Detect** — Sentry alert fires (Slack, email, or PagerDuty)
2. **Triage** — Open Sentry issue, assess severity:
   - Check affected users count
   - Review stack trace and context
   - Determine if it's a regression (linked to a release)
3. **Diagnose** — Use Sentry data:
   - Breadcrumbs for user actions leading to error
   - Request/response data (redacted)
   - Environment and browser info
   - Console logs and replay (frontend)
4. **Respond** — Based on severity:
   - **Critical:** Immediately investigate, consider rollback
   - **High:** Fix in current sprint
   - **Medium:** Add to backlog
   - **Low:** Log and ignore
5. **Resolve** — Deploy fix, verify in Sentry:
   - Mark issue as resolved in Sentry
   - Add a comment linking to the fix PR
   - Create a follow-up issue for root cause analysis if needed

### Post-Mortem Checklist

For critical and high-severity errors:

- [ ] Root cause identified
- [ ] Fix deployed and verified
- [ ] Sentry issue marked resolved
- [ ] Monitoring rule adjusted (if too noisy or too quiet)
- [ ] Post-mortem document created
- [ ] Follow-up issues created for preventive measures

## Maintenance

### Regular Tasks

| Frequency | Task |
|---|---|
| Daily | Review new errors in Sentry dashboard |
| Weekly | Triage unresolved issues, adjust alert thresholds |
| Per Release | Verify source maps uploaded correctly |
| Monthly | Review rate limits and quota usage |

### Rate Limits

Sentry has a monthly event quota. Monitor usage at **Settings → Usage** in the Sentry dashboard. When approaching quota:

- Reduce `tracesSampleRate` (e.g., from 0.2 to 0.1)
- Increase `sampleRate` filtering
- Add more `beforeSend` filters to drop noisy, non-actionable errors