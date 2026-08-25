---
title: Support Case Assessment — M2 Trip Pages (Plan/Prepare/Go modes)
version: m2-v1
applies_to: VOY-2282 (M2 Trip — Trip Page Simplification)
status: Committed — branch fix/m-series-tech-debt, NOT yet deployed to production (blocked on R1a P0 VOY-2298)
maintained_by: Support Engineer (88b72065)
---

# Support Case Assessment: M2 Trip Pages (Plan/Prepare/Go Modes)

## Feature Summary

The M2 Trip Pages feature (VOY-2282) introduces a complete trip detail experience with three mode-based views — **Plan**, **Prepare**, and **Go** — that adapt the page content based on how far the trip date is. It replaces the previous placeholder trip page with a full-featured itinerary, research, and action center powered by the Sage AI research infrastructure.

**Current status:** Committed on `fix/m-series-tech-debt` (commit `2c0f8b8b23`, 2026-08-25). **NOT yet deployed to production** — the R1a release (VOY-2189) is blocked on a P0 infinite-loop bug (VOY-2298) found during the Staff Engineer's final structural audit. The R1a fix commit (`8976083b9b`) and M2 trip page commit are both on the same branch and will ship together.

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

### What Is NOT Yet Built

- **Intelligent Urgency (VOY-2284)** — mode-aware red/amber/green/grey urgency hierarchy (in progress, visible in working tree)
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
| Freshness cues | Subtle visual indicator showing how recent the research is — depends on VOY-2283 |

## Prepare Mode

### What It Does

Prepare mode is the booking and logistics view, shown when the trip start is within 7 days but hasn't started yet. It features:

- **Booking checklist** — A progress-tracked list of research items organized as a pre-trip todo list
- **"Book soon" badges** — Prominent badges on activities approaching booking deadlines
- **Urgency sidebar** — Highlights items needing immediate attention (depends on VOY-2284)

### Key Behaviors

| Behavior | Details |
|----------|---------|
| Mode entry | Auto-selected when trip start ≤ 7 days away and trip has not started |
| Booking checklist | Shows all research items with completion tracking; empty state: "No Sage finds yet. Ask Sage in Plan mode and they'll appear here." |
| Progress bar | Visual indicator of checklist completion |
| Urgency cues | Badges for booking deadlines within 7 days; "Book now — X remaining" warnings for sell-out activities (VOY-2284) |

## Go Mode

### What It Does

Go mode is the active-trip view, shown once the trip has started. It provides:

- **Today view** — A focused view of today's schedule, activities, and reservations
- **Quick actions** — Maps, calendar export, offline access buttons
- **"How to get there"** — Navigation info for each activity

### Key Behaviors

| Behavior | Details |
|----------|---------|
| Mode entry | Auto-selected when trip start date has passed |
| Today focus | Only shows today-relevant information; past items are completed, future items deferred |
| Quick actions panel | Inline buttons for maps navigation, calendar export (ICS), and offline mode |
| Safety gaps | Mode-specific warnings shown when relevant (e.g., travel advisories, safety info for unfamiliar destinations) |

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

### Exports

11. **PDF/ICS export from trip page is pending** — The export infrastructure exists (R1a background jobs), but the trip page does not yet have export buttons. Users needing exports must use the generic export mechanisms.

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

## Escalation Path

| Issue | Action | Escalate to |
|-------|--------|-------------|
| Trip page fails to load (blank/error) | Check browser console for errors; verify API availability | Engineering (Founding Engineer / CTO) |
| Research queries never complete | Verify background worker is running; check job status in background jobs page | Engineering (Founding Engineer) |
| Mode detection consistently wrong | Verify trip start dates; check for localStorage corruption | Support Engineer + Engineering |
| Manual override not working | Clear localStorage and retry; if persists, browser compatibility issue | Support Engineer |
| "Sage is looking into that..." stuck for >10 minutes | Background worker may be saturated or crashed | Engineering (Founding Engineer) |
| Missing features (export, Sage chat, urgency indicators) | Feature not yet deployed — depends on VOY-2283/VOY-2284 | Support Engineer (document known limitation) |
| API returns 401/403 | JWT expired or invalid | Support Engineer + Engineering (auth config) |
| API returns 500 on any endpoint | Server-side error | Engineering (Founding Engineer / CTO) |

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| m2-v1 | 2026-08-25 | Support Engineer | Initial assessment for VOY-2282 (M2 Trip — Trip Page Simplification). Covers Plan/Prepare/Go mode trip pages, mode detection logic, manual override, trip listing. Notes dependencies on VOY-2283 (Research-as-Infrastructure) and VOY-2284 (Intelligent Urgency) for full functionality. R1a release blocked on P0 VOY-2298. |
