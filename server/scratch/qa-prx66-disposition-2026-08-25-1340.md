# QA Disposition: PRX-66 — Grant CEO agent 'agents:configure' permission

**Date:** 2026-08-25 ~13:40 UTC
**QA Engineer:** 689a1e64-5151-4c46-bb98-3ea5f650c4b0
**Wake reason:** heartbeat_timer (not a PRX-66 checkout)
**Status:** BLOCKED — human Board UI action required

---

## Summary

PRX-66 delivers the `agents:configure` grant to the CEO agent (bec0cc49). This is a prerequisite to unblocking PRX-63 (CSO role general→agent) and PRX-25 (Phase 2: Clean Up Agent Definitions). I investigated whether this can be done programmatically by an agent. **It cannot** — the grant requires Board-level auth.

---

## API Investigation

### Tried: `PATCH /api/companies/{companyId}/members/{memberId}/role-and-grants`

This endpoint accepts:
```json
{
  "grants": [{ "permissionKey": "agents:configure" }]
}
```

**Auth required:** `BoardSessionAuth` (browser cookie) **or** `BoardApiKeyAuth` (board API key bearer token).

**Auth I hold:** `AgentBearerAuth` — authenticates but results in `403 Permission denied` because agent tokens are not allowed on this endpoint.

### Verification steps
1. `GET /api/companies/b0cfa6ad-8205-4dbb-b310-12d5f8592f27/members` → `403 Permission denied`
2. OpenAPI spec confirms: members endpoints (GET list, PATCH role-and-grants) all require `BoardSessionAuth` or `BoardApiKeyAuth` per security override at path level.

**Root cause:** The `agents:configure` grant *is* the authority needed to grant itself via API. Bootstrapping this permission must come from the Board UI (human session) or a provisioned board API key that already holds it.

---

## Required Unblock Action

| Field | Value |
|-------|-------|
| **Owner** | Ben (responsibleUserId: `i66elh65thHBfp2zjIxgQEja6RqohJQY`) |
| **Action** | Board UI → Company Members → CEO member (`bec0cc49-d859-4e2e-bc63-51930922b467`) → Add grant `agents:configure` (no scope restriction) |
| **Alternative** | Provision a board API key and call `PATCH /api/companies/b0cfa6ad-8205-4dbb-b310-12d5f8592f27/members/{memberId}/role-and-grants` with `grants:[{permissionKey:"agents:configure"}]` |

### CEO member ID
The CEO agent ID is `bec0cc49-d859-4e2e-bc63-51930922b467`. The member record ID under the company may differ — use the Board UI to locate it.

---

## Duplicate Issues

Three issues exist for the same work:

| Issue | Status | Assignee | Notes |
|-------|--------|----------|-------|
| **PRX-66** | in_progress | QA Engineer (me) | Active issue, should be canonical |
| PRX-76 | todo | unassigned | "Board: Grant agents:configure to CEO agent" |
| PRX-78 | backlog | unassigned | "Manual: Grant agents:configure to CEO via Board UI" |

Recommend consolidating: close PRX-76 and PRX-78 as duplicates once the grant lands, or mark as superseded by PRX-66.

---

## Downstream Chain

```
PRX-25 (Phase 2: Clean Up Agent Definitions) [blocked]
  └─ PRX-66 (Grant agents:configure to CEO) [BLOCKED ← HERE]
       └─ PRX-63 (CSO role general→agent) [blocked]
```

Unblocking PRX-66 cascades: CEO can then change CSO role (PRX-63), update budgets, and complete the remaining PRX-25 cleanup items.

---

## Agent heartbeat context

This run (6d144cd0) is a timer-based heartbeat — no issue checkout. The cross-issue write guard prevents issue PATCH from a timer heartbeat. This document serves as the durable evidence artifact per execution contract §sanctioned-fallback.
