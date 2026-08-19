docs(staff-engineering): heartbeat — Aug 19 ~12:55 UTC — board idle, voy-1420 re-verified, 3 founder-gated blockers unchanged

## Board State

| Status      | Count | Notes                          |
|-------------|-------|--------------------------------|
| in_progress | 0     | —                              |
| in_review   | 0     | —                              |
| blocked     | 3     | All founder-gated, unassigned  |
| todo        | 0     | —                              |
| backlog     | 0     | —                              |

## Branch Review Status

**voy-1420-posthog-p2-fixes** — PostHog business events + P2 fixes:
- Already reviewed and CTO-approved per prior audit chain (08:05 → 08:50 → 09:09 UTC)
- Re-verified this heartbeat: all P2 fixes confirmed committed (stack trace preservation, in-place message redaction, response message snapshot, VAPID dedup bounded cache, decisionNote redaction, Google OAuth config, parseObject strictness)
- Branch has 90 commits not in master, pending Release Engineer merge to fork/master
- Working tree has only .worktrees submodule modifications (no source changes)

## Structural Verification (this heartbeat)

| Category | Status | Detail |
|----------|--------|--------|
| N+1 / indexes | ✅ Clean | All hooks fire-and-forget, no DB reads |
| Race conditions | ✅ Clean | `resolveLoginMethod` reads request URL snapshot; auth hooks don't mutate state |
| Trust boundaries | ✅ Proper | Google OAuth env-var gated; `redactSensitiveText` before PostHog; `captureErrorEvent` passes companyId |
| SQL safety | ✅ Clean | Parameterized queries, `AS "score"` alias fix |
| Error handler redaction | ✅ Correct | `responseMessage` snapshot before `captureErrorEvent` in-place mutation |
| VAPID dedup cache | ✅ Correct | Bounded FIFO Map (10K cap), verified via test |
| Module import degradation | ✅ Correct | try/catch with `return false` on import failure for net/tls/web-push |
| `prepare: false` DB | ✅ Accepted | CTO accepted for embedded-PG deployment (issue #9a79485e — drizzle prepared-statement issue). No comment in source — recommend adding. |
| Auth hooks — try/catch | ✅ Wrapped | `captureMetric` in `user.create.after` and `session.create.after` wrapped |

## Findings (carried forward from prior audit, still open)

### P3 — shutdownPostHog not wired in server/index.ts shutdown handler
`server/src/index.ts` line 1081 calls `shutdownInstrumentation()` (OTel) but not `shutdownPostHog()`. Buffered PostHog events (flushAt=20, flushInterval=10s) are silently dropped on SIGTERM/SIGINT. Low severity — telemetry completeness, not user-facing data loss. No tracking issue exists.

### P3 — captureMetric not uniformly try/catch-wrapped
Prior reverification claimed telemetry is "try/catch-wrapped" but only auth hooks (better-auth databaseHooks) wrap `captureMetric` in try/catch. The call sites in `approvals.ts:185,212` and `notifications.ts:989` do NOT wrap. `captureMetric` calls `posthog-node.capture()` which is fire-and-forget and generally safe, but inconsistent with the defensive pattern established in the auth hooks. Low severity — posthog-node's `capture()` doesn't throw synchronously in practice.

## Recommendations

1. **Add `shutdownPostHog()` call** alongside `shutdownInstrumentation()` in server shutdown handler (tiny change).
2. **Add code comment** on `packages/db/src/client.ts:50` explaining why `prepare: false` is needed.
3. **Unwrap or uniformly wrap** `captureMetric` calls — either wrap all business-path call sites or document that `captureMetric` is known safe.

## Summary

Board idle. voy-1420-posthog-p2-fixes fully verified and ready for Release Engineer merge. 3 founder-gated blockers unchanged.