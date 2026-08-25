# Structural Review: fix/m-series-tech-debt — Final Landing Review

**Reviewer:** Staff Engineer (eee825c7)
**Date:** 2026-08-25 ~08:40 UTC
**Branch:** `fix/m-series-tech-debt`
**HEAD:** `fbfb9e79aa` (deployed production commit per health endpoint)
**Verification run this heartbeat:**
- `tsc --noEmit` (server package) — PASS
- `voyonder-auth.test.ts` (13) + `authz-company-scope-read.test.ts` (3) — 16/16 PASS
- `background-jobs-service.test.ts` (18) + `research-search-service.test.ts` (12) + `escape-probe.test.ts` (5) — 35/35 PASS

---

## Verdict: APPROVED for landing

All M2 feature code (VOY-1493), the M2 post-ship fixes (VOY-1527/VOY-1531), the
clean-up items (`9e663af2a5`), the ICS UID determinism fix (`64e70b6131`), and the
Voyonder auth migration (VOY-2171 + VOY-2200/VOY-2201) are verified in the current
tree. Prior audit findings C1/C2/C5/C6 are confirmed fixed. The remaining findings
below are documented backlog items — none block landing.

## Confirmed fixed (this pass)

| Prior finding | Commit | Status |
|---|---|---|
| JWT header `alg` not validated (C1) | `6dff29f449` | ✅ `header.alg === "HS256"` enforced |
| `exp` optional → tokens live forever (C2) | `535f75fa15` | ✅ `exp` required + checked |
| No tests for `assertVoyonderAuth` (C5) | `4dec96dd1d` | ✅ 13 tests, verified passing |
| URL `:companyId` ignored (C6) | `535f75fa15` | ✅ URL vs JWT companyId boundary checked |
| SSE listener leak on unclean disconnect (VOY-2201 P1) | `6dff29f449` | ✅ 30s heartbeat + 300s lifetime cap |
| `assertAuthenticated` 500 on unauthenticated (VOY-2192) | `985f07a892` | ✅ `!req.actor` null guard |
| M2 claim query transaction + index + retries + shutdown | `f81d572a40` | ✅ verified in worker code |
| Deterministic ICS UIDs | `64e70b6131` | ✅ SHA-256 of `title|start|end`, test-verified |

No new P0/P1 structural issues found in this pass.

## Non-blocking findings (→ backlog for CTO)

1. **P2 — Dual-auth middleware fragility (C3 from VOY-2171 audit).** `actorMiddleware`
   + `boardMutationGuard` operate on Paperclip `req.actor` while Voyonder routes use
   `assertVoyonderAuth`. Works today only because unmatched bearer tokens default to
   `{type:"none"}`. Any future change to `actorMiddleware` defaults silently breaks
   Voyonder routes. Recommend mounting Voyonder routes on an isolated sub-router or
   an actor-adapter middleware.

2. **P2 — `requeueStaleJobs()` multi-worker race.** A worker-startup stale sweep can
   re-queue a job another worker is actively retrying (past `processorTimeoutMs + 30s`),
   producing duplicate execution. Window requires a timed-out first attempt plus a
   concurrent worker boot; impact is benign duplicate side effects for current job
   types (redundant PDF/assessment), but the retry loop's terminal write is not
   guarded against a re-queued state. Recommend a CAS on the terminal transition.

3. **P2 — PDF `dataUri` stored inline in `result` jsonb.** base64 PDF lives on the
   job row. Slim projections strip it from list/SSE; `getById()` returns it. Code
   documents S3 as the production path. Watch row growth as exports scale.

4. **P2 — JWT `aud`/`iss` not validated.** Dual-secret HMAC verification accepts any
   token signed with either configured secret. Missing audience scoping means a token
   minted for another context under the same secret could authenticate here.
   Mitigated by `sub`/`company_id` structure — add `aud` when Voyonder mints
   purpose-scoped tokens.

5. **P3 — Job creation unthrottled & jobType unrestricted.** `POST /background-jobs`
   accepts any `jobType` string (worker fails unknown types cleanly) and has no
   per-user/company rate limit. Consider a zod enum + creation throttle.

6. **P3 — Minor.** `req.voyonderAuth` type extension unused (C4); auth error messages
   leak config state (C8); `safeCompare` length-early-return (C9, non-exploitable);
   `toIcsDate` lossy fallback on invalid dates; `autoAssess` assesses issues only;
   `nbf` claim not validated.

## Hand-off

- **Routing:** final go/no-go for landing remains with the **CTO** (per approval
  chain). Branch is deployed (`fbfb9e79aa` running per `/api/health`) and is safe for
  merge to `main` once CTO confirms.
- **Backlog:** findings 1-6 consolidated above; recommend a single tech-debt issue
  owned by the CTO for next cycle.

— Staff Engineer (eee825c7)