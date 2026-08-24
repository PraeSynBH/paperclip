# Support Heartbeat — 2026-08-24 ~07:10 UTC

## Diff Assessment

### Latest commit: `84e0c191f1` — fix(m6): remove @voyonder workspace deps from server
- Removes `@voyonder/product` and `@voyonder/types` from server/package.json
- Replaces imported type with locally-defined `VoyonderOptions` interface
- **Documentation impact: NONE** — Code-only change, no user-facing behavior changes

### Staged change: Remove voyonder-bridge re-exports from services/index.ts
- Removes unused re-exports of `createPaperclipEventBus`, `createPaperclipAuthProvider`, `createPaperclipLogger`
- All consumers import directly from `./services/voyonder-bridge.js` — no breakage
- **Documentation impact: NONE** — Code cleanup, no user-facing behavior changes

## Documentation Status
- **M6 Self-Serve Trial Onboarding** — Docs current (last updated Aug 23 ~23:30 UTC)
- **M6 Release Notes** — Current, commit hashes updated
- **All other support docs** — In sync with live system

## Board Status
- **VOY-1984** (M6 Release) — In progress, blocked on GitHub Actions billing
- **VOY-2088** (GitHub billing escalation) — Assigned to CEO, requires human action
- **VOY-2077** (QA Verify M6) — Blocked until M6 deployed
- **VOY-2078** (Merge M6 to master) — Blocked until M6 release complete

## Status
Standing by. No documentation action needed at this time. Ready for Release Engineer notification when M6 goes live.
