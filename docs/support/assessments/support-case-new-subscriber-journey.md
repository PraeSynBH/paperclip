---
title: Support Case Assessment — New Subscriber Journey
summary: Consolidated SOP covering the full user journey from signup through first trip to subscription — common issues, troubleshooting, and escalation paths
version: v0.5.1
applies_to: Voyonder Cloud (voyonder.com) and self-hosted deployments with billing enabled
last_updated: 2026-08-22
---

## Quick-Reference SOP for Support Agents

When a user reports an issue, identify the journey stage and check the most common issues first:

| Stage | Most Common Issues | First Check |
|-------|-------------------|-------------|
| **Sign Up** | Email already in use, verification not received, OAuth failed | Check auth method; resend verification; clear cookies |
| **Onboarding** | 403 on start, agent creation fails, template deployment slow | Verify auth; check adapter config; retry deployment |
| **First Trip** | CEO not firing, task stuck, pending approval not showing | Check agent status (Resume if paused); check budget; refresh approvals |
| **Subscription** | PAYWALL errors, checkout not processing, missing invoices | Check tier features; verify Stripe keys; sync invoices |

**Always check:**
1. Is the user authenticated? (sign-in session valid)
2. Is billing enabled? (`PAPERCLIP_BILLING_ENABLED=true`)
3. What tier are they on? (check subscription features)
4. What error code did they see? (403 = permissions, PAYWALL = tier limits)

**Escalation:** If the issue involves Stripe integration, webhook failures, or backend errors, escalate to Founding Engineer / CTO with the error message, affected company ID, and relevant timestamps.

---

# Support Case Assessment: New Subscriber Journey

**Feature coverage:** Signup → Onboarding → First Trip → Subscription
**Assessed by:** Support Engineer (88b72065)
**Date:** 2026-08-22
**Related issues:** VOY-1677, VOY-1673 (COO Customer Acquisition), VOY-1678 (PostHog funnels), VOY-1609 (Feature Gating), VOY-1669 (TOCTOU billing fix), VOY-1474 (Async UX)
**Related documentation:** [Self-Service Onboarding](support-case-v0.5.0-onboarding.md), [Billing System](support-case-billing-system.md), [Async UX / Background Jobs](support-case-async-ux-background-jobs.md), [PAYWALL Errors KB](/support/kb/paywall-errors)

---

## Overview

This assessment covers the complete new user journey on Voyonder — from the moment a user lands on voyonder.com through creating their first company, running their first trip, and setting up a paid subscription. It consolidates knowledge from individual feature assessments into a single support-facing reference for common subscriber issues.

---

## User Journey Map

```
Landing Page (voyonder.com)
    │
    ▼
Sign Up ───────────────────► Email/password or Google OAuth
    │
    ▼
Dashboard (empty)
    │
    ├──► Deploy a Template ──► Travel Concierge, Support Ops, Engineering, CPA Firm
    │         │                    (instant — 10 seconds)
    │         ▼
    │    Company Dashboard
    │         │
    │         ├──► CEO heartbeat fires ──► First task started
    │         ├──► Approvals queue ──► Approve CEO strategy
    │         └──► Company running autonomously
    │
    └──► Create from Scratch ──► Onboarding wizard
              │                    (company name, industry, budget)
              ▼
         Company Dashboard
              │
              ├──► CEO heartbeat fires
              ├──► Approvals queue
              └──► Company running autonomously
                      │
                      ▼
              Subscription Setup (when ready)
                      │
                      ├──► Go to /pricing or Billing page
                      ├──► Choose tier (monthly/yearly)
                      ├──► Enter card details via Stripe Checkout
                      └──► Subscription active — feature gates lift
```

### Acquisition Channels (Current)

Users arrive at voyonder.com through these channels. Support should be familiar with each channel's documentation and user expectations:

| Channel | Status | Documentation | Support Notes |
|---------|--------|---------------|---------------|
| **Direct / Organic** | Active — voyonder.com discoverable via search, SEO work in progress (VOY-1676, VOY-1681) | Landing page, Docs site | Primary entry point. Users arrive expecting self-service. |
| **Case Studies** | 4 published — Trail Life, Voyonder dogfooding, AI agents, autonomous economy | `/case-studies/` | Users from case studies may have specific use-case expectations. Direct to Your First Company guide. |
| **Discord Community** | Live — discord.gg/m4HZY7xNG3 — link in docs nav, footer, and onboarding docs | Community channels | Active support community. Users often referred from Discord for billing/auth issues. |
| **Outreach / Direct Sales** | Outreach materials drafted — demo scripts, launch posts, email templates | Internal only (COO) | Beta prospects and outreach contacts may need assisted onboarding. Escalate to COO if needed. |
| **Pricing Page** | Live — `/pricing` — tier comparison with upgrade CTAs | Billing setup guide | Users comparing plans. Expect clear feature breakdown. PAYWALL errors drive users here. |

---

## Common Issues by Journey Stage

### Stage 1: Sign Up

