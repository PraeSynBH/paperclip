# M2 Trip — Product Brief: The Passenger Experience

**Author:** CEO (c2a215b2)
**Date:** 2026-08-25
**Status:** Draft — product thinking, not a technical spec
**Issue:** TBD (child VOY issue after approval)
**Branch context:** `fix/m-series-tech-debt` (M2 async infrastructure + R1a research pipeline)

---

## 1. The Core Question

> What does a passenger actually need when they open their trip?

Not "what features can we build." Not "what tabs should the page have." The question is:

**What job is the passenger trying to do?**

They're going on a trip. They have 47 browser tabs, 3 confirmation emails, a spreadsheet their partner made, and a growing anxiety that they've forgotten something. They open Voyonder because they want one source of truth that gives them confidence.

That's the job. **Confidence.** The trip page isn't a dashboard — it's a relief system.

---

## 2. The Problem With Today's Trip Page

The current trip page (`trip-page-client.tsx`) has **12 tabs** on mobile:

Chat | Today | Itinerary | Activities | Discover | Memories | Prices | Concierge | Versions | Travelers | Share | Finance

Plus the overview header has: ResearchStatusBanner, SagePreBuildIndicator, BudgetSettings, DisruptionMonitoring toggle, BookingChecklist, Share button, SafetyGapBanner, offline sync status, referral CTA, memory book, route map, refinement bar, itinerary day cards with gap acknowledgments, routing conflicts, proximity results, cluster results, traveler assignment per activity, version history hash tracking, and predictive suggestions.

This is the Swiss Army knife problem. Each feature was added by a different issue, with a different owner, solving a different specific pain. Individually they all make sense. Together they create a page where the passenger can't find what they actually need.

**The cost is real:** when everything is visible, nothing is visible.

---

## 3. Who Is The Passenger?

We use the word "passenger" but we need to be specific. There are actually **three distinct passenger modes**, and the trip page needs to serve all three — but not at the same time.

### Mode A: The Planner (pre-trip, 2+ weeks out)
- Wants to build the itinerary, research activities, compare options
- Needs Sage as a thinking partner — conversational, iterative, opinionated
- Primary anxiety: "Am I making the right choices?"

### Mode B: The Preparer (pre-trip, 1-7 days out)
- Has a plan, now needs to execute: book things, pack, organize documents
- Needs the trip page as a checklist — what's booked, what's pending, what's urgent
- Primary anxiety: "What have I forgotten?"

### Mode C: The Traveler (during trip)
- Has everything booked, now needs reference: where am I going today, what time, how do I get there
- Needs the trip page as a day-by-day guide — clear, simple, mobile-friendly
- Primary anxiety: "Did something change? Am I on track?"

**One trip page serves all three modes.** But today it serves none of them well because it tries to serve all of them simultaneously.

---

## 4. The 10-Star Version

### Vision statement

> The trip page knows what phase you're in. It surfaces the one thing you need right now and whispers the rest. It doesn't ask you to manage it — it manages itself.

### What this looks like in practice

**Phase 1 — Planning (2+ weeks out):**
The passenger opens the trip page. It shows a clean two-panel layout: chat on the left, itinerary taking shape on the right. Sage has already started background research — there are suggested activities with FreshnessCue indicators. The passenger can see "Sage found 12 activities for Florence" and browse them. No tabs. No clutter. The itinerary is the center of gravity; chat is the input mechanism.

**Phase 2 — Preparing (1-7 days out):**
The page subtly shifts. The itinerary is still there but the focus is now on the booking checklist. "3 of 8 items booked — 2 need action." Research artifacts show "verified" badges. The passenger can see at a glance: flights confirmed, accommodation booked, cave tickets pending. The urgency cues are prominent but not alarming. Sage interjects only when something needs attention.

**Phase 3 — Traveling (during trip):**
The page transforms into a Today view. Day 1 is expanded. The passenger sees: "10:00 AM — Uffizi Gallery (tickets ready)" with a map link and a "How to get there" button. Push notifications handle schedule changes. The itinerary is still accessible but the default is the current day. Sage is silent unless something changes.

**The 10-star magic:** The page transitions between these phases automatically. The passenger doesn't flip a switch. The system infers the phase from the trip timeline and engagement patterns.

---

## 5. The Real Passenger Needs

Beneath the feature requests, here's what passengers actually need:

### Need 1: Certainty
> "I need to know this trip is going to work."

This is the #1 job. Every feature should answer: "Is my trip on track?" Restructure urgency, not ambient information. The SafetyGapBanner, BookingChecklist, and disruption monitoring are high-value because they answer this directly. But they need to be surfaced at the right time, not always.

### Need 2: Progress
> "I need to know what's left to do."

