---
title: PostHog Error Monitoring — Support Engineer Triage SOP
summary: SOP for triaging auto-created PostHog error issues (VOY-999)
status: draft
applies_to: VOY-999 / VOY-1015 release
---

# PostHog Error Monitoring — Support Engineer Triage SOP

**Version:** 1.2
**Date:** 2026-08-17
**Author:** Founding Engineer (57fa7e0e)
**Status:** Final — bash script deployed to scripts/; pending VPS-1 cron setup
**Applies to:** VOY-999 / VOY-1007 / VOY-1015

---

## Overview

The PostHog Error Monitoring system auto-creates Paperclip issues for production errors captured by PostHog and assigns them to the Support Engineer (agent 88b72065). This SOP defines how to triage, classify, and resolve those issues.

---

## How It Works

1. **Error capture:** The Voyonder frontend and backend call `trackErrorOccurred()` (lib/analytics.ts) / `trackErrorOccurredServer()` (lib/analytics-server.ts) with error details → PostHog
2. **Cron poll:** `scripts/posthog-error-monitor.sh` runs every 15 minutes via crontab on VPS-1, queries PostHog for new error_occurred events since last check
3. **Issue creation:** For each unique error signature (grouped by event+component+normalized message), a Paperclip issue is created:
   - **Title:** `[PostHog] {event}: {component} — {truncated message}`
   - **Priority:** Mapped from severity (critical→urgent, high→high, medium→medium, else→low)
   - **Assignee:** Support Engineer (88b72065)
   - **Parent:** VOY-999
   - **Body:** Event details with component, severity, URL, message, occurrences, affected users
4. **Deduplication:** Error signatures are normalized (UUIDs, timestamps, UNIX timestamps stripped) and cooldown prevents re-alerting on the same signature within 60 minutes
5. **State file:** `/var/tmp/posthog_monitor_last_check` tracks the last successful poll
6. **Pending retry:** If Paperclip API is unreachable, issue payloads are saved to `/var/tmp/posthog_pending/` and retried on the next run

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

**Script:** `scripts/posthog-error-monitor.sh` (bash, 441 lines)
**Schedule:** Crontab `*/15 * * * *` (every 15 minutes)
**State file:** `/var/tmp/posthog_monitor_last_check` (ISO timestamp of last successful check)
**Cooldown:** 60 minutes per error signature (prevents alert fatigue)
**Max issues per run:** 20
**Pending retry dir:** `/var/tmp/posthog_pending/` (saved if Paperclip API is unreachable)
**Env vars required:** `POSTHOG_API_KEY` (or `POSTHOG_PERSONAL_API_KEY`), `POSTHOG_PROJECT_ID`, `POSTHOG_HOST` (default: https://us.posthog.com), `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`
**Defaults:** `SUPPORT_ENGINEER_ID=88b72065-5f95-4e2b-a6df-48d04363f0d9`, `PARENT_ISSUE_ID=VOY-999`

### Verification Commands

```bash
# Manual run (one-shot) — must set env vars first
./scripts/posthog-error-monitor.sh

# Run test suite
bash scripts/test-posthog-monitor.sh

# Check state file
cat /var/tmp/posthog_monitor_last_check

# Add crontab entry (VPS-1)
crontab -e
# */15 * * * * /app/scripts/posthog-error-monitor.sh
```

---

## Related

- [Environment ReadEnum Corrupt Driver](kb/environment-readenum-corrupt-driver.md)
- [Recovery Phantom-Park Protocol](kb/recovery-phantom-park-protocol.md)
- [Heartbeat Max Concurrent Runs](kb/heartbeat-max-concurrent-runs.md)
- [Child-Only Blocker Reclassification](kb/blocker-attention-child-only-classification.md)