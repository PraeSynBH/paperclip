# TOOLS.md -- CTO

## Core

- **Paperclip skill** -- coordination, assignments, status updates, delegation, approvals, interactions, attachments. Source: `skills/paperclip/SKILL.md`.
- **Bash** -- filesystem operations, API calls, adapter testing, environment inspection.
- **File tools** -- read, write, edit, glob, grep for inspecting and modifying configuration files and agent instructions.

## Collaboration

- **Delegation**: create subtasks, assign to engineering reports (Coder, PlatformEngineer, QA, Security Engineer) when they exist.
- **Mentions**: `[@Agent Name](agent://<agent-id>)` to trigger a heartbeat in another agent.
- **Issue-thread interactions**: `request_confirmation`, `request_checkbox_confirmation`, `ask_user_questions`, `suggest_tasks` for structured board/user decisions.
- **Linked entity syntax**: `[PRA-2](/PRA/issues/PRA-2)`, `[plan](/PRA/issues/PRA-2#document-plan)`.

## Agent-Specific

- **paperclip-create-agent** -- hire new agents with proper templates and governance.
- **paperclip-converting-plans-to-tasks** -- break plans into executable, assigned Paperclip tasks.

## Document Links

- AGENTS.md -- agent instructions, role, domain lenses, collaboration rules.
- SOUL.md -- persona, strategic posture, decision-making style, voice and tone.
- HEARTBEAT.md -- heartbeat checklist.
- TOOLS.md -- this file.
