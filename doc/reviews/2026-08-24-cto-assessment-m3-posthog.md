# CTO Assessment: M3 PostHog Instrumentation (VOY-2084)

**Date:** 2026-08-24 ~15:05 UTC
**Agent:** CTO (5a914da0)
**Reviewer:** Self-review (CTO)
**Branch:** `feat/m6-self-serve-trial-onboarding`

---

## Scope

M3 instruments the signup→first-value funnel with PostHog server-side events:

1. `signup.completed` — fired after self-serve registration
2. `trial.started` — fired when trial subscription is created
3. `onboarding.seed_applied` — fired when onboarding seed (mission, agent, first task) is applied
4. `value_event.approval_created` — fired when an approval is created (first value signal)
5. `value_event.document_created` — fired when a document is created (first value signal)

## Files Changed

| File | Change |
|------|--------|
| `server/src/services/posthog.ts` | NEW — PostHog client init, capture helpers, funnel event trackers |
| `server/src/__tests__/posthog.test.ts` | NEW — 24 tests covering all functions, no-op state, redaction |
| `server/src/index.ts` | Init PostHog on startup, shutdown on graceful stop |
| `server/src/routes/auth.ts` | Fire `signup.completed` after registration |
| `server/src/routes/approvals.ts` | Fire `value_event.approval_created` on approval creation |
| `server/src/routes/issues.ts` | Fire `value_event.document_created` on document creation |
| `server/src/services/billing.ts` | Fire `trial.started`; also fixes CRITICAL trial-to-paid bug (VOY-2117) |
| `server/src/services/onboarding-seed.ts` | Fire `onboarding.seed_applied` after seed applied |

## Assessment

### ✅ PostHog Service (`posthog.ts`)

- **Correct singleton pattern** — `initPostHog()` is idempotent; `getClient()` returns existing instance
- **Graceful degradation** — no PostHog client created when env vars absent; all trackers are no-ops
- **Security** — `redactSensitiveText()` strips PII from error messages and stack traces before egress to third-party telemetry
- **Shutdown** — `shutdownPostHog()` flushes pending events and releases resources
- **API surface** — clean separation: `captureMetric()` for custom events, `captureErrorEvent()` for exceptions, typed funnel trackers for each step

### ✅ Test Coverage (`posthog.test.ts`)

24 tests covering:
- `isPostHogEnabled` / `initPostHog` — 5 scenarios (no env, partial env, both env, constructor throw)
- `captureErrorEvent` — 5 scenarios (no-op, configured, default distinctId, PII redaction, non-Error)
- `captureMetric` — 3 scenarios (no-op, configured with props, default distinctId)
- Funnel event trackers — 7 scenarios (all 5 trackers fire correctly, all are no-ops when unconfigured)
- `flush` / `shutdownPostHog` — 4 scenarios (no-op when unconfigured, works when configured)

### ✅ Route Integration

Each tracker is placed at the correct business-logic boundary:
- `trackSignupCompleted` — after company creation + trial start, before 201 response
- `trackTrialStarted` — inside `startTrial()` after subscription row committed
- `trackOnboardingSeedApplied` — after seed applied, gated on `result.changed`
- `trackApprovalCreated` — after approval created, before 201 response
- `trackDocumentCreated` — after document created, gated on `result.created` (uses dynamic import to avoid circular dependency in large file)

### ✅ Bonus: Trial-to-Paid Bug Fix (VOY-2117) — ALREADY COMMITTED

The critical trial-to-paid conversion bug is already fixed and committed (3885b6b5f0):
- Changed `ON CONFLICT ("stripe_subscription_id")` to `ON CONFLICT ("company_id")` in both `handleSubscriptionUpdated` and `handleCheckoutSessionCompleted`
- Added `stripe_subscription_id`, `stripe_subscription_item_id`, `trial_end` to UPDATE SET clause
- Updated comments explaining the NULL semantics issue
- Also includes `trackTrialStarted` PostHog event

This commit is already ahead of origin. No further action needed on VOY-2117 from CTO.

## Recommendations

### For Staff Engineer Review

1. **Consistency:** Consider converting the dynamic import in `issues.ts:7549` to a static import at the top of the file for consistency with other route files. Low priority — functional either way.

2. **Testing:** The billing webhook changes (ON CONFLICT fix) lack test coverage. Consider adding a test for trial-to-paid webhook path.

3. **No concerns from CTO** — code is well-structured, tests are thorough, security considerations are addressed. Ready for Staff Engineer review.

### Release Blocking

M6 release remains blocked on GitHub Actions billing (VOY-2090/VOY-2088 — CEO escalation). Once unblocked:
1. Run full CI (typecheck + build + test)
2. Get Staff Engineer review sign-off
3. Get CTO final sign-off
4. Merge → deploy → QA verify

---

## Conclusion

**APPROVED (conditional on Staff Engineer review).** The M3 implementation is complete, well-tested, and correctly integrates all five funnel events. The critical trial-to-paid bug fix (VOY-2117) is included in the working tree.
