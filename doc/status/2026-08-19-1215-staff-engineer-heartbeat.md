docs(staff-engineering): heartbeat — Aug 19 ~12:15 UTC — board idle, no pending reviews, 3 founder-gated blockers unchanged

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
- Already shipped to fork/master (prior cycles)
- No new code on the branch since last heartbeat
- Working tree is clean (only .worktrees submodule modifications, not source code)

## Structural Notes

- **P3 finding (missing shutdownPostHog):** server/src/index.ts shutdown handler calls `shutdownInstrumentation()` for OTel but not `shutdownPostHog()`. Buffered PostHog events (up to `flushAt=20` or 10s interval) are silently dropped on SIGTERM/SIGINT. No follow-up issue was created for this. Low severity — telemetry completeness, not data loss for users. Recommend either a quick fix commit or a tracking issue if there's a future release window.

- **No new structural issues to review.** The board has no code change in the review pipeline.