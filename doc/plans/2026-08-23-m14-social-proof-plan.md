# M14: Social Proof — Implementation Plan

**Owner:** COO
**Parent:** VOY-1833 (CEO Board Pulse execution)
**Issue:** VOY-1879
**Date:** 2026-08-23

---

## Current State Assessment

### Existing Social Proof Assets ✅

| Asset | Status | Notes |
|-------|--------|-------|
| Case studies (4) | Published on docs site | Voyonder Travel, AI Agents Built Paperclip, Autonomous Agent Economy, Trail Life Troop |
| Case study index page | Published | `/case-studies/index` |
| FAQ/Knowledge Base (M12) | Partially done | FAQ page exists, knowledge base feature in product |
| GitHub repo | Public | Open source on github.com/paperclip-ai/paperclip |
| Discord community | Active | discord.gg/m4HZY7xNG3 |
| Beta user quote | Available | In case-study-voyonder-travel.md (`doc/outreach/`) |
| Marketing site optimization (VOY-1564/1568) | Done | Earlier social proof, nav, pricing CTAs |

### Gaps ❌

| Item | Priority | Effort | Notes |
|------|----------|--------|-------|
| Testimonials on landing/homepage | High | Small | Need to add inline quotes to key docs pages |
| Social proof badges ("Trusted by X") | High | Small | GitHub stars, company count |
| Case study snippets on homepage | High | Small | Add callout sections to landing page |
| Dedicated testimonials page | Medium | Medium | Curate quotes from beta users |
| Customer logos | Medium | Medium | Need customer permission |
| A/B test social proof placement | Low | Large | Requires experiment framework |
| Case study CTAs throughout docs | High | Small | Add "read the case study" callouts |
| Live usage counters | Medium | Medium | API-based counters for companies/agents/issues |

---

## Implementation Roadmap

### Phase 1: Content Additions (Now — This Heartbeat)
**Add social proof content to existing docs pages:**

1. **What is Paperclip page** (`docs/start/what-is-paperclip.md`)
   - Add testimonial quote callout from beta user
   - Add case study call-to-action section
   - Add GitHub stars badge

2. **Quickstart page** (`docs/start/quickstart.md`)
   - Add "Trusted by" section with case study links
   - Add inline testimonial

3. **Create a Testimonials page** (`docs/testimonials.md`)
   - Curate beta user quotes
   - Link from navigation

4. **Add case study callouts** to relevant guides
   - Board operator guides → link to case studies
   - Developer guides → link to AI Agents Built Paperclip case study

### Phase 2: Badges & Counters (Next Heartbeat)
**Add visual social proof elements:**

1. GitHub stars badge on docs site header/homepage
2. "Trusted by X companies" stat
3. "X+ agents deployed" counter
4. "X issues resolved" counter

### Phase 3: Testimonial Collection (Ongoing)
**Gather and curate customer testimonials:**

1. Reach out to beta users for quotes
2. Collect case study permission releases
3. Create testimonial snippets for reuse
4. Add to social proof rotation

### Phase 4: A/B Testing & Optimization (Later)
**Optimize social proof placement:**

1. Set up experiment framework
2. Test placement on pricing page
3. Test placement on sign-up flow
4. Measure conversion impact

---

## Immediate Actions (This Heartbeat)

1. ✅ Create VOY-1879 issue
2. ✅ Assess existing social proof assets
3. 📝 Add testimonial callouts to What is Paperclip page
4. 📝 Add case study snippets to key pages
5. 📝 Create testimonials page
6. 📝 Add GitHub stars badge reference
7. 📝 Create child issues for remaining phases
