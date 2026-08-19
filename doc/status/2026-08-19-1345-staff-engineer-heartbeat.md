docs(staff-engineering): heartbeat — Aug 19 ~13:45 UTC — voy-1420-posthog-p2-fixes re-approved, board idle, 3 founder-gated blockers unchanged

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

### Post-approval change reviewed this heartbeat
`e2ebccf3ac fix(Dockerfile): add missing agents-catalog package.json to deps stage (pre-ship policy gate)`

- One-line COPY of `packages/agents-catalog/package.json` in the deps stage
- Without it, `pnpm install --frozen-lockfile` in Docker build fails — the workspace package is unresolved
- Trivially correct; alphabetically placed among peer package.json copies
- **Verdict: ✅ No structural issues**

### Full-diff re-verification (master..HEAD)

| Category | Status | Detail |
|----------|--------|--------|
| In-place Error mutation (posthog.ts) | ✅ Correct | `responseMessage` snapshot before `captureErrorEvent` — both HttpError and generic error paths covered. `companyId` passed as distinctId. |
| `prepare: false` (db/client.ts) | ✅ Accepted | CTO-accepted for embedded-PG (prepared-statement incompatibility). Recommend adding inline comment. |
| Google OAuth (better-auth.ts) | ✅ Correct | Env-var gated, `resolveLoginMethod` hardened with `new URL()`, fire-and-forget PostHog hooks with try/catch. |
| Approval metrics (approvals.ts) | ✅ Correct | `decisionNote` redacted via `redactSensitiveText` before PostHog egress. Tested. |
| VAPID dedup (notifications.ts) | ✅ Correct | Bounded FIFO cache (10K cap). Dynamic imports degraded gracefully. |
| SQL `AS "score"` alias | ✅ Correct | Ensures drizzle-orm result mapping works reliably. |
| parseObject strictness | ✅ Correct | Null-safe parsing replaces unsafe `as` casts. |
| Google OAuth UI | ✅ Correct | Sign-in button, redirect, error surface. Tests cover both paths. |
| Dockerfile | ✅ Correct | Missing package.json copy added. |

### Carried-forward P3 items (unchanged, non-blocking)
1. `shutdownPostHog()` not wired in server shutdown handler
2. `captureMetric()` not uniformly try/catch-wrapped in approvals/notifications
3. No code comment on `packages/db/src/client.ts:50` (`prepare: false`)

## Recommendations
- Add code comment on `prepare: false` explaining the embedded-PG rationale
- Consider wiring `shutdownPostHog()` in server shutdown handler for telemetry completeness

## Summary
Voy-1420-posthog-p2-fixes re-approved. No new structural issues. Board idle — all engineering work complete. 3 founder-gated blockers unchanged (VOY-1421 Mintlify, VOY-1413 docs deploy, VOY-748 credentials).
