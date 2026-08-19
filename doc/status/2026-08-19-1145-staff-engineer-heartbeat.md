docs(staff-engineering): heartbeat — Aug 19 ~11:44 UTC — board idle, no pending reviews, voy-1420-posthog-p2-fixes shipped

## Board State

| Status        | Count | Notes                          |
|---------------|-------|--------------------------------|
| in_progress   | 0     | —                              |
| in_review     | 0     | —                              |
| blocked       | 3     | All human-gated (founder/CEO)  |
| todo          | 0     | —                              |
| backlog       | 0     | —                              |

## Branch Review Status

**voy-1420-posthog-p2-fixes** — PostHog business events + P2 fixes:
- Structural audit completed (Aug 19 ~20:00 UTC): P1-P8 findings filed
- All P1-P5 fixes implemented: VOY-1428, 1430, 1433, 1434, 1435
- Auth hooks structural findings resolved (VOY-1447 commit 96faa13434)
- Re-verification and final approval granted
- Code shipped to fork/master (feat VOY-1420 + VOY-1447 via e7efa4452e)
- Branch HEAD contains only post-ship heartbeat docs — no new code un-reviewed

## Structural Notes (no action required)

- `prepare: false` in DB client accepted for Voyonder's embedded-PG deployment; upstream already has env-var-based config
- `ts_rank` SQL alias fix (`AS "score"`) verified correct — fixes drizzle result-mapping issue with prepared statements on embedded PG
- In-place error message mutation in `sanitizeErrorForTelemetry` is safe: error-handler snapshots `responseMessage` before telemetry call; only 2 callers (both in error-handler), both snapshot correctly
- `captureMetric` does not auto-redact properties — callers must pre-redact (approval service does so; design is by-explicit-redaction)

## Blocked Issues (unchanged, human-gated)

1. **VOY-1413**: Docs site deploy — waiting on founder for Cloudflare DNS / Mintlify dashboard
2. **VOY-387.5**: PostHog dashboards + alerts — waiting on founder for PostHog project admin access
3. **Mintlify setup**: waiting on founder action

Engineering team idle. No review bottleneck — ready for CTO escalation when human gates clear.