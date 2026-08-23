# M10 — Sentry Error Tracking

**Release status:** Branch `feat/clean-m5-pricing-pr` (uncommitted working tree alongside M5 pricing experiment)
**Commits:** `ae50cb239a` (lockfile), `492e0948d7` (Sentry service)
**Working tree:** `error-handler.ts` (server-side Sentry reporting), `AppErrorBoundary.tsx` (client-side crash reporting), `main.tsx` (Sentry init), `vite.config.ts` (source map upload)
**Related issues:** VOY-1826 (M10), VOY-1938 (Sentry error tracking service)

Paperclip now includes Sentry error tracking for both the server and the UI. The service is fully optional — it only activates when a valid Sentry DSN is configured, and failures in Sentry reporting never crash the application.

## What's New

### Server-side Sentry integration

The server can now capture unhandled errors and report them to Sentry with rich context:

- **Automatic error capture** — `initSentry()` initializes the Sentry Node SDK early in server startup
- **Express error handler** — `setupExpressSentry()` registers Sentry's Express error handler middleware so uncaught route errors flow to Sentry
- **Manual coverage in error handler** — The existing catch-all `errorHandler` middleware calls `reportToSentry()` for every unhandled error, with structured scope data:
  - HTTP method, URL, query params, route params
  - Authenticated actor info (user/agent ID, actor type, company ID, run ID)
  - Error name/code and any error details
- **Graceful shutdown** — `closeSentry()` flushes pending events before the server exits (2-second timeout)
- **Build-aware releases** — The release string is resolved from build stamp, git commit SHA, or environment variable (in priority order)
- **Fails open** — If Sentry initialization fails, the server logs a warning and continues without it. If Sentry reporting errors at runtime, the error is silently caught and the application continues.

### Client-side (UI) Sentry integration

The frontend captures browser-side errors with full session context:

- **Sentry React SDK initialized in `main.tsx`** — Reads `VITE_SENTRY_DSN` (or `SENTRY_DSN`) from environment; initializes only when a DSN is present
- **Browser tracing** — `browserTracingIntegration()` captures page load performance and navigation spans
- **Session replays** — `replayIntegration()` captures user sessions for debugging (with `maskAllText` and `blockAllMedia` for privacy). Replays are sampled separately from errors:
  - Session replays: 1% of sessions in production (0% in dev)
  - Error replays: 10% of sessions with errors in production (0% in dev)
- **AppErrorBoundary reporting** — When the React app shell crashes (uncaught render error), the boundary reports the error to Sentry with the component stack trace, tagged as `error_source: "app_shell"`
- **Trace sampling** — Performance traces: 25% in production (0% in dev); profiles: 10% in production (0% in dev)

### Source map upload (build-time)

The Vite build includes the `@sentry/vite-plugin` for production builds:

- **Automatic upload** — When `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` are set, source maps are uploaded to Sentry during the production build
- **Asset isolation** — Only source maps under `dist/assets/**` are uploaded
- **No telemetry** — The Sentry plugin's own telemetry is disabled
- **Source maps generated in production** — `build.sourcemap` is set to `true` only for production builds, enabling Sentry to de-obfuscate stack traces

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SENTRY_DSN` / `PAPERCLIP_SENTRY_DSN` | No (opt-in) | `""` | Sentry Data Source Name. Must be set for Sentry to activate. Server reads either variable. |
| `VITE_SENTRY_DSN` | No (opt-in) | `""` | Client-side Sentry DSN. Can also fall back to `SENTRY_DSN` at build time. |
| `SENTRY_ORG` | No (build-time) | — | Sentry organization slug for source map uploads |
| `SENTRY_PROJECT` | No (build-time) | — | Sentry project slug for source map uploads |
| `SENTRY_AUTH_TOKEN` | No (build-time) | — | Sentry auth token for source map uploads |
| `SENTRY_RELEASE` | No | auto-resolved | Override the release string (otherwise resolved from build stamp > git commit > `OTEL_SERVICE_VERSION`) |
| `NODE_ENV` | No | `development` | Controls sampling rates (traces 25%/0%, profiles 10%/0%) |

### Sampling Rates

| Data Type | Production | Development |
|---|---|---|
| Performance traces | 25% | 0% |
| Profiles | 10% | 0% |
| Session replays | 1% of sessions | 0% |
| Error replays | 10% of error sessions | 0% |

## What Changed

| Aspect | Before | After |
|---|---|---|
| Error visibility | Server logs only, PostHog error events (if PostHog configured) | All errors captured in Sentry dashboard with structured context + stack traces |
| Frontend errors | Silent failures (AppErrorBoundary showed reload button only) | AppErrorBoundary reports crash to Sentry with component stack |
| Source maps | Not generated in production | Generated and optionally uploaded to Sentry for de-obfuscated stack traces |
| Session replay | None | 1% of sessions captured for debugging (privacy-masked) |
| Performance traces | None | 25% of production requests instrumented |
| Configuration | Sentry DSN not recognized | Multiple env vars for server, client, and source map upload |
| Error context | Generic error handler response | Sentry captures HTTP context, actor identity, and error metadata |

## Impact

- **No configuration required** — Sentry is fully opt-in and fails gracefully when not configured
- **Privacy-conscious** — Session replays mask all text and block all media by default; sampling is conservative
- **Zero overhead when disabled** — No Sentry dependencies are loaded or initialized if no DSN is set
- **Reduced troubleshooting time** — Support and engineering can see full error context, stack traces, and session replays for any captured error
- **Build-time dependency** — Production builds require `@sentry/vite-plugin`; dev builds skip it entirely

---

*Paperclip Platform — M10 Error Tracking (branch: feat/clean-m5-pricing-pr)*