---
title: Auth Improvements — Google OAuth + PostHog Lifecycle Events + Structural Hardening
version: voy-1447
date: 2026-08-19
commits: 96faa13434
status: Draft — code committed and reviewed, awaiting release to fork/master
---

# Auth Improvements: Google OAuth + PostHog Auth Lifecycle Events

**Branch:** `voy-1420-posthog-p2-fixes`
**Release status:** Draft — code committed on branch, reviewed by Staff Engineer and CTO. Awaiting Release Engineer to ship to fork/master.

## What Changed

### Google OAuth Sign-In

Users can now sign in or create an account using their Google account. A **"Sign in with Google"** button appears on the Auth page alongside the existing email/password form.

| Feature | Detail |
|---|---|
| Sign-in flow | Click "Sign in with Google" → redirected to Google OAuth consent → back to Voyonder with an active session |
| Sign-up flow | First-time Google users get an account created automatically |
| Configuration | Requires `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` environment variables |
| Graceful fallback | If env vars are not set, the Google button is hidden and only email/password is shown |
| Email verification | Disabled for Google accounts (configurable) |
| Account linking | Not yet implemented — a Google sign-in with an email that already has an email/password account creates a separate account |

### PostHog Auth Lifecycle Events

Two new business events are now captured in PostHog to track authentication activity:

| Event | When it fires | User-identifying property |
|---|---|---|
| `auth.signup_completed` | A new user account is created (email or Google) | `login_method` — `"google"`, `"email"`, or `"unknown"` |
| `auth.session_started` | A new session is created (login via email or Google) | `login_method` — `"google"`, `"email"`, or `"unknown"` |

Unlike other business events, auth events use the **user's ID** as the PostHog distinct ID (not the company ID), because auth events fire before a company context exists.

### Auth Hook Structural Hardening (96faa13434)

Two improvements from the Staff Engineer's structural audit of the auth code:

1. **Robust login method detection** — URL parsing in `resolveLoginMethod()` now uses the `URL()` constructor instead of manual string splitting. This correctly handles absolute URLs (e.g., behind a proxy) and returns `"unknown"` instead of potentially misclassifying the method on malformed URLs.

2. **Fire-and-forget telemetry** — PostHog `captureMetric()` calls in auth lifecycle hooks are synchronous and no longer awaited. The hooks remain `async` for better-auth type compliance, but PostHog availability can never delay or block an auth response. If PostHog is unreachable, the auth flow completes normally and the event is silently dropped.

## Configuration

### New Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | No | Google OAuth app client ID. Omitted if not set. |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth app client secret. Must be set alongside `GOOGLE_CLIENT_ID`. |

### PostHog

No new configuration. Existing `POSTHOG_API_KEY` and `POSTHOG_HOST` settings are reused. Auth events flow through the same PostHog pipeline as approval and notification events.

## Support Impact

### For Support Staff

| Change | What to know |
|---|---|
| Google OAuth available | Users can sign in with Google. If they report the button is missing, check `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are set. |
| No account linking | A user who signs up via email and later tries Google OAuth will create a separate account. This can cause confusion. Escalate to CTO for account merging. |
| Auth events in PostHog | `auth.signup_completed` and `auth.session_started` are visible in PostHog. Query by event name and filter by `login_method` to separate Google vs email traffic. |
| PostHog downtime doesn't break auth | Auth operations complete regardless of PostHog availability. Telemetry gaps are silent — if auth events are missing, check PostHog health, not auth code. |
| Login method detection | If `login_method` is consistently `"unknown"` for valid sign-ins, check the server's reverse proxy configuration — `resolveLoginMethod` uses `ctx.request.url` which may be affected by URL rewriting. |

## Related Documentation

- [Google OAuth Support Case Assessment](../assessments/support-case-google-oauth.md) — Full support case details, troubleshooting, escalation paths
- [PostHog Monitoring Triage SOP](../posthog-error-monitoring-triage-sop.md) — v1.4.5, reflects fire-and-forget auth hooks + all auth events
- [PostHog Business Events + P2 Fixes Release Note](voy-1420-posthog-business-events.md) — Prior release that established the PostHog telemetry pipeline
