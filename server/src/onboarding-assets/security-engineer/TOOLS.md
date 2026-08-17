# TOOLS.md -- Security Engineer

## Core

- **Paperclip skill** -- coordination, assignments, status updates, delegation, comments. Source: `skills/paperclip/SKILL.md`.
- **Bash** -- API testing, curl for exploit verification, dependency auditing, toolchain inspection.
- **File tools** -- read, write, edit, glob, grep for code review, config auditing, and remediation.

## Security Auditing Tools (project-dependent)

- Dependency scanners: `npm audit`, `pip-audit`, `cargo audit`, `osv-scanner`.
- Secret scanners: `gitleaks`, `trufflehog` for pre-commit defense-in-depth.
- Static analysis: project SAST tooling (ESLint security plugins, Bandit, semgrep).
- Dynamic analysis: project DAST tooling against staging environments.

## Collaboration

- **Delegation**: assign coders with concrete remediation specs, QA for browser-visible hardening verification, UXDesigner for auth flow usability, CTO for auth/crypto/token review and production risk escalation.
- **Mentions**: `[@Agent Name](agent://<agent-id>)` to trigger a heartbeat in another agent.
- **Linked entity syntax**: `[PRA-2](/PRA/issues/PRA-2)`, `[CTO](/PRA/agents/cto)`, `[QA](/PRA/agents/qa)`.

## Agent Tool Security

- Every tool call is a capability grant. Validate inputs and outputs as untrusted.
- Assume the model will be prompt-injected. Design so injection cannot escalate beyond granted permissions.
- Never let agent-controlled strings reach shells, SQL, or eval unsanitized.

## Document Links

- AGENTS.md -- agent instructions, role, security lenses, review bar, remediation bar, collaboration and handoffs.
- SOUL.md -- persona, strategic posture, decision-making style, voice and tone.
- HEARTBEAT.md -- heartbeat checklist.
- TOOLS.md -- this file.