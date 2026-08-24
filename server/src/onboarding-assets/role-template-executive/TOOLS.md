# Role Template: TOOLS.md -- Executive

## Core

- **Paperclip skill** -- coordination, assignments, status updates, delegation, approvals, interactions, attachments. Source: `skills/paperclip/SKILL.md`.
- **Bash** -- API calls, document generation, data analysis, environment inspection.
- **File tools** -- read, write, edit, glob, grep for inspecting and maintaining documents, policies, and records.

## Collaboration

- **Delegation**: create subtasks, assign to reports with clear deliverables and deadlines.
- **Mentions**: `[@Agent Name](agent://<agent-id>)` to trigger a heartbeat in another agent.
- **Issue-thread interactions**: `request_confirmation`, `request_checkbox_confirmation`, `ask_user_questions`, `suggest_tasks` for structured board/user decisions.
- **Linked entity syntax**: `[PRA-6](/PRA/issues/PRA-6)`, `[plan](/PRA/issues/PRA-15#document-plan)`.

## Plan Documents

- **Create/update plans**: `POST /api/issues/{issueId}/documents/plan` with sections, milestones, and change summary.
- **Create review gates**: `POST /api/issues/{issueId}/plan/gates` to add approval gates linked to milestones.
- **Decompose approved plans**: after a board user accepts the plan confirmation, call `POST /api/issues/{issueId}/accepted-plan-decompositions` to create child issues.
- See the [Plan Documents API](/api/plans) for the full workflow.

## Agent-Specific

- *(Add skills specific to this executive role, e.g., `financial-analysis`, `strategy`, `board-communications`)*

## Knowledge Base

- **Search** published documents: `GET /api/companies/{companyId}/knowledge/search?q=...` (full-text across published content only).
- **Create** draft documents: `POST /api/companies/{companyId}/knowledge` with title and body.
- **Update** drafts: `PATCH /api/companies/{companyId}/knowledge/{docId}` (creates a new revision).
- **Submit for review**: `POST .../knowledge/{docId}/submit-review` to transition from draft to in_review.
- Only **published** documents appear in search. Documents must go through the lifecycle: draft → in_review → published.

## Domain Knowledge Base

List domain-specific knowledge areas here:

- *(Example for CTO: architecture decisions, technology evaluations, security policies)*
- *(Example for COO: compliance calendar, vendor contracts, operational procedures)*
- *(Example for CFO: financial models, tax strategy, cap table management)*

## Document Links

- AGENTS.md -- agent instructions, role, domain lenses, collaboration rules.
- SOUL.md -- persona, strategic posture, values and principles, decision-making style, voice and tone.
- HEARTBEAT.md -- heartbeat checklist.
- TOOLS.md -- this file.
