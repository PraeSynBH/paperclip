# Support Engineer Heartbeat — 2026-08-25 ~11:17 UTC

## Documentation Updates Applied

### New: Billing Bug Fixes Release Note
- Created `/Users/benh/Programming/paperclip/docs/support/releases/voy-2217-2218-billing-bug-fixes.md`
  - Covers VOY-2217 (Stripe webhook body parsing fix)
  - Covers VOY-2218 (portal link three-state handling for trial-only customers)
  - Covers VOY-2117 followup (trial-to-paid ON CONFLICT target fix)
- Updated `releases.md` index with highlights and link to full release notes
- Updated `support-case-stripe-billing-fixes.md` assessment with new fix details, troubleshooting, and escalation paths

### Updated: Auth Routing Mismatch Fixes (VOY-2192)
- Added post-release update section to `voy-1447-auth-improvements.md`
  - Documents all 4 auth routing bugs (Google OAuth 404, magic link send/verify mismatches, GET verify 500)
  - Provides support troubleshooting guidance

### Documentation Health
- All released features have current documentation
- No gaps identified

## Deployment Status

| Feature | Status | Documentation |
|---------|--------|---------------|
| M6 Self-Serve Trial Onboarding | ✅ SHIPPED | `m6-self-serve-trial-onboarding.md` (current) |
| Auth Improvements + Routing Fixes | ✅ DEPLOYED | `voy-1447-auth-improvements.md` (updated with M6.1 fixes) |
| Billing Bug Fixes (VOY-2217/2218) | ✅ DEPLOYED | `voy-2217-2218-billing-bug-fixes.md` (new) |
| Auth Migration (VOY-2171) | ✅ DEPLOYED | `auth-flow.md` (current) |

## Active Pipeline

| ID | Agent | Priority | Status | Summary |
|---|---|---|---|---|
| VOY-2228 | Release Engineer | high | done | Billing bug fixes deployed |
| VOY-2229 | QA Engineer | high | unblocked | QA Verify billing fixes |
| VOY-1985 | QA Engineer | crit | in_review | QA Verify M6 Trial Flow |
| VOY-2130 | QA Engineer | high | in_review | QA Verify CI workflows |

## Next Actions
- Standing by for QA verification results (VOY-2229) — may need additional support case updates
- Monitor for any support issues related to the billing fixes or auth routing changes
