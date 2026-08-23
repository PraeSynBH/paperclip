---
title: Onboarding API
summary: Self-service company creation and role-based onboarding wizard
version: v0.5.0 + M6
last_updated: 2026-08-23
---

# Onboarding API

The Onboarding API provides endpoints for creating a new company and setting up its initial structure. Two flows are available:

1. **Quick-start onboarding** (`POST /api/start`) — One-shot company creation with default agents, goal, project, and task. Requires board-level access.
2. **Guided onboarding wizard** (`/api/companies/:companyId/onboarding/*`) — Step-by-step role selection for new self-serve signups. Integrated with the M6 trial flow.

## Endpoints

### Start onboarding — create a company

```
POST /api/start
```

Creates a company (with the authenticated user as owner), hires the requested default agents, seeds a company-level goal, an "Onboarding" project, and a starter task assigned to the first (CEO) agent. Returns all created entities so the caller can navigate directly to the working board.

**Request body:**

```json
{
  "company": {
    "name": "Acme Corp",
    "industry": "Technology",
    "budgetMonthlyCents": 1000000
  },
  "agents": [
    { "role": "ceo", "name": "Alex", "adapterType": "process" },
    { "role": "cto", "name": "Jordan" },
    { "role": "pm", "name": "Taylor" }
  ]
}
```

**Fields:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `company.name` | string | Yes | — | Company name (trimmed) |
| `company.industry` | string | No | `null` | Industry description (stored in company description) |
| `company.budgetMonthlyCents` | number | No | `0` | Monthly budget in cents |
| `agents` | array | No | CEO, CTO, PM | Array of agent items (1-10 agents) |

**Agent item fields:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `role` | string | No | `ceo` | Agent role from the AGENT_ROLES enum |
| `name` | string | No | Role label | Custom display name |
| `adapterType` | string | No | `process` | Agent adapter type |
| `adapterConfig` | object | No | `{}` | Agent adapter configuration |

**Authorization:**

Requires board-level access (`assertBoard`). The caller must be either:
- A local implicit user (`local_implicit`), or
- An instance admin, or
- An authenticated board user with a valid user session

**Response (201 Created):**

```json
{
  "company": {
    "id": "uuid",
    "name": "Acme Corp",
    "issuePrefix": "ACME",
    "description": "Industry: Technology",
    "budgetMonthlyCents": 1000000,
    "status": "active",
    "createdAt": "2026-08-18T00:00:00.000Z"
  },
  "agents": [
    {
      "id": "uuid",
      "name": "Alex",
      "role": "ceo",
      "title": "CEO",
      "icon": null,
      "status": "idle",
      "adapterType": "process",
      "urlKey": "alex-abc123"
    }
  ],
  "goal": {
    "id": "uuid",
    "title": "Scale Acme Corp",
    "description": "Build a leading Technology company.",
    "level": "company",
    "status": "active"
  },
  "project": {
    "id": "uuid",
    "name": "Onboarding",
    "status": "in_progress"
  },
  "issue": {
    "id": "uuid",
    "identifier": "ACME-1",
    "title": "Hire your first engineer and create a hiring plan",
    "status": "todo",
    "assigneeAgentId": "uuid"
  }
}
```

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `company` | object | Created company with id, name, prefix, description, budget, status |
| `agents` | array | Created agents with id, name, role, title, status, adapterType, urlKey |
| `goal` | object | Created company-level goal "Scale {CompanyName}" |
| `project` | object | Created "Onboarding" project linked to the goal |
| `issue` | object | Created starter task assigned to the first (CEO) agent |

**Errors:**

| Status | Meaning |
|--------|---------|
| `400` | Validation error (e.g., invalid agent role, agent count outside 1-10) |
| `403` | Not authenticated or not authorized (board access required) |

## Details

The onboarding flow performs the following steps in a single request:

1. **Create company** — creates a new company record with the provided name and optional industry description
2. **Set up owner** — creates an owner membership and grants for the authenticated user
3. **Apply budget** — sets up a calendar-month budget policy if `budgetMonthlyCents > 0`
4. **Create agents** — hires requested agents, materializing default instructions bundles for adapters that support managed instructions
5. **Create goal** — creates a company-level "Scale {CompanyName}" goal
6. **Create project** — creates an "Onboarding" project linked to the goal
7. **Create starter task** — creates a sample task ("Hire your first engineer and create a hiring plan") assigned to the first (CEO) agent

