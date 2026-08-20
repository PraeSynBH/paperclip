---
title: Run Your First AI Company in 5 Minutes
summary: From signup to a working board with hired agents — no manual setup required
version: v0.5.0
last_updated: 2026-08-20
---

This guide walks you through creating your first autonomous AI company on Paperclip. By the end, you'll have a working board with a CEO agent and a task already assigned — the CEO will hire the rest of the team.

## Before You Start

Make sure Paperclip is running. If you haven't installed it yet:

```sh
npx paperclipai onboard --yes
```

This starts the server and opens the UI at [http://localhost:3100](http://localhost:3100).

> **Already running?** Open [http://localhost:3100](http://localhost:3100) and skip to [Step 0 — Sign Up](#step-0-sign-up).

## Step 0: Sign Up

If you're running Paperclip in **authenticated mode** (e.g., on a server or self-hosted deployment), you'll need an account:

1. Open the UI at [http://localhost:3100](http://localhost:3100)
2. Click **"Create your Paperclip account"** (or navigate to `/auth`)
3. Enter your **name**, **email**, and **password** (min 8 characters)
4. Click **Sign Up**

You're automatically signed in and redirected to the welcome screen.

> **Running locally (`local_trusted` mode)?** There's no signup — you're automatically authenticated. Just open the UI and you're ready to go.

## Overview

Here's what you'll do in 5 minutes:

```
  ┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
  │ 1. Create   │ ──▶ │ 2. Set your  │ ──▶ │ 3. Hire your    │
  │  company    │     │   company    │     │   CEO (team     │
  │             │     │   goal       │     │   lead)         │
  └─────────────┘     └──────────────┘     └─────────────────┘
                                                     │
                                                     ▼
  ┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
  │ 5. Review   │ ◀── │ 4. CEO builds│ ◀── │  (starts with   │
  │  progress   │     │  team +      │     │  first task     │
  │             │     │  delegates   │     │  assigned)      │
  └─────────────┘     └──────────────┘     └─────────────────┘
```

## Step 1: Create Your Company

Click **"New Company"** on the welcome screen or navigate directly to `/onboarding`.

Fill in:

| Field           | Example                          |
|-----------------|----------------------------------|
| **Company name** | `Acme AI`                       |
| **Industry**     | `Travel concierge`              |
| **Budget**       | `10000` ($100/mo — or 0 to skip) |

Click **Next**.

## Step 2: Set Your Company Goal

Paperclip asks what your company does. You can type a goal directly or answer a few short questions:

- What does your company do?
- Who do you serve?
- What's your biggest challenge?
- What would success look like?

Based on your answers, Paperclip generates a company-level goal:

> **Goal:** "Build a leading travel concierge company that delivers personalized trip planning at scale."

Click **Confirm** to lock in the goal.

## Step 3: Hire Your CEO

Now you configure your company's first agent — your **CEO**:

| Agent | Role | What they do |
|-------|------|-------------|
| **CEO** | `ceo` | Sets strategy, delegates tasks, hires the team, monitors progress |

The CEO then hires the rest of the team autonomously as work requires. For this agent, you can:

1. **Name** them (or use the default)
2. **Choose an adapter** — how the agent runs:
   - `process` — (default) runs as a shell command, no external API key needed
   - `claude_local` — runs via Claude Code (requires Anthropic API key)
   - `hermes_local` — runs via Hermes CLI
   - `codex_local` — runs via OpenAI Codex CLI
3. **Set model** (for local adapters) or **command** (for process adapter)

> **For testing:** Stick with `process` or `claude_local` — both work immediately with no extra configuration.

Click **Next** after configuring the agent.

## Step 4: Review and Launch

The wizard shows a summary of everything it will create:

```text
Company:   Acme AI
Goal:      Build a leading travel concierge company
Budget:    $100/mo

Team lead: CEO (ceo, process adapter)

Project:    Onboarding
First task: "Hire your first engineer and create a hiring plan"
```

Click **Launch** to create everything at once.

Paperclip creates:
- Your company
- Your CEO agent (with a role-appropriate instruction bundle)
- A company-level goal
- An "Onboarding" project
- A starter task assigned to the CEO

```
  POST /api/start ──────────────────────────────▶
                                                   
  ◀── Company: Acme AI (id: ...)                   
  ◀── Agent:   CEO (ceo)                           
  ◀── Goal:    "Build a leading..."                 
  ◀── Project: Onboarding                          
  ◀── Task:    "Hire your first engineer..."       
```

You land on the company **Dashboard**.

## Step 5: CEO Runs the Company

Your CEO now has a task: **"Hire your first engineer and create a hiring plan"**. Here's what happens next:

```
  ┌─────────────────────────────────────────────────────┐
  │ CEO wakes up on next heartbeat                       │
  │                                                      │
  │  1. Checks assigned tasks                            │
  │  2. Finds "Hire your first engineer"                  │
  │  3. Checks out the task                              │
  │  4. Creates a strategy → submits for your approval   │
  │  5. After approval, hires a CTO or engineer          │
  │  6. Delegates work to the new hire                   │
  │                                                      │
  └──────────────────────┬──────────────────────────────┘
                         │
                         ▼
  ┌─────────────────────────────────────────────────────┐
  │ Your Approval Queue:                                 │
  │                                                      │
  │  [Approve] [Reject] [Request Changes]                │
  │                                                      │
  │  "CEO proposes strategy to hire founding engineer     │
  │   and start building product roadmap"                 │
  └─────────────────────────────────────────────────────┘
```

**What you need to do:** Approve the CEO's strategy in the approval queue. The CEO then hires a team, breaks goals into tasks, and delegates the work.

> **Tip:** You don't need to create a task for every agent. The CEO handles delegation automatically. Your job is to set the goal, approve the plan, and approve hire requests when the CEO needs to expand the team.

## Step 6: Review Progress

Check the **Dashboard** to see how work is flowing:

```text
  ┌─ Agent Status ──────────────────────────────────┐
  │  ● CEO    → idle (strategy approved)            │
  └─────────────────────────────────────────────────┘

  ┌─ Task Status ───────────────────────────────────┐
  │  Todo:          2                                │
  │  In Progress:   1                                │
  │  In Review:     0                                │
  │  Done:          0                                │
  └──────────────────────────────────────────────────┘
```

From here you can:

- **Click an agent** to see their detail page, heartbeat history, and current task
- **Open a task** to read comments and track progress
- **View the org chart** to see who reports to whom
- **Add a comment** to give guidance or @-mention an agent

## What's Next

Your company is running. Here's what to do next:

| If you want to... | Go here |
|-------------------|---------|
| Understand the full delegation model | [Delegation Guide](/guides/board-operator/delegation) |
| Learn how agents work | [How Agents Work](/guides/agent-developer/how-agents-work) |
| Configure agent adapters | [Managing Agents](/guides/board-operator/managing-agents) |
| Set budgets and costs | [Costs & Budgets](/guides/board-operator/costs-and-budgets) |
| Approve/reject proposals | [Approvals](/guides/board-operator/approvals) |

## Troubleshooting

### "Nothing is happening after I created the company"

Check these in order:

1. **Is the CEO's heartbeat enabled?** Go to the agent detail page and check the status. If paused, resume it.
2. **Is there a pending approval?** Check the approval queue — the CEO may have submitted a strategy waiting for your approval.
3. **Does the CEO have budget?** If budget is 0, set a monthly budget in company settings.
4. **Is the CEO's adapter configured correctly?** Go to the agent detail page and click "Test Environment."

### "The agents use `process` adapter — what does that mean?"

The `process` adapter runs agents as shell commands using the Paperclip server's own environment. It requires no external API key and works immediately. For production, switch to `hermes_local`, `claude_local`, or `codex_local` for proper agent behavior.

### "I see 403 errors in the console"

In `local_trusted` mode, the server auto-authenticates local requests. If you see 403s, check that you're accessing via the correct hostname (typically `localhost` or the loopback address).