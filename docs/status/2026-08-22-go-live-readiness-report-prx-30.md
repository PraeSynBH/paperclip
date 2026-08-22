# Go-Live Readiness Report — PRX-30

> **Prepared by:** CEO Agent (bec0cc49)
> **Date:** 2026-08-22 ~12:29 UTC
> **Company:** Praxis M&A
> **Issue:** PRX-30 (Phase 4: Go-Live Checklist)
> **Status:** Assessment in Progress — awaiting board operator actions

---

## Checklist Assessment

### 1. ❌ Heartbeats Operational

**Current State:** Only the CEO agent has a functional heartbeat invocation mechanism. All 7 agents lack configured `heartbeatIntervalSecs`:

| Agent | ID | Status | Error | Heartbeat Interval | Last Heartbeat |
|-------|----|--------|-------|-------------------|----------------|
| **CEO** | bec0cc49 | running | "Process lost"* | none | ~12:29 UTC (invoked successfully) |
| **CTO** | 47a4a604 | **error** | "Process lost -- server may have restarted" | none | Never (error state) |
| **CSO** | 19828a0f | running | None | none | Never |
| **Design Agent** | 7a3a1ba7 | idle | None | none | Never |
| **Staff Engineer** | 9219e2c9 | idle | None | none | 2026-08-21T17:24Z |
| **Release Engineer** | a1053376 | idle | None | none | Never |
| **QA Engineer** | 689a1e64 | idle | None | none | 2026-08-21T18:57Z |

*\*CEO shows "Process lost" error but heartbeat invoke still works — this may be stale from a prior server restart.*

**Gap:** No agent has `heartbeatIntervalSecs` configured. CEO heartbeat can be triggered on-demand but is not scheduled. The `agents:suggest-changes` permission is required to configure heartbeat schedules via the API.

**Prerequisite:** PRX-29 (Configure Budget Alerts and Heartbeat Monitoring) — in_progress, requires board operator.

---

### 2. ❌ Skills Wired Correctly

**Current State:** 38 skills are available in the company catalog (32 GStack + 6 Paperclip). However, only 8 skills have any agents attached:

| Skill | Attached Agents |
|-------|----------------|
| garrytan/gstack/investigate | 1 |
| garrytan/gstack/land-and-deploy | 1 |
| garrytan/gstack/office-hours | 1 |
| garrytan/gstack/plan-ceo-review | 1 |
| garrytan/gstack/qa | 1 |
| garrytan/gstack/qa-only | 1 |
| garrytan/gstack/review | 1 |
| garrytan/gstack/ship | 1 |

The remaining 30 skills (including design, spec, context-save/restore, etc.) have no agents bound.

**Gap:** Skills are not explicitly wired to agents per the PRX-1 plan. The `agents:suggest-changes` permission is required.

**Prerequisite:** PRX-24 (Wire GStack Skills to All 7 Agents) — in_progress, requires board operator.

---

### 3. ❌ Handoff Chains Tested

**Current State:** 
- **PRX-27** (Test CEO → CTO → QA Handoff) — in_progress, assigned to CEO
- **PRX-28** (Document Full A→B→C Workflow Map) — in_progress, already has docs/workflows documented in docs/agent-workflows.md
- **PRX-33** (Go-Live Smoke Test: CEO → CTO Handoff) — **CREATED** as part of this heartbeat (assigned to CTO)

**Blockers:**
- CTO is in error state ("Process lost") — cannot receive task assignments
- Only CEO can wake itself; other agents cannot be woken by CEO via API
- The smoke test issue (PRX-33) was created and assigned to CTO but CTO cannot action it while in error state

**Prerequisite:** CTO error must be cleared (requires board operator: POST /api/agents/47a4a604/clear-error)

---

### 4. ❌ Budget Alerts Verified

**Current State:** 
- Company budget: $0/mo (unlimited — pay-as-you-go)
- Agent budgets configured (per PRX-1 plan): Total $2,800/mo
- **$0 spent** across all agents (no production tasks completed)
- No budget alert endpoint found in the API
- No heartbeat failure notifications configured

**Gap:** Budget alert configuration requires board operator or the budget monitoring service to be stood up.

**Prerequisite:** PRX-29 (Configure Budget Alerts and Heartbeat Monitoring) — requires board operator.

---

### 5. ✅ Org Chart (Partially Accurate)

**Current State:** `docs/org-chart.md` exists but needs updates:
- CSO shows "running" status (API says running)
- Design Agent shows "idle" (matches API)
- CTO shows "error" — needs to reflect error state
- Budget amounts verified against API (match)
- Heartbeat intervals: all show "none" — needs documenting
- Agent capabilities table needs verification

**Action Taken:** Org chart will be updated to reflect current API state.

---

### 6. ❌ Final Smoke Test

**Current State:** 
- PRX-33 (Go-Live Smoke Test: CEO → CTO Handoff) was created
- CEO heartbeat was invoked successfully
- CTO cannot process the test task (error state)
- Full CEO → CTO → QA chain cannot be verified until CTO is unblocked

**Partial Success:** CEO self-heartbeat works. Issue creation works. Assignment works. CTO wake is blocked by error state.

---

## Open Issues Dependencies

The following Phase 2/3 issues are in_progress and block full go-live readiness:

| Issue | Title | Priority | Blocking PRX-30 Item |
|-------|-------|----------|---------------------|
| PRX-23 | Recover CTO from Error State | High | Heartbeats, Handoff, Smoke Test |
| PRX-24 | Wire GStack Skills to All 7 Agents | High | Skills Wiring |
| PRX-25 | Clean Up Agent Definitions | Medium | Org Chart, Definitions |
| PRX-26 | Audit AGENTS.md for Accuracy | Low | Documentation |
| PRX-27 | Test CEO → CTO → QA Handoff Chain | High | Handoff Verification |
| PRX-28 | Document Full A→B→C Workflow Map | Medium | Workflow Documentation |
| PRX-29 | Configure Budget Alerts and Heartbeat Monitoring | High | Heartbeats, Budget |
| PRX-31 | First Real Task (Security Question Bank) | High | End-to-End Flow |
| PRX-32 | Post-Launch Review after 24 hours | Low | Post-Launch |
| PRX-33 | Go-Live Smoke Test: CEO → CTO Handoff | High | Smoke Test |

---

## Interaction Pending

An `ask_user_questions` interaction has been created on PRX-30 asking the board operator to:
1. Clear CTO error state (unblocks smoke test)
2. Choose whether to proceed with go-live despite configuration gaps or fix them first

---

## Summary

| # | Item | Status | Action Needed |
|---|------|--------|--------------|
| 1 | Heartbeats operational | ❌ Not configured | Board operator: configure heartbeatIntervalSecs |
| 2 | Skills wired correctly | ❌ Not wired | Board operator: run skills/sync API |
| 3 | Handoff chains tested | ❌ Blocked | Clear CTO error, then test CEO→CTO→QA |
| 4 | Budget alerts verified | ❌ Not configured | Board operator: set up budget monitoring |
| 5 | Org chart accurate | ⚠️ Needs update | CEO can update doc (in progress) |
| 6 | Final smoke test | ❌ Blocked on CTO | Clear CTO error to proceed |

**Overall:** Go-live cannot pass all checks until CTO error is cleared and board operator configures heartbeat schedules, skill bindings, and budget alerts. These require permissions the CEO agent does not have (`agents:suggest-changes`, board-level clear-error).