| Issue | Symptoms | Root Cause | Resolution |
|-------|----------|------------|------------|
| Email already in use | "An account with this email already exists" | User already registered | Redirect to login; offer password reset |
| Weak password | "Password must be at least 8 characters" | Password too short | Suggest stronger password |
| Google OAuth fails | "Unable to sign in with Google" | Google account not linked, or browser blocking popup | Try email/password signup; check browser popup settings; clear cookies |
| Email verification not received | User registered but can't verify | Email in spam; mail server misconfigured; typo in email | Check spam folder; resend verification; verify email is correct |
| Rate limited | "Too many attempts. Try again later." | Multiple rapid signup attempts | Wait 60 seconds and retry |

### Stage 2: Onboarding / Company Creation

| Issue | Symptoms | Root Cause | Resolution |
|-------|----------|------------|------------|
| 403 on onboarding | `403 Forbidden` on `POST /api/start` | User session not authenticated or not board-level | Ensure user is signed in; clear session and retry |
| Agent creation fails during onboarding | Onboarding fails with agent error | Specified adapter type not registered, or adapter misconfigured | Check server logs; try default adapters (no adapterType specified) |
| Onboarding succeeds but no CEO appears | Dashboard shows company with no agents | Instructions bundle materialization warning | Non-fatal — agent exists with adapter defaults. Instructions can be set up later from the agent detail page |
| "Budget cannot be zero" error | Onboarding wizard rejects $0/mo | Budget too low for the selected configuration | Set a minimum budget (try $10,000 = $100/mo) or edit after creation |
| Template deployment fails | "Deployment failed — rolling back" | One of the atomic deployment steps failed | Retry; if persistent, check server logs for the specific failed step (skill install, agent creation, knowledge pack) |
| Slow template deployment | Takes >30 seconds | Template deployment is atomic — each step runs sequentially | Normal for first deployment. Subsequent deployments use warmed connections. |

### Stage 3: First Activity / Trip

| Issue | Symptoms | Root Cause | Resolution |
|-------|----------|------------|------------|
| CEO heartbeat not firing | Dashboard shows idle agents after 2+ minutes | First heartbeat queued but not yet processed; agent paused; no budget | Wait 60s and refresh; check agent status (if paused, click Resume); check company budget |
| "No tasks to work on" | CEO reports no tasks | Onboarding task may not have been created; task is in wrong status | Create a manual task from the dashboard; check task status filter |
| Pending approval not appearing | CEO says strategy needs approval but nothing in queue | Approval queue not refreshed; notification not sent | Refresh the Approvals page; check notification settings |
| Task stuck at "in_progress" for hours | Agent checked out a task but no updates | Agent heartbeat timed out or process crashed | Check agent heartbeat history; restart agent; server restart requeues stale heartbeats |
| Export returns 413 | PDF/ICS export fails with payload too large | Export request exceeds 512 KB limit | Reduce item count or date range before exporting |
| Export stays "running" forever | Background job never completes | Server may have crashed; pre-hotfix deployment | Restart server — startup sweep requeues stale jobs |
| Search returns no results | Research search returns empty | No research data; filter too restrictive; search query issue | Broaden search; check date range; try a different query |
| Semantic upgrade never arrives | Keyword results show but no semantic enhancement | `PAPERCLIP_EMBEDDING_API_KEY` not configured; `semanticUpgrade` not set in request | Check env var; ensure request includes `semanticUpgrade: true` |

### Stage 4: Subscription / Billing

| Issue | Symptoms | Root Cause | Resolution |
|-------|----------|------------|------------|
| Billing page not available | 404 or route not found | `PAPERCLIP_BILLING_ENABLED` not set to `true` | Set env var and restart; billing routes are feature-flagged |
| 403 on billing mutations | `403 Forbidden` when creating/cancelling subscription | Agent context — mutations require board user | Use a board user session (human, not agent) |
| PAYWALL creating API key | `403 { code: "PAYWALL" }` on POST /access/keys | Current tier lacks `api_access` feature | Upgrade to a tier that includes API access |
| PAYWALL inviting members | `403 { code: "PAYWALL" }` on POST /invites | At seat limit; tier lacks `unlimited_seats` | Upgrade tier or remove inactive members |
| Checkout session broken | Stripe checkout page shows error or doesn't load | `STRIPE_SECRET_KEY` not set; invalid tierId; Stripe API error | Verify Stripe keys; check tierId exists; check Stripe dashboard |
| Checkout completed but no subscription | User returned to app but no subscription shown | `checkout.session.completed` webhook not processed | Verify webhook endpoint (`POST /api/billing/webhook`) is configured in Stripe dashboard; check webhook signing secret |
| "Subscription status: incomplete" | New subscription shows incomplete | Payment method not collected before subscription creation | Use the Checkout Session flow instead of direct `POST /billing/subscription` |
| Invoice missing or outdated | Billing overview shows no invoices | Invoices not yet synced from Stripe | Trigger manual sync via `POST /billing/invoices/sync` |
| Subscription cancel not working | "I cancelled but it still shows active" | Cancel sets `cancelAtPeriodEnd=true` — subscription remains active until period end | That's expected — subscription continues to end of billing period then transitions to `canceled` |
| "How do I reactivate?" | User wants to restore cancelled subscription | Subscription was cancelled | Use `POST /billing/subscription/reactivate` — works as long as Stripe subscription still exists |
| Price looks wrong on upgrade | "I switched tiers but the price doesn't match" | Billing period mismatch; tier pricing changed | Check `GET /billing/tiers` for current pricing; verify monthly vs yearly billing period |
| "I'm being charged after cancelling" | Stripe charge after cancellation | Cancellation was `cancelAtPeriodEnd` — service continues until period end | Explain that cancellation takes effect at period end; pre-paid period is not refunded |

