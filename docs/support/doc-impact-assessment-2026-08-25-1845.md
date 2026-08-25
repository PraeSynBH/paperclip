---
title: Documentation Impact Assessment — M2 UI Working Tree (Research-as-Infrastructure)
date: 2026-08-25 ~18:45 UTC
branch: fix/m-series-tech-debt
base_commit: d3c107a3a8 (docs(support): correct heartbeat)
assessor: Support Engineer (88b72065)
---

# Documentation Impact Assessment: M2 UI Working Tree Changes

## Scope

Assessment of uncommitted working tree changes on `fix/m-series-tech-debt` against HEAD `d3c107a3a8`. These changes are tracked as "M2 improvements to ship after R1a" per the Release Engineer pipeline status (~18:16 UTC).

## Changed Files (User-Facing Impact)

| File | Change | User-Facing | Doc Impact |
|------|--------|-------------|------------|
| `ui/src/pages/trips/TripDetail.tsx` (M) | Sage AI chat composer wired: `Textarea` + submit button, `researchTripsApi.submitQuery()`, loading/error states, Enter-to-send, Shift+Enter for newline. 500-char cap. Artifacts poll every 15s. | **YES** — Chat is now functional (was placeholder) | **HIGH** |
| `ui/src/components/trips/InlineProcessDisplay.tsx` (new) | Mode-aware background process display: Plan mode (inline progress after 5s delay with job label, %, mini bar), Prepare mode (collapsible tray, auto-expands on completion, dismissible), Go mode (hidden). | **YES** — Replaces basic spinner in Prepare mode; adds progress in Plan mode | **MEDIUM** |
| `ui/src/components/BackgroundProcessTray.tsx` (M) | Refactored to use shared `useBackgroundProcesses` hook. Same behaviour. | **NO** (refactor only) | None |
| `ui/src/hooks/useBackgroundProcesses.ts` (new) | Shared SSE + polling hook with `isWorking` delay signal, prefix filtering, derived state. | **NO** (internal) | None |
| `ui/src/lib/background-jobs.ts` (new) | `backgroundJobLabel()` (user-facing copy: "Sage is researching activities…", "Sage is reviewing…", "Sage is looking deeper…", "PDF Export", "Calendar Export") + `formatDuration()`. | **YES** — Label copy changed from "Activity Search" etc. | **LOW** |
| `ui/tsconfig.verify.json` (new) | TypeScript verify config. | **NO** (infra) | None |

## Documentation Delta

### 1. `docs/support/assessments/support-case-m2-trip-pages.md` (m2-v2)

**Stale statements (committed state vs. working tree):**

| Line | Current Statement | Working Tree Reality | Action |
|------|------------------|---------------------|--------|
| ~47 | "Sage AI natural language chat on Plan mode — the dual-panel layout exists but Sage suggestion wiring depends on VOY-2283" | Chat composer is wired: `researchTripsApi.submitQuery()` returns `queryId`/`jobId`, shows loading/error states, results appear inline | Update when working tree ships |
| ~57 | "full Sage chat wiring is pending VOY-2283; the panel layout exists with placeholder content" | Working chat input with Enter-to-send, 500-char limit | Update when working tree ships |
| ~81 | "Background process summary — 'Sage is looking into that…' indicator when research jobs are queued/running" | Replaced by `InlineProcessDisplay` with mode-aware tray (Plan: inline progress bar; Prepare: collapsible tray with per-job status) | Update when working tree ships |
| ~206 | "Sage suggestions are placeholder until VOY-2283 — The Plan mode chat panel has the layout for Sage interaction, but full conversational research is not wired." | Chat is functional; query submission triggers background job and results appear inline | Update when working tree ships |
| ~253 | "Navigate to Plan mode and submit a research query (requires VOY-2283 to be functional)" | No longer gated on VOY-2283 | Update when working tree ships |
| ~255 | "'Sage is looking into that...' persists — Background research job is running or stuck" | Now `InlineProcessDisplay` with per-job progress, label, and percentage | Update when working tree ships |
| ~273 | "Sage chat panel empty — VOY-2283 not deployed; chat wiring pending" | Chat is functional. Empty state may still show if no queries submitted. | Update when working tree ships |

### 2. `docs/support/assessments/support-case-research-artifact-service.md` (R1a)

| Line | Current Statement | Working Tree Reality | Action |
|------|------------------|---------------------|--------|
| ~43 | "TripPage UI (R1a-6) — no customer-facing frontend for viewing research artifacts alongside trip itineraries" | TripDetail.tsx now shows artifacts inline with 15s polling; InlineProcessDisplay shows research progress | Update when working tree ships |

### 3. `docs/support/releases/voy-1474-async-ux.md` (M1+M2 release notes)

No update needed for this doc — the M2 UI changes are post-R1a and will get their own release note entry or a follow-up release note.

## Recommended Actions

When the working tree is committed and deployed:

1. **Update `support-case-m2-trip-pages.md`** to:
   - Mark Sage chat as functional (remove "pending VOY-2283" caveats)
   - Document InlineProcessDisplay behaviour (inline progress in Plan mode, collapsible tray in Prepare mode, hidden in Go mode)
   - Update troubleshooting table entries for Sage/research issues
   - Update "What Is NOT Yet Built" to reflect progress on VOY-2283
   - Add version increment (m2-v3 or appropriate)

2. **Update `support-case-research-artifact-service.md`** to:
   - Remove "no customer-facing frontend" caveat
   - Note that artifacts are visible in TripDetail with auto-refresh polling

3. **Create release note** for the M2 UI improvements (or append to upcoming R1a release note)

## Release Pipeline Context

Per Release Engineer (~18:16 UTC):
- R1a release (VOY-2189) is blocked on code review sign-off (VOY-2298, P0 fix)
- These working tree UI changes are designated "M2 improvements to ship after R1a"
- Next step when R1a ships: Support Engineer called for docs sync and curated release note

## Post-ship Status (added ~22:25 UTC, 2026-08-25)

The M2 UI working tree assessed above **shipped with R1a** (VOY-2304 done ~22:13 UTC, merge `6b1d841658`). All recommended actions were executed:

| Recommended action | Executed |
|---|---|
| Update `support-case-m2-trip-pages.md` (Sage chat functional, InlineProcessDisplay, troubleshooting, version increment) | ✅ Done — m2-v3.3 (Sage chat, InlineProcessDisplay, useBackgroundProcesses documented; status LIVE) |
| Update `support-case-research-artifact-service.md` (remove "no frontend" caveat) | ✅ Done — r1a-v6.3 (artifacts visible in TripDetail with 15s polling noted; status LIVE) |
| Create release note for R1a incl. M2 UI | ✅ Done — `docs/support/releases/r1a-pre-ship-fixes.md` (shipped) + `docs/releases.md` entry |

## Sign-off

- Assessment: Complete
- Action: **COMPLETE** — R1a shipped, docs synced to live system at r1a-v6.3 / m2-v3.3

*Maintained by: Support Engineer (88b72065)*