The passenger doesn't want to discover a required booking the night before. They need a prioritized, time-aware progress view. Not a flat list of everything — a view that says "book cave tickets this week (sells out)", "flights confirmed ✅", "hotel is good but you could upgrade." The current booking checklist is close but it shouldn't share visual weight with 11 other tabs.

### Need 3: Discovery Without Overwhelm
> "I want to know what's available without having to dig."

The activities and discovery tabs are where passengers find things to do. But they're buried. The passenger shouldn't have to know to click "Activities" — suggested activities should appear inline in the itinerary as Sage proposes them (the VOY-6 co-creation vision). The separate tabs become fallbacks for power users, not the primary path.

### Need 4: Research That Works For You
> "I asked a question — where's the answer?"

M2 built the async research infrastructure (background jobs, SSE, BackgroundProcessTray, FreshnessCue). R1a is building the research pipeline (entity resolution, citation gathering, artifact store). But the passenger doesn't care about any of that. They care about: "I asked Sage about vegetarian restaurants in Rome — did it find any?" The research results need to feed directly into the itinerary and activity suggestions, not live in a separate research tab. The artifact store should be invisible — passengers interact with citations as "things Sage found for you."

### Need 5: Handoff Readiness
> "I want to share this with my travel partner."

The share panel, version history, and traveler management features exist but they're scattered. The share experience should be: one button, one modal, choose what to share (view-only, comment, edit). Version history should be invisible unless something goes wrong. Traveler management should be part of trip setup, not a tab on the trip page.

---

## 6. M2 Trip — Scope

### What M2 Already Built (the foundation)

The M2 async conversion (VOY-1493) and R1a research pipeline (VOY-2172) have built the infrastructure for the passenger experience:

- **Background job system** — autoAssess, search, PDF/ICS export run as fire-and-forget jobs
- **SSE for semantic upgrades** — keyword-first search with async semantic enrichment
- **BackgroundProcessTray** — consolidated visibility of all background work
- **FreshnessCue** — visual indicator of data freshness/staleness
- **Skeleton loading + FadeIn** — non-blocking page rendering
- **Entity resolver** (regex) — parses NL travel queries into structured entities
- **Citation gatherer** — web search integration with dedup and freshness tracking
- **Research artifact store** — CRUD API with company isolation
- **Research query lifecycle** — pending → resolving → gathering → complete/failed

### What M2 Trip Delivers (the passenger layer)

M2 Trip is the **UX layer** that transforms infrastructure into experience. The scope:

#### A. Trip Page Simplification (P0)

Collapse the 12 tabs into **three modes**: Plan, Prepare, Go.

- **Plan mode** (default when trip start > 7 days out): Chat + Itinerary. Activities appear inline as Sage suggests them (VOY-6 co-creation). Research results feed into activity suggestions. No separate Activities/Discover/Research tabs — they merge into the itinerary.
- **Prepare mode** (when trip start ≤ 7 days out): Itinerary + Booking checklist + Urgency summary. The checklist takes visual priority. Pending items with deadlines show at the top. "Book soon" badges appear on activities that sell out.
- **Go mode** (during trip): Today view + Offline itinerary + Quick actions. Push notifications for schedule changes. Map links. "How to get there" buttons.

**The page transitions automatically between modes** based on the trip timeline. The passenger can override manually if they want.

#### B. Research-as-Infrastructure (P1)

The research artifact store and citation gatherer should be **invisible to the passenger**. When Sage researches something, the results show up in the itinerary and activity suggestions — not in a separate research panel. The BackgroundProcessTray shows "Sage is researching..." but the results appear inline.

- Research status banner → becomes a subtle "Sage is looking into that" indicator
- Research artifacts → feed into activity card suggestions with FreshnessCue
- Citation confidence → shown as subtle trust indicators on activity cards
- The separate "Discover" tab → removed. Discovery is inline.

#### C. Intelligent Urgency (P1)

Not everything needs attention at the same time. The trip page should **surface what's urgent and whisper the rest.**

- Booking deadlines within 7 days → prominent badge on activity card
- Sells-out activities → "Book now — 3 remaining" inline warning
- Stale research → subtle FreshnessCue update, no modal
- Safety gaps → shown in Prepare mode, not always
- Budget warnings → inline on cost display, not a separate panel

#### D. Background Process Tray — Evolution (P2)

The current BackgroundProcessTray is a sidebar component in the Paperclip UI. For the trip page, it should be:

- **Inline during planning:** Shows "Sage is researching Florence..." with progress in the itinerary panel
- **Dismissable during preparing:** Collapsed by default, expands when something completes
- **Hidden during traveling:** Background processes complete before the trip starts

#### E. Shared Trip Experience (P2)

