# Paperclip Community — Discord Setup Guide

**Owner**: COO
**Date**: 2026-08-19
**Status**: Deliverable — ready for human execution
**Discord Server**: https://discord.gg/m4HZY7xNG3 (existing invite in docs.json)

---

## 1. Channel Structure

Create the following channels under appropriate categories:

### Category: #📥 Welcome

| Channel | Purpose |
|---------|---------|
| `#welcome` | Landing page with rules, roles, and getting-started guide |
| `#onboarding` | Step-by-step walkthrough for new members (pinned) |
| `#roles` | Self-serve role selection (opt-in for beta, feedback, etc.) |

### Category: #💬 General

| Channel | Purpose |
|---------|---------|
| `#general` | General discussion about Paperclip, AI agents, autonomous companies |
| `#showcase` | Members share what they've built with Paperclip — agent companies, workflows, integrations |
| `#feedback` | Structured feedback thread — bug reports, feature requests, UX improvements |
| `#support` | Q&A / help channel — community-driven with COO/CTO monitoring |

### Category: #🔬 Beta

| Channel | Purpose |
|---------|---------|
| `#beta-announcements` | Official announcements for beta testers — new features, breaking changes |
| `#beta-discussion` | Private (beta-role-gated) discussion for beta testers |
| `#beta-bugs` | Structured bug reporting channel with template |

### Category: #📚 Resources

| Channel | Purpose |
|---------|---------|
| `#docs` | Links to docs site, quickstart guide, API reference |
| `#templates` | Community-shared company templates and agent skills |
| `#tips` | Pro tips for agent setup, board management, cost optimization |

### Category: #🔧 Development

| Channel | Purpose |
|---------|---------|
| `#dev-announcements` | Release notes, changelog, maintenance windows |
| `#dev-chat` | Technical discussion for self-hosters and contributors |
| `#github` | GitHub activity feed (webhook) |

### Category: #🎮 Community

| Channel | Purpose |
|---------|---------|
| `#introductions` | New members introduce themselves and their use case |
| `#off-topic` | Non-Paperclip discussion |
| `#events` | Community calls, hackathons, office hours |

---

## 2. Role Structure

| Role | Color | Permissions | Criteria |
|------|-------|-------------|----------|
| `@everyone` | — | Read-only in most channels | Default |
| `Member` | Blue | Full read/write in all public channels | Verified email |
| `Beta Tester` | Green | Access to #beta-* channels | Invited by COO |
| `Contributor` | Purple | Access to #dev-* channels | PR merged or significant contribution |
| `Moderator` | Red | Manage messages, members, channels | Appointed by COO |
| `Admin` | Orange | Full server control | COO / Founder |

---

## 3. Welcome Message (Pinned in #welcome)

