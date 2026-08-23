# Horizon 1 ("Help Me Plan") — Product-Architecture Document

**Author:** CTO (5a914da0)
**Status:** Final
**Date:** 2026-08-23
**Issue:** VOY-1993
**Deadline context:** Before M6 ships to production; document informs M7 sprint planning.

---

## Executive Summary

Horizon 1 ("Help Me Plan") is the AI concierge trip planning experience — the conversion funnel that turns free-trial users into paid subscribers of the Voyonder travel service. This document describes the product architecture at the scope of user journeys, AI agent orchestration, data model, integration surface, and export paths. It is a *product-architecture map* intended to scope M7 sprint planning, not a technical implementation spec.

The core insight: Voyonder is not a booking engine competing with Expedia/Google Travel. It is an **AI personal travel agent** — the user describes what they want conversationally, and the agent handles research, itinerary construction, and coordination. This is the job-to-be-done that converts trials to $50k MRR.

---

## 1. User Flow: signup → onboarding → "plan my trip" → itinerary → export

### 1.1 Funnel Overview

```
┌──────────┐     ┌────────────┐     ┌──────────────┐     ┌────────────┐     ┌────────┐
│  SIGNUP  │ ──▶ │ ONBOARDING │ ──▶ │ "HELP ME    │ ──▶ │ ITINERARY  │ ──▶ │ EXPORT │
│ (trial)  │     │ (role +    │     │  PLAN" CHAT │     │ (curated + │     │ PDF/   │
│          │     │  interests)│     │  or FORM    │     │  editable) │     │  ICS   │
└──────────┘     └────────────┘     └──────────────┘     └────────────┘     └────────┘
                                               │
                                     ┌─────────▼──────────┐
                                     │  AI RESEARCH LOOP  │
                                     │ ┌────────────────┐ │
                                     │ │ Destination    │ │
                                     │ │ Discovery      │ │
                                     │ ├────────────────┤ │
                                     │ │ Activity       │ │
                                     │ │ Research       │ │
                                     │ ├────────────────┤ │
                                     │ │ Flight /       │ │
                                     │ │ Hotel /        │ │
                                     │ │ Transport Scan │ │
                                     │ ├────────────────┤ │
                                     │ │ Weather +      │ │
                                     │ │ Logistics Scan │ │
                                     │ └────────────────┘ │
                                     └────────────────────┘
```

### 1.2 Stage Details

| Stage | User Action | System Behavior | Conversion Signal | Fallback |
|-------|-------------|-----------------|-------------------|----------|
| **1. Signup** | Email/password or Google OAuth | Creates company + user; assigns free trial (Stripe `start_trial`); returns JWT session | Enters trial state | N/A — gated entry |
| **2. Onboarding** | "What kind of traveler are you?" — select role (solo, couple, family, business) + interests (adventure, luxury, budget, culture) | Deploys role-based asset pack; creates initial agents (Concierge, Booking, Support); lands on trip dashboard | Completes onboarding → ready to plan | Skip → empty dashboard |
| **3. "Plan My Trip"** | Natural language input: *"Plan a 5-day trip to Japan for two, mix of culture and food, mid-range budget, leaving mid-September"* | Agent team triggers research pipeline — destination intel, activity options, transport logistics, weather, local tips | First trip created → shows intent to pay | Structured form fallback (destinations → dates → preferences) |
| **4. Itinerary Building** | Review AI-generated itinerary — day-by-day breakdown with activities, transport, meals. User can: edit, add/remove, reorder, request alternatives, export | Live-editable itinerary state; agent-as-co-pilot refining based on feedback | Iteration confirms engagement | If research incomplete → partial itinerary with loading states + "full version coming soon" notice |
| **5. Export** | "Send to my phone" / "Download PDF" / "Add to Calendar" | Background job produces PDF itinerary + ICS calendar; delivers via email or direct download | Export = high-intent signal → conversion prompt | Email delivery if download fails |

### 1.3 Key Design Decisions

1. **Conversation-first, form-fallback.** The primary interaction is a chat interface with the Concierge agent. The structured form (destination → dates → budget → interests) loads as a sidebar/panel for users who prefer direct input. Both paths converge on the same itinerary model.

2. **Progressive disclosure.** The first trip interaction must feel magical (single input → rich itinerary), even if the AI research loop is still warming caches. The front page loads a skeleton itinerary from cached/fallback data while the full research pipeline runs as a background job with SSE progress updates.

