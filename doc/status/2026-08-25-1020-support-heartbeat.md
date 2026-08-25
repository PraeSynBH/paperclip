# Support Engineer Status — Aug 25 ~10:20 UTC

## Diff Assessment: R1a Foundation (VOY-2172)

Three related commits landed on `fix/m-series-tech-debt`:

| Commit | Title | Lines | Impact |
|--------|-------|-------|--------|
| `24c8c5a455` | R1a-1: DB schemas + migration for research_artifacts, research_queries, trips | +328 | New data model — internal, no direct doc impact |
| `5f7a5120fc` | R1a-2: Entity resolver service (regex-based) | +693 | New service — internal, no direct doc impact |
| `144d790973` | R1a-3: Research artifact service + REST routes | +959 | **Documentation impact** — 12 new REST endpoints, 3 new domain entities with state machines |

### Documentation Impact Assessment (R1a-3)

**WHAT:** 12 new REST endpoints for research queries (3), research artifacts (4), and trips (5). Three domain entities with status state machines. Entity resolution runs synchronously on query submission. Background job enqueued for citation gathering.

**DOCUMENTATION REQUIRED:**
- [x] Support case assessment created — `docs/support/assessments/support-case-research-artifact-service.md`
- [ ] Release notes — pending feature completion (R1a foundation is incomplete — citation gatherer, web search, TripPage UI not yet built)
- [ ] API reference documentation — pending release
- [ ] docs/releases.md index entry — pending feature ship

**NOTE:** R1a is a partial implementation. R1a-1/2/3 are committed but R1a-4 (background job processors), R1a-5 (web search integration), and R1a-6 (TripPage UI) are not built. The citation gathering pipeline is incomplete — queries will submit and resolve entities but never complete citation gathering.

## Documentation Health Update

### New Addition
- **`docs/support/assessments/support-case-research-artifact-service.md`** — r1a-v1 — Support case assessment for the Research Artifact Service (R1a Foundation). Documents what's built (R1a-1/2/3), what's not (R1a-4/5/6), all 12 API endpoints, state machines, entity resolver capabilities and limitations, troubleshooting guidance, and escalation paths.

### Documentation Coverage Matrix (updated)

| Feature | Release Notes | Support Assessment | Status |
|---------|--------------|-------------------|--------|
| R1a Foundation (VOY-2172) — Research Artifact Service | Not yet — feature incomplete | ✅ `docs/support/assessments/support-case-research-artifact-service.md` | 🟡 Foundation committed, assessment created, pending completion |

## Active Pipeline

| Issue | Owner | What's Needed |
|-------|-------|---------------|
| VOY-2228 — Release: Fix billing bugs | Release Engineer (7a2a259f) | Deploy in progress — billing defects already documented in M6 support case |
| VOY-2214 — Deploy auth fix | Release Engineer (7a2a259f) | Blocked — CEO escalation (VOY-2245) resolved, awaiting deploy |
| R1a-4/5/6 (VOY-2172) | Not assigned | Citation gatherer, web search, TripPage UI not built |