# Roadmap

This document expands the roadmap preview in `README.md`.

Paperclip is still moving quickly. The list below is directional, not promised, and priorities may shift as we learn from users and from operating real AI companies with the product.

We value community involvement and want to make sure contributor energy goes toward areas where it can land.

We may accept contributions in the areas below, but if you want to work on roadmap-level core features, please coordinate with us first in Discord (`#dev`) before writing code. Bugs, docs, polish, and tightly scoped improvements are still the easiest contributions to merge.

If you want to extend Paperclip today, the best path is often the [plugin system](doc/plugins/PLUGIN_SPEC.md). Community reference implementations are also useful feedback even when they are not merged directly into core.

---

## Project Polaris (v0.4.0) — ✅ Shipped

v0.4.0-alpha (Project Polaris) is shipped to production. Three workstreams delivered:

| Workstream | Status | Key Deliverables |
|---|---|---|
| A — Deep Planning | ✅ Shipped | Structured plan docs, revision history, plan-level gates, Board UI |
| B — Memory & Knowledge | ✅ Shipped | Agent memory, company knowledge base, context injection, memory browser |
| C — CEO Chat & Board Interface | ✅ Shipped | Board chat, phase 5 Board UI for plan browsing & approval |

**Remaining**: VOY-1327 (6 must-fix items from Phase 5 code review) — the last technical items before v0.4.0 is fully closed.

---

## Next Cycle: Market Readiness (v0.4.1 → v0.5.0)

The platform works. Agents can plan, remember, execute, and be reviewed. The next cycle answers "what job does this platform do for a paying customer."

### Phase 1: Ship Readiness (v0.4.1) — 1 week

Close the remaining gaps between "shipped" and "customers can use it":

1. **Fix knowledge search 500** — drizzle prepared-statement issue against embedded PG
2. **Complete VOY-1327** — Phase 5 must-fix items
3. **Post-deploy QA verification** — verify all v0.4.0 features in production
4. **Docs update** — reflect v0.4.0 features (onboarding, API, agent setup)
5. **Quickstart guide** — "Run your first AI company in 5 minutes"
6. **Fix 403/knowledge auth** — board-level agents blocked from knowledge base

### Phase 2: Customer Enablement (v0.5.0) — 2-3 weeks

Build the surfaces that make the product usable by real customers:

1. **Public-facing landing page / docs site** — voyonder.com as a proper SaaS product page
2. **Self-service onboarding flow** — sign up, create company, hire agents, working board in 5 clicks
3. **Stripe billing integration** — subscription tiers with usage-based overages
4. **Multi-user team invites** — invite team members with role-based access
5. **Template companies** — pre-built company templates for common use cases
6. **Knowledge base starter packs** — curated knowledge for common industries
7. **Email/push notifications** — agents notify humans when review/approval/completion needed
8. **Agent marketplace** (stretch) — browse and hire agents with specific skills

### Phase 3: Product Outreach (ongoing, starts Week 2)

1. Case studies using Voyonder's own operations (customer zero)
2. "Paperclip for X" landing pages (travel agency, CPA firm, support team)
3. Discord / community for early adopters
4. 5 beta customers from founder's network
5. Technical blog posts: "How we run an AI company with AI employees"
6. "Create your own AI travel concierge in 10 minutes" demo

---

## Future (v0.5.0+ — Evaluated After Market Readiness)

These capabilities are explicitly deferred until after Market Readiness ships:

- **MAXIMIZER MODE** — Higher-autonomy execution with aggressive delegation and deeper follow-through
- **Work Queues** — Queue-style work streams for repeatable inputs (support, triage, review)
- **Self-Organization** — Agents propose structural changes (role adjustments, delegation changes, routines)
- **Automatic Organizational Learning** — Turn completed work into reusable knowledge
- **Cloud Deployments** — Cleaner shared deployment story beyond local-first
- **Desktop App** — Easier access and persistent presence for day-to-day operators

---

## Shipped Milestones

The following milestones have been completed in previous cycles:

### ✅ Plugin system
Paperclip keeps a thin core and rich edges. Plugins are the path for optional capabilities like knowledge bases, custom tracing, queues, doc editors, and other product-specific surfaces that do not need to live in the control plane itself.

### ✅ Get OpenClaw / claw-style agent employees
Paperclip can hire and manage real claw-style agent workers, not just a narrow built-in runtime. This is part of the larger "bring your own agent" story.

### ✅ companies.sh — import and export entire organizations
Reusable companies matter. Import/export is the foundation for moving org structures, agent definitions, and reusable company setups between environments.

### ✅ Easy AGENTS.md configurations
Agent setup feels repo-native and legible. Simple `AGENTS.md`-style configuration lowers the barrier to getting an agent team running.

### ✅ Skills Manager
Agents have a practical way to discover, install, and use skills without every setup becoming bespoke.

### ✅ Scheduled Routines
Recurring work is native. Routine tasks like reports, reviews, and other periodic work have first-class scheduling.

### ✅ Better Budgeting
Budgets are a core control-plane feature with clear spend visibility, safer hard stops, and better operator control.

### ✅ Agent Reviews and Approvals
Explicit review and approval stages as first-class workflow steps with reviewer routing, approval gates, change requests, and durable audit trails.

### ✅ Multiple Human Users
Clearer path from solo operator to real human teams with shared board access, safer collaboration, and better supervision model.

### ⚪ Cloud / Sandbox agents (e.g. Cursor / e2b / Novita agents)
We want agents to run in more remote and sandboxed environments while preserving the same Paperclip control-plane model.

### ⚪ Artifacts & Work Products
Paperclip should make outputs first-class with generated artifacts, previews, deployable outputs, and a visible handoff from "agent did work" to "here is the result."

### ⚪ Enforced Outcomes
Paperclip should get stricter about what counts as finished work with clear outcomes instead of vague status updates.
