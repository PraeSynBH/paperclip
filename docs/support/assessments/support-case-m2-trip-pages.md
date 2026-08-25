---
title: Support Case Assessment — M2 Trip Pages (Plan/Prepare/Go modes)
version: m2-v2
applies_to: VOY-2282 (M2 Trip — Trip Page Simplification) + VOY-2284 (M2 Trip — Intelligent Urgency)
status: Committed — branch fix/m-series-tech-debt, NOT yet deployed to production (blocked on R1a P0 VOY-2298/VOY-2301)
maintained_by: Support Engineer (88b72065)
---

# Support Case Assessment: M2 Trip Pages (Plan/Prepare/Go Modes)

## Feature Summary

The M2 Trip Pages feature (VOY-2282) introduces a complete trip detail experience with three mode-based views — **Plan**, **Prepare**, and **Go** — that adapt the page content based on how far the trip date is. It replaces the previous placeholder trip page with a full-featured itinerary, research, and action center powered by the Sage AI research infrastructure. The mode-aware **Intelligent Urgency hierarchy** (VOY-2284) adds red/amber/green/grey urgency scoring to every research item, driving the booking checklist ordering, safety alerts, and today-view prioritization.

**Current status:** Trip pages (VOY-2282, commit `2c0f8b8b23`) and Intelligent Urgency (VOY-2284, commit `8fc99f01b8`) are committed on `fix/m-series-tech-debt` (2026-08-25). **NOT yet deployed to production** — the R1a release (VOY-2189) is blocked on a P0 infinite-loop bug (VOY-2298; fix issue VOY-2301) found during the Staff Engineer's final structural audit. The R1a fix commit (`8976083b9b`) and the M2 trip commits are all on the same branch and will ship together.

### Modes Overview

| Mode | Condition | Purpose |
|------|-----------|---------|
| **Plan** | Trip start > 7 days away | Research, brainstorm, and build itinerary with Sage AI assistance |
| **Prepare** | Trip start ≤ 7 days away (not started) | Booking checklist, urgency indicators, confirm reservations |
| **Go** | Trip has started | Today's schedule, quick actions, navigation, offline access |

Mode detection is automatic based on the trip start date, with a manual override persisted per-trip in localStorage.

### What Is Built (Committed in VOY-2282)

| Component | Description | Status |
|-----------|-------------|--------|
| **tripMode.ts** | Pure mode detection logic with 12 unit tests covering all mode transitions and edge cases | ✅ Committed |
| **useTripMode.ts** | React hook with localStorage-persisted manual override | ✅ Committed |
| **TripsList.tsx** | Trip listing page with search, create dialog, status badges | ✅ Committed |
| **TripDetail.tsx** | Full trip page with three mode-based views | ✅ Committed |
| **App.tsx** routes | Route registration with UnprefixedBoardRedirect for trips | ✅ Committed |
| **company-routes.ts** | 'trips' in BOARD_ROUTE_ROOTS | ✅ Committed |
| **research-trips.ts** | API client for all trip/research endpoints | ✅ Committed |
| **queryKeys.ts** | ResearchTrips query keys for React Query caching | ✅ Committed |
| **tripUrgency.ts** | Mode-aware urgency scoring library: red/amber/green/grey hierarchy (VOY-2284) | ✅ Committed |
| **tripUrgency.test.ts** | 26 unit tests covering all modes and edge cases (VOY-2284) | ✅ Committed |
| **UrgencyBadge.tsx** | UrgencyBadge, SellOutWarning, BookingDeadlineBadge, UrgencyRow, UrgencyDotLegend components (VOY-2284) | ✅ Committed |
| **FreshnessCue.tsx** | Stale state aligned to muted grey per urgency hierarchy (VOY-2284) | ✅ Committed |

### What Is NOT Yet Built

