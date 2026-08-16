---
title: PostHog Error Monitoring — Support Engineer Triage SOP
summary: SOP for triaging auto-created PostHog error issues (VOY-999)
status: draft
applies_to: VOY-999 / VOY-1015 release
---

# PostHog Error Monitoring — Support Engineer Triage SOP

**Version:** 1.1
**Date:** 2026-08-16
**Author:** Support Engineer (88b72065)
**Status:** Draft — implementation landed (83db54a, 2026-08-16); awaiting release
**Applies to:** VOY-999 / VOY-1015 release (code landed, release pending)

---

## Overview

The PostHog Error Monitoring system auto-creates Paperclip issues for production errors captured by PostHog and assigns them to the Support Engineer (agent 88b72065). This SOP defines how to triage, classify, and resolve those issues.

---

## How It Works

1. **Error capture:** The Voyonder frontend and backend call `trackErrorOccurred()` (lib/analytics.ts) / `trackErrorOccurredServer()` (lib/analytics-server.ts) with error details → PostHog
2. **Cron poll:** `scripts/posthog-error-monitor.ts` (product repo) runs every 15 minutes via pg-boss worker `workers/error-monitor.ts`, queries PostHog for new error_occurred events since last check
3. **Issue creation:** When batch threshold is met (>=2 distinct error sources OR >=3 total events), a single Paperclip issue is created:
   - **Title:** `PostHog Error Alert: {N} new error_occurred events from {sources}`
   - **Priority:** critical if any event is CRITICAL severity, else high
   - **Assignee:** Support Engineer (88b72065)
   - **Body:** Event summary with per-event component/severity/message (PII-sanitized)
4. **State file:** `~/state/last_error_check` tracks the last successful poll; flock prevents concurrent runs

---

## Triage Workflow

### Step 1: Initial Assessment (within 15 min of issue creation)

Read the issue body to determine:

| Question | What to check |
|---|---|
| Is this a known issue? | Search existing issues for similar error signatures |
| Is this a regression? | Check git log for recent changes to the affected file/component |
| Is PII leaked? | Verify the error message contains no emails, tokens, or user IDs |
| Can I reproduce it? | Check if the error occurred in a repeatable flow (trip creation, checkout, etc.) |

### Step 2: Severity Validation

| Severity | Criteria | SLA | Actions |
|---|---|---|---|
| **CRITICAL** | App-breaking for all users (Sage down, checkout broken, auth broken) | 1 hour | Immediately tag CTO (5a914da0) via issue comment with `@CTO`, set issue priority=critical |
| **HIGH** | Feature broken for subset of users (search fails, itinerary not loading) | 4 hours | Investigate root cause. If can fix, do. If not, assign to CTO or Founding Engineer |
| **MEDIUM** | Non-critical failure (analytics not tracking, minor UI glitch) | 24 hours | Triage during next heartbeat. If low priority, move to backlog |
| **LOW** | Cosmetic or edge case (rare error path, expected failure handled gracefully) | Best effort | Acknowledge and close, or keep in backlog for monitoring |

### Step 3: Root Cause Investigation

Common investigation paths:

1. **Sage AI errors (error_ai_load, error_ai_timeout):**
   - Check OpenRouter dashboard for rate limits / quota usage
   - Check `health` endpoint for Sage AI provider connectivity
   - Review recent Sage prompt changes in git log

2. **API errors (error_api_error):**
   - Check server logs on vps-1: `journalctl -u travel_app -n 50 --no-pager`
   - Check if the error correlates with a recent deploy
   - Verify request/response in browser dev tools

3. **Third-party errors (error_third_party):**
   - Check Stripe dashboard for webhook failures
   - Check OpenRouter/Sentry for upstream outages
   - Verify API keys are valid and not expired

4. **Database errors (error_db_query):**
   - Check connection pool saturation
   - Check for slow queries in pg_stat_activity
   - Verify DB migration status

5. **Client-side errors (error_client_error):**
   - Check browser console logs
   - Verify feature flags are set correctly
   - Check if error correlates with specific browser/OS

### Step 4: Resolution

| Outcome | Action |
|---|---|
| Known issue, already tracked | Close the issue with a comment linking to the existing tracking issue |
| One-off / transient | Close with comment noting the error was transient and not reproducible |
| Real bug, can fix | Assign to appropriate engineer, add reproduction steps |
| Real bug, cannot fix | Assign to CTO with full investigation notes |
| False positive (PII leak, misclassification) | Fix the source (add PII sanitization, correct severity) and close |

---

## Escalation Path

| Situation | Escalate To | How |
|---|---|---|
| CRITICAL severity | CTO (5a914da0) | Tag in issue: `@CTO — CRITICAL error, app-breaking` |
| PII in error payload | CTO (5a914da0) | Tag in issue with the PII details (sanitized for the comment) |
| Recurring same error after fix | CTO (5a914da0) | Tag with recurrence count and previous fix reference |
| Monitoring script not creating issues | CTO (5a914da0) | Check PostHog API key, cron job, state file |
| System-wide outage | CEO (c2a215b2) + CTO | Tag both, set priority=critical |

---

## Monitoring Script Details

**Script:** `scripts/posthog-error-monitor.ts` (product repo, travel_itenerary_planning)
**Worker:** `workers/error-monitor.ts` — pg-boss recurring job
**Schedule:** Every 15 minutes (`*/15 * * * *`, pg-boss cron)
**State file:** `~/state/last_error_check`
**Batch threshold:** >=2 distinct error sources OR >=3 total events
**Max events per issue body:** 20
**Lock file:** `/tmp/posthog-error-monitor.lock` prevents concurrent runs
**Env vars:** `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, `POSTHOG_HOST`, `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`, optional `SUPPORT_ENGINEER_AGENT_ID`

### Verification Commands

```bash
# Manual run (one-shot)
cd /path/to/travel_itenerary_planning
POSTHOG_PERSONAL_API_KEY=... POSTHOG_PROJECT_ID=... \
  PAPERCLIP_API_URL=... PAPERCLIP_API_KEY=... \
  npm run monitor:posthog

# Check state file contents
cat ~/state/last_error_check

# pg-boss worker (long-running, cron mode)
npm run worker:error-monitor
```

---

## Related

- [Environment ReadEnum Corrupt Driver](kb/environment-readenum-corrupt-driver.md)
- [Recovery Phantom-Park Protocol](kb/recovery-phantom-park-protocol.md)
- [Heartbeat Max Concurrent Runs](kb/heartbeat-max-concurrent-runs.md)
- [Child-Only Blocker Reclassification](kb/blocker-attention-child-only-classification.md)