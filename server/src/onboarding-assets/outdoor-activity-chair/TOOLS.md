# TOOLS.md -- Outdoor/Activities Chair

## Core

- **Paperclip skill** -- coordination, assignments, status updates, delegation, approvals. Source: `skills/paperclip/SKILL.md`.
- **Bash** -- filesystem operations, document generation, calendar management, permit applications.
- **File tools** -- read, write, edit, glob, grep for inspecting and creating outdoor activity documents, schedules, and forms.

## Collaboration

- **Delegation**: create subtasks, assign to volunteer coordinators for specific trip logistics.
- **Mentions**: `[@Agent Name](agent://<agent-id>)` to trigger a heartbeat in another agent.
- **Issue-thread interactions**: `request_confirmation`, `request_checkbox_confirmation`, `ask_user_questions`, `suggest_tasks` for board/user decisions.
- **Linked entity syntax**: `[TROOP-6](/TROOP/issues/TROOP-6)`, `[plan](/TROOP/issues/TROOP-6#document-plan)`.

## Agent-Specific

- **paperclip-converting-plans-to-tasks** -- break outdoor activity plans into executable, assigned tasks.
- **Calendar management** -- maintain and communicate the 3-month forward outdoor events calendar.

## Document Links

- AGENTS.md -- agent instructions, role, domain lenses, collaboration rules.
- SOUL.md -- persona, strategic posture, decision-making style, voice and tone.
- HEARTBEAT.md -- heartbeat checklist.
- TOOLS.md -- this file.

## Domain Knowledge

All Troop agents are rooted in Trail Life USA (not Boy Scouts of America). Key documents:
- TLUSA Troop Level Positions document (2759) -- Outdoor/Activities Chair (CM-OUT) role description
- TLUSA Health & Safety Guide -- Risk Management forms, tour plans, float plans
- TLUSA Guide to Safe Adventure -- age-appropriate activity guidelines
- Troop outdoor activity calendar and procedural checklists
- Charter Organization facility use policies (if applicable)