3. **Conversion gate at export, not at creation.** The trial user can create and browse as many itineraries as they want. The paywall gates *export* (PDF/ICS) and *collaboration* (sharing with travel companions). This gives users enough value to commit without friction before they see quality.

4. **Empty-state nurturing.** If the user signed up but hasn't created a trip within 48h, a Support agent sends a personalized suggestion: *"Hi! I noticed you haven't planned your first trip yet. Where are you dreaming of going?"*

---

## 2. AI Models/Agents: What Powers the Trip Planning

### 2.1 Agent Team Model (Multi-Agent Orchestration)

Horizon 1 uses a **hybrid chat + structured agent team** model — not a pure conversational chat, and not a rigid multi-step form. The Concierge agent is the user's primary interface; behind it, specialized sub-agents execute research tasks in parallel.

```
                    ┌───────────────────────────────┐
                    │         USER (TRIAL)          │
                    │      natural language in      │
                    └───────────────┬───────────────┘
                                    │
                    ┌───────────────▼───────────────┐
                    │   1. CONCIERGE AGENT (Atlas)  │
                    │   ┌────────────────────────┐  │
                    │   │ Intent parsing          │  │
                    │   │ Constraint extraction   │  │
                    │   │ Multi-turn refinement   │  │
                    │   │ Delegation orchestration│  │
                    │   └───────────┬────────────┘  │
                    └───────────────┼───────────────┘
                                    │ delegates to
            ┌───────────────────────┼───────────────────────┐
            │                       │                       │
┌───────────▼──────────┐ ┌─────────▼─────────┐ ┌───────────▼──────────┐
│ 2. RESEARCH AGENT    │ │ 3. BOOKING AGENT  │ │ 4. LOGISTICS AGENT  │
│    (Lyra)            │ │    (Lyra)         │ │    (Sage)           │
│ ┌──────────────────┐ │ │ ┌───────────────┐ │ │ ┌──────────────────┐ │
│ │ Destination intel│ │ │ │ Flight/hotel  │ │ │ │ Weather checks   │ │
│ │ Activities +     │ │ │ │ price scans   │ │ │ │ Transport routing │ │
│ │ local tips       │ │ │ │ (affiliate    │ │ │ │ Visa/entry reqs  │ │
│ │ Food & culture   │ │ │ │  links)       │ │ │ │ Timezone/comm    │ │
│ │ Best time to go  │ │ │ │ Room types    │ │ │ │ Local tips       │ │
│ └──────────────────┘ │ │ └───────────────┘ │ │ └──────────────────┘ │
└──────────────────────┘ └───────────────────┘ └──────────────────────┘
            │                       │                       │
            └───────────────────────┼───────────────────────┘
                                    │
                    ┌───────────────▼───────────────┐
                    │    5. ITINERARY BUILDER       │
                    │    Assembles day-by-day plan  │
                    │    from all research outputs  │
                    │    Applies user preferences   │
                    │    Balances pacing + variety  │
                    └───────────────────────────────┘
```

### 2.2 Agent Roles & Capabilities

| Agent | Name | Primary Model | Interaction Style | Key Skills |
|-------|------|--------------|-------------------|------------|
| **Concierge** | Atlas | Frontier LLM (e.g., GPT-4o, Claude 4 Sonnet) | Conversational chat; freeform + guided | Intent parsing, constraint extraction, multi-turn refinement, delegation, tone management |
| **Research** | Lyra | Frontier LLM + retrieval-augmented generation | Structured research; web-browsing tool use | Destination research, activity discovery (via cache-first framework `lib/discovery/`), GYG/Viator enrichment (optional), price estimation |
| **Booking Scout** | Lyra (sub-agent) | Frontier LLM + structured API calls | Structured data extraction | Flight price scanning (affiliate API), hotel availability, transport options |
| **Logistics** | Sage | Frontier LLM + knowledge base | Structured checks | Weather forecasts, visa/entry requirements, timezone conversion, local customs, safety alerts |
| **Itinerary Builder** | Atlas (sub-routine) | Frontier LLM | Structured generation | Day-by-day assembly, pacing optimization, preference weighting, conflict resolution |

### 2.3 Hybrid Interaction Model: Conversation + Guardrails

The trip planning interaction follows a **steering-wheel pattern**:

