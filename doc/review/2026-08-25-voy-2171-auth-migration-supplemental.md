# Supplemental Audit: VOY-2171 Auth Migration — Additional Findings

**Supplement to:** `doc/review/2026-08-25-voy-2171-auth-migration-review.md`
**Reviewer:** Staff Engineer (eee825c7)
**Date:** 2026-08-25 ~02:12 UTC
**Commit:** `99b3917519`
**Branch:** `fix/m-series-tech-debt`

---

## Context

The primary structural audit of VOY-2171 completed at ~01:45 UTC and APPROVED the auth migration with 2 medium findings (alg header validation, mandatory `exp` claim). This supplementary note records additional concerns discovered during re-examination of the full middleware stack interaction.

## New Finding

### ⚠️ HIGH — C3: Dual-Auth Confusion — `boardMutationGuard` Operates on Stale `req.actor`

**Files:** `server/src/app.ts:226`, `server/src/middleware/board-mutation-guard.ts:54`, `server/src/middleware/auth.ts:24-35`
**Not covered in prior review.**

The `api` Router (app.ts:225) applies `boardMutationGuard()` as global middleware for ALL API routes, including the Voyonder JWT-authenticated background-jobs, exports, and research routes. The guard reads `req.actor.type` — but `req.actor` is populated by Paperclip's `actorMiddleware` (app.ts:210), which runs BEFORE the `api` router.

**How it currently works (by accident, not design):**

1. `actorMiddleware` runs: if the request carries a Voyonder JWT (not a Paperclip token), the Bearer token doesn't match any Paperclip auth format, so `req.actor` defaults to `{ type: "none", source: "none" }` (auth.ts:35).
2. `boardMutationGuard` runs: checks `req.actor.type !== "board"`. Since it's `"none"`, the guard passes through immediately (board-mutation-guard.ts:54-57).
3. The route handler calls `assertVoyonderAuth(req)`, which independently validates the Voyonder JWT.

**Why this matters:**

- **Brittle dependency on default behavior.** If `actorMiddleware` ever changes its default (e.g., throwing an error for unrecognized Bearer tokens instead of defaulting to `"none"`), all Voyonder routes break silently.
- **Dead code hazard.** `boardMutationGuard` looks like it protects these routes but it doesn't — it's a no-op for Voyonder JWT callers. A future developer adding middleware to the `api` router that relies on `req.actor` will make incorrect auth decisions.
- **No isolation.** Voyonder JWT routes and Paperclip routes share the same middleware pipeline but use independent auth systems. A middleware added for Paperclip auth could block Voyonder routes, or vice versa, in ways unit tests won't catch.

**Recommendation for the next review cycle:**
- Option A: Mount Voyonder routes on a separate sub-router that skips `boardMutationGuard` and `actorMiddleware`.
- Option B: Write a Voyonder-to-actor adapter middleware that translates `assertVoyonderAuth` results into `req.actor` format, so downstream middleware sees consistent auth state.
- Option C: Add an explicit guard in `boardMutationGuard` that skips its check for Voyonder-authenticated requests (check for `req.header("authorization")` being a Voyonder JWT format).

This is not a production blocker today — the code works by accident of the default behavior. But it is a structural fragility that will cause a confusing bug when someone touches `actorMiddleware`.

## Previously-Covered Findings (re-audited, confirmed)

| Finding | Prior Severity | Status |
|---------|---------------|--------|
| C1: JWT header algorithm not validated | Medium | Confirmed — unchanged |
| C2: Missing required JWT claims | Medium | Confirmed — `exp` still optional, no `iat`/`nbf` |
| C4: `req.voyonderAuth` never set | Low | Confirmed — code/doco mismatch |
| C5: No tests for `assertVoyonderAuth` | High | Confirmed — zero coverage |
| C6: Route path `:companyId` ignored | Low | Confirmed — covered in doc as "validated but ignored" (actually not validated) |
| C7: `createdByActorId` semantics changed | Low | Confirmed — acceptable for Voyonder-only deployment |
| C8: Error messages leak config state | Low | Confirmed — `"Auth secret not configured"` reveals server state |
| C9: `safeCompare` length leak | Informational | Confirmed — non-exploitable (fixed-length HMAC output) |

## Disposition

The auth migration (VOY-2171) was APPROVED in the prior review and is deployed to production. The new finding C3 (dual-auth confusion) is a structural concern that should be addressed in the next development cycle — it represents a real but latent fragility, not an active production issue.

**No change to landing status.** The branch remains cleared for the M6 release. Flag for the CTO: C3 should be added to the M2 post-ship tech-debt backlog.

---

*Staff Engineer, 2026-08-25 02:12 UTC*
