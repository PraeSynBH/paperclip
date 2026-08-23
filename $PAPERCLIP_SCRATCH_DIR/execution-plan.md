# VOY-1673 — Customer Acquisition & Revenue: Execution Plan

**Author:** COO Agent  
**Date:** 2026-08-22  
**Status:** Assessment Complete — Backlog Ready

---

## 1. Current Acquisition Capabilities Assessment

### 1.1 Active Channels

| Channel | Status | Details |
|---------|--------|---------|
| **Discord** | Server exists, NOT configured | discord.gg/m4HZY7xNG3 — 8,600+ members from prior verification, but channels never set up (human-gated Discord admin action) |
| **Direct Outreach** | Not active | All email templates drafted (warm outreach, demo invite, kickoff, nurture, feedback request). Demo script ready. No prospect names from founder — pipeline stalled |
| **SEO** | Not configured | No sitemap.xml, robots.txt, meta descriptions, or keyword targeting found in codebase |
| **Content Marketing** | Not started | 3 case studies drafted (Trail Life, Voyonder ops, Voyonder travel). Launch posts drafted (HN, Reddit). None published |
| **Referrals** | Not built | No referral mechanics exist in codebase |
| **Paid Ads** | Not started | No ad infrastructure |
| **Community** | Partially ready | Launch posts drafted for HN, r/AIagents, r/SaaS, Indie Hackers. All gated on Discord setup + beta cohort |

### 1.2 Analytics & Tracking

| Capability | Status | Details |
|------------|--------|---------|
| **PostHog** | Configured & Live | Business events: auth.signup_completed, auth.session_started, approval.approved, approval.rejected, notification.digest.sent. Per-company error tracking via cron poll (15min) |
| **PostHog Dashboards** | Not configured | Blocked on founder providing POSTHOG_API_KEY + POSTHOG_PROJECT_ID (VOY-387.5) |
| **Conversion Funnels** | Not configured | Need PostHog dashboards first |
| **Paperclip Telemetry** | Live | Internal telemetry system, not customer-facing |
| **A/B Testing** | Not configured | No experimentation framework |

### 1.3 Conversion Infrastructure

| Capability | Status | Details |
|------------|--------|---------|
| **Stripe Billing** | Fully integrated | Checkout sessions, subscription tiers, webhooks, invoice management, usage tracking |
| **Pricing Page** | Functional | React component with tier cards, subscription management, Stripe Checkout redirect |
| **Feature Gating** | Infrastructure exists | FEATURE_KEYS system with tier-based access control |
| **Onboarding Flow** | Live | Self-service onboarding with seed data (goal, agent, first task) |
| **Auth** | Live | Google OAuth + email signup, both verified |
| **Case Studies** | Drafted, not deployed | 3 case studies drafted, /case-studies/ likely 404 |

### 1.4 Key Gaps Summary

1. No active customer-facing acquisition channel — Discord server exists but unused, no SEO, no ads, no outreach happening
2. PostHog dashboards unfunded — Can't measure conversion without founder-provided API keys
3. Case studies not published — Social proof exists in draft form but not on site
4. No referral or viral mechanics — Word-of-mouth not instrumented
5. Founder gate on outreach — Prospect names needed to start beta pipeline
6. Discord channels human-gated — Need Discord admin to set up channel structure

---

## 2. Fastest Path to First Paid Subscriber

### Tier 1: Zero-Code Wins (No Engineering — COO + Founder Execution)

| # | Action | Expected Timeline | Channel | Difficulty |
|---|--------|-------------------|---------|------------|
| 1 | Founder sends 5 warm outreach emails using drafted templates | Week 1 | Direct | Low (human gate) |
| 2 | Deploy case studies to voyonder.com (P0 publish of drafted content) | Week 1-2 | Content/Social Proof | Medium (Fix /case-studies/) |
| 3 | Publish HN Show HN post (drafted) | Week 2 | Organic/Community | Low (human gate) |
| 4 | Publish Reddit posts (drafted) | Week 2 | Organic/Community | Low (human gate) |
| 5 | Configure Discord channels + post welcome message | Week 1-2 | Community | Low (human gate) |

### Tier 2: Engineering-Enabled Growth (Founding Engineer)

| # | Action | Expected Timeline | Effort | Owner |
|---|--------|-------------------|--------|-------|
| 6 | Fix /case-studies/ route — publish drafted case studies | Week 1-2 | Small | FE |
| 7 | Add SEO basics — sitemap, meta tags, robots.txt | Week 2 | Small | FE |
| 8 | Add Discord link to voyonder.com footer | Week 1 | Tiny | FE |
| 9 | Configure PostHog signup->activation funnel (if API keys available) | Week 2 | Medium | FE/CTO |
| 10 | Add conversion tracking events to pricing/subscribe flow | Week 2-3 | Small | FE |