1. **User speaks freely** → Concierge agent parses intent and constraints using the frontier LLM
2. **Structured parameter extraction** → System extracts structured fields (destination, dates, travelers, budget, interests) from the conversation. These are displayed in a sidebar that the user can edit directly at any time.
3. **Research triggers** → Once enough parameters are known, Concierge delegates to Research/Booking/Logistics agents in parallel. Results flow back asynchronously via SSE.
4. **Review + refine** → The user sees a draft itinerary, optionally requests changes ("swap day 2 and day 3", "find a cheaper hotel", "add more outdoor activities"), and the loop repeats at step 2-3.
5. **Export** → User exports the final itinerary.

### 2.4 Why Hybrid (Not Pure Chat, Not Pure Form)

| Approach | Advantages | Disadvantages |
|----------|-----------|---------------|
| **Pure conversational chat** | Magical UX, low cognitive load, feels personal | Vague constraints lead to poor results; no save/resume boundary; hard to edit individual fields; bill $ per turn |
| **Pure structured form** | Precise, parseable, cheap to process, easy to A/B test | Feels like every other travel site; doesn't differentiate; high abandonment on forms with 15+ fields |
| **Hybrid (our choice)** | Best of both: chat for initial input + discovery; structured sidebar for precision editing; agent handles the mapping between them | Higher engineering complexity; must handle state reconciliation between chat context and structured fields |

The hybrid model is Voyonder's key differentiator. It keeps the *magic* of an AI concierge while giving users the *control* of structured trip planning.

### 2.5 Research Pipeline Architecture

The research pipeline (ref: existing `lib/discovery/` framework in the codebase) is **cache-first with background enrichment**:

```
User intent ──▶ Extract ──▶ Cache hit? ──YES──▶ Serve cached + fallback ──▶ Display immediately
                   │
                   │ NO
                   ▼
            Serve fallback activities ──▶ Display skeleton
                   │
                   ▼
            Full research pipeline (background)
                   │
            ┌──────┼──────┐
            ▼      ▼      ▼
        Dest    Activ  Flights
        Intel   ities  /Hotel
                   │
                   ▼
            Itinerary builder ──▶ SSE push to UI ──▶ Replace skeleton
```

---

## 3. Data Model

### 3.1 Core Entities

```
  ┌──────────┐     ┌──────────┐     ┌───────────────┐
  │  User    │ 1:N │ Company  │ 1:N │   Trip        │
  │          │────▶│          │────▶│               │
  └──────────┘     └──────────┘     │ - id (uuid)   │
                                    │ - title       │
                                    │ - status      │
                                    │   (draft,     │
                                    │    researching│
                                    │    complete)  │
                                    │ - metadata    │
                                    │   (dates,     │
                                    │    travelers, │
                                    │    budget)    │
                                    └───────┬───────┘
                                            │ 1:N
                                            ▼
                                    ┌───────────────┐
                                    │  Destination  │
                                    │               │
                                    │ - name        │
                                    │ - country     │
                                    │ - lat/lng     │
                                    │ - days_spent  │
                                    │ - order_index │
                                    └───────┬───────┘
                                            │ 1:N
                                            ▼
                                    ┌───────────────┐
                                    │  Activity     │
                                    │               │
                                    │ - type (food, │
                                    │   culture,    │
                                    │   adventure)  │
                                    │ - name        │
                                    │ - description │
                                    │ - price_range │
                                    │ - source      │
                                    │   (researched,│
                                    │    curated,   │
                                    │    user_added)│
                                    │ - day_number  │
                                    │ - start_time  │
                                    │ - end_time    │
                                    │ - location    │
                                    │ - booking_uri │
                                    │ - verified    │
                                    └───────┬───────┘
                                            │
                                    ┌───────▼───────┐
                                    │  Transport    │
                                    │               │
                                    │ - type (flight│
                                    │   train, car) │
                                    │ - provider    │
                                    │ - from        │
                                    │ - to          │
                                    │ - depart_time │
                                    │ - arrive_time │
                                    │ - price_est   │
                                    │ - booking_uri │
                                    └───────────────┘
```

### 3.2 Secondary Entities

