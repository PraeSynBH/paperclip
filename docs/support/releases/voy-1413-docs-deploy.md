---
title: Docs Site Deploy — Voyonder Cloud/SaaS + Billing Webhook Fix
version: voy-1413, voy-1598
date: 2026-08-21
commits: f64d16dd7f
status: PR #59 — pending CTO sign-off for merge + deploy
---

# Docs Site Deploy: Voyonder Cloud/SaaS + Billing Webhook Fix

**Branch:** `fork/docs-deploy-voy-1413`
**PR:** [#59](https://github.com/PraeSynBH/paperclip/pull/59)
**Release date:** 2026-08-21
**Status:** PR open, mergeable, CTO sign-off pending

## What Changed

### 1. Docs Site — Voyonder Cloud/SaaS Primary Path
- **FAQ** — Added Voyonder Cloud (SaaS) option alongside self-hosted install
- **Quickstart** — Added comparison table (Cloud vs Self-Hosted); Cloud is now the recommended path
- **Run Your First AI Company** — Rewritten as a SaaS-first guide (no install, no terminal, just a browser)

### 2. Support Documentation
- **New assessment:** Async UX / Background Jobs support case (`docs/support/assessments/support-case-async-ux-background-jobs.md`)
- **Support README:** Updated to link to new assessment
- **Heartbeat log:** Updated with Support Engineer activity

### 3. Billing — Webhook Handler
- **`customer.subscription.created`** handler added to `billing.ts` — calls `handleSubscriptionUpdated` for new subscriptions
- **`STRIPE_WEBHOOK_SECRET` guard** — early return with `badRequest` if not configured, before `constructEvent()`

### 4. Seed Data
- **`server/src/seed/002_subscription_tiers.sql`** — Stripe subscription tiers seed (Adventurer, Explorer, Elite)

## Verification
- Billing routes tests: 7/7 passed
- TypeScript typecheck: clean
- PR mergeable: yes
