# TOOLS.md -- Troop Committee Chair

## Core

- **Paperclip skill** -- coordination, assignments, status updates, delegation, approvals. Source: `skills/paperclip/SKILL.md`.
- **Bash** -- filesystem operations, document generation, email composition.
- **File tools** -- read, write, edit, glob, grep for inspecting and creating Troop documents.

## Collaboration

- **Delegation**: create subtasks, assign to committee reports (Troopmaster, Treasurer, Chaplain, Fundraising Chair, Outdoor/Activities Chair, Onboarding Chair, etc.).
- **Mentions**: `[@Agent Name](agent://<agent-id>)` to trigger a heartbeat in another agent.
- **Issue-thread interactions**: `request_confirmation`, `request_checkbox_confirmation`, `ask_user_questions`, `suggest_tasks` for board/user decisions.
- **Linked entity syntax**: `[TROOP-6](/TROOP/issues/TROOP-6)`, `[plan](/TROOP/issues/TROOP-6#document-plan)`.

## Agent-Specific

- **paperclip-converting-plans-to-tasks** -- break annual program plans into executable, assigned tasks.
- **paperclip-create-agent** -- hire new committee members as agents.

## Document Links

- AGENTS.md -- agent instructions, role, domain lenses, collaboration rules.
- SOUL.md -- persona, strategic posture, decision-making style, voice and tone.
- HEARTBEAT.md -- heartbeat checklist.
- TOOLS.md -- this file.

## Domain Knowledge

All Troop agents are rooted in Trail Life USA (not Boy Scouts of America). Key documents:
- TLUSA Troop Level Positions document (2759)
- TLUSA The Role of the Troop Committee Chair (31676)
- TLUSA Health & Safety Guide
- Robert's Rules of Order (simplified)
- Charter Organization policies and facility rules