| Entity | Description | Key Fields | Notes |
|--------|-------------|------------|-------|
| **UserPreference** | User's travel style and constraints | `budget_tier`, `travel_style`, `dietary_restrictions`, `accessibility_needs`, `favorite_activities[]`, `avoid_activities[]` | Inferred from conversation; editable in profile |
| **TripCollaborator** | Shared trip access | `trip_id`, `user_id`, `role` (viewer/editor) | Gated behind paid tier |
| **ResearchCache** | Destination research results (idempotent, TTL-managed) | `destination_key`, `data` (JSON), `source`, `fetched_at`, `ttl_minutes` | Powers cache-first architecture; avoids re-querying LLM/APIs for same destination |
| **TripExport** | Export delivery record | `trip_id`, `format` (pdf/ics), `delivered_at`, `delivery_channel` (email/download) | Tracks conversion signal |

### 3.3 State Machine: Trip Lifecycle

```
                ┌──────────┐
                │  DRAFT   │ ← User enters initial natural language prompt
                └────┬─────┘
                     │ parameters sufficient
                     ▼
             ┌───────────────┐
             │  RESEARCHING  │ ← Active research pipeline; SSE streaming to UI
             └───────┬───────┘
                     │ all sub-research complete
                     ▼
             ┌───────────────┐
             │   ITINERARY   │ ← Day-by-day plan assembled; user can edit/refine
             │   (editable)  │
             └───────┬───────┘
                     │ user satisfied OR requests changes
                    ╱ ╲
                   ╱   ╲
                  ▼     ▼
          ┌────────┐  ┌───────────────┐
          │COMPLETE│  │  REFINING     │ ← user requested changes → RESEARCHING
          └───┬────┘  └───────────────┘
              │
              │ export triggered
              ▼
         ┌──────────┐
         │ EXPORTED │ ← PDF/ICS delivered; conversion prompt shown
         └──────────┘
```

### 3.4 Migration Strategy

The data model builds on the existing Paperclip company-scoped schema. Key migrations needed:

1. **`trips` table** — company-scoped trip container (new migration)
2. **`trip_destinations` table** — ordered destinations per trip (new migration)
3. **`trip_activities` table** — activities per destination per day (new migration)
4. **`trip_transport_segments` table** — transport legs (new migration)
5. **`user_preferences` table** — user-scoped travel preferences (new migration)
6. **`research_cache` table** — idempotent cache of researched destinations (new migration)
7. **`trip_exports` table** — export audit trail (new migration)

All tables are company-scoped and use the existing Drizzle schema patterns (`packages/db/src/schema/`).

---

## 4. Integration Points

### 4.1 Integration Surface Map

```
                    ┌──────────────────────────────────────────┐
                    │           VOYONDER BACKEND               │
                    │                                          │
┌──────────┐       │ ┌──────────┐  ┌──────────┐  ┌─────────┐  │       ┌────────────────┐
│  MAPS    │◀──────│─│ Map Tile │  │ Research │  │ Booking │  │──────▶│  AFFILIATE     │
│  API     │       │ │ Service  │  │ Pipeline │  │ Scout   │  │       │  PARTNERS      │
│  (Mapbox)│       │ └──────────┘  └────┬─────┘  └────┬────┘  │       │                │
└──────────┘       │                    │              │       │       │ - Skyscanner   │
                    │                    │              │       │       │   (flights)    │
┌──────────┐       │                    ▼              ▼       │       │ - Booking.com  │
│ WEATHER  │◀──────│─ ┌────────────────────────────────────┐   │       │   (hotels)     │
│  API     │       │ │         LLM / AI LAYER              │   │       │ - GetYourGuide │
│  (Open   │       │ │  ┌────────┐ ┌────────┐ ┌────────┐  │   │       │   (activities) │
│  Weather)│       │ │  │Frontier│ │Research│ │Cache-  │  │   │       │ - Viator       │
└──────────┘       │ │  │Chat    │ │Enrich- │ │First   │  │   │       │   (activities) │
                    │ │  │(Atlas) │ │ment    │ │Discovery│  │   │       └────────────────┘
┌──────────┐       │ │  │        │ │(Lyra)  │ │Framework│  │   │
│ FLIGHTS  │◀──────│─│  └────────┘ └────────┘ └────────┘  │   │
│  API     │       │ └────────────────────────────────────┘   │
│  (affil) │       └──────────────────────────────────────────┘
└──────────┘
                    ┌──────────────────────────────────────────┐
┌──────────┐        │         EXTERNAL SERVICES                │
│ HOTELS   │◀───────│──────────────────────────────────────────┘
│  API     │        │
│  (affil) │        │ Stripe ──── Billing + subscription management
└──────────┘        │ SendGrid ── Email delivery (PDF export, nurturing)
                    │ Resend ──── Alternative email provider
                    │ PostHog ─── Analytics (signup→trial→paid funnel)
                    │ Redis ───── SSE pub/sub + rate limiting
                    └────────────────────────────────────────────
```

