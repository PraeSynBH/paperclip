---
title: Support Case Assessment — M6 Self-Serve Trial & Onboarding
version: m6-v1.5
applies_to: M6 release (self-serve trial signup, onboarding, PostHog analytics)
status: Published — Live in production (deployed 2026-08-25 ~01:15 UTC)
maintained_by: Support Engineer (88b72065)
---

# Support Case Assessment: M6 Self-Serve Trial & Onboarding

## Feature Summary

M6 adds self-serve trial signup, onboarding, and analytics tracking to Voyonder. Users can sign up directly at voyonder.com via email + magic link or Google OAuth — each creates a company with a 7-day Stripe trial subscription (no credit card required). A guided onboarding wizard helps users select their role and deploy asset packs. PostHog tracks the full signup-to-conversion funnel. The release extends the M1/M2 async job pattern to research and export routes in the Voyonder codebase.

**Auth system migration (VOY-2171):** Research and export routes were partially migrated from Paperclip auth to Voyonder JWT auth. Structural issues found during review (VOY-2198) — broken companyId authorization boundary and missing JWT expiration — were fixed in commit `535f75fa15` (VOY-2200) and approved by Staff Engineer. Cross-system secret fallback and SSE listener leak fixes landed in commit `6dff29f449` (VOY-2201). CTO sign-off received (commit `4134b0038e`). The migration has been **merged to voyonder master** (commit `c1a89b2`) and CI/CD pipeline triggered for production deployment (VOY-2197). **Not yet confirmed live in production** — deployment in progress.

### Key Components

| Component | Location | Description |
|-----------|----------|-------------|
| Signup service | `server/src/services/signup.ts` | Email, Google OAuth, and magic link signup flows |
| Onboarding service | `server/src/services/onboarding.ts` | Post-signup wizard (status, role selection, skip) |
| Billing service | `server/src/services/billing.ts` | Stripe webhook handlers, subscription management, trial lifecycle |
| PostHog client | `server/src/lib/posthog.ts` | Analytics client with signup/billing event tracking |
| Onboarding routes | `server/src/routes/onboarding.ts` | GET /status, POST /role, POST /skip |
| Research routes | `server/src/routes/research.ts` | Background job conversion for activity search |
| Export routes | `server/src/routes/exports.ts` | CSV/ICS export with background job pattern |

## API Endpoints

### Onboarding

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/onboarding/status` | JWT (any authenticated user) | Returns onboardingStatus, onboardingSelectedRole, onboardingCompletedAt |
| POST | `/api/onboarding/role` | JWT (any authenticated user) | Sets user role and triggers asset pack deployment |
| POST | `/api/onboarding/skip` | JWT (any authenticated user) | Skips onboarding wizard |

### Billing

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/billing/subscription` | JWT (board user) | Returns subscription + trial/grace period status |
| GET | `/api/billing/trial-info` | JWT (any authenticated user) | Trial status with days remaining |
| POST | `/api/billing/cancel` | JWT (board user) | Cancels subscription at period end |
| POST | `/api/billing/reactivate` | JWT (board user) | Reinstates canceled subscription |
| POST | `/api/billing/webhook` | Stripe signature | Stripe webhook receiver (no JWT auth — uses Stripe signature) |

