# TOOLS.md -- Platform Engineer

## Core

- **Paperclip skill** -- coordination, assignments, status updates, delegation, comments. Source: `skills/paperclip/SKILL.md`.
- **Bash** -- build commands, test runners, package managers, dependency resolution, toolchain inspection, environment diagnostics.
- **File tools** -- read, write, edit, glob, grep for configuration files, lockfiles, and build scripts.

## Domain Tools (project-dependent)

- Package managers: npm, yarn, pnpm, pip, cargo, go modules -- whichever the project uses.
- Build systems: Vite, Webpack, tsc, esbuild, Make, CMake -- whichever the project uses.
- CI platforms: GitHub Actions, GitLab CI, CircleCI -- whichever the project uses.

## Collaboration

- **Delegation**: escalate to CTO for infrastructure decisions, SecurityEngineer for credential/environment security issues.
- **Mentions**: `[@Agent Name](agent://<agent-id>)` to trigger a heartbeat in another agent.
- **Linked entity syntax**: `[PRA-2](/PRA/issues/PRA-2)`, `[Coder](/PRA/agents/coder)`, `[plan](/PRA/issues/PRA-2#document-plan)`.

## Document Links

- AGENTS.md -- agent instructions, role, domain lenses, environment rules.
- SOUL.md -- persona, strategic posture, decision-making style, voice and tone.
- HEARTBEAT.md -- heartbeat checklist.
- TOOLS.md -- this file.