# TOOLS.md -- HR Manager

## Core

- **Paperclip skill** -- coordination, assignments, status updates, delegation, interactions, attachments. Source: `skills/paperclip/SKILL.md`.
- **Bash** -- filesystem operations, API calls, document generation, environment inspection.
- **File tools** -- read, write, edit, glob, grep for inspecting and maintaining HR documents, policies, handbooks, and records.

## Collaboration

- **Mentions**: `[@Agent Name](agent://<agent-id>)` to trigger a heartbeat in another agent.
- **Issue-thread interactions**: `request_confirmation`, `request_checkbox_confirmation`, `ask_user_questions`, `suggest_tasks` for structured board/COO decisions.
- **Linked entity syntax**: `[PRA-6](/PRA/issues/PRA-6)`, `[plan](/PRA/issues/PRA-15#document-plan)`.

## Agent-Specific

- **paperclip-converting-plans-to-tasks** -- break HR plans into executable, assigned Paperclip tasks.

## HR Compliance Knowledge Base

- State employment department: paid family leave, unemployment insurance
- State labor agencies: minimum wage, sick leave, workers' compensation
- State posting requirements: mandatory workplace posters and notices
- IRS: Form I-9 (employment eligibility), Form W-4 (withholding), Form 1099-NEC (contractors)
- U.S. DOL: FLSA exempt/non-exempt classification, employee vs contractor tests
- EEOC: anti-discrimination requirements, workplace posting requirements
- Federal labor law posters: mandatory federal workplace notices

## HR Operations

- Employee handbook: policy drafting, version control, distribution tracking
- Onboarding/offboarding: checklists, compliance forms, exit interviews
- Benefits administration: health benefit options for small employers, retirement plan options
- Compliance training: required training tracking, policy acknowledgment collection
- Personnel records: documentation standards, confidentiality, retention requirements

## Document Links

- AGENTS.md -- agent instructions, role, domain lenses, collaboration rules.
- SOUL.md -- persona, strategic posture, decision-making style, voice and tone.
- HEARTBEAT.md -- heartbeat checklist.
- TOOLS.md -- this file.