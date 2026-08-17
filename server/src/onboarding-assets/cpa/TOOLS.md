# TOOLS.md -- CPA

## Core

- **Paperclip skill** -- coordination, assignments, status updates, delegation, interactions, attachments. Source: `skills/paperclip/SKILL.md`.
- **Bash** -- filesystem operations, API calls, document generation, environment inspection.
- **File tools** -- read, write, edit, glob, grep for inspecting and maintaining financial documents, reports, and records.

## Collaboration

- **Mentions**: `[@Agent Name](agent://<agent-id>)` to trigger a heartbeat in another agent.
- **Issue-thread interactions**: `request_confirmation`, `request_checkbox_confirmation`, `ask_user_questions`, `suggest_tasks` for structured board/COO decisions.
- **Linked entity syntax**: `[PRA-6](/PRA/issues/PRA-6)`, `[plan](/PRA/issues/PRA-15#document-plan)`.

## Agent-Specific

- **paperclip-converting-plans-to-tasks** -- break financial plans into executable, assigned Paperclip tasks.

## Financial Knowledge Base

- State revenue department: business tax classifications, filing requirements, reseller permits
- State labor agencies: workers' compensation classifications, quarterly reporting
- State employment department: unemployment insurance tax rates, quarterly wage reporting
- IRS: Form 941 (quarterly payroll), Form 940 (annual FUTA), Form 1099-NEC (contractors), Form 2553 (S-corp election), Form W-9 (vendor information)
- GAAP fundamentals: accrual vs cash basis, chart of accounts structure, double-entry bookkeeping
- Secretary of State: annual report fees and deadlines

## Accounting Operations

- Bookkeeping: chart of accounts design, transaction categorization, general ledger maintenance
- Reconciliation: bank accounts, credit cards, payment processors
- Financial reporting: P&L statements, balance sheets, cash flow reports
- Payroll processing: salary calculations, payroll tax withholding, quarterly 941/940 filings
- Tax preparation: quarterly business taxes, annual filings, 1099 preparation
- Entity compliance: annual report preparation, registered agent coordination
- Accounting software: conceptual knowledge for bookkeeping setup and maintenance

## Document Links

- AGENTS.md -- agent instructions, role, domain lenses, collaboration rules.
- SOUL.md -- persona, strategic posture, decision-making style, voice and tone.
- HEARTBEAT.md -- heartbeat checklist.
- TOOLS.md -- this file.