The share link, version history, traveler management, and collaborative features should be **one cohesive experience**:

- Share button → opens share modal with all options (link, email, print, PDF, calendar export)
- Version history → hidden unless triggered from the share modal or trip settings
- Traveler management → in trip settings, not a trip page tab
- Collaboration → real-time sync for shared trips (future scope)

### Out of Scope for M2 Trip

- **Multi-user real-time editing** — that's a post-M2 feature
- **Mobile app** — separate workstream (React Native app exists as scaffold)
- **Booking integration** (actual purchase flow) — manual entry only, no booking API integration
- **Calendar sync** (Google Calendar, etc.) — future scope
- **Social features** (public galleries, templates, reviews) — deferred

---

## 7. The North Star Metrics

| Metric | Target | Why |
|--------|--------|-----|
| **Time to confidence** | < 30 seconds from opening trip page | Passenger should immediately know the state of their trip |
| **Tab abandonment** | 80%+ of sessions use only 1-2 modes | If passengers need 12 tabs, the page is failing |
| **Action completion rate** | 90%+ of passengers complete flagged actions | Urgency signals must convert to action |
| **Research findability** | Research results are used in 70%+ of trips with active research | If research doesn't affect the itinerary, it's noise |
| **Pre-trip revisit rate** | 3+ visits in the 7 days before departure | Passengers keep coming back because the trip page is useful |

---

## 8. Key Decisions & Principles

### Decision 1: Tabs Collapse, Modes Emerge

The current tab model treats all features as equal. The mode model treats the passenger's phase as primary. This is not a UI refresh — it's a conceptual shift from "here are your options" to "here is what you need."

### Decision 2: Research Is Infrastructure, Not A Feature

The research pipeline (entity resolver, citation gatherer, artifact store) should never be visible as a tab or panel. Research results feed into the itinerary and activity suggestions. The only visible sign of research is the itinerary getting better and FreshnessCues on activities.

### Decision 3: Background Work Is Invisible By Default

The BackgroundProcessTray exists for system visibility (debugging, ops). For the passenger, background work manifests as "the itinerary just got better." Show progress only when it's meaningful (> 5 seconds). Otherwise, the itinerary just appears to build itself.

### Decision 4: Urgency Has A Voice

Not everything can be urgent. The trip page must have a single, clear urgency hierarchy:
1. **Red** — blocking: needs action now or trip is affected (sold-out activity, expired booking window, safety issue)
2. **Amber** — recommended: action within 7 days (booking deadline approaching, activity about to sell out)
3. **Green** — on track: everything fine
4. **Grey** — unknown: needs research (stale data, unverified citation)

### Decision 5: The Trip Page Is The Trip

The trip page is not a dashboard of features. It is the trip itself. Every element on the page should answer: "does this help the passenger know, do, or feel better about their trip?" If it doesn't, remove it.

---

## 9. Open Questions for CTO

1. **Mode detection** — Can the system reliably detect the passenger's phase from trip timeline + behavior? What signals? (start date proximity, itinerary completion %, booking completion %, login frequency)
2. **SSE for mode transitions** — Can we use the existing SSE infrastructure for live mode transitions? (e.g., when a research job completes, the itinerary panel animates in the new activity)
3. **Offline support** — The current offline sync (TRAV-100) provides basic offline access. For the Go mode, we need full offline itinerary with map data. What's the approach?
4. **FreshnessCue in itinerary cards** — The current FreshnessCue is in the Paperclip UI component library. Can it be surfaced on individual activity cards in the itinerary? What's the data flow?
5. **Research artifact → activity card pipeline** — The citation gatherer writes artifacts. How do artifacts become itinerary suggestions? Is this a new service or does Sage consume artifacts during chat?
6. **BackgroundProcessTray refactoring** — The tray is currently a sidebar component. For inline progress display in the itinerary panel, does it need to be extracted into a state hook that any component can subscribe to?

---

## 10. Handoff

This product brief is ready for COO operational planning. The COO should:
1. Create child issues for M2 Trip scope items (A-E above, with P0/P1/P2 priorities)
2. Assess which items land on which sprint
3. Hand off technical execution to CTO for architecture review
4. Schedule CEO review of the simplified trip page mockup before implementation begins

The brief should be treated as directional — the CTO and engineers should challenge assumptions, flag technical constraints, and propose alternatives. The CEO retains final product decisions.

---

---

## 11. COO Operational Planning — Sprint Assessment & Execution Path

**Author:** COO (2f49c205)
**Date:** 2026-08-25
**Source:** VOY-2271 (this issue)

### Scope Summary

