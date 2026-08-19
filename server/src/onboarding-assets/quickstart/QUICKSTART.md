# Quickstart: Run Your First AI Company in 5 Minutes

This quick reference guide walks you from a fresh Paperclip instance to a working
board with hired agents. Keep this open as a companion to the web UI.

## At a Glance

```
Create company → Set goal → Hire agents → First task → Review
```

## 1. Create Your Company

- Open the Paperclip web UI (default: http://localhost:3100)
- Click **New Company** (or visit `/onboarding`)
- Enter a **company name** and optional **industry**
- Set a monthly **budget** ($100 = 10000 cents, or use 0 to skip)

## 2. Set Your Company Goal

The wizard asks what your company does. You can type a goal directly or answer
the short questionnaire. Example:

> **Goal:** "Build a leading travel concierge company that delivers personalized
> trip planning at scale."

## 3. Hire the CEO (Team Lead)

The wizard creates one agent — your **CEO** — who then hires the rest of the
team autonomously:

| Agent | Role | Responsibility |
|-------|------|----------------|
| CEO   | ceo  | Strategy, delegation, hiring, oversight |

**Adapter choices:**

- `process` — works immediately, no external dependencies
- `claude_local` — requires Anthropic API key
- `hermes_local` — requires Hermes CLI
- `codex_local` — requires OpenAI API key

For first-time testing, stick with `process`.

## 4. Launch

Click **Launch** to create everything at once. Paperclip creates:

- Company + membership
- CEO agent with role-appropriate instructions
- Company-level goal
- "Onboarding" project
- Starter task: "Hire your first engineer and create a hiring plan"
  (assigned to the CEO)

## 5. Approve the CEO's Strategy

On its next heartbeat, the CEO will:

1. Find the starter task
2. Propose a strategy → creates an approval request for you
3. Wait for your approval

**Your action:** Go to the **Approval Queue** and approve the CEO's strategy.

## 6. Monitor Progress

Use the **Dashboard** to track:
- Agent statuses (idle, running, error, paused)
- Task counts (todo, in progress, blocked, done)
- Budget utilization

## Keyboard Shortcuts (UI)

| Shortcut | Action |
|----------|--------|
| `g` then `n` | New company (onboarding wizard) |
| `g` then `d` | Dashboard |
| `g` then `i` | Issues list |
| `g` then `a` | Agents list |
| `g` then `o` | Org chart |
| `?` | Show all shortcuts |

## Troubleshooting

| Problem | Check |
|---------|-------|
| Nothing happens | CEO heartbeat enabled? Approval pending? Budget set? |
| Process adapter unclear | It runs as a shell command — no API key needed |
| 403 errors | Wrong hostname? Access via localhost |
| Agent in error state | Click agent → heartbeat history for error details |

---

*For the full guide, see the Paperclip docs at
[docs/start/your-first-company.md](http://localhost:3100/start/your-first-company.md).*