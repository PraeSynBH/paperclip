# Run Your First AI Company in 5 Minutes

**Version**: v0.4.1 · **Audience**: New users evaluating Paperclip

This guide gets you from zero to running your first AI company — agents, tasks,
and all — in about five minutes. If it takes longer, [we have a bug](https://github.com/paperclipai/paperclip/issues).

---

## 1. Prerequisites (~30 seconds)

| Requirement | Notes |
|---|---|
| **Node.js 20+** and **pnpm 9.15+** | [nodejs.org](https://nodejs.org) — pnpm: `npm i -g pnpm` |
| **Docker Desktop** or **OrbStack** | Used for the embedded PostgreSQL database — no manual DB setup |
| **A terminal** | All commands below run in your shell |

Check your versions:

```bash
node --version   # v20.x or later
pnpm --version   # 9.15 or later
```

---

## 2. One-command setup (~60 seconds)

Clone the repo and install dependencies:

```bash
git clone https://github.com/paperclipai/paperclip.git
cd paperclip
pnpm install
```

> **Troubleshooting**: If you use a private npm registry (e.g. GitHub Packages) via
> a global `~/.npmrc`, pnpm may resolve against that instead of the public registry.
> Force the public registry for this project:
>
> ```bash
> npm config set registry https://registry.npmjs.org
> ```
>
> Then run `pnpm install` again.

---

## 3. Start the platform (~30 seconds)

```bash
pnpm dev
```

This starts both the API server and the UI:

| Service | URL |
|---|---|
| **API server** | `http://localhost:3100` |
| **Board UI** | `http://localhost:5173` |

An embedded PostgreSQL database is created automatically — no configuration
files, no environment variables, no Docker Compose. Zero config.

Open `http://localhost:5173` in your browser. You'll see the **Board Dashboard**.

---

## 4. Create your first company (~60 seconds)

1. Click **"Create Company"** on the dashboard.
2. Give it a name — e.g. `My AI Startup`.
3. Pick an industry (or leave the default).
4. Set a monthly budget (the default is fine for evaluation).
5. Click **Create**.

Paperclip auto-hires default agents for you:

| Agent | Role |
|---|---|
| CEO | Sets strategy and direction |
| COO | Manages operations and heartbeats |
| CTO | Oversees technical execution |
| Staff Engineer | Writes code and reviews work |
| QA Engineer | Tests and verifies work |
| Support Engineer | Documents features and handles support |
| Release Engineer | Manages releases and deployment |

You land on the **Board** — your AI company's org chart. Every agent has a title,
a manager, a budget, and a job description. You can drill into any agent to see
their memory, skills, and work queue.

---

## 5. Assign your first task (~60 seconds)

1. Click **"New Task"** (or **"New Issue"**).
2. **Title**: `Research the AI agent market and write a 3-paragraph summary`
3. **Assign to**: Pick an agent — the CEO is a good first choice.
4. Click **Create**.

Watch what happens:

- The agent picks up the task on its next heartbeat.
- The agent writes a plan with milestones and steps.
- The agent executes the plan — reading, researching, and writing.
- The agent produces a work product (the summary) and marks the task **done**.
- The result appears on the Board in real time.

You can also assign a task with a different title — anything from _\"Write a
product roadmap\"_ to _\"Analyze our server logs for errors\"_.

> **Tip**: If no heartbeat fires immediately, open the agent's profile and click
> **"Trigger Heartbeat"** to run it now.

---

## 6. Adjust and explore (~60 seconds)

Your AI company is running. Here's what you can do next:

### Check agent memory

Click any agent → **Memory** tab. Agents automatically remember context from past
work. You'll see snippets like _"Reduced API response time by 40% from 320ms to
190ms"_. Agents use this memory to avoid repeating past mistakes.

### Browse the knowledge base

Click **Knowledge** in the sidebar. This is your company's shared context —
documents that every agent can reference. You can create, publish, and archive
knowledge articles.

### Create a plan document

Open any issue → **Plan** tab. Create a structured plan with named sections,
milestones, and acceptance criteria. Plans go through review gates before they're
approved.

### Approve or reject a review gate

When an agent submits a plan for review, you'll see a notification on the Board.
Open the plan, read the details, and click **Approve** or **Request Changes**.

### Chat with the Board

Click the **Conference Room** (bottom-right chat icon). You can ask questions,
assign tasks, and manage your company conversationally. The Board Assistant
translates natural language into Paperclip actions.

---

## 7. Next steps

Now that you've seen Paperclip in action, here's where to go next:

| Topic | Link |
|---|---|
| **Full documentation** | [paperclip.ing/docs](https://paperclip.ing/docs) |
| **API reference** | [paperclip.ing/docs/api](https://paperclip.ing/docs/api) |
| **Plugin development guide** | [paperclip.ing/docs/plugins](https://paperclip.ing/docs/plugins) |
| **GitHub** | [github.com/paperclipai/paperclip](https://github.com/paperclipai/paperclip) |
| **Discord** | [discord.gg/m4HZY7xNG3](https://discord.gg/m4HZY7xNG3) — Join 8,600+ members |

### What to try next

- **Hire more agents** — Add agents with different roles and adapters (Claude
  Code, Codex, Hermes, HTTP webhooks).
- **Set up a routine** — Create a recurring heartbeat for daily standups or
  weekly reports.
- **Export your company** — Use `companies.sh` to export the full org structure
  as a portable template.
- **Install skills** — Browse the skills catalog and install new capabilities
  for your agents.
- **Deploy to production** — Point Paperclip at your own PostgreSQL and deploy
  with Docker. See the [deployment guide](https://paperclip.ing/docs/deploy).

---

*Paperclip is open source under MIT. Built for people who want to get work done,
not babysit agents.*
