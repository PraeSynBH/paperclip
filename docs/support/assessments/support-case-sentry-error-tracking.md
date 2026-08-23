# Support Case Assessment: M10 Sentry Error Tracking

**Feature:** Sentry error tracking for server-side and client-side error capture
**Assessed by:** Support Engineer
**Date:** 2026-08-23
**Related:** VOY-1826 (M10), VOY-1938 (Sentry error tracking service)
**Branch:** `feat/clean-m5-pricing-pr`
**Committed at:** `492e0948d7` (server service) + working tree (error handler + frontend wiring)

## Feature Overview (User Perspective)

Paperclip now includes Sentry error tracking for error monitoring and debugging. The feature is fully opt-in — it only activates when a valid Sentry DSN is configured via environment variables, and failures in Sentry reporting never crash the application.

**What this means for users:**

- **No visible change** — Users see the same application behavior with or without Sentry
- **Support benefits** — When Sentry is configured, support and engineering teams get structured error reports with full context (HTTP request details, authenticated actor, error stack traces)
- **Frontend crash visibility** — If the UI crashes, the error is captured with a component stack trace. Previously these crashes were only visible to the affected user; now they're surfaced in Sentry
- **Session replays** — When enabled, support can see a privacy-masked replay of the user's session leading up to an error (1% of sessions sampled, privacy-masked by default)

## What Changed

### 1. Server Sentry Service (`server/src/sentry.ts`)

A new 145-line module providing:

- **`initSentry()`** — Initializes the Sentry Node SDK. Reads `SENTRY_DSN` or `PAPERCLIP_SENTRY_DSN`. Resolves release string from build stamp > git commit > `OTEL_SERVICE_VERSION`. Only initializes once; subsequent calls are no-ops. Logs a warning on failure and continues.
- **`setupExpressSentry(app)`** — Registers Sentry's Express error handler middleware. Call after body parsers but before routes.
- **`isSentryEnabled()`** — Returns true if Sentry was successfully initialized.
- **`closeSentry()`** — Flushes pending events with a 2-second timeout. Call during graceful shutdown.

### 2. Error Handler Integration (`server/src/middleware/error-handler.ts`)

The catch-all error handler now calls `reportToSentry()` for every unhandled error:

- Sets scope extras: `method`, `url`, `query`, `params`
- Sets user context from `req.actor`: agent/user ID, actor type, company ID, run ID
- Tags: `actor_type`, `company_id`, `run_id`, `error_code`
- Captures error details (if present) as extras
- Fully wrapped in try/catch — Sentry reporting never breaks the app

### 3. Frontend Sentry Initialization (`ui/src/main.tsx`)

Initializes the Sentry React SDK early in the client bootstrap:

- Reads `VITE_SENTRY_DSN` (or falls back to `SENTRY_DSN`)
- Environment: uses Vite's `MODE` (production/development)
- Release: from `VITE_SENTRY_RELEASE` if set
- Integrations: browser tracing + session replays (privacy-masked)

### 4. AppErrorBoundary (`ui/src/components/AppErrorBoundary.tsx`)

The app shell crash boundary now reports to Sentry:

- Captures the error with Sentry scope tagged as `error_source: "app_shell"`
- Includes component stack as extra context
- Best-effort: Sentry failure is silently caught

### 5. Vite Configuration (`ui/vite.config.ts`)

Production builds include the Sentry source map upload plugin:

