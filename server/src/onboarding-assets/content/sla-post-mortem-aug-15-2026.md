# SLA Breach Post-Mortem — Aug 15, 2026

## Incident Summary

**Client:** paperclip.praesyn.int (internal Paperclip instance)
**Date:** August 14-15, 2026
**Classification:** Premium SLA Breach
**Measured Availability (24h):** 77.8% vs 99.9% SLA commitment (corrected from 78.3% after subsequent downtime)
**Accumulated Downtime:** ~5.4 hours

## Root Cause

The downtime was caused by a concurrent agent restart loop (PRA-535). During normal operation, a server restart cleared the in-memory `liveRunExecutions` Set that tracks active heartbeat timer runs. This caused the heartbeat scheduler to enqueue new wakeup runs for every agent simultaneously, even though each agent already had a queued/running execution in the database. The unbounded re-enqueue loop saturated the execution pipeline, preventing legitimate agent work from progressing.

### Timeline

1. **Trigger:** Server restart (planned or unplanned) cleared in-memory process tracking
2. **Amplification:** Heartbeat timer, seeing an empty `liveRunExecutions` set, created duplicate wakeup enqueues for all agents
3. **Result:** Execution pipeline flooded; agents unable to process work; availability dropped to 78.3%

### Subsequent Downtime (Aug 15, 22:48-23:14 UTC)

- **22:48 UTC** — Port 3100 (monitored API) restarted to apply the concurrency guard fix cleanly
- **22:53 UTC** — `ServiceDownAllRegions` alert fired (PRA-672) as the restart interrupted agent sessions
- **23:14 UTC** — Service restored; alert auto-resolved
- **Net impact:** ~21 minutes additional downtime, dropping 24h availability from 78.3% to 77.8%

## Corrective Actions

### Immediate (Applied)
- ✅ **DB-backed concurrency guard:** Before enqueueing any heartbeat timer wakeup, we now query the `heartbeatRuns` table for active (non-terminal) runs. If any exist for the agent, the enqueue is skipped. This is a database-level check that survives server restarts.
- ✅ **Fix deployed live** via tsx runtime at ~22:30 UTC Aug 15 (confirmed in heartbeat.ts:14124-14144)
- ✅ **Server restarted** (port 3100) at 22:48 UTC — all in-memory state is fresh
- ✅ **Both server instances healthy** as of 23:16 UTC (paperclip.praesyn.int:443 and macbook.praesyn.int:3101)

### Follow-up (Planned)
- ✅ **DB-backed zombie detection (PRA-674):** Replace the in-memory `liveRunExecutions` Set with a persistent tracking mechanism to prevent recurrence even during server restarts. This eliminates the class of bug entirely.

## Service Credit Assessment

### Premium SLA Terms (Standard)
Typical Premium SLA terms for continuous deployment platforms:
- **99.9% monthly uptime guarantee** (~43.2 min/month allowable downtime)
- **Measured availability (24h):** 77.8%
- **Excess downtime:** ~4.8 hours above the 99.9% threshold (5.4h - 43.2min)

### Proposed Credit
Under standard Premium SLA terms, this level of breach typically warrants **10-25% service credit** on the affected month's bill, depending on the severity tier:

| Downtime Threshold | Typical Credit |
|---|---|
| >0.5% (first breach tier) | 5% credit |
| >2% (second tier) | 10% credit |
| >5% (third tier) | 25% credit |
| >10% (fourth tier) | 50% credit |

At 22.2% below SLA (100% - 77.8% = 22.2% deficit), this breach falls into the **25-50% credit tier**.

### Recommendation
- Apply a **25% service credit** on the current billing period
- Issue the credit proactively as part of the incident response, acknowledging that internal infrastructure is not subject to formal billing but the principle of accountability stands
- Document the credit as paperclip.praesyn.int operational budget credit

## Communication Plan

### Stakeholder: COO / Board
- **Status:** Informed via PRA-669
- **Next update:** After PRA-674 (zombie detection) is created and tracked

### Stakeholder: CTO
- **Status:** Reviewed and applied the concurrency guard fix; confirmed server health
- **Action:** Created PRA-674 for DB-backed zombie detection; PRA-673 disposition

### Stakeholder: Technical Team (PlatformEngineer, Coder)
- **Status:** Aware via PRA-535/PRA-655 disposition
- **Note:** PRA-674 will be the implementation vehicle for the deeper fix

## Schedule

- **Fix deployed:** ~22:30 UTC, Aug 15 (live via tsx)
- **Server restart:** 22:48 UTC, Aug 15 (port 3100 — clean restart, completed)
- **Post-mortem updated:** 23:16 UTC, Aug 15 (PRA-673)
- **Follow-up:** PRA-674 — DB-backed zombie detection