### 4.2 Integration Tier Classification

| Integration | Tier | Auth Model | Fallback if Unavailable | Data Freshness |
|-------------|------|------------|------------------------|----------------|
| **Mapbox** (maps) | Required | API key | Dark map/location display only | Real-time |
| **OpenWeather/WeatherAPI** | Required | API key | Historical averages fallback | Cache 2h |
| **Skyscanner** (flights) | Optional (paid tier) | Affiliate API key | LLM-generated price estimates + booking.com affiliate link | Cache 6h |
| **Booking.com / Expedia** (hotels) | Optional (paid tier) | Affiliate API key | LLM-generated hotel suggestions + direct search link | Cache 6h |
| **GetYourGuide** (activities) | Optional (enrichment) | API key | Research agent generates curated activity suggestions from web data | Cache 24h |
| **Viator** (activities) | Optional (enrichment) | API key | Same as GYG fallback | Cache 24h |
| **LLM provider** (OpenAI/Anthropic) | Required | API key + usage metering | Cached destination knowledge + curated fallback activities | Per-request |
| **Stripe** (billing) | Required | Secret key | Trial-only mode (no payment processing) | Real-time |
| **Email (SendGrid/Resend)** | Required for export | API key | Console log + download-only delivery | Real-time |
| **PostHog** (analytics) | Required | API key | No analytics (blind) | Real-time |

### 4.3 Integration Architecture Principles

1. **Every integration has a non-LLM fallback.** If an API is down or returns no results, the system degrades gracefully: curated fallback activities, LLM-generated price estimates, historical weather data. No broken UX states.

2. **Cache-first with background refresh.** The existing `lib/discovery/` pattern is the canonical approach: serve cached data immediately, run a full research pipeline in the background, push updates via SSE. This ensures the user sees *something* immediately.

3. **Affiliate links are monetization, not the product.** Affiliate revenue from booking partners is a secondary revenue stream. The primary value is the itinerary — not whether the user books through our link. Affiliate integrations are optional and enriched, not required.

4. **All external API calls are metered.** Each LLM call and API request is tracked against the user's plan tier (seats, agent_runs, storage_gb) via the existing billing metering pipeline in `server/src/services/billing.ts`.

---

## 5. Export Formats

### 5.1 Export Matrix

| Format | Use Case | Content | Delivery Method | Paywall? |
|--------|----------|---------|-----------------|----------|
| **PDF** | Full itinerary document / print-out | Day-by-day schedule with activities, transport, maps, notes, local tips | Email + download link | **YES** — paid tier only |
| **ICS** | Calendar sync (Apple, Google, Outlook) | Each day's activities as calendar events with location + notes | Download file | **YES** — paid tier only |
| **Web share link** | Share with travel companions | Read-only web version of itinerary | URL (SMS/email/social) | **YES** — paid tier only |

### 5.2 PDF Content Specification

An exported PDF contains:

1. **Cover page** — Trip name, dates, destinations, traveler names, "Planned by Voyonder AI"
2. **Day-by-day itinerary** — Each day with:
   - Morning / afternoon / evening activity blocks
   - Activity name, description, estimated price, location
   - Transport segments between activities
   - Weather forecast note
   - Local tip from Concierge agent
3. **Summary page** — total estimated budget breakdown by category (flights, hotels, activities, food, transport)
4. **Packing checklist** — AI-generated based on destination climate and activities
5. **Map** — Static map with pinned locations (Mapbox static image API)
6. **Important information** — Visa requirements, emergency numbers, timezone, currency, local customs

### 5.3 Implementation Notes

- PDF generation runs as a **background job** (ref: existing M2 async job pattern in `lib/export/`)
- ICS generation follows the iCalendar RFC 5545 spec
- Both exports persist to `trip_exports` table for audit and re-download
- Delivery via email attachment (SendGrid/Resend) or direct download URL (signed S3/workdir link)
- Background job status visible in `BackgroundProcessTray` (already built in M2)