---

## Quick Diagnostic Queries

### Check company subscription and features

```sql
SELECT ct.name AS tier, ct.features, cs.status, cs.cancel_at_period_end
FROM company_subscriptions cs
JOIN subscription_tiers ct ON ct.id = cs.tier_id
WHERE cs.company_id = '<company-id>';
```

### Check if billing is enabled

```sql
SHOW PAPERCLIP_BILLING_ENABLED;
-- Or check environment: SELECT current_setting('PAPERCLIP_BILLING_ENABLED', true);
```

### Check recent webhook events (idempotency)

```sql
SELECT stripe_event_id, event_type, created_at, status
FROM stripe_webhook_events
WHERE company_id = '<company-id>'
ORDER BY created_at DESC
LIMIT 20;
```

### Check agent heartbeat status

```sql
SELECT a.name, a.role, a.status, a.last_heartbeat_at, a.error_message
FROM agents a
WHERE a.company_id = '<company-id>'
ORDER BY a.last_heartbeat_at DESC NULLS LAST;
```

### Check company budget

```sql
SELECT b.monthly_budget_cents, b.spent_cents, b.period_start, b.period_end
FROM budgets b
WHERE b.company_id = '<company-id>';
```

---

## Escalation Path

| Issue Category | First Response | Escalate To | Notes |
|---------------|----------------|-------------|-------|
| Signup / Auth issues | Clear cookies, try email/password flow | Engineering — auth provider (better-auth) | Google OAuth issues may be provider-side |
| Onboarding failure | Retry; check budget and adapter config | Engineering — onboarding service | Check server logs for specific failure step |
| Agent heartbeat stuck | Check agent status; resume if paused; check budget | Engineering — heartbeat scheduler | Server restart requeues stale heartbeats |
| Billing mutations (403) | Educate: board user required | N/A — by design | Agents cannot mutate billing |
| PAYWALL errors | Check tier features; suggest upgrade | N/A — by design | Part of subscription feature gating |
| Stripe integration failures | Verify `STRIPE_SECRET_KEY` and webhook config | Founding Engineer / CTO | Check Stripe dashboard for API errors |
| Background job stuck | Restart server; check processor logs | Founding Engineer / CTO | Pre-hotfix deployments may need the VOY-1527 patch |
| Checkout flow broken | Verify tierId, Stripe keys, webhook URL | Founding Engineer / CTO | Test with Stripe test mode first |

---

## Feature Availability by User Type

| Feature | Anonymous | Logged-in (Free) | Subscribed | Notes |
|---------|-----------|------------------|------------|-------|
| Browse voyonder.com | ✅ | ✅ | ✅ | Public pages |
| Sign up | N/A | ✅ | ✅ | |
| Create company | ❌ | ✅ | ✅ | Requires auth |
| Deploy template | ❌ | ✅ | ✅ | |
| Run company (agents) | ❌ | ✅ | ✅ | Subject to budget |
| Create API keys | ❌ | ❌ | ✅ (if `api_access` in tier) | Gated by feature |
| Create agents | ❌ | ✅ (basic) | ✅ (advanced) | `advanced_agents` feature gate |
| Invite members | ❌ | Limited (tier seats) | Unlimited (with `unlimited_seats`) | Seat-count gated |
| Install plugins | ❌ | ❌ | ✅ (with `custom_plugins`) | Gated by feature |
| View billing/pricing | ✅ | ✅ | ✅ | Read-only |
| Manage subscription | ❌ | ❌ | ✅ | Board user only |

---

## Related Documentation

- [Self-Service Onboarding Assessment](support-case-v0.5.0-onboarding.md)
- [Billing System Assessment](support-case-billing-system.md)
- [Async UX / Background Jobs Assessment](support-case-async-ux-background-jobs.md)
- [Feature Gating Release Notes](/support/releases/voy-1609-feature-gating)
- [PAYWALL Errors KB](/support/kb/paywall-errors)
- [PostHog Monitoring Triage SOP](/support/posthog-error-monitoring-triage-sop)
- [Your First AI Company Guide](/start/your-first-company)
- [Billing Setup Guide](/guides/board-operator/billing-setup)
- [Quickstart Guide](/start/quickstart)

---

*Maintained by: Support Engineer (88b72065)*
*Last updated: 2026-08-22 — consolidated new subscriber SOP with quick-reference guide, updated acquisition channels for public launch*
