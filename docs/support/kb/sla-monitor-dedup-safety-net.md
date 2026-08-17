---
title: Support KB — SLA Monitor Alert Dedup Hardening
summary: Post-insert duplicate verification prevents near-simultaneous duplicate SLA alert tracking issues from concurrent requests (75c6c27a41)
version: v0.4.0
commit: 75c6c27a41
---

# Support KB: SLA Monitor Alert Dedup Hardening (TOCTOU Safety Net)

**Applies to:** Paperclip v0.4.0+ (commit `75c6c27a41`)
**Tag:** Post-insert SLA dedup safety net
**Related:** C-2, VOY-1298, VOY-1313
**Date:** 2026-08-17

---

## Summary

The SLA monitor creates a tracking issue when a premium-tier SLA breach is detected. The dedup check (matching by title pattern) previously ran **before** the INSERT — a classic time-of-check to time-of-use (TOCTOU) window. Two concurrent requests could both pass the pre-insert check and both create a tracking issue, producing duplicate alerts for the same breach.

A **post-insert duplicate verification** now re-checks for a near-simultaneous duplicate **after** the row is committed. If a duplicate exists, the newer issue is hidden, cancelled, and linked back to the original — so only one visible tracking issue remains per breach.

## Old Behavior

- Pre-insert dedup check by title pattern only.
- Two concurrent SLA-alert requests could both create a tracking issue (duplicate alerts).

## New Behavior

1. The pre-insert dedup check still runs (fast path — most duplicates caught here).
2. **After the INSERT**, the server re-checks for a duplicate in the same dedup window.
3. If a near-simultaneous duplicate exists:
   - The new issue is **hidden** (`hiddenAt` set) and **cancelled**.
   - A comment is added to the **original** issue: `## Duplicate SLA Alert Suppressed` — explaining a concurrent request also created an issue that was hidden and linked.
   - The response returns the **original** issue enriched with `deduplicated: true`, `deduplicatedOfIssueId`, and `deduplicatedOfIdentifier`.

## Support Implications

1. **"I see a cancelled/hidden SLA alert issue"** — this is expected behavior when two requests raced. The visible tracking issue is the original; the hidden duplicate is linked as a reference comment. No user action needed.
2. **"I got a response with `deduplicated: true`"** — the API returned the original issue instead of the new one. The requester should use the returned issue ID (the original) for follow-up.
3. **Rarely-visible**: this safety net only triggers on genuine concurrency. Single-request flows are unaffected.

## Verification

- Trigger two SLA-alert creation requests concurrently (e.g., two curl processes in parallel with the same breach signature). Exactly one visible tracking issue should result.
- Check the original issue's comments for the `## Duplicate SLA Alert Suppressed` note.
- Confirm the hidden duplicate has `status: cancelled` and `hiddenAt` set.

## Related Documentation

- [v0.4.0-alpha release notes](../releases/v0.4.0-alpha-deep-planning.md)
- Support cases involving SLA alerting (internal monitoring)