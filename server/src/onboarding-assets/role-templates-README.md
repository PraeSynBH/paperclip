# Role Templates

This directory contains reusable, copyable role template documents for creating new Paperclip agents. Each template is a complete set of four files:

- **AGENTS.md** — Agent instructions, role description, domain lenses, collaboration rules, safety rules
- **SOUL.md** — Persona, strategic posture, values and principles, decision-making style, voice and tone
- **TOOLS.md** — Available tools, collaboration mechanisms, domain knowledge areas
- **HEARTBEAT.md** — Heartbeat checklist, delivery workflows, handoff procedures, rules

## Templates Available

| Template | Covers | When to Use |
|---|---|---|
| [Executive](role-template-executive/) | CEO, COO, CFO, CTO, and similar leadership roles | Creating a strategic decision-maker who manages teams and sets direction |
| [Engineer](role-template-engineer/) | Coder, Platform Engineer, QA Engineer, Security Engineer | Creating a technical builder who writes code, tests systems, or secures infrastructure |
| [Creative](role-template-creative/) | Content Writer, UX Designer, Visual Designer, Marketing Strategist | Creating a creative professional who produces content, designs, or marketing |
| [Operations](role-template-operations/) | HR/People Ops, Admin Assistant, Customer Support, Operations Analyst | Creating an operations professional who keeps the company running smoothly |

## How to Use

1. **Copy** the template directory for the role category that fits your agent.
2. **Rename** the directory to match your agent's name/role key (e.g., `my-agent-name`).
3. **Customize** each file:
   - Replace `AGENT_NAME`, `AGENT_TITLE`, and `MANAGER_NAME` placeholders with real values
   - Fill in the **Role** section with responsibilities specific to the agent
   - Choose the relevant sub-role variant (e.g., "If Coder", "If UX Designer", "If HR")
   - Replace placeholder values in **Values and Principles** with your company's actual values
   - Customize **Authority Boundaries** for the specific role
   - Add role-specific **Domain Knowledge** items
   - Remove unused sub-role sections
4. **Register** the agent in `DEFAULT_AGENT_BUNDLE_FILES` in `server/src/services/default-agent-instructions.ts` if you want the bundle auto-loaded when the agent is created via onboarding.

## Template Structure

Each file uses `PLACEHOLDER_NAME` for values that must be customized:

- `AGENT_NAME` — The agent's display name (e.g., "MyCOO")
- `AGENT_TITLE` — The agent's title (e.g., "Chief Operating Officer")
- `MANAGER_NAME` — Who the agent reports to (e.g., "CEO")

Sections marked with "Customize" or sub-role variants (e.g., "If CTO:") indicate choices to make during customization. Remove unused options.

## Relationship to Existing Role Bundles

This directory contains **category templates** — broader than the specific role bundles in sibling directories. The specific role directories (e.g., `ceo/`, `coder/`, `uxdesigner/`, `hr-manager/`) are fully customized agent definitions for those specific roles. Use those as-is when creating an agent with an exact matching role. Use these templates as starting points when creating an agent whose role doesn't have a pre-existing specific bundle.

For a truly generic starter template with minimal content, see the [`template/`](template/) directory.
