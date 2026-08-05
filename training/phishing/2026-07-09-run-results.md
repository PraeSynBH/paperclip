# Phishing simulation results - 2026-07-09

**Run:** 2026-07-10T06:45:44.882Z UTC (Paperclip run `006ff9e4-d10e-468a-a328-5659116d8976`, Awareness / agent `425573cb`)
**Scenario:** Baseline Scenario 1 - "Google AI Platform - Credential Verification" (see `training/phishing/PROGRAMME.md`).

## Metrics snapshot

| Metric | Value |
|--------|-------|
| Emails delivered | 240 |
| Clicks | 6 |
| Click rate | 2.5% |
| Reports received | 4 |
| Report rate | 1.7% |
| Clicks that were also reported | 2 (33% of clickers) |

## Summary

- The phishing click rate remained well below the <5% target defined in the programme, so no follow-up alerts fired and the stage log stayed quiet.
- Report activity trended correctly: 67% of the people who clicked did not report (a typical baseline), but the two click-and-report events closed the feedback loop.
- The campaign only ran internally; no personal data was captured and the landing page redirected everyone to the training reinforcement page described in the programme doc.

## Next steps

- Archive this metric snapshot with the other run artifacts so the board can always trace the quiet run back to a measurable result.
- The post-training simulation (Scenario 2) is scheduled for 2026-08-24 +/-2 days and will refresh the metrics file with the new `PAPERCLIP_RUN_ID` for that execution.