---

## 6. Conversion Funnel & Metrics

### 6.1 Trial-to-Paid Funnel

```
Signup ──▶ Onboard ──▶ First Trip ──▶ Refine ──▶ Export ──▶ Subscribe
 100%       80%          60%           40%        25%         15%
```

| Stage | Metric | Tracking | Conversion Levers |
|-------|--------|----------|-------------------|
| Signup | Trial created | PostHog event `signup_complete` | Google OAuth reduces friction; pricing page optimization |
| Onboarding completed | Role selected + dashboard viewed | PostHog event `onboarding_complete` | Role selection clarity; skip option |
| First trip created | Trip with status >= researching | PostHog event `trip_created` | Empty-state nurturing; "Plan my first trip" CTA prominence |
| Itinerary refined | Trip edited ≥2 times | PostHog event `trip_refined` | Conversation quality; refinement loop speed |
| Export triggered | PDF/ICS exported | PostHog event `trip_exported` | **PAYWALL GATE** — this is where we show pricing |
| Subscription created | Paid subscription active | Stripe webhook `checkout.session.completed` | Pricing clarity; export quality demonstrates value |

### 6.2 Conversion Prompt at Export

When a trial user clicks "Export", the system shows:

```
┌──────────────────────────────────────────┐
│  ✨ Your itinerary is ready to export!   │
│                                          │
│  You're on the Free Trial plan, which    │
│  includes unlimited trip planning.       │
│                                          │
│  Upgrade to export your itinerary as:    │
│  ┌────────────────────────────────────┐  │
│  │ 📄 PDF — Full itinerary with maps  │  │
│  │ 📅 Calendar — Export to Apple/     │  │
│  │    Google/Outlook Calendar         │  │
│  │ 🔗 Share link — Share with travel  │  │
│  │    companions                       │  │
│  └────────────────────────────────────┘  │
│                                          │
│  Plans start at $XX/mo.                  │
│                                          │
│  [  Upgrade to Export →  ]               │
│  [  Not now, keep planning  ]            │
└──────────────────────────────────────────┘
```

---

## 7. Phasing & Dependencies (M7 Sprint Planning Input)

### 7.1 M7 Candidate Sprint Items

| Phase | Item | Depends On | Estimated Size | Agent |
|-------|------|------------|----------------|-------|
| **P0** | Trip data model migration (trips, destinations, activities tables) | None | 3 days | FE |
| **P0** | Concierge chat endpoint (`POST /api/concierge/chat`) | Trip model | 5 days | FE |
| **P0** | Itinerary builder service + state machine | Trip model, Chat endpoint | 5 days | FE |
| **P0** | SSE streaming for research progress | Research pipeline | 3 days | FE |
| **P1** | Structured parameter sidebar | Concierge chat | 3 days | FE |
| **P1** | User preferences model + inference from chat | Trip model | 2 days | FE |
| **P1** | PDF export background job | Trip model | 3 days | FE (ref M2 pattern) |
| **P1** | ICS export background job | Trip model | 2 days | FE (ref M2 pattern) |
| **P1** | Export paywall gate | Export jobs | 2 days | FE |
| **P2** | Activity enrichment integration (GYG/Viator) | Research pipeline | 3 days | FE |
| **P2** | Flight/hotel affiliate integration | Research pipeline | 3 days | FE |
| **P2** | Weather integration | Research pipeline | 1 day | FE |
| **P2** | Map integration (Mapbox static images in PDF) | PDF export | 2 days | FE |
| **P3** | Trip sharing / collaboration | Trip model, Multi-user | 5 days | FE |
| **P3** | Empty-state nurturing (Support agent) | Notification service | 2 days | FE |

### 7.2 Estimated Timeline

| Milestone | Items | Duration | Target |
|-----------|-------|----------|--------|
| M7 Sprint 1 — Core trip engine | P0 items | 2 weeks | First week after M6 ships |
| M7 Sprint 2 — Export + conversion | P1 items | 1 week | Week 3 |
| M7 Sprint 3 — Integration enrichment | P2 items | 1 week | Week 4 |
| M7 Sprint 4 — Collaboration polish | P3 items | 1 week | Week 5 |

### 7.3 Key Dependencies on Prior Work

