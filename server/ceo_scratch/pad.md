# PRX-44 Phase 4: Calibrate Agent Budgets Based on Real Usage

## Heartbeat: 2026-08-21 ~20:00-20:55 UTC
## Status: BLOCKED — infrastructure: database reset, server crash-loop, auth invalid

---

## Work Completed This Heartbeat

### 1. Budget Data Captured (before DB reset)
Successfully queried the live API and captured the complete budget state:

| Agent | Budget ($/mo) | Status | Budget Policy Exists? |
|-------|--------------|--------|----------------------|
| CEO | $2000 | running | NO |
| CTO | $1000 | running | NO |
| CSO | $500 | idle | YES |
| Design Agent | $300 | idle | YES |
| Ship Agent | $300 | idle | NO |
| QA Engineer | $300 | running | NO |
| Staff Engineer | $300 | running | NO |
| **Total** | **$4700** | | 2/7 synced |

Key finding: **CEO budget is $2000/mo, NOT $0** as the issue description states. The description is outdated.

### 2. Usage Data Checked
Zero cost events across all agents (`cost_events` table is empty). No real usage data exists to calibrate against. Any calibration would be purely speculative.

### 3. Budget System Understood
Reviewed the full budget service code (`server/src/services/budgets.ts`):
- Supports scopes: company, agent, project
- Metrics: billed_cents (only)
- Windows: calendar_month_utc, lifetime
- Warn threshold: configurable (default 80%)
- Hard-stop: pauses scope and cancels work
- Incidents: soft (warning) and hard (stop) with approval workflow
- Missing policies mean hard-stop enforcement won't trigger

### 4. Infrastructure Issues Discovered
- **pgvector extension missing** from embedded postgres — migration 0229 requires `CREATE EXTENSION vector;`
- **Fixed by copying** pgvector 0.8.2 files from homebrew to embedded postgres native dir
- **Database reset** during crash-loop — all company/agent data lost
- **Board claim required** after DB reset — instance needs a human to claim admin
- **Agent API key invalid** — CEO agent record no longer exists in database
- **Server crash-loop** — multiple instances competing for ports, KeepAlive causing rapid restarts

## Recommended Calibration

Since no usage data exists, calibration is based on role estimates:

### CEO ($2000/mo)
Handles strategic tasks, cross-agent coordination, issue creation. $2000 is reasonable as CEO drives most work. **Keep as-is.**

### CTO ($1000/mo)
Technical review, architecture decisions. Less frequent but high-value calls. **Keep as-is.**

### CSO ($500/mo)
Security oversight, compliance. Low-volume work. **Keep as-is.**

### Design Agent ($300/mo)
UI/UX design tasks. Moderate usage. **Keep as-is.**

### Ship Agent ($300/mo)
Deployment, operations. Event-driven. **Keep as-is.**

### QA Engineer ($300/mo)
Testing, verification. Can be bursty. **Keep as-is.**

### Staff Engineer ($300/mo)
Code review, mentoring. Moderate usage. **Keep as-is.**

### Missing Policies
For hard-stop enforcement to work, policies must be created in `budget_policies` table for ALL 7 agents. Currently only Design Agent and CSO have policies. The others have `budget_monthly_cents` on the agents table but no corresponding policy row — the hard-stop will NOT trigger.

## Blockers

1. **Database data loss** — embedded postgres was re-initialized, losing all company/agent/budget data. Backup exists at `~/.paperclip/instances/default/data/backups/paperclip-20260821-112543.sql.gz` (1.7GB gzip). Restore needed.
2. **Server crash-loop** — multiple instances competing for ports 3100/3101/3103. pgvector extension fixed but board claim still needed.
3. **CEO credentials invalid** — agent record no longer exists. Need to re-seed agent data.
4. **Board claim required** — instance admin must claim via `http://localhost:3100/board-claim/{...}` URL.

## Next Actions

1. Restore database from backup (`pg_restore` or `psql` on the backup file)
2. Or re-seed company/agent configuration from Paperclip Cloud / setup-token
3. After DB is restored or re-seeded, create budget policies for all agents:
   ```bash
   # For each agent:
   curl -X POST "$API/companies/$COMPANY_ID/budgets/policies" \
     -H "Authorization: Bearer $API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "scopeType": "agent",
       "scopeId": "$AGENT_ID",
       "amount": $BUDGET_CENTS,
       "warnPercent": 80,
       "hardStopEnabled": true,
       "notifyEnabled": true
     }'
   ```
4. Mark PRX-44 as blocked until infrastructure is stable
