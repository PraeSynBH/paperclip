---
title: Support Knowledge Base
summary: Internal support case assessments for Paperclip features
---

# Support Knowledge Base

This directory contains support case assessments for Paperclip features. Each document covers what the feature does, known limitations, troubleshooting steps, and support escalation paths.

## Recently Shipped Features

| Feature | Version | Status | Assessment |
|---|---|---|---|
| Sentry Error Tracking — Server-side and client-side error capture with structured context, session replays, performance traces, and source map uploads (M10) | voy-1826/1938 | Branch `feat/clean-m5-pricing-pr` (committed + working tree) | [Assessment](assessments/support-case-sentry-error-tracking.md) · [Release Notes](../documentation/releases/m10-sentry-error-tracking.md) |
| Pricing Page UX + A/B Pricing Experiment — Billing period toggle, usage progress bars, contextual feature icons, experiment variant rendering, client-side GA4 events, and configurable server-side A/B pricing test (M5) | voy-1685/1888/1941 | Committed via `b878783795` (Code Separation Phase 2) on `feat/clean-m5-pricing-pr` — upstream PR frozen per CEO VOY-1959, fork experiment continues | [Assessment](assessments/support-case-pricing-experiment.md) · [Release Notes](releases/voy-1888-pricing-page-ux.md) · [Customer Release](../documentation/releases/m5-ab-pricing-experiment.md) |
|| Self-Serve Trial Onboarding — Free 14-day trial with auto-registration, trial banner, expiry reaper, self-serve trial endpoints (start, status, convert) (M6) | m6-self-serve-trial | Branch `feat/clean-m5-pricing-pr` | [Assessment](assessments/support-case-self-serve-trial-onboarding.md) · [Release Notes](../documentation/releases/m6-self-serve-trial-onboarding.md) |
| GA4 Analytics Service — Google Analytics 4 Measurement Protocol integration (PostHog fallback) | voy-1941 | Committed `f95b738967` — service exported, .env.example configured, billing helper wired. Remaining: approval events (VOY-1967), monitoring script (VOY-1969) | [Documentation](../documentation/ga4-analytics.md) |
| SEO Metadata — Sitemap, Robots.txt, Dynamic Page Titles/Meta, Open Graph + Twitter Card Tags | v0.4.1 (voy-1798/1815) | Aug 23, 2026 (SHIPPED via a2ad8f8d90 + 096b1ecdff) | [Assessment](assessments/support-case-seo-metadata.md) · [Release Notes](../documentation/releases/v0-4-1-seo-metadata.md) |
| TOCTOU Billing Fix — Subscription & Usage Race Elimination + Idempotency Key | voy-1669/1671 | Aug 22, 2026 (SHIPPED via VOY-1682) | [Release Notes](../documentation/releases/voy-1669-toctou-billing-fix.md) |
| Async UX — Background Jobs + Process Visibility (M1+M2) | voy-1474 | Aug 20, 2026 (VPS deploy) | [Assessment](assessments/support-case-async-ux-background-jobs.md) · [Release Notes](../documentation/releases/voy-1474-async-ux.md) |
| Google OAuth & PostHog auth events + P2 fixes | voy-1420-posthog-p2-fixes | Documented, ready for release | [Google OAuth](assessments/support-case-google-oauth.md) |
| Agent Marketplace — browse + one-click hire marketplace agents | v0.5.0 | Aug 18, 2026 (PR #48) | [Marketplace](assessments/support-case-v0.5.0-marketplace.md) |
| Self-Service Onboarding — POST /start creates company + agents + goal + project + task | v0.5.0 | Aug 18, 2026 (PR #48) | [Onboarding](assessments/support-case-v0.5.0-onboarding.md) |
| Knowledge Starter Packs — curated KB document bundles | v0.5.0 | Aug 18, 2026 (PR #48) | [Starter Packs](assessments/support-case-knowledge-starter-packs.md) |
| Billing System — Stripe subscriptions, usage, invoices | v0.4.0+v0.5.0 | Trust boundary hardened | [Billing](assessments/support-case-billing-system.md) |
| Notification System — 5 types, 3 channels, digests | v0.4.0+v0.5.0 | Aug 18, 2026 (PR #48) | [Notification](assessments/support-case-notification-system.md) |
| Company Templates — one-click company deploy | v0.4.0+v0.5.0 | Aug 18, 2026 (PR #48) | [Templates](assessments/support-case-company-templates.md) |
| VOY-1367 Security Hardening — billing trust boundary, memory indexes, notification dedup | v0.5.0 | Aug 18, 2026 (PR #48) | [Release note](../documentation/releases/v0.5.0-phase-1.md) |
| Board Chat — Conference Room streaming chat | v0.4.0 | Aug 18, 2026 (PR #48) | [Board Chat](assessments/support-case-v0.4.0-board-chat.md) |

## Knowledge Base Articles

| Article | Covers | Commit | Issue |
|---|---|---|---|
| [Search Safety — plainto_tsquery](kb/search-safety-plainto-tsquery.md) | Knowledge search + memory warm-up handle special characters safely | `75c6c27a41` | C-3 / VOY-1299 |
| [SLA Monitor Alert Dedup Safety Net](kb/sla-monitor-dedup-safety-net.md) | Post-insert duplicate verification prevents concurrent duplicate SLA alerts | `75c6c27a41` | C-2 / VOY-1298 |
| [Environment Driver Corruption — readEnum()](kb/environment-readenum-corrupt-driver.md) | `readEnum()` returns `null` instead of throwing on corrupt driver values | `32ccc16229` | PRA-577 |
| [Manager-Chain Issue Permissions](kb/authorization-manager-chain-grant.md) | Managers can comment on and mutate issues assigned to agents in their reporting subtree | `f09cf3bc6e` | VOY-1264 |
| [Recovery Phantom-Park-and-Revalidate](kb/recovery-phantom-park-protocol.md) | Recovery system temporarily parks terminal issues for recovery action execution | `7f84af039b` | RBR-921/RBR-953 |
| [Heartbeat Max Concurrent Runs Enforcement](kb/heartbeat-max-concurrent-runs.md) | `tickTimers` checks maxConcurrentRuns before enqueueing | `b9d5299816` | PRA-553 |
| [Billing Downgrade-to-Free on Cancellation](kb/billing-cancellation-downgrade.md) | Subscription cancellation downgrades tier on next login | `83a1cee` | VOY-944 |
| [Child-Only Blocker Reclassification](kb/blocker-attention-child-only-classification.md) | Blocked issues with only child blockers now show `needs_attention` | `6b0b118367`+`7f84af039b` | RBR-824 |
| [DB Health Watchdog](kb/db-health-watchdog.md) | Embedded PG health probe behavior, restart gates, external-mode differences | `cd7f9d21db`+`36d152f5d2` | P0-B / PRA-1051 |

---

*Last updated: 2026-08-24 ~00:15 UTC — Assessed test commit 5353666316 and uncommitted M7/PostHog work. All docs current. Standing by.*

*Maintained by: Support Engineer (88b72065)*