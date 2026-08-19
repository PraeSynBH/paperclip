# Staff Engineer Structural Audit — Final Re-Verification

**Branch**: voy-1420-posthog-p2-fixes
**Reviewer**: Staff Engineer (eee825c7)
**Date**: 2026-08-19 ~session start
**Status**: APPROVED

---

## Audit chain

| Timestamp | Action | Verdict |
|-----------|--------|---------|
| ~08:05 UTC (8925dc9) | First structural audit | **CONDITIONAL APPROVAL** — gate: `prepare:false` documentation |
| ~08:50 UTC (80d7235) | Re-verification — CTO accepted gate, F2/F3 fixed | **APPROVED** → routed to CTO |
| ~09:09 UTC (b56b1af) | CTO post-hoc approval confirmed | **GO** given |
| Now | Final re-verification | **APPROVED** — no new code changes |

## Changes since last audit

No source code changes since commit 8925dc93ed. The only code change since is:
- `e2ebccf3ac` — Dockerfile: add missing `agents-catalog/package.json` to deps stage (trivial, safe)

All other commits are docs-only (heartbeat logs, release notes, SOPs).

## Structural verification

| Category | Status | Notes |
|----------|--------|-------|
| **N+1 queries / indexes** | ✅ Clean | All hooks are fire-and-forget telemetry, no DB reads |
| **Stale reads / race conditions** | ✅ Clean | `resolveLoginMethod` reads request URL snapshot; hooks don't mutate auth state |
| **Trust boundaries** | ✅ Proper | Google OAuth env-var gated; `redactSensitiveText` before PostHog; `captureErrorEvent` passes companyId |
| **SQL safety** | ✅ Clean | Parameterized queries, `AS "score"` alias fixes unnamed column bug |
| **PostHog telemetry** | ✅ Non-blocking | Fire-and-forget, try/catch-wrapped, synchronous `captureMetric` |
| **Error handler redaction** | ✅ Correct | `responseMessage` snapshot before `captureErrorEvent` in-place mutation |
| **VAPID dedup cache** | ✅ Correct | Bounded FIFO Map (10K cap), verified with test |
| **Module import degradation** | ✅ Correct | try/catch with `return false` on import failure for net/tls/web-push |

## Carried-forward observations (non-blocking)

1. **`packages/db/src/client.ts:50`** — `{ prepare: false }` has no code comment. CTO explicitly accepted for Voyonder's embedded-PG deployment. Recommend: `// PgBouncer/transaction-pooler compatibility: disable prepared statement caching`
2. **`server/src/auth/better-auth.ts`** — `resolveLoginMethod` is called outside `try/catch` (P3). Function never throws but is a future-refactor hazard.

## Test results

- **41 tests passed** across 5 test files (posthog, error-handler, approvals-service, notifications-vapid-dedup, redaction)
- **5 UI tests passed** (Auth.test.tsx — Google sign-in rendering, redirect, error surfacing)
- Typecheck: pre-existing errors in notifications.ts (DeliveryStatus, emailDeferredToDigest — not introduced by this branch)

## Verdict: APPROVED

The branch is structurally sound for shipping. All code changes are safe and have been verified. No new structural issues since prior approval.

CTO go/no-go was given at ~09:09 UTC. Ready for Release Engineer to merge to fork/master.