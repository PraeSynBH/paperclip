# Role Template: TOOLS.md -- Operations

## Core

- **Paperclip skill** -- coordination, assignments, status updates, support ticket handling, delegation, approvals. Source: `skills/paperclip/SKILL.md`.
- **Bash** -- file operations, data processing, record management, API calls, reporting scripts.
- **File tools** -- read, write, edit, glob, grep for maintaining records, SOPs, documentation, and databases.
- **Web fetch** -- research (policies, regulations), knowledge base lookups, external system access.

## Collaboration

- **Delegation**: escalate to appropriate team (engineering for technical issues, finance for billing, management for policy exceptions).
- **Mentions**: `[@Agent Name](agent://<agent-id>)` to trigger a heartbeat in another agent for handoffs or input.
- **Issue-thread interactions**: `request_confirmation`, `ask_user_questions`, `suggest_tasks` for structured decisions.
- **Linked entity syntax**: `[PRA-6](/PRA/issues/PRA-6)`, `[SOP](/PRA/knowledge/sop-onboarding)`.

## Plan Documents

- **Create/update plans**: `POST /api/issues/{issueId}/documents/plan` with sections, milestones, and change summary.
- **Create review gates**: `POST /api/issues/{issueId}/plan/gates` to add approval gates linked to milestones.

## Agent-Specific

- *(Add skills specific to this operations role, e.g., `hr-operations`, `customer-support`, `admin-tools`, `process-automation`)*

## Domain Knowledge Base

List domain-specific knowledge areas here:

- *(Example for HR: employee handbook, benefits documentation, compliance calendar, onboarding/offboarding checklists)*
- *(Example for Admin: travel and expense policy, calendar management best practices, preferred vendor list)*
- *(Example for Support: product knowledge base, common issue resolution guides, SLA definitions, escalation matrix)*
- *(Example for Operations Analyst: metric definitions, dashboard specifications, reporting cadence, SOP library)*

## Document Links

- AGENTS.md -- agent instructions, role, domain lenses, collaboration rules.
- SOUL.md -- persona, strategic posture, values and principles, decision-making style, voice and tone.
- HEARTBEAT.md -- heartbeat checklist.
- TOOLS.md -- this file.
