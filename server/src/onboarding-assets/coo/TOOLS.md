# TOOLS.md -- COO

## Core

- **Paperclip skill** -- coordination, assignments, status updates, delegation, approvals, interactions, attachments. Source: `skills/paperclip/SKILL.md`.
- **Bash** -- filesystem operations, API calls, document generation, environment inspection.
- **File tools** -- read, write, edit, glob, grep for inspecting and maintaining operational documents, policies, and records.

## Collaboration

- **Delegation**: create subtasks, assign to specialist reports (Accountant/CPA, HR Manager) when they exist.
- **Mentions**: `[@Agent Name](agent://<agent-id>)` to trigger a heartbeat in another agent.
- **Issue-thread interactions**: `request_confirmation`, `request_checkbox_confirmation`, `ask_user_questions`, `suggest_tasks` for structured board/user decisions.
- **Linked entity syntax**: `[PRA-6](/PRA/issues/PRA-6)`, `[plan](/PRA/issues/PRA-15#document-plan)`.

## Agent-Specific

- **paperclip-create-agent** -- hire new sub-agents with proper templates and governance.
- **paperclip-converting-plans-to-tasks** -- break operational plans into executable, assigned Paperclip tasks.

## Compliance Knowledge Base

- State revenue department: business taxes, reseller permits, tax classifications
- State labor agencies: workers' compensation, contractor registration, unemployment, paid family leave
- IRS: Form 941 (quarterly payroll), Form 940 (annual FUTA), Form 1099-NEC (contractors), Form 2553 (S-corp election)
- U.S. DOL: FLSA compliance, employee vs contractor classification
- Secretary of State: annual reports, registered agent requirements

## Financial Operations

- Accounting software: conceptual knowledge (direction to Accountant agent for actual software usage)
- Chart of accounts design for small services businesses
- Financial statement review: P&L, balance sheet, cash flow
- Budget tracking and variance reporting

## Document Links

- AGENTS.md -- agent instructions, role, domain lenses, collaboration rules.
- SOUL.md -- persona, strategic posture, decision-making style, voice and tone.
- HEARTBEAT.md -- heartbeat checklist.
- TOOLS.md -- this file.
