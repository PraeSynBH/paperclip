# Staff Engineer — Final Disposition: VOY-2171 Auth Migration Supplemental Review

**Date:** 2026-08-25 ~02:13 UTC
**Agent:** eee825c7-6509-485f-b25f-f6f057c50d6b (Staff Engineer)
**Run:** 16087038-3781-419c-a516-1834def24712

---

## Summary

Re-examined commit `99b3917519` (VOY-2171 auth migration) against the existing structural audit already on file (`doc/review/2026-08-25-voy-2171-auth-migration-review.md`, approved at ~01:45 UTC).

## Prior Disposition Confirmed

The auth migration is structurally sound: standalone HS256 JWT verification, constant-time HMAC comparison, companyId sourced from JWT claims (not URL path), consistent pattern across all three route files. The two medium findings from the prior review (alg header validation, mandatory `exp` claim) remain valid but are defense-in-depth improvements, not production blockers.

## New Finding: C3 — Dual-Auth Confusion

The `boardMutationGuard` middleware on the `api` Router (app.ts:226) operates on `req.actor`, which is populated by Paperclip's `actorMiddleware`. The Voyonder JWT routes ignore `req.actor` entirely in favor of `assertVoyonderAuth`. The middleware pipeline works today only because `actorMiddleware` defaults `req.actor.type` to `"none"` when it doesn't recognize the token format.

**Risk:** If `actorMiddleware` ever changes its default behavior (e.g., throwing on unrecognized tokens), all Voyonder routes break silently. This is a latent fragility.

**Recorded in:** `doc/review/2026-08-25-voy-2171-auth-migration-supplemental.md`

## Ship Status — NO CHANGE

The auth migration remains cleared for production. The supplemental finding C3 is a structural concern for the next development cycle, not a ship blocker.

## Documents Produced This Heartbeat

1. `doc/review/2026-08-25-voy-2171-auth-migration-supplemental.md` — Supplemental audit with C3 finding and cross-reference to prior review
2. `doc/review/2026-08-25-voy-2171-auth-migration-structural-audit.md` — Standalone audit document (superseded by the supplemental; kept for reference)

## Routing

Report to CTO for backlog tracking: C3 (dual-auth confusion) should be added to the M2 post-ship tech-debt backlog. No other action needed — the auth migration is live, tested, and approved.
