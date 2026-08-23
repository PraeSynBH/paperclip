# Agent Definition Audit — PRX-25

Date: 2026-08-23
Author: CEO agent (bec0cc49)
Company: Praxis M&A (b0cfa6ad)

## Current Agent Definitions

| Agent | ID | Role | Status | Budget/mo | Spent/mo | Reports To |
|-------|-----|------|--------|-----------|----------|------------|
| CEO | bec0cc49 | agent | running | $1,000 | $0 | — |
| CTO | 47a4a604 | agent | idle | $1,000 | $0 | CEO |
| CSO | 19828a0f | **general** ⚠️ | idle | $500 | $0 | CTO |
| Staff Engineer | 9219e2c9 | agent | running | $300 | $0 | CEO |
| Release Engineer | a1053376 | agent | idle | $200 | $0 | CEO |
| Design Agent | 7a3a1ba7 | designer | idle | $300 | $0 | CTO |
| QA Engineer | 689a1e64 | agent | **paused (budget)** 🛑 | $500 | $1,616 | CEO |

## Issues Found

### 1. CSO Role: 'general' → 'agent'
The CSO (Chief Security Officer) currently has `role: "general"` instead of `role: "agent"`. This is the primary issue from Plan Rev 4.

**Additional concern:** CSO has `canCreateAgents: true` and `canAssignTasks: true` — both overly permissive for a security-focused role. Recommend reducing to `canCreateAgents: false`.

### 2. Ship Identity
No dedicated "Ship Agent" exists. The **Release Engineer** is the closest role covering release/deployment concerns. Given the other gaps and current phase scope, the recommendation is: **Release Engineer covers ship responsibilities**. A dedicated Ship Agent can be added in a later phase if a gap emerges.

### 3. Budget Review
| Agent | Current | Recommendation | Rationale |
|-------|---------|---------------|-----------|
| CEO | $1,000 | ✅ Keep | Top-level orchestrator |
| CTO | $1,000 | ✅ Keep | Technical leadership |
| CSO | $500 | ✅ Keep | Security operations |
| Staff Engineer | $300 | → **$500** | Active coder, higher usage expected |
| Release Engineer | $200 | → **$500** | Release/ship work needs runway |
| Design Agent | $300 | ✅ Keep | Light usage |
| QA Engineer | $500 | → **$1,000** (and reset spent) | Currently paused at $1,616 spend/$500 budget |

### 4. Stale/Misconfigured Definitions
- **QA Engineer**: Budget-exhausted and paused; needs budget increase AND spent-reset to resume
- **CSO**: overly permissive (canCreateAgents, canAssignTasks)
- **Design Agent**: role `designer` — confirm this is intentional (seems valid for a UX/UI designer)

## Permission Limitation
The CEO agent lacks the `agents:configure` grant needed to PATCH agent configurations. Only the board (human user) can directly apply these changes. See interaction request on this issue.

## Recommended Actions (priority order)
1. PATCH CSO: set `role: "agent"`, `permissions.canCreateAgents: false`
2. Increase Release Engineer budget to $500/mo
3. Increase Staff Engineer budget to $500/mo
4. Increase QA Engineer budget to $1,000/mo and reset spent to $0, resume agent
5. Confirm Design Agent `designer` role is intentional
6. Note: Release Engineer covers Ship identity for now