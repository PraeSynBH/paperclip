# Discord Community Plan — Early Adopters

**Owner:** COO (PRA-921)
**Status:** Ready but blocked on human Discord Admin. Welcome message and moderation guidelines fixed from Voyonder → Paperclip branding (2026-08-19). Execution gated on Ben (Discord channel setup) + CEO (beta contact info).
**Server:** Paperclip Community — discord.gg/m4HZY7xNG3
**Guild ID:** 1478750559191302299
**Members:** ~8,582 (verified via Discord API, 2026-08-19)
**Online:** ~1,267 (at time of check)
**Date:** August 2026

---

## Goal

Build an active community of early adopters who use Paperclip, share feedback, showcase builds, and help shape the product direction. Target: 20+ members within 2 weeks of launch.

---

## Server Structure

### Category: Welcome

| Channel | Purpose |
|---------|---------|
| #welcome | New member landing — rules, roles, intro prompts |
| #announcements | Product updates, release notes, downtime notices |
| #onboarding | Step-by-step guide to setting up a first Paperclip company |

### Category: Community

| Channel | Purpose |
|---------|---------|
| #general | Open discussion, questions, brainstorming |
| #showcase | Members share their AI agent companies and use cases |
| #feedback | Structured feedback threads — what works, what doesn't |
| #support | Troubleshooting, setup help, FAQ |

### Category: Product

| Channel | Purpose |
|---------|---------|
| #feature-requests | Upvoted feature ideas (linked to GitHub issues) |
| #roadmap | Planned releases, in-progress work, beta features |
| #changelog | Automated release note feed from GitHub |

### Category: Community Projects

| Channel | Purpose |
|---------|---------|
| #template-sharing | Share agent templates, company configs, skill packs |
| #integrations | Connect Paperclip with external tools (Slack, email, APIs) |
| #agent-showcase | Spotlight specific agent configurations and workflows |

### Category: Voice (Stage)

| Channel | Purpose |
|---------|---------|
| 🎙️ Town Hall | Monthly community calls — product updates + Q&A |
| 🎙️ Office Hours | Weekly drop-in support with the founding team |

---

## Role Structure

| Role | Permissions | Criteria |
|------|------------|----------|
| **@Admin** | Full server management | Founding team |
| **@Moderator** | Message management, member moderation | Trusted community members |
| **@Beta Tester** | Access to beta channels, early features | Signed up for beta program |
| **@Contributor** | Priority feedback channel access | Contributed code, docs, or templates |
| **@Member** | General access | Joined server |
| **@Guest** | Read-only (welcome + announcements) | Not yet verified |

---

## Moderation Guidelines

1. **Be constructive** — Critique ideas, not people. This is a community for builders.
2. **No self-promotion** — Share your Paperclip builds in #showcase; no unrelated spam.
3. **No NDA violations** — We want an open community; don't share confidential access or credentials.
4. **Tag responsibly** — Use @mentions sparingly. Direct questions to appropriate channels.
5. **Report issues** — Tag an @Moderator or use /report for anything that needs attention.

---

## Onboarding Flow

### New Member Journey

1. **Arrives via invite link** — lands in #welcome
2. **Reads pinned rules** — automated message explains server purpose and etiquette
3. **Chooses role** — /role select command offers Member, Beta Tester, or Guest
4. **Gets oriented** — pinned message in #onboarding with links to:
   - Quickstart guide (run first AI company in 5 minutes)
   - Documentation site
   - GitHub repository
   - Beta signup form
5. **Introduces themselves** — encouraged to post in #general with their use case

### First Interaction Prompts

Automated prompts (via Discord bot or pinned posts):

- **In #showcase**: "What are you building with Paperclip? Share your company board or agent setup!"
- **In #feedback**: "Try the quickstart guide and let us know: where did you get stuck?"
- **In #support**: "Before posting, check our FAQ and known issues at docs.voyonder.com"

---

## Pre-Launch Checklist

- [x] Create Discord server (server live: discord.gg/m4HZY7xNG3 — verified 8,582 members via API)
- [x] Confirm server identity — named "Paperclip" (Guild ID: 1478750559191302299)
- [ ] Set up server structure (categories and channels per discord-channel-config.md) — **human Discord admin required**
- [ ] Create invite link set to never-expire (existing link works, verify it's permanent)
- [ ] Set up moderation roles and permissions (per discord-channel-config.md Role Configuration) — **human Discord admin required**
- [x] Draft welcome message and moderation guidelines (discord-welcome-message.md, discord-moderation-guidelines.md — corrected to Paperclip brand 2026-08-19)
- [ ] Pin welcome message and rules in #welcome
- [ ] Configure GitHub → #changelog webhook (steps documented in discord-channel-config.md)
- [ ] Set up onboarding bot (Carl-bot recommended — config guide in discord-channel-config.md)
- [ ] Test invite flow with a test account
- [ ] Invite initial beta customers (from beta-customer-candidates.md — **contact info TBD from CEO**)
- [x] Create beta email templates (beta-email-templates.md — ready to send)
- [x] Draft community launch posts (community-launch-posts.md — ready to publish)
- [ ] Seed #showcase with case studies (drafts exist: doc/outreach/case-study-*.md)
- [ ] Post launch announcement in relevant communities (gated on beta cohort live)

---

## Launch Sequence

| Day | Action | Owner |
|-----|--------|-------|
| Pre | Create server, configure channels, test onboarding | COO (human) |
| Day 1 | Invite first 5 beta customers (from CEO network) | CEO |
| Day 1-3 | Seed discussions: post case studies, share screenshots | COO |
| Day 3 | Post on Hacker News "Show HN: AI employees for your startup" | CEO |
| Day 5 | Post on r/AIagents, r/SaaS, r/startups | CMO |
| Day 7 | First town hall call — product roadmap + live demo | CEO + CTO |
| Day 14 | Assess growth — if <20 members, activate referral program | COO |

---

## Growth Targets

| Milestone | Timeline | Trigger |
|-----------|----------|---------|
| 20 members | 2 weeks | Initial beta cohort + HN post |
| 50 members | 1 month | Community referrals + organic discovery |
| 100 members | 2 months | Public launch + content marketing |
| 500 members | 6 months | Sustained organic growth + partnerships |

---

## Ready-to-Create Resources

When the server is created, the following items are ready to post:

1. **Welcome message** (draft in doc/outreach/discord-welcome-message.md) ✅
2. **Rules embed** (derived from moderation guidelines — standalone draft in doc/outreach/discord-moderation-guidelines.md) ✅
3. **Getting started guide** (link to docs quickstart)
4. **Case study posts** (from PRA-920 deliverables) to seed #showcase ✅
5. **Beta program info** (from CEO's beta outreach plan)
6. **Community launch posts** (drafts in doc/outreach/community-launch-posts.md) ✅