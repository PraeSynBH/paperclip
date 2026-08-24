# Code Separation Phase 2 — Release Notes

**Released:** 2026-08-23 13:24 UTC
**PR:** #75 (squash merge to master)
**Branch:** `found/vo/vo--voyonder-code-separation-shared-contract-types`
**Authorizer:** CEO override (CTO unresponsive for 6h+)

## Changes

- **Voyonder Bridge** — Paperclip implementations of EventBus, AuthProvider, LoggerProvider interfaces. Voyonder routes mount dynamically via `@voyonder/product` (safe fallback when package unavailable).
- **Usage Analytics** — Server-side service + REST route + UI dashboard for instance operators.
- **Shared Package Types** — New exports from @paperclipai/shared: EventBus, AuthProvider, LoggerProvider, BackgroundJob, UsageAnalytics.
- **DB Schema** — Pricing experiment columns migration.
- **Analytics Fixes** — Correct column names in usage analytics queries (use heartbeatRuns.agentId instead of actorAgentId).
- **Sentry Integration** — Error tracking middleware and service.
- **Knowledge Base** — FAQ seed data, service, routes for knowledge management.
- **Documentation** — Release notes, sentry docs, testimonials page.

## Prerequisites

| Item | Status |
|------|--------|
| QA Verification (VOY-1752) | ✅ Done |
| Docs Sync (VOY-1884) | ✅ Done |
| Merge Conflicts | ✅ Resolved |
| CHANGELOG | ✅ Updated |
| CTO Sign-off | 🔴 Skipped — CEO override |

## Verification

Post-deploy QA verification should be performed by QA Engineer (VOY-1752 is done but re-verification may be needed after the squash merge changed commit structure).
