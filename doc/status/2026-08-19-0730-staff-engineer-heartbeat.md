# Staff Engineer Heartbeat — 2026-08-19 ~07:30 UTC

## Cycle Summary

Heartbeat wake. No active review work — no branches are awaiting pre-landing review.

## Board State (verified via Paperclip API, ~07:30 UTC)

| Status | Count | Notes |
|--------|-------|-------|
| in_progress | 1 | QA: Google OAuth E2E Verification (VOY-441, QA Engineer) |
| in_review | 0 | — |
| blocked | 2 | Docs deploy (VOY-1413, CEO-gated), Mintlify setup (VOY-1421, founder-gated) |
| todo | 0 | — |
| approved | 0 | — |

- All issues ever assigned to Staff Engineer are in terminal state (done/cancelled).
- Board is human-gated on CEO/founder for both blocked items.

## Git State

- **Branch:** `voy-1420-posthog-p2-fixes`
- **Status:** Uncommitted working tree changes (Google OAuth implementation + PostHog auth hooks + postgres prepare:false + SQL alias fixes)
- **Committed VOY-1420 P2 work:** Already shipped to `fork/master` per commit `64271d8c39` and `f54710d402`
- **Stash:** WIP on this branch preserves VOY-1435 fix

The working tree contains significant uncommitted additions that appear to implement:
1. Google OAuth sign-in (VOY-406) — better-auth social provider + UI button + tests
2. PostHog auth lifecycle events (`auth.signup_completed`, `auth.session_started`)
3. Global `{ prepare: false }` on postgres.js connection
4. SQL column alias fixes (AS "score") for knowledge-search queries

## Structural Review: Working Tree Changes

I reviewed the uncommitted delta against `HEAD` for structural issues. Findings below.

### Finding 1: `{ prepare: false }` is a blunt global fix (moderate concern)

**File:** `packages/db/src/client.ts:50`

```ts
const sql = postgres(url, { prepare: false });
```

This disables prepared statements for **all** database queries globally. The original issue (VOY-1331) was a prepared-statement problem with drizzle against embedded PGlite. Disabling prepares globally:
- Forces a full query-plan parse on every query (performance regression)
- Bypasses postgres.js's binary-format prepared-statement optimizations
- Massively increases network round-trips (prepared statements skip the parse step)

**Recommendation:** Scope this to embedded-PG mode only, or fix the underlying drizzle adapter issue rather than disabling prepares globally. If this is intended as a temporary fix, document the tracking issue.

### Finding 2: `resolveLoginMethod` URL parsing — correct for typical case, fragile on URL variants (low concern)

**File:** `server/src/auth/better-auth.ts:140-152`

```ts
const rawUrl = ctx.request.url;
const pathname = rawUrl.includes("?") ? rawUrl.split("?")[0] : rawUrl;
```

The function assumes `request.url` is a pathname + query string (e.g., `/callback/google?code=xyz`). In the standard better-auth Express/Fetch adapter this is true, so it works. However, this will silently return `"unknown"` if:
- The URL is a full absolute URL (e.g., behind a proxy that rewrites it)
- The path has no leading slash or has encoding

**Recommendation:** Low priority, but would be more robust to use `new URL(rawUrl, "http://localhost").pathname` to safely extract the pathname regardless of format. Open a follow-up if this misclassifies auth events in production.

### Finding 3: PostHog hooks add synchronous latency to auth hot path (medium concern)

**File:** `server/src/auth/better-auth.ts:194-210`

The `databaseHooks` handlers `await captureMetric(...)` inside the auth creation path. The try/catch prevents auth failure, but PostHog latency directly delays auth responses. If PostHog is slow or unreachable, every sign-up and sign-in is delayed by the timeout.

**Recommendation:** Use fire-and-forget (`.catch()` on the promise without awaiting) rather than try/catch with await. This keeps PostHog failure from affecting auth latency without losing the error logging. Pattern:

```ts
captureMetric("auth.signup_completed", user.id, {
  login_method: loginMethod,
}).catch(err => logger.warn({ err }, "[auth] PostHog metric failed"));
```

### Finding 4: Google OAuth UI — correctly implemented (no issues)

The `signInWithGoogle` API client, the Auth.tsx button, and the test coverage all follow existing patterns correctly. The redirect-after-oauth flow is properly handled. Tests cover both success and failure paths. No structural issues.

### Finding 5: SQL alias fixes — correct

The `AS "score"` additions in `knowledge-documents.ts` and `memory-context-injection.ts` fix ambiguous column references in ts_rank results. These are the C-fix items from the earlier review cycle. Correct and no issues.

## Disposition

**Idle** — Board clear of Staff Engineer action items. All issues ever assigned to Staff Engineer are in terminal state. No branches awaiting pre-landing review.

Working tree has uncommitted Google OAuth + PostHog auth event code. Finding 3 (synchronous PostHog in auth hot path) and Finding 1 (global prepare:false) should be addressed before this code ships to production, but neither is a hard review blocker — both are structural improvements for a follow-up commit.

Next triggers:
- CTO/engineers assign a branch for pre-landing review
- QA Engineer completes VOY-441 verification → release chain may need re-review
- CEO/founder unblock VOY-1413/1421 → docs deploy verification
- New implementation branches enter the pipeline