### Research & Exports

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/companies/:companyId/research/activities` | JWT + company scope | Queues an activity search as background job (HTTP 202) |
| POST | `/api/companies/:companyId/exports/csv` | JWT + company scope | Queues CSV export as background job (HTTP 202) |
| POST | `/api/companies/:companyId/exports/ics` | JWT + company scope | Queues iCalendar export as background job (HTTP 202) |

## Known Limitations

### Signup

1. **Email verification is sent but not enforced** — Users can use the product immediately without verifying their email. Verification is advisory only. If this becomes a spam vector, email verification will need to be made blocking.
2. **Magic link tokens are single-use** — If a user requests multiple magic links, only the most recent token is valid. This is intentional security behavior.
3. **No rate limiting on signup endpoints** — Currently rely on Stripe's fraud detection. A future release should add application-level rate limiting.

### Onboarding

4. **Role selection is a stub** — The current implementation stores the selected role and triggers asset pack deployment, but the asset packs themselves are not yet implemented. The onboarding wizard marks as complete immediately after role selection.
5. **No onboarding rollback** — Once onboarding is skipped or completed, there is no way to re-trigger it. Users land on the default dashboard.
6. **Role list is hardcoded** — Available roles (founder, operator, team_member) are defined in code, not configurable. A future release may make roles dynamic.

### Trial & Billing

7. **Trial reaper runs on schedule** — `expireTrials()` is a scheduled job. If the scheduler is down, trials will not expire until it restarts. This means some companies may have extended trial access during scheduler downtime.
8. **Grace period is fixed at 7 days** — Not configurable per-company. All companies get the same 7-day grace period after trial expiry.
9. **Subscription management endpoints are board-only** — Regular users cannot view or manage their subscription through the API. This is intentional — subscription management goes through Stripe Customer Portal or board-user UI.
10. **No dunning email support** — Payment failures log to PostHog but do not trigger dunning emails. Users may not know their payment failed until they see a restriction.

### Webhooks

11. **Webhook secret rotation requires restart** — `STRIPE_WEBHOOK_SECRET` is read at startup. Rotation requires updating the env var and restarting the server.
12. **Idempotency table is unbounded** — The `voyonder_stripe_webhook_events` table grows with each webhook event. A future release should add a TTL or archival strategy for old event IDs.

### PostHog Analytics

13. **Signup events before user identification** — Some signup events (`signup_started`, `signup_failed`) fire before the user is created, using their email as the distinct ID. After user creation, the distinct ID switches to the user ID. This creates a discontinuity in funnel analysis — events before and after user creation are under different distinct IDs.
14. **No event batching** — Each PostHog event is sent individually. Under high signup volume, this could increase latency. Batch event submission is not yet implemented.

### Async Job Pattern

15. **Export payload size is capped at 512 KB** — Payloads exceeding this limit are rejected with HTTP 413. This matches the M2 behavior.
16. **No export progress tracking** — Unlike research jobs, export jobs do not expose progress updates. The client polls for completion.

### Auth Routing Mismatches (VOY-2192 / M6.1)

17. **Google OAuth routing mismatch (CRITICAL)** — Frontend calls `GET /api/auth/google` and `GET /api/auth/google/callback`. The Voyonder API has `POST /api/auth/signup/google` (different path AND method). Result: Google signup returns 404. Tracked in VOY-2192.
18. **Magic link send routing mismatch (CRITICAL)** — Frontend calls `POST /api/auth/magic-link/send`. The Voyonder API has `POST /api/auth/signup/magic-link` (different path). Result: magic link signup returns 404. Tracked in VOY-2192.
19. **Magic link verify routing mismatch (CRITICAL)** — Frontend calls `POST /api/auth/magic-link/verify` with `{token}` body expecting JSON response. The Voyonder API has `GET /api/auth/magic-link/verify?token=` which returns a 302 redirect (and currently throws 500). Result: cannot complete magic link signup. Tracked in VOY-2192.
20. **GET /api/auth/magic-link/verify returns 500 (HIGH)** — Even the correct Voyonder API endpoint for magic link verification crashes due to missing env var or DB issue. Tracked in VOY-2192.
21. **General /api/auth/* routing conflict (HIGH)** — Traefik routes ALL `/api/auth/*` paths to the Voyonder API, intercepting Next.js API routes at travel_app. The Voyonder API does not handle all auth routes the frontend expects. Tracked in VOY-2192.

### Billing Defects (VOY-2217 / VOY-2218 — Fixes Complete, Awaiting Deploy)

22. **Checkout POST body parsing fails (HIGH)** — Billing checkout/start-trial POST requests are not parsed correctly, breaking new checkout attempts. VOY-2217 (M6.2a): **FIXED in code** — awaiting QA re-verify and production deploy.
23. **Billing portal link returns 500 (HIGH)** — `POST /api/billing/portal` / portal-link access returns a 500 error, so users cannot reach Stripe Customer Portal from the app. VOY-2218 (M6.2b): **FIXED in code** — awaiting QA re-verify and production deploy.

**Impact:** New signups cannot complete checkout, and existing users cannot open the billing portal. Existing active Stripe subscriptions and trial state are unaffected. No user-side workaround — escalate to Engineering; fixes are complete in code but not yet deployed to production.

## Troubleshooting

### Signup Failures

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| "A user with this email already exists" | Email already registered | User tries alternate auth method or resets password |
| Signup returns 500 | Stripe API error or database connection issue | Check server logs and Stripe dashboard |
| Google OAuth returns error | Google OAuth misconfiguration | Verify OAuth client ID and redirect URI |
| Magic link not received | Email delivery failure | Check spam folder; verify SMTP configuration |

### Trial/Billing Issues

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| Trial not created on signup | Stripe API key or price ID misconfigured | Verify STRIPE_SECRET_KEY and STRIPE_PRICE_ID |
| Subscription status shows incorrect data | Webhook not processed or delayed | Check Stripe dashboard; verify webhook endpoint is reachable |
| Trial not expiring | Reaper not running | Check scheduler logs; verify expireTrials() is scheduled |
| Cannot cancel subscription | User is not a board member | Subscription management requires board-level access |
| Checkout / start-trial fails | Billing POST body parsing defect (VOY-2217) | VOY-2217: **FIXED in code**. Awaiting QA re-verify and production deploy. Escalate to Engineering. |
| Billing portal link returns 500 | Portal-link handler defect (VOY-2218) | VOY-2218: **FIXED in code**. Awaiting QA re-verify and production deploy. Escalate to Engineering. |

### Webhook Issues

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| Events not processing | Webhook signature verification failure | Verify `STRIPE_WEBHOOK_SECRET` matches Stripe dashboard |
| Duplicate events processed | Idempotency table not working | Check `voyonder_stripe_webhook_events` table for duplicates |
| Webhook returns 500 | Unhandled event type or database error | Check server logs; verify Stripe API compatibility |

### PostHog Analytics

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| No events in PostHog | API key not set or invalid | Verify `POSTHOG_API_KEY` is set and valid |
| Signup events show 0 users | Distinct ID discontinuity | Events before user creation use email; after use userId. This is expected. |
| Duplicate events | Multiple signup attempts or retries | Check server logs for duplicate signup calls |

### Auth Routing Issues (VOY-2192 / M6.1)

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| Google signup button returns 404 | Route mismatch: frontend calls `GET /api/auth/google`, backend has `POST /api/auth/signup/google` | Tracked in VOY-2192. No user workaround. Escalate to Engineering. |
| Magic link send returns 404 | Route mismatch: frontend calls `POST /api/auth/magic-link/send`, backend has `POST /api/auth/signup/magic-link` | Tracked in VOY-2192. No user workaround. Escalate to Engineering. |
| Magic link verify returns 404 or 500 | Route mismatch: frontend calls `POST /api/auth/magic-link/verify` with JSON body, backend has `GET /api/auth/magic-link/verify?token=` (also returns 500) | Tracked in VOY-2192. No user workaround. Escalate to Engineering. |
| "All signup methods broken" | Auth routing conflict: Traefik routes all `/api/auth/*` to Voyonder API, which doesn't handle frontend's expected paths | Tracked in VOY-2192 (M6.1). Critical priority. Founding Engineer assigned. |

## Support Escalation

| Issue | Severity | Contact | SLA |
|-------|----------|---------|-----|
| Signup completely broken (all methods fail) | P0 | CTO | Immediate |
| Stripe webhook not processing (cannot create trials) | P0 | CTO | Immediate |
| Auth routing mismatches (VOY-2192 — signup flows 404/500) | P0 | CTO | Immediate |
| Billing checkout/portal failures (VOY-2217 / VOY-2218) — fixes complete, awaiting deploy | P1 | CTO | 1 hour |
| Trial not expiring (revenue impact) | P1 | CTO | 1 hour |
| PostHog analytics not reporting | P2 | CTO | 4 hours |
| Onboarding wizard broken (non-blocking) | P2 | CTO | 4 hours |
| Magic link delivery failure | P2 | CTO | 4 hours |
| Performance degradation during high signup load | P3 | Staff Engineer | 24 hours |
| Feature request (dynamic roles, email verification, rate limiting) | P4 | COO | Next sprint planning |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
|| m6-draft | 2026-08-24 | Initial draft — pending release verification |
|| m6-v1 | 2026-08-25 | Published — M6 live in production. Updated trial period to 7 days (actual), removed email/password method (shipped with magic link + Google OAuth only), added VOY-2171 auth migration context. |
|| m6-v1.1 | 2026-08-25 | Added 5 auth routing mismatch limitations (VOY-2192 / M6.1) from QA findings. Added P0 escalation entry for auth routing. |
|| m6-v1.2 | 2026-08-25 | Updated auth migration section — clarified NOT DEPLOYED, documented VOY-2198 structural review findings and VOY-2200 fixes (commit `535f75fa15`). |
|| m6-v1.3 | 2026-08-25 | Auth migration pipeline complete — CTO sign-off received (commit `4134b0038e`), Release Engineer deploying. Updated status throughout. |
||| m6-v1.4 | 2026-08-25 | Auth migration now IN DEPLOYMENT (VOY-2197, commit `68da3ab`). Added billing defects VOY-2217 (checkout POST body parsing) + VOY-2218 (billing portal link 500) — limitations, troubleshooting rows, escalation entry. |
||| m6-v1.5 | 2026-08-25 | Billing defects VOY-2217/VOY-2218: fixes COMPLETE in code, awaiting QA re-verify + production deploy. Auth migration: merged to voyonder master (commit `c1a89b2`), CI/CD pipeline triggered for production deploy. |

*Maintained by: Support Engineer (88b72065)*
