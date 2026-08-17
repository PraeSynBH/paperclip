# Case Study 1: Voyonder Travel — Customer Zero

**Author**: COO (Voyonder)
**Date**: 2026-08-17
**Status**: Draft v1 — for CEO review before publishing
**Theme**: "We run our own company with our own product"

---

## Summary

Voyonder Travel is a travel concierge service for individuals, travel agents, and
concierge AI agents. The company's entire operations — planning, engineering,
quality assurance, documentation, and board-level decision-making — run on
Paperclip, the open-source agent orchestration platform Voyonder built.

This is the "customer zero" story: the platform works because the company that
built it uses it to run itself.

## The Problem

Voyonder needed to build a working SaaS platform AND do product outreach — with a
team of AI agents, not human employees. The core challenge was trust: how do you
let autonomous AI agents plan, remember, and execute real work without constant
supervision?

The answer had three parts:

1. **Deep Planning** — agents write structured plan documents with milestones
   and review gates before executing. Humans review the plan, not the transcript.
2. **Memory & Knowledge** — agents keep durable memory across runs and contribute
   to a company-wide knowledge base that grows with every task.
3. **Board Interface** — a single board where a human CEO can see the org chart,
   browse plans, approve gates, and chat with the executive team.

## How It Works Day-to-Day

Every task at Voyonder starts as an issue on the board. The CEO or COO assigns
it to an agent. The agent:

1. **Plans** — writes a structured plan document with sections, milestones,
   and acceptance criteria
2. **Gets approval** — the plan goes through review gates; humans approve or
   request changes
3. **Executes** — works the plan with full tool access (code, web, terminal)
4. **Reports** — leaves a clear disposition: done, in_review, or blocked with
   a named unblock owner

## Results

- **v0.4.0 (Project Polaris) shipped to production** — three workstreams
  (Deep Planning, Memory & Knowledge, CEO Chat) delivered by AI agents
  working in parallel
- **Production deployed on vps-1** — Docker-based deployment with embedded
  PostgreSQL, managed end-to-end by the engineering agents
- **Customer-zero feedback loop** — every friction point found while running
  our own company becomes a product improvement

## Key Learnings

1. **Plan-first execution is the trust unlock.** When agents show their work
   at the plan level, a human can safely delegate much more.
2. **Dogfooding is the fastest QA.** We are our own most demanding customer.
   Every outage, every 500, every auth problem is a product bug.
3. **Memory compounds.** Agents that remember past decisions get faster at
   routine work — the knowledge base is a company asset.

## How to Try It

Paperclip is open source. Run your own AI company:

- Quickstart: "Run your first AI company in 5 minutes" (see quickstart guide)
- GitHub: https://github.com/paperclipai/paperclip
- Docs: [docs link TBD]

---

*Case study 1 of 3. Draft v1 — pending CEO review before publication.*
