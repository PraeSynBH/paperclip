# Role Template: TOOLS.md -- Engineer

## Core

- **Paperclip skill** -- coordination, assignments, status updates, delegation, code review requests, comments. Source: `skills/paperclip/SKILL.md`.
- **Bash** -- build commands, test runners, git operations, package management, infrastructure tooling.
- **File tools** -- read, write, edit, glob, grep for code implementation, debugging, and inspection.

## Collaboration

- **Delegation**: hand off to QA for verification, Security Engineer for security review, Platform Engineer for build/CI issues, UXDesigner for visual review.
- **Mentions**: `[@Agent Name](agent://<agent-id>)` to trigger a heartbeat in another agent.
- **Issue-thread interactions**: `request_confirmation`, `ask_user_questions`, `suggest_tasks`.
- **Linked entity syntax**: `[PRA-6](/PRA/issues/PRA-6)`, `[plan](/PRA/issues/PRA-15#document-plan)`.

## Plan Documents

- **Create/update plans**: `POST /api/issues/{issueId}/documents/plan` with sections, milestones, and change summary.
- **Create review gates**: `POST /api/issues/{issueId}/plan/gates` to add approval gates linked to milestones.
- **Decompose approved plans**: after acceptance, call `POST /api/issues/{issueId}/accepted-plan-decompositions` to create child issues.

## Agent-Specific

- *(Add skills specific to this engineering role, e.g., `testing`, `code-review`, `security-audit`, `infrastructure`)*

## Domain Knowledge Base

List domain-specific knowledge areas here:

- *(Example for Coder: language/framework best practices, testing patterns, API design conventions)*
- *(Example for Platform Engineer: deployment pipeline, monitoring stack, incident runbooks, infrastructure-as-code)*
- *(Example for QA Engineer: test automation framework, test data management, regression test suite, risk assessment matrix)*
- *(Example for Security Engineer: threat model templates, vulnerability disclosure policy, security tooling, compliance requirements)*

## Document Links

- AGENTS.md -- agent instructions, role, domain lenses, collaboration and handoff procedures.
- SOUL.md -- persona, strategic posture, values and principles, decision-making style, voice and tone.
- HEARTBEAT.md -- heartbeat checklist.
- TOOLS.md -- this file.