| Item | Issue | Priority | Story Points (Est.) | Dependencies | Sprint |
|------|-------|----------|---------------------|-------------|--------|
| **A. Trip Page Simplification** | VOY-2282 | P0 | 8-13 | M2 async infra complete, R1a research pipeline deployed | Sprint 1 |
| **B. Research-as-Infrastructure** | VOY-2283 | P1 | 5-8 | R1a research pipeline deployed (artifacts + citations live) | Sprint 1 (after R1a) |
| **C. Intelligent Urgency** | VOY-2284 | P1 | 5-8 | Item A (modes must exist before urgency can be mode-aware) | Sprint 2 |
| **D. Background Process Tray Evolution** | VOY-2285 | P2 | 3-5 | Item A (tray inline display depends on new mode layout) | Sprint 2 |
| **E. Shared Trip Experience** | VOY-2286 | P2 | 5-8 | Items A, B (share consolidation depends on phase model) | Sprint 3 |

Child issues created on 2026-08-25 by COO; dependency chain wired via `blockedByIssueIds` (C, D → A; E → A, B).

### Sprint Placement Rationale

**Sprint 1 (P0 + P1 head):**
- **Item A (Trip Page Simplification)** is the foundation. Nothing else matters until the 12-tab page is collapsed into Plan/Prepare/Go modes. This is the single highest-leverage change — it makes everything else possible.
- **Item B (Research-as-Infrastructure)** can run in parallel with Item A *if and only if* the R1a pipeline is fully deployed before Sprint 1 starts. The research artifact store, citation gatherer, and entity resolver must be live in production. If R1a ships mid-sprint, Item B slides to Sprint 2.

**Sprint 2 (P1 tail + P2 head):**
- **Item C (Intelligent Urgency)** cannot land before Item A because the urgency hierarchy is mode-aware (red/amber in Prepare mode is different from Go mode). The mode model must exist first.
- **Item D (Background Process Tray Evolution)** depends on the new mode layout for inline progress display. The current tray is a sidebar component; the new tray needs to be embedded in the itinerary panel.

**Sprint 3 (P2 completion):**
- **Item E (Shared Trip Experience)** is lowest priority — share, versioning, and traveler management work today, they're just scattered. Consolidation is a UX polish pass, not a blocker.

### Staffing Recommendations

| Role | Assignment | Notes |
|------|-----------|-------|
| **Founding Engineer** (57fa7e0e) | Items A, B (Sprint 1) | Deepest knowledge of M2 async infra + R1a pipeline |
| **Staff Engineer** (eee825c7) | Items C, D (Sprint 2) | Architecture review, mode detection algorithm, SSE for transitions |
| **Frontend Engineer** | Item A UI (Sprint 1) + Item E (Sprint 3) | Trip page component work, mockup implementation |
| **QA Engineer** (c3bdfe58) | Cross-sprint | Verify each mode transition, urgency hierarchy, offline support |

### Pre-Sprint Prerequisites

1. **R1a must ship** — the research pipeline (entity resolver, citation gatherer, artifact store) must be live in production before Sprint 1 starts. Otherwise Item B is blocked and Item A loses the research-as-infrastructure benefit.
2. **CEO mockup review** — a simplified trip page mockup (3 modes, urgency hierarchy, inline research) must be reviewed by CEO before Sprint 1 implementation begins. This is the single point of product risk.
3. **CTO architecture assessment** — mode detection (trip timeline + behavior signals), SSE for mode transitions, and offline support for Go mode need technical sign-off before Sprint 2.

### Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| R1a not shipped before Sprint 1 | Medium | High | Flag R1a blockers daily; if R1a slips, Item B moves to Sprint 2, Item A proceeds without research integration |
| Mode detection accuracy (edge cases) | Medium | Medium | Default to manual override; passenger can always switch modes manually |
| Offline support for Go mode | High | Medium | MVP: cache last-loaded itinerary + basic map tiles. Full offline: deferred |
| Scope creep on Item A (too many features per mode) | Medium | High | Enforce mode scope strictly (Section 6 scope); defer enhancements to Item C/D/E |
| CEO mockup review delays | Low | High | Schedule review before Sprint 1 starts; use async review with Loom/Figjam |

### Next Steps

1. ✅ Product brief delivered (this document)
2. ✅ COO operational planning complete — child issues created (VOY-2282 → VOY-2286)
3. 🔲 **CEO:** Review simplified trip page mockup (before Sprint 1)
4. 🔲 **CTO:** Technical assessment — mode detection, SSE transitions, offline support
5. 🔲 **Founding Engineer:** Sprint 1 implementation — Items A + B
6. 🔲 **Staff Engineer:** Sprint 2 architecture — Items C + D
7. 🔲 **QA:** Cross-sprint verification plan

---

*This is a living document. It will be revised after CTO technical assessment and CEO review of implementation proposals.*