- Uploads source maps for `dist/assets/**` when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` are set
- Source maps are generated only for production builds (`build.sourcemap: true`)
- Plugin telemetry is disabled

## Known Limitations

1. **Opt-in only** — Sentry is completely inactive unless a DSN is configured. Zero Sentry code runs if not configured.
2. **No historical data** — Sentry is new; there is no error history before it was enabled.
3. **Sampled traces** — Only 25% of production requests are traced for performance. Errors are always captured.
4. **Session replays are sampled** — Only 1% of sessions have replays captured. This is intentional to reduce overhead and privacy risk.
5. **Privacy masking** — All text is masked and all media is blocked in session replays. This may limit debugging of text-heavy workflows.
6. **No error grouping customization** — Sentry's default grouping is used. Similar errors may be grouped differently than expected.
7. **Resolved release detection** — If git is unavailable at runtime (Docker builds without `.git`), the release string falls back to build stamp or `OTEL_SERVICE_VERSION`. If none are set, it defaults to `"unknown"`.
8. **No alerting configured** — Sentry creates issues by default, but no escalation integrations (Slack, PagerDuty, email) are configured out of the box.

## Troubleshooting

### Sentry issues not appearing in dashboard

1. Check that `SENTRY_DSN` (or `PAPERCLIP_SENTRY_DSN`) is set to a valid Sentry Data Source Name
2. Verify the Sentry project exists and accepts events from that DSN
3. Check server startup logs for `[paperclip] Sentry initialized (server)` — if missing, the DSN was not set or initialization failed
4. Check server startup logs for `[paperclip] Failed to initialize Sentry` — indicates an initialization error
5. Verify server restart after setting the DSN

### Source maps not appearing in Sentry

1. Verify `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` are set during the production build
2. Verify the Sentry auth token has `project:write` scope
3. Check the production build output for Sentry plugin output
4. Source maps are only uploaded in production builds (`--mode production`), not in development

### Session replays not visible

1. Session replays are sampled at 1% — a specific user's session may not have been captured
2. Verify the environment is set to production (replays are 0% in development)
3. Check that `VITE_SENTRY_DSN` matches the Sentry project
4. Note: replays require the Sentry React SDK's `replayIntegration()` to be initialized, which requires `VITE_SENTRY_DSN` to be set

### "Unknown" release string in Sentry

1. The release is resolved from: build stamp > git rev-parse > `OTEL_SERVICE_VERSION` > `"unknown"`
2. In Docker builds, `.git` may not be present — set `OTEL_SERVICE_VERSION` or `SENTRY_RELEASE` as an environment variable during the build
3. Alternatively, ensure the build stamp file (`build-info.json`) is generated and contains a `commit` field

## Configuration Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `SENTRY_DSN` | No (opt-in) | `""` | Sentry DSN for server-side error tracking |
| `PAPERCLIP_SENTRY_DSN` | No (opt-in) | `""` | Alternative server-side Sentry DSN (fallback). Either this or `SENTRY_DSN` must be set. |
| `VITE_SENTRY_DSN` | No (opt-in) | `""` | Client-side Sentry DSN. Also falls back to `SENTRY_DSN`. |
| `SENTRY_ORG` | No (build-time) | — | Sentry org slug for source map upload |
| `SENTRY_PROJECT` | No (build-time) | — | Sentry project slug for source map upload |
| `SENTRY_AUTH_TOKEN` | No (build-time) | — | Sentry auth token for source map upload |
| `SENTRY_RELEASE` | No | auto-resolved | Override the release string |
| `VITE_SENTRY_RELEASE` | No | auto-resolved | Client-side release override |

## Escalation Path

| Issue | First Response | Escalation |
|---|---|---|
| Sentry not receiving events | Support Engineer verifies DSN config and server startup logs | CTO — Sentry DSN / network connectivity |
| Source maps not uploading | Support Engineer verifies build-time env vars (auth token, org, project) | Release Engineer — verify production build environment |
| Errors appearing in Sentry that need investigation | Support Engineer triages error, checks scope context | CTO — root cause analysis and fix |
| Session replays not working | Support Engineer confirms client-side DSN and production environment | CTO — replay integration / sampling config |
| Privacy concern about replays | Support Engineer confirms `maskAllText` and `blockAllMedia` defaults | COO — privacy policy / opt-out decisions |
| Release string shows "unknown" | Support Engineer checks build stamp and CI config | Release Engineer — set `OTEL_SERVICE_VERSION` or `SENTRY_RELEASE` |

## Monitoring Checklist

- [ ] Server startup logs show `[paperclip] Sentry initialized (server)` after setting DSN
- [ ] Server startup logs show `[paperclip] Sentry Express handlers registered`
- [ ] Test error appears in Sentry dashboard: trigger an unhandled 500 error
- [ ] Frontend test: cause an AppErrorBoundary crash and verify it appears in Sentry with `error_source: "app_shell"`
- [ ] Source maps verified: production stack traces are de-obfuscated in Sentry
- [ ] Release string is descriptive (not `"unknown"`)
- [ ] Session replay appears in an error event (when replay sampling includes the session)

## Rollback

To disable Sentry entirely:

**Server:**
1. Remove `SENTRY_DSN` and `PAPERCLIP_SENTRY_DSN` environment variables
2. Re-deploy the server
3. Server startup logs will show no Sentry initialization messages

**Client:**
1. Remove `VITE_SENTRY_DSN` environment variable
2. Re-build and re-deploy the frontend
3. The `main.tsx` Sentry initialization is gated on the DSN being non-empty; without it, no Sentry code runs

**Build (source maps):**
1. Remove `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` environment variables from the build environment
2. The Sentry Vite plugin becomes a no-op without these variables

## Related Documentation

- [M10 Release Notes](../documentation/releases/m10-sentry-error-tracking.md)
- [Error Handling Documentation (server)](../../server/src/middleware/error-handler.ts)
- [Sentry Service Source (server)](../../server/src/sentry.ts) — `initSentry`, `setupExpressSentry`, `isSentryEnabled`, `closeSentry`
- [AppErrorBoundary Source (ui)](../../ui/src/components/AppErrorBoundary.tsx)
- [Sentry Vite Plugin Config (ui)](../../ui/vite.config.ts) — source map upload settings