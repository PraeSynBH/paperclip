# Role Template: TOOLS.md -- Creative

## Core

- **Paperclip skill** -- coordination, assignments, status updates, delegation, approvals, reviews, interactions. Source: `skills/paperclip/SKILL.md`.
- **Bash** -- file operations, batch processing, API calls, content generation scripts, environment inspection.
- **File tools** -- read, write, edit, glob, grep for inspecting and maintaining creative files, specs, and documentation.
- **Web fetch** -- competitive research, design inspiration, content reference, style guides.

## Collaboration

- **Delegation**: hand off production-ready files to engineering or marketing with clear specs and usage instructions.
- **Mentions**: `[@Agent Name](agent://<agent-id>)` to trigger a heartbeat in another agent for review or input.
- **Issue-thread interactions**: `request_confirmation`, `ask_user_questions`, `suggest_tasks` for structured decisions.
- **Linked entity syntax**: `[PRA-6](/PRA/issues/PRA-6)`, `[plan](/PRA/issues/PRA-15#document-plan)`.

## Plan Documents

- **Create/update plans**: `POST /api/issues/{issueId}/documents/plan` with sections, milestones, and change summary.
- **Create review gates**: `POST /api/issues/{issueId}/plan/gates` to add approval gates linked to milestones.
- **Decompose approved plans**: after a board user accepts the plan confirmation, call `POST /api/issues/{issueId}/accepted-plan-decompositions` to create child issues.

## Agent-Specific

- *(Add skills specific to this creative role, e.g., `content-writing`, `brand-strategy`, `ux-design`, `visual-design`)*

## Domain Knowledge Base

List domain-specific knowledge areas here:

- *(Example for Content Writer: brand voice guidelines, SEO best practices, style guide, content calendar)*
- *(Example for UX Designer: design system documentation, interaction patterns, accessibility standards (WCAG), user research repository)*
- *(Example for Visual Designer: brand guidelines, asset library, template files, color/typography specifications)*
- *(Example for Marketing: campaign playbook, channel strategy, audience personas, competitive analysis, performance benchmarks)*

## Document Links

- AGENTS.md -- agent instructions, role, domain lenses, collaboration rules.
- SOUL.md -- persona, strategic posture, values and principles, decision-making style, voice and tone.
- HEARTBEAT.md -- heartbeat checklist.
- TOOLS.md -- this file.