Activity log entries are recorded for each created entity.

## Related

- [Agent Marketplace API](/api/marketplace) — browse and hire marketplace agents
- [Agents API](/api/agents) — agent lifecycle and management
- [Companies API](/api/companies) — company lifecycle and memberships
- [Company Templates API](/api/company-templates) — one-click company deployment with knowledge packs

---

## Guided Onboarding Wizard (M6)

The guided onboarding wizard is presented to new self-serve signups after registration. It provides step-by-step role selection, with the option to skip and land on an empty dashboard.

### Check onboarding status

```
GET /api/companies/:companyId/onboarding/status
```

Returns the current onboarding state for a company.

**Authorization:** Company access (`assertCompanyAccess`).

**Response (200):**
```json
{
  "status": "pending",
  "selectedRole": null,
  "completedAt": null,
  "canSelectRole": true
}
```

**Status values:**
| Status | Meaning | canSelectRole |
|--------|---------|---------------|
| `pending` | Onboarding not yet started | `true` |
| `completed` | Role was selected | `false` |
| `skipped` | User skipped onboarding | `false` |

**Errors:**
| Status | Meaning |
|--------|---------|
| `400` | Company not found |

### Select a role

```
POST /api/companies/:companyId/onboarding/role
```

Select a role during onboarding. Creates an agent, company-level goal, project, and first task in a single transaction with `SELECT ... FOR UPDATE` row locking to prevent concurrent selection conflicts.

**Authorization:** Company access (`assertCompanyAccess`).

**Request body:**
```json
{
  "role": "cto"
}
```

**Valid roles:** `ceo`, `cto`, `engineer`, `pm`, `designer`, `product`, `founder`, `operator`, `marketing`, `support`, `sales`, `hr`, `finance`, `legal`, `operations`

**Response (200):**
```json
{
  "companyId": "uuid",
  "role": "cto",
  "applied": true,
  "agentId": "uuid",
  "projectId": "uuid",
  "goalId": "uuid",
  "issueId": "uuid"
}
```

**Errors:**
| Status | Meaning |
|--------|---------|
| `400` | Company not found or invalid role |
| `409` | Onboarding already completed or skipped |

**Idempotency:** The first task is created with an `idempotencyKey` (`onboarding-role:{companyId}:{role}`). The `409` conflict prevents re-execution if the role was already selected.

### Skip onboarding

```
POST /api/companies/:companyId/onboarding/skip
```

Skip the onboarding wizard and land on the empty dashboard. Only allowed when status is `pending`.

**Authorization:** Company access (`assertCompanyAccess`).

**Request body:** None (empty body or `{}`).

**Response (200):**
```json
{
  "companyId": "uuid",
  "skipped": true
}
```

**Errors:**
| Status | Meaning |
|--------|---------|
| `400` | Company not found |
| `409` | Onboarding already completed or skipped |

### What the wizard creates

When a role is selected, the following entities are created atomically:

1. **Company-level goal** — Title matches the role label (e.g., "CTO"), status `active`
2. **"Onboarding" project** — Linked to the goal, status `in_progress`
3. **Agent** — Named after the role label, `general` role (or `ceo` for CEO role), `claude_local` adapter
4. **First task** — "Get started with {RoleLabel}", assigned to the new agent, status `todo`

The company's `onboarding_status` is set to `completed` with `onboarding_selected_role` and `onboarding_completed_at` populated.

### Activity Logging

- `company.onboarding_role_selected` — details include role, agentId, projectId, goalId, issueId
- `company.onboarding_skipped` — empty details

### DB Schema

The `companies` table has three additional columns (migration 0231):

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `onboarding_status` | `text` | `'pending'` | Current state: `pending`, `completed`, or `skipped` |
| `onboarding_selected_role` | `text` | `null` | The role selected during onboarding |
| `onboarding_completed_at` | `timestamp with time zone` | `null` | When onboarding was completed or skipped |