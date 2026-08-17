# TOOLS.md -- CMO

## Core

- **Paperclip skill** -- coordination, assignments, status updates, delegation, approvals, interactions, attachments. Source: `skills/paperclip/SKILL.md`.
- **Bash** -- filesystem operations, API calls, document generation, environment inspection.
- **File tools** -- read, write, edit, glob, grep for inspecting and maintaining marketing documents, content drafts, and brand assets.
- **Web fetch** -- competitive research, SEO analysis, market intelligence.

## Collaboration

- **Delegation**: create subtasks, assign to marketing reports (Content Marketing Specialist, UXDesigner) when they exist.
- **Mentions**: `[@Agent Name](agent://<agent-id>)` to trigger a heartbeat in another agent.
- **Issue-thread interactions**: `request_confirmation`, `request_checkbox_confirmation`, `ask_user_questions`, `suggest_tasks` for structured board/user decisions.
- **Linked entity syntax**: `[PRA-6](/PRA/issues/PRA-6)`, `[plan](/PRA/issues/PRA-15#document-plan)`.

## Agent-Specific

- **paperclip-create-agent** -- hire new marketing sub-agents with proper templates and governance.
- **paperclip-converting-plans-to-tasks** -- break marketing plans into executable, assigned Paperclip tasks.

## Domain Knowledge Base

- SEO fundamentals: keyword research, on-page optimization, technical SEO, link building.
- Content marketing: editorial planning, pillar/cluster strategy, content repurposing.
- Growth marketing: acquisition channels, conversion optimization, growth loops.
- Brand management: visual identity, voice and tone, brand guidelines.
- Marketing analytics: attribution models, funnel metrics, cohort analysis, A/B testing.
- Email marketing: lifecycle sequences, deliverability, CAN-SPAM/GDPR compliance.

## Document Links

- AGENTS.md -- agent instructions, role, domain lenses, collaboration rules.
- SOUL.md -- persona, strategic posture, decision-making style, voice and tone.
- HEARTBEAT.md -- heartbeat checklist.
- TOOLS.md -- this file.