- **Research-as-Infrastructure invisible pipeline (VOY-2283)** — background job SSE, confidence indicators, FreshnessCue (in progress, visible in working tree)
- Sage AI natural language chat on Plan mode — the dual-panel layout exists but Sage suggestion wiring depends on VOY-2283
- PDF/ICS export from trip page — export infra exists (R1a) but trip-page integration is pending
- Real web search / email search integration — R1a-5 not yet wired

## Plan Mode

### What It Does

Plan mode is the trip research and brainstorming view, shown when the trip start date is more than 7 days away. It presents a dual-panel layout:

- **Left panel: Chat** — Designed for conversational interaction with Sage AI. Users can ask research questions, get suggestions, and explore destination options. *(Note: full Sage chat wiring is pending VOY-2283; the panel layout exists with placeholder content.)*
- **Right panel: Itinerary** — Displays research artifacts, activity cards, and a growing itinerary built from Sage's findings. Artifacts show title, snippet, source type, status, and confidence indicators (when confidence data is available).

### Key Behaviors

| Behavior | Details |
|----------|---------|
| Mode entry | Auto-selected when trip start > 7 days from now |
| Research query submission | Via backend POST /research/queries (async — returns queryId/jobId, poll for results) |
| Activity cards | Research artifacts displayed with title, snippet, source, status badge |
| Confidence indicators | Dot-based meter (3 dots: green = high confidence, grey = lower) — depends on VOY-2283 |
| Freshness cues | Subtle visual indicator showing how recent the research is — stale renders as muted grey "Needs refresh" (VOY-2284 alignment) |
| Research needs card | "N items need research" card shown when grey (stale/unverified) items exist (VOY-2284) |

## Prepare Mode

### What It Does

Prepare mode is the booking and logistics view, shown when the trip start is within 7 days but hasn't started yet. It features:

- **Booking checklist** — A progress-tracked list of research items organized as a pre-trip todo list, **sorted by urgency (Red → Amber → Grey → Green)** with color-tinted rows and a mini urgency count bar (VOY-2284)
- **"Book soon" badges** — Prominent badges on activities approaching booking deadlines (VOY-2284)
- **Urgency Overview sidebar** — Per-level counts (Blocking/Soon/On track/Unknown), needs-attention total, booking progress, and a dot legend (VOY-2284)
- **Safety items card** — Red-bordered card listing items whose titles carry safety/health keywords (VOY-2284)
- **Background process summary** — "Sage is looking into that…" indicator when research jobs are queued/running

### Key Behaviors

| Behavior | Details |
|----------|---------|
| Mode entry | Auto-selected when trip start ≤ 7 days away and trip has not started |
| Booking checklist | Shows all research items with completion tracking; empty state: "No Sage finds yet. Ask Sage in Plan mode and they'll appear here." |
| Progress bar | Visual indicator of checklist completion (verified artifacts / total) |
| Urgency cues | Badges for booking deadlines within 7 days; "Book now — X remaining" warnings for sell-out activities (VOY-2284) |

## Go Mode

### What It Does

Go mode is the active-trip view, shown once the trip has started. It provides:

- **Today view** — A focused view of today's schedule, activities, and reservations, with a **Needs attention** section (red/amber items) shown prominently and on-track items collapsed into an "On track (N)" disclosure (VOY-2284)
- **Quick actions** — Maps, calendar export, offline access buttons
- **"How to get there"** — Navigation info for each activity
- **Needs attention card** — When red/amber items exist, a red-bordered card (top 5) appears above the itinerary in the main column (VOY-2284)

### Key Behaviors

| Behavior | Details |
|----------|---------|
| Mode entry | Auto-selected when trip start date has passed |
| Today focus | Only shows today-relevant information; past items are completed, future items deferred |
| Quick actions panel | Inline buttons for maps navigation, calendar export (ICS), and offline mode |
| Safety gaps | Mode-specific warnings shown when relevant (e.g., travel advisories, safety info for unfamiliar destinations) — driven by the VOY-2284 safety keyword heuristic |

## Mode Detection Logic

### Automatic Detection

```typescript
Plan   = trip.startDate > now + 7 days
Prepare = now < trip.startDate ≤ now + 7 days
Go     = trip.startDate ≤ now (trip has started)
```

