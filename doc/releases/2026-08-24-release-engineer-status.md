# Release Engineer Status — 2026-08-24 ~14:10 UTC

## Issue: VOY-1984 — Release M6 Trial Feature (Voyonder)

### Current State: BLOCKED

The M6 release is fully staged and ready to ship, but blocked on **VOY-2088** (GitHub Actions billing).

### Completed Deliverables
- ✅ All 3 implementation phases complete
- ✅ All 3 code reviews approved
- ✅ CI pipeline fixes applied (merge conflict resolved, PR #78 mergeable)
- ✅ Must-fix patches committed (pg_advisory_xact_lock, trial expiry index, publishLiveEvent guard)
- ✅ Documentation in sync per Support Engineer

### Critical Blocker
**GitHub Actions billing failure** on PraeSynBH/voyonder
- Root cause: Free-tier User account with exhausted private repo minutes
- Fix: Upgrade to GitHub Pro ($4/month) at https://github.com/settings/billing
- Owner: Ben (human with GitHub admin access)
- Reference: VOY-2088, VOY-2090

### Remaining Gaps
1. **expireTrials() reaper** — Support Engineer flagged this as unscheduled, but code review confirms it IS wired via `setInterval` (30-min interval) and startup hook in `server/src/index.ts:1582-1605`. Can be confirmed and closed.
2. **CI validation** — Cannot run until billing is resolved
3. **CTO sign-off** — Pending CI green
4. **Production deploy** — After CTO sign-off

### When Unblocked
1. Run `pnpm run typecheck && pnpm run build && pnpm run test`
2. Get CTO sign-off via `request_confirmation`
3. Call Support Engineer to verify docs in sync
4. Bump version, update changelog
5. Merge PR #78 → deploy to production
6. Verify production health

### Note
API writes to Paperclip issues are unavailable from this session (run context not associated with an issue checkout). Status reported via local document and runtime status channel.