> # Welcome to the Paperclip Community! 🎉
>
> Paperclip is the **control plane for autonomous AI companies** — where you can hire, manage, and collaborate with AI agents to run real business operations.
>
> ## Getting Started
>
> 1. **Read the docs** → [docs.paperclip.so](https://docs.paperclip.so)
> 2. **Follow the quickstart** → Create your first AI company in 5 minutes
> 3. **Introduce yourself** in #introductions — tell us what you're building!
> 4. **Grab a role** in #roles to get access to beta features
>
> ## Community Guidelines
>
> - Be respectful and constructive
> - No spam, self-promotion, or solicitation
> - Keep support questions in #support
> - Report bugs with templates in #feedback
> - Share your work in #showcase
>
> ## Need Help?
>
> - 📖 [Documentation](https://docs.paperclip.so)
> - 🐛 [GitHub Issues](https://github.com/paperclip-ai/paperclip/issues)
> - 💬 Ask in #support
>
> **Welcome to the future of work!** 🚀

---

## 4. Beta Invite Copy

### Direct Message (Warm — Tier 1 Candidates)

> Hey {name}! 👋
>
> We're launching a private beta community for **Paperclip** — the platform that lets you run AI agent companies. Think of it as a control plane where AI workers handle real business operations under human supervision.
>
> Since you're connected to our founder's network, I'd love to invite you to be one of our **early beta testers**. You'd get:
> - 🎯 **Priority access** to new features before public launch
> - 🛠️ **Direct line** to the team for feedback and feature requests
> - 🤝 **Community** of builders exploring autonomous AI companies
> - 📈 **Use case consulting** — we'll help you set up your first AI company
>
> Here's the invite: https://discord.gg/m4HZY7xNG3
>
> When you join, grab the **Beta Tester** role in #roles and introduce yourself in #introductions.
>
> Would love to have you on board!
>
> — {COO name}, COO at Paperclip

### Email (Warm-ish — Tier 2 Candidates)

> **Subject**: Invitation: Paperclip Private Beta Community
>
> Hi {name},
>
> I'm reaching out as COO of Paperclip — we're building the control plane for autonomous AI companies, and I'd like to invite you to our private beta community.
>
> Paperclip lets you create, manage, and collaborate with AI agent teams that handle everything from travel booking (Voyonder) to bookkeeping (PraeSyn) to church operations (Northwest Church trial).
>
> **Why join the beta?**
> - Shape the product roadmap with direct feedback
> - Get hands-on setup support from our team
> - Network with other builders exploring AI agent autonomy
> - Early access to new agent types and features
>
> Join our Discord community: https://discord.gg/m4HZY7xNG3
>
> Once you're in, grab the Beta Tester role and let us know what you'd like to build!
>
> Best,
> {COO name}
> COO, Paperclip

---

## 5. Community Post Copy (Hacker News / AI Forums)

### Hacker News "Show HN" Draft

> **Show HN: Paperclip — The Control Plane for Autonomous AI Companies**
>
> Hey HN! We've been building Paperclip, an open-source platform where you can create, hire, and manage AI agent companies.
>
> Think of it as a **board of directors dashboard** for AI workers. You create a company (e.g., "Voyonder Travel"), hire agents (CEO, COO, Travel Agent, QA), and they autonomously work through tasks — with human review at key gates.
>
> **What it does:**
> - Create AI agent companies with org structures and role assignments
> - Agents work through issues via a heartbeat protocol, using tools like web search, file system, and code execution
> - Human-in-the-loop review gates for approvals, spending, and sensitive decisions
> - Memory and knowledge base that persists across agent runs
> - Self-hosted (Docker) — your data never leaves your infra
>
> **Real use cases running today:**
> - 🏕️ Trail Life USA troop committee (10-agent company managing a youth troop)
> - ✈️ Voyonder Travel (AI travel agency with CEO/COO/Travel Agent)
> - 📚 PraeSyn Bookkeeping (AI CPA handling monthly close and tax prep)
>
> **Stack:** TypeScript, Node.js, PostgreSQL, Drizzle ORM, React (board UI)
>
> **Repo:** https://github.com/paperclip-ai/paperclip
> **Docs:** https://docs.paperclip.so
> **Discord:** https://discord.gg/m4HZY7xNG3
>
> Would love feedback — especially from folks building in the AI agent space!

### AI Agent Forum / Subreddit Post

> We've been building an open-source platform for creating autonomous AI companies. Paperclip lets you create a company org chart, hire AI agents into roles (CEO, COO, Engineer, etc.), and they autonomously work through business tasks with human review gates.
>
> Key design decisions:
> - **Heartbeat protocol**: agents work in bounded execution runs, posting progress to issues
> - **Human-in-the-loop**: review gates on plan approvals, spending, sensitive actions
> - **Self-hosted**: Docker, PostgreSQL, no external dependencies
> - **Workspace isolation**: each agent runs in its own sandboxed workspace
>
> We've been running it for real use cases — travel agency, bookkeeping, church operations.
>
> Repo: https://github.com/paperclip-ai/paperclip
> Discord: https://discord.gg/m4HZY7xNG3
>
> Would love to hear what the community thinks!

---

## 6. Moderation Guidelines

### Code of Conduct

1. **Be respectful.** Disagreement is fine; personal attacks are not.
2. **Stay on topic.** Keep Paperclip-related discussion in the relevant channels.
3. **No spam.** Unsolicited DMs, self-promotion, or referral links are not permitted.
4. **No soliciting.** Don't pitch your product or service unless asked.
5. **Keep it legal.** No piracy, no sharing of credentials, no violating ToS.
6. **Respect privacy.** Don't share others' personal information.
7. **Use threads.** Long conversations should use threads to keep channels readable.

### Moderation Actions

| Infraction | Action |
|------------|--------|
| Minor (off-topic, minor spam) | Verbal warning (DM) |
| Moderate (repeated off-topic, self-promotion) | 24-hour mute |
| Major (harassment, illegal content, ToS violation) | Immediate ban |
| Spam/bot accounts | Instant ban + report |

### Moderation Team

- Primary: COO (moderator)
- Secondary: Founder/Ben (admin)
- Community-appointed moderators as community grows

---

## 7. Implementation Checklist

- [ ] **Step 1**: Create channels per Section 1 structure
- [ ] **Step 2**: Configure roles per Section 2
- [ ] **Step 3**: Pin welcome message in #welcome (Section 3)
- [ ] **Step 4**: Set up #feedback with structured bug-report template
- [ ] **Step 5**: Set up GitHub webhook in #github
- [ ] **Step 6**: Invite beta customers (Tier 1 first, then Tier 2, then Tier 3)
- [ ] **Step 7**: Post community announcement (Section 5 — HN / AI forums)
- [ ] **Step 8**: Post moderation guidelines in #welcome
- [ ] **Step 9**: Verify all links work (docs.paperclip.so, GitHub, invite)
- [ ] **Step 10**: Launch announcement in #announcements

---

## 8. Timeline

| Phase | Target | Owner |
|-------|--------|-------|
| Channel + role setup | Aug 20 | Ben (human) |
| Welcome guide + pinned content | Aug 20 | COO (done) |
| Beta customer invites (Tier 1) | Aug 21-23 | Ben (human) |
| Community launch post (HN) | Aug 23 | Ben / COO |
| Beta customer invites (Tier 2-3) | Aug 24-28 | Ben (human) |
| 20 members milestone | Sep 2 | Community growth |