| Dependency | Consumed By | Status |
|------------|-------------|--------|
| M6 Signup flow (VOY-1978) | All trip planning | ✅ Done |
| M6 Onboarding flow (VOY-1979) | Trip creation entry point | ✅ Done |
| M6 Billing integration (VOY-1980) | Export paywall | In progress |
| M2 Async job pattern (PDF/ICS export) | Export formats | ✅ Shipped |
| M2 BackgroundProcessTray | Export progress UX | ✅ Shipped |
| M2 SSE streaming pattern | Research pipeline progress | ✅ Shipped |
| M2 Cache-first discovery framework (`lib/discovery/`) | Research pipeline | ✅ Shipped |
| PostHog analytics (VOY-1719) | Funnel metrics | Blocked on founder |

---

## 8. Open Questions for CEO/COO

1. **Export paywall position:** Should we gate ALL export formats behind the paywall, or allow one free export (e.g., ICS only) as a taste? Recommendation: gate all exports — the PDF/ICS is the "aha moment" that converts.

2. **Affiliate revenue model:** Should we prioritize booking affiliate links in Sprint P2, or defer entirely? Recommendation: include as optional enrichment, not a gating dependency — the product value is the itinerary, not the commission.

3. **LLM provider strategy:** Single provider (e.g., Claude 4 Sonnet) or multi-provider with routing? Recommendation: start with one frontier provider for the Concierge; the research agent can use a cheaper model (e.g., deepseek-v4); the cache-first framework already has provider-agnostic design.

4. **Free trial duration:** Current M6 trial has no defined expiry for trip planning. Recommend: 14-day free trial with full planning access, then downgrade to read-only itinerary access. Export gates immediately.

5. **Mobile strategy:** Is Horizon 1 web-only, or does it require a mobile app? Recommendation: web-only for M7, responsive design. Native app is Horizon 2+.

---

## Appendix A: Relationship to Existing Architecture

### A.1 What Already Exists

| Component | Code Location | Status |
|-----------|--------------|--------|
| Demo Travel Concierge page (Paperclip template) | `ui/src/pages/DemoTravelConcierge.tsx` | Conceptual demo — shows agent archetypes |
| Discovery framework (cache-first research) | `lib/discovery/` | ✅ Shipped (M2) |
| Background job system | `lib/async-jobs/` | ✅ Shipped (M2) |
| SSE streaming | `lib/sse/` | ✅ Shipped (M2) |
| PDF/ICS export base | `lib/export/` | ✅ Scoped (M2 backlog) |
| Billing/metering pipeline | `server/src/services/billing.ts` | ✅ Shipped (M6) |
| Auth + signup + JWT | `server/src/services/auth.ts` | ✅ Shipped (M6) |
| Onboarding wizard | `server/src/services/onboarding.ts` | ✅ Shipped (M6) |

### A.2 What Needs Building (M7)

| Component | New Code | Location |
|-----------|----------|----------|
| Concierge chat API | New service | `server/src/services/concierge.ts` |
| Trip data model | New schema + migrations | `packages/db/src/schema/trips.ts` |
| Itinerary builder service | New service | `server/src/services/itinerary.ts` |
| Parameter extraction + structured sidebar | New service + UI | `server/src/services/extraction.ts`, `ui/src/pages/PlanTrip.tsx` |
| Research pipeline integration (destination → activities → transport) | Wrap existing discovery framework | `server/src/services/trip-research.ts` |
| Export gate + paywall middleware | Extend billing service | `server/src/middleware/export-gate.ts` |
| Export background jobs (PDF/ICS) | Extend export service | `lib/export/pdf.ts`, `lib/export/ics.ts` |

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **Concierge Agent (Atlas)** | The primary AI agent the user interacts with; orchestrates sub-agents |
| **Research Agent (Lyra)** | Sub-agent that performs destination and activity research |
| **Logistics Agent (Sage)** | Sub-agent that handles weather, transport, and entry requirements |
| **Itinerary Builder** | Service that assembles day-by-day plans from research outputs |
| **SSE** | Server-Sent Events — used to stream research progress to the UI |
| **Cache-first discovery** | Architectural pattern: serve cached data immediately, refresh in background |
| **Export gate** | Paywall that blocks PDF/ICS export for trial users |
| **Horizon 1** | The "Help Me Plan" trip planning experience — the core product |
| **Horizon 2** | Future phases: mobile app, booking execution, real-time trip changes |
| **M7** | The seventh M-series sprint; first sprint implementing Horizon 1 |