### Tier 3: Product-Led Growth (Requires Product Work)

| # | Action | Expected Timeline | Effort | Owner |
|---|--------|-------------------|--------|-------|
| 11 | Add "Share Voyonder" referral CTA after trip planning | Week 3-4 | Medium | FE |
| 12 | A/B test pricing page CTA placement | Week 3-4 | Small | FE |
| 13 | Add social proof section on landing (testimonials, logos) | Week 3-4 | Small | FE |
| 14 | Implement email nurture sequence (Brevo/Mailchimp) | Week 3-5 | Medium | FE/COO |

---

## 3. Prioritized Execution Backlog

Ordered by impact-to-effort ratio:

### P0: Ship (This Week)

| ID | Task | Owner | Depends On | Impact |
|----|------|-------|------------|--------|
| VOY-1673-A | Founder sends 5 warm outreach emails | Founder (Ben) | None | Direct path to first paid sub |
| VOY-1673-B | Fix /case-studies/ route + publish 3 drafted case studies | Founding Engineer | None | Social proof for site visitors |
| VOY-1673-C | Add Discord link to voyonder.com footer | Founding Engineer | None | Traffic to community |

### P1: Launch (Next Week)

| ID | Task | Owner | Depends On | Impact |
|----|------|-------|------------|--------|
| VOY-1673-D | Configure Discord channels + post welcome + rules | COO/human | Human Discord admin | Activates 8,600+ member server |
| VOY-1673-E | Publish HN Show HN post + Reddit posts | Founder/COO | Discord setup | Organic traffic from tech community |
| VOY-1673-F | Add SEO metadata (sitemap, meta tags, robots.txt) | Founding Engineer | None | Organic discovery long-term |

### P2: Measure (Week 2-3)

| ID | Task | Owner | Depends On | Impact |
|----|------|-------|------------|--------|
| VOY-1673-G | Set up PostHog dashboards + conversion funnels | CTO/FE | Founder: PostHog API keys | Measurement infrastructure |
| VOY-1673-H | Add conversion tracking to pricing/subscribe flow | Founding Engineer | PostHog keys | Funnel visibility |
| VOY-1673-I | Begin beta customer onboarding via email sequences | COO/Founder | Prospect names | Direct pipeline |

### P3: Grow (Week 3-5)

| ID | Task | Owner | Depends On | Impact |
|----|------|-------|------------|--------|
| VOY-1673-J | Implement referral/share mechanics | Founding Engineer | Product stability | Viral growth |
| VOY-1673-K | A/B test pricing page CTA | Founding Engineer | PostHog funnels | Conversion optimization |
| VOY-1673-L | Email nurture automation | COO/FE | Brevo/email provider | Lead nurturing |

---

## 4. Expected Timeline to First Paid Subscriber

```
Week 1:    Founder outreach to 5 prospects -> first demos
           Fix /case-studies/ -> social proof live
           Discord link in footer -> community traffic

Week 2:    Discord channels live -> community engagement
           HN/Reddit launch posts -> organic traffic wave
           Case studies published -> conversion lift

Week 3:    First beta conversations -> trials
           PostHog funnels live -> measurement
           Pricing CTA A/B test -> optimization

Week 4+:   First paid subscriber from organic/growth channel
           Referral loop -> compounding growth
```

**Best case:** First paid subscriber in 2-3 weeks (if founder sends warm outreach this week)
**Realistic case:** First paid subscriber in 4-6 weeks (organic traffic + community ramp)

---

## 5. Coordination Required

### Founding Engineer
- Fix /case-studies/ route and publish drafted content
- Add Discord link to footer (5-min change)
- SEO metadata (sitemap, meta tags)
- Conversion tracking on pricing/subscribe page

### CTO
- PostHog dashboard provisioning (once API keys available)
- Infrastructure assessment for growth (scaling, monitoring)

### Support Engineer
- Ensure docs cover new user acquisition flow
- Update quickstart guide for first-time Voyonder users
- Prepare support SOP for new subscriber issues

### COO (this run)
- Create child issues for each backlog item
- Assign owners and set priorities
- Coordinate with engineers on execution

### Founder (Ben) — Critical Gates
1. Send 5 warm outreach emails using drafted templates
2. Provide PostHog API keys
3. Configure Discord channels (or grant admin access)
4. Approve HN/Reddit launch posts

---

## 6. Key Metric Definition

**First paid subscriber from organic/growth channel (not founder-direct):**
- A new user who signs up on voyonder.com, starts a subscription via Stripe Checkout, and whose first interaction was NOT from a founder's direct email
- Tracks channel attribution (organic search, HN, Reddit, Discord, referral)
- Measured via PostHog auth.signup_completed + stripe subscription status