The detection uses server-returned trip start dates. Edge cases:
- **No start date set** — defaults to Plan mode (research phase)
- **Cancelled trips** — all mode UIs display cancelled state
- **Past trips (completed)** — defaults to Go mode showing completed itinerary

### Manual Override

Users can manually switch between modes via a dropdown/toggle. The override is persisted per-trip in localStorage (`trip-mode-override-${tripId}`) and survives page refreshes. Clearing localStorage or using a different device resets to automatic mode.

**Limitations:**
- Manual override is device-local — switching devices resets to auto mode
- No API endpoint for mode override (no server-side persistence of mode preference)
- Mode override is lost if localStorage is cleared

## Intelligent Urgency (VOY-2284)

### What It Does

The Intelligent Urgency feature (VOY-2284, commit `8fc99f01b8`) scores every research artifact with a red/amber/green/grey urgency level computed client-side by `ui/src/lib/tripUrgency.ts`. The score is **mode-aware**: which signals are surfaced depends on whether the trip is in Plan, Prepare, or Go mode. This drives:

- **Booking checklist ordering** (Prepare mode) — items sorted Red → Amber → Grey → Green with color-tinted rows
- **Safety items card** (Prepare mode) — red-flagged items with safety/health keywords in the title
- **Urgency Overview sidebar** (Prepare mode) — counts per level + needs-attention total + legend
- **Needs attention card** (Go mode) — red/amber items shown prominently; on-track items collapsed into a `<details>` section in TodayView
- **"X items need research" card** (Plan mode) — grey count shown so users know what needs fresh research

### Urgency Levels (client-side, no server round-trip)

| Level | Meaning | When applied |
|-------|---------|-------------|
| **Red** | Blocking — needs action now | Safety keyword in title (Prepare/Go); booking window expired; deadline ≤ 0 days |
| **Amber** | Recommended — action within 7 days | Booking deadline 1–7 days away; pending item with high confidence (≥30) + high relevance (≥70) → "about to sell out" |
| **Green** | On track | Fresh, verified, no deadlines. Also the catch-all for stale/unverified in Go mode (noise hidden) |
| **Grey** | Unknown — needs research | Data ≥30 days old (stale); pending citation with low confidence (<30) or null confidence (Plan/Prepare modes) |

### Mode-Aware Rules (from `computeArtifactUrgency`)

