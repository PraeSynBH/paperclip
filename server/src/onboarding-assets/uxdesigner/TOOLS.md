# TOOLS.md -- UXDesigner

## Core

- **Paperclip skill** -- coordination, assignments, status updates, delegation, approvals, interactions, attachments. Source: `skills/paperclip/SKILL.md`.
- **Bash** -- filesystem operations, scripts, API calls, data processing.
- **File tools** -- read, write, edit, glob, grep for inspecting and maintaining design files, specs, and documentation.
- **Web fetch** -- competitive design research, accessibility standards reference, design system inspiration.

## Collaboration

- **Delegation**: create subtasks, assign tasks as needed.
- **Mentions**: `[@Agent Name](agent://<agent-id>)` to trigger a heartbeat in another agent.
- **Issue-thread interactions**: `request_confirmation`, `request_checkbox_confirmation`, `ask_user_questions`, `suggest_tasks` for structured board/user decisions.
- **Linked entity syntax**: `[PRA-6](/PRA/issues/PRA-6)`, `[plan](/PRA/issues/PRA-15#document-plan)`.

## Agent-Specific

- **paperclip-converting-plans-to-tasks** -- break design plans into executable, assigned Paperclip tasks.

## Domain Skills Available

*(These are available skills that may be installed or referenced.)*

- `frontend-design` -- Guidance for distinctive, intentional visual design when building new UI or reshaping existing ones.
- `design-shotgun` -- Generate multiple AI design variants for visual exploration.
- `design-review` -- Visual design audit and QA for live sites.
- `design-consultation` -- Design system creation: aesthetic, typography, color, layout, spacing, motion.
- `wireframe` -- Produce low-fidelity black-and-white UI wireframes as SVG files.
- `figma` -- Import Figma content (brand tokens, components, storyboard sections).

## Design Knowledge Base

- Design systems: component libraries, design tokens, pattern libraries.
- Interaction design: states, transitions, micro-interactions, feedback patterns.
- Accessibility: WCAG AA/AAA, ARIA, keyboard navigation, screen reader compatibility.
- Responsive design: mobile-first, breakpoints, adaptive layouts.
- User research: usability testing, task analysis, heuristic evaluation.
- Visual design: typography, color theory, spacing systems, visual hierarchy.

## Document Links

- AGENTS.md -- agent instructions, role, domain lenses, collaboration rules.
- SOUL.md -- persona, strategic posture, decision-making style, voice and tone.
- HEARTBEAT.md -- heartbeat checklist.
- TOOLS.md -- this file.
