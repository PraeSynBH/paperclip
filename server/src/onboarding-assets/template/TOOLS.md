# Template: TOOLS.md

## Core

- **Paperclip skill** -- coordination, assignments, status updates, delegation, approvals, interactions, attachments. Source: `skills/paperclip/SKILL.md`.
- **Bash** -- filesystem operations, API calls, document generation, environment inspection.
- **File tools** -- read, write, edit, glob, grep for inspecting and maintaining files.

## Collaboration

- **Delegation**: create subtasks, assign to reports.
- **Mentions**: `[@Agent Name](agent://<agent-id>)` to trigger a heartbeat in another agent.
- **Issue-thread interactions**: `request_confirmation`, `request_checkbox_confirmation`, `ask_user_questions`, `suggest_tasks` for structured board/user decisions.
- **Linked entity syntax**: `[PRA-6](/PRA/issues/PRA-6)`, `[plan](/PRA/issues/PRA-15#document-plan)`.

## Plan Documents

- **Create/update plans**: `POST /api/issues/{issueId}/documents/plan` with sections, milestones, and change summary.
- **Create review gates**: `POST /api/issues/{issueId}/plan/gates` to add approval gates linked to milestones.
- **Decompose approved plans**: after a board user accepts the plan confirmation, call `POST /api/issues/{issueId}/accepted-plan-decompositions` to create child issues.
- See the [Plan Documents API](/api/plans) for the full workflow.

## Memory Tools

- **Capture** findings during execution: `POST /api/companies/{companyId}/memory/capture` with text and source context. Auto-captured records have a 30-day TTL.
- **Query** memory at the start of a heartbeat: `GET /api/companies/{companyId}/memory/query?q=...` for semantic + full-text hybrid search.
- **Upsert** curated records: `POST /api/companies/{companyId}/memory/records` for consciously saved information that persists beyond the 30-day TTL.
- **List/forget**: browse records with `GET .../memory/records` or delete them via `DELETE .../memory/records` by handle.
- Memory is scoped per-agent by default. Shared (non-agent-scoped) records are visible to all agents in the company.
- See the [Memory API](/api/memory) for full endpoint details.

## Knowledge Base

- **Search** published documents: `GET /api/companies/{companyId}/knowledge/search?q=...` (full-text across published content only).
- **Create** draft documents: `POST /api/companies/{companyId}/knowledge` with title and body.
- **Update** drafts: `PATCH /api/companies/{companyId}/knowledge/{docId}` (creates a new revision).
- **Submit for review**: `POST .../knowledge/{docId}/submit-review` to transition from draft to in_review.
- Only **published** documents appear in search. Documents must go through the lifecycle: draft → in_review → published.
- See the [Knowledge Documents API](/api/knowledge).

## Agent-Specific

- **paperclip-converting-plans-to-tasks** -- break plans into executable, assigned Paperclip tasks.

## Domain Knowledge Base

- List domain-specific knowledge areas here.

## Document Links

- AGENTS.md -- agent instructions, role, domain lenses, collaboration rules.
- SOUL.md -- persona, strategic posture, decision-making style, voice and tone.
- HEARTBEAT.md -- heartbeat checklist.
- TOOLS.md -- this file.