- **Plan mode** → only Grey matters. Stale/unverified items are Grey; every verified/fresh item is Green regardless of deadlines or safety keywords. (Research phase — no urgency pressure.)
- **Prepare mode** → full hierarchy. Priority order: safety → expired window → deadline ≤0 (all Red) → deadline ≤7 days (Amber) → high-confidence+high-relevance pending (Amber, "about to sell out") → stale (Grey) → unverified (Grey) → Green.
- **Go mode** → only blocking items prominent. Safety and expired/closed windows are Red; deadlines within 7 days and sell-out items are Amber; stale/unverified items are **Green** (suppressed so they don't add noise during the trip).

### Thresholds (constants in `tripUrgency.ts`)

| Constant | Value | Meaning |
|----------|-------|---------|
| `STALE_THRESHOLD_MS` | 30 days | Data older than this → grey "stale" |
| `FRESH_THRESHOLD_MS` | 7 days | Data newer than this is fresh |
| `DEADLINE_AMBER_DAYS` | 7 | Deadline within 7 days → Amber |
| `DEADLINE_RED_DAYS` | 0 | Deadline today/expired → Red |
| `LOW_CONFIDENCE_THRESHOLD` | 30 (0–100) | Confidence below this → unverified → Grey |
| `HIGH_RELEVANCE_THRESHOLD` | 70 (0–100) | Relevance above this → "selling fast" heuristic → Amber |

### Heuristics & Signals

- **Safety detection** — keyword match on the artifact **title only** (case-insensitive): safety, travel advisory, vaccine, visa requirement, entry requirement, travel warning, covid, health alert, security alert, evacuation, natural disaster, political unrest, strike, curfew. This is a heuristic — a non-safety item mentioning "travel warning" in passing will be flagged Red in Prepare mode.
- **Sell-out estimate** — `estimateRemainingCount()` derives a 1–10 "remaining" count from confidence+relevance (higher both → fewer remaining). This is an **estimate, not live inventory** — no external booking API is consulted. `SellOutWarning` renders "Book now — N remaining" when remaining ≤ 3, else "N left — book soon".
- **Deadline input gap** — `toUrgencyInput()` in `TripDetail.tsx` currently passes `expiresAt: null` for every artifact because **the trips schema does not yet store booking deadlines**. Consequences:
  - Red "expired booking window" / Amber "booking deadline approaching" branches are **code-complete but dormant in practice** — they only fire when `expiresAt` is populated server-side.
  - The live modes that actually produce non-Green results today are: safety titles (Red), stale data (Grey), below-threshold confidence (Grey), and the sell-out heuristic (Amber).

### Visual Elements (`ui/src/components/trips/UrgencyBadge.tsx`)

| Component | Purpose |
|-----------|---------|
| `UrgencyBadge` | Colored pill or dot-only indicator (Red/Amber/Green/Grey) with reason tooltip |
| `SellOutWarning` | Inline "Book now — N remaining" / "N left — book soon" clock badge |
| `BookingDeadlineBadge` | "N days left" pill, red when ≤0 days, amber ≤7 days, hidden >7 days |
| `UrgencyRow` | Combines badge + sell-out + deadline for a single item; `compact` variant for list rows |
| `UrgencyDotLegend` | Legend explaining Blocking/Soon/On track/Unknown dots |

### FreshnessCue Alignment

`FreshnessCue.tsx` was aligned with the hierarchy: the **stale** state now renders as muted grey with a "Needs refresh" label (HelpCircle icon) instead of amber — matching the Grey "unknown — needs research" tier so stale data reads as informational rather than alarming.

## Known Limitations

### Data & Storage

1. **Research artifacts may be stale** — Artifacts have no automatic refresh. If a user researched a destination in Plan mode and returns weeks later, the displayed information may be outdated. Freshness cues (VOY-2283) will address this visually but won't auto-refresh.
2. **No offline mode for trip data** — Trip pages require network connectivity. Go mode is designed for quick access but has no true offline support yet (quick action buttons for maps/calendar help, but page content requires the API).
3. **Trip list pagination** — The trips list page paginates results. Users with very large numbers of trips may need to search or navigate pages.

### Research & Sage AI

4. **Sage suggestions are placeholder until VOY-2283** — The Plan mode chat panel has the layout for Sage interaction, but full conversational research is not wired. Users may see placeholder states or "Ask Sage" prompts without actual Sage responses until the Research-as-Infrastructure pipeline (VOY-2283) ships.
5. **Research is asynchronous** — Submitting a query returns immediately (202 status), but results appear only after background processing completes. Users unfamiliar with async patterns may expect instant results.
6. **Confidence indicators are best-effort** — The dot-based confidence meter (when available) reflects Sage's internal confidence score. It may not always be accurate for subjective recommendations.
7. **No query editing** — Once a research query is submitted, there's no endpoint to modify it. Users must submit a new query.

### Mode System

8. **Mode override is not synced** — Manual mode override is stored in localStorage only. It does not sync across devices or browsers. Users switching devices will see the automatic mode until they manually override again.
9. **Mode transitions are client-side** — The mode is determined entirely on the frontend based on trip start date. There's no server-side mode concept. This means different clients could theoretically show different modes for the same trip if they have different clock settings.
10. **No mode notifications** — Users are not notified when their trip automatically transitions from Plan to Prepare mode (7-day mark). They discover the change when they visit the trip page.

### Urgency (VOY-2284)

11. **Urgency is computed client-side only** — The red/amber/green/grey score is derived entirely in the browser from artifact fields returned by the API. No urgency field is stored or returned by the server, so two clients can disagree if they see different artifact data. The score cannot be shared, exported, or queried via API.
12. **Deadline signals are dormant until the schema stores `expiresAt`** — The booking-window Red/Amber branches never fire today because `TripDetail` maps `expiresAt` to `null` (not yet a column in the trips schema). Support should expect users to see Green on items that would logically have a booking deadline until the backend populates this field.
13. **Safety flags are title-keyword heuristics** — A title containing any of the 14 safety keywords (e.g. "visa requirement", "travel warning") is Red in Prepare/Go mode regardless of actual safety meaning. False positives are possible (e.g. "no vaccine required", "travel warning lifted"). There is no curated safety database behind this.
14. **Sell-out warnings show estimated counts** — "Book now — N remaining" numbers are derived from confidence/relevance heuristics (1–10), not live availability. The count can be wrong and there is no refresh path, so support should not treat it as an inventory figure.
15. **Manual urgency cannot be overridden by the user** — There is no UI or API to dismiss, correct, or override an urgency level on an item. A false-positive Red safety flag stays Red until the artifact's title/confidence changes.
16. **Urgency badges are purely visual in this release** — Sorting and coloring guide the user, but there is no linked action (e.g. a "Book now" button that opens checkout). Items are not clickable through to booking.

### Exports

17. **PDF/ICS export from trip page is pending** — The export infrastructure exists (R1a background jobs), but the trip page does not yet have export buttons. Users needing exports must use the generic export mechanisms.

## API Endpoints (Trip-Related)

### Research Trips

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/companies/:companyId/research/trips` | Voyonder JWT | Create a new trip in `draft` status. Returns 201. |
| GET | `/companies/:companyId/research/trips` | Voyonder JWT | List trips, filterable by status. Paginated. |
| GET | `/companies/:companyId/research/trips/:id` | Voyonder JWT | Get single trip with full details. |
| PATCH | `/companies/:companyId/research/trips/:id` | Voyonder JWT | Update trip details or status (validates state machine transitions). |
| DELETE | `/companies/:companyId/research/trips/:id` | Voyonder JWT | Cancel trip (soft-delete via status → cancelled). |

### Research Queries & Artifacts

See the [Research Artifact Service support case](./support-case-research-artifact-service.md) for full API reference on queries, artifacts, and background jobs.

## Troubleshooting

### Trip Page Issues

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| Trip page shows wrong mode | Auto-detection based on trip start date; manual override may be set | Check trip start date; clear localStorage (`trip-mode-override-${tripId}`) to reset to auto |
| "No Sage finds yet" shown | No research artifacts exist for this trip | Navigate to Plan mode and submit a research query (requires VOY-2283 to be functional) |
| Activity cards show no confidence dots | Research artifacts lack confidence data | Expected when artifacts come from R1a stub gatherer (no real search integration yet) |
| "Sage is looking into that..." persists | Background research job is running or stuck | Wait for job completion; if stuck for >5 minutes, check background jobs page for status |
| Research query returns 202 but no results appear | Async processing in progress; or query failed silently | Poll trip page; check background jobs list; if failed, resubmit the query |
| Trip not found (404) | Wrong company scope or trip ID | Verify trip ID belongs to the authenticated company |
| Cannot delete a trip | DELETE sets status to "cancelled" (soft-delete) | The trip remains in the database but hidden from default list queries; no hard-delete endpoint exists |

### Mode Issues

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| Plan mode shows Prepare layout (or vice versa) | Incorrect trip start date; or clock discrepancy | Verify trip start date is correct; check device clock; manually override mode |
| Manual override not persisting | localStorage cleared or disabled | Override is device-local; re-set the override; use same device/browser |
| Trip still shows as "upcoming" after start date | Date comparison uses local device time | Refresh the page; check trip start date; verify server date |
| All trips showing as Plan mode | No trip start dates set | Set a start date on the trip for proper mode detection |

### Sage / Research Issues

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| Sage chat panel empty | VOY-2283 not deployed; chat wiring pending | Expected for pre-release builds; basic functionality arrives with VOY-2283 |
| Research artifacts show as stale | Freshness threshold exceeded (7 days fresh, 30 days stale) | Re-submit research query to refresh; this is by design |
| Artifact status shows "unverified" | Research artifact has not been verified | Review and verify manually via PATCH endpoint; or wait for citation verification (R1a) |
| Source shows "integration pending (R1a-5)" | Web search / email search not wired | Expected pre-release; actual sources arrive with R1a-5 |

### Urgency Issues (VOY-2284)

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| Item shows Red "safety" but isn't dangerous | Title contains a safety keyword (visa requirement, travel warning, covid, strike, curfew, …) | Keyword heuristic — false positives possible; no override exists in this release. Document as known limitation |
| Item shows Amber "Book now — N remaining" | Sell-out heuristic fired (high confidence + high relevance) | Remaining count is an estimate (1–10), not live inventory; do not treat as availability |
| No item ever shows "booking window closed" | `expiresAt` is not stored in the trips schema yet — all artifacts map to null | Expected; deadline branches are code-complete but dormant until backend populates booking deadlines |
| Everything in Go mode is Green | Go mode suppresses stale/unverified noise — only safety + expired/closed windows are Red/Amber | Expected behavior; switch to Prepare mode (or check item titles for safety keywords) |
| Urgency colors differ between devices | Urgency is computed client-side from artifact data; data may differ per client | Refresh both clients; if they still differ, check fetchedAt/confidence values in the API response |
| User wants to dismiss a Red flag | No override UI/API exists | Not possible in this release; escalate feature request (VOY-2284 follow-up) |

## Escalation Path

| Issue | Action | Escalate to |
|-------|--------|-------------|
| Trip page fails to load (blank/error) | Check browser console for errors; verify API availability | Engineering (Founding Engineer / CTO) |
| Research queries never complete | Verify background worker is running; check job status in background jobs page | Engineering (Founding Engineer) |
| Mode detection consistently wrong | Verify trip start dates; check for localStorage corruption | Support Engineer + Engineering |
| Manual override not working | Clear localStorage and retry; if persists, browser compatibility issue | Support Engineer |
| "Sage is looking into that..." stuck for >10 minutes | Background worker may be saturated or crashed | Engineering (Founding Engineer) |
| Missing features (export, Sage chat, urgency indicators) | Feature not yet deployed — depends on VOY-2283 | Support Engineer (document known limitation) |
| Urgency colors don't match expectations | Client-side heuristic — may not reflect actual booking data | See urgency troubleshooting section; escalate if systemic misclassification |
| API returns 401/403 | JWT expired or invalid | Support Engineer + Engineering (auth config) |
| API returns 500 on any endpoint | Server-side error | Engineering (Founding Engineer / CTO) |

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| m2-v2 | 2026-08-25 | Support Engineer | **Intelligent Urgency (VOY-2284)** committed (`8fc99f01b8`). Added full urgency section: red/amber/green/grey hierarchy, mode-aware rules, thresholds, heuristics (safety keywords, sell-out estimate, deadline gap), visual components, FreshnessCue alignment. Updated Prepare mode (sorted checklist, Urgency Overview, SafetyGapsCard), Go mode (Today View needs-attention/collapsed-on-track, NeedsAttention card), Plan mode (research needs card, stale grey alignment). Added urgency limitations (11–16), urgency troubleshooting table, updated escalation path. Reflected VOY-2301 unassigned state in status line. |
| m2-v1 | 2026-08-25 | Support Engineer | Initial assessment for VOY-2282 (M2 Trip — Trip Page Simplification). Covers Plan/Prepare/Go mode trip pages, mode detection logic, manual override, trip listing. Notes dependencies on VOY-2283 (Research-as-Infrastructure) and VOY-2284 (Intelligent Urgency) for full functionality. R1a release blocked on P0 VOY-2298. |
