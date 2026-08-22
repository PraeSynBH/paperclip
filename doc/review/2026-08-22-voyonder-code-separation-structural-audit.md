# Staff Engineer Structural Audit — Voyonder Code Separation Phase 1

**Reviewer:** Staff Engineer (eee825c7)
**Date:** 2026-08-22 ~20:20 UTC
**Status:** APPROVED — no blocking issues

## Branch & Scope

**Branch:** `release/vo/voyonder-code-separation-phase-1`
**PR #70:** Merged (closed) — `feat(shared): Voyonder code separation — shared contract types (VOY-1657)`

Reviewed the accumulated code changes on this release branch, covering:

| Area | Scope |
|------|-------|
| VOY-1645/1669/1671 | Billing TOCTOU race fixes + upsert idempotency |
| VOY-1657 | Shared contract types (BackgroundJob, LiveEvent envelope) + workspace link |
| VOY-1659 S2 | BackgroundJobEvent wire format alignment |
| VOY-1609 | Feature gating / paywall logic |
| Migration 0229 | background_jobs + billing + knowledge + memory + notification tables |
| Code separation | pnpm-workspace ../voyonder reference, schema exports |

## Findings

### 1. Background Jobs Schema — ✅

| Concern | Verdict |
|---------|---------|
| CHECK constraints | status IN (queued,running,succeeded,failed), progress 0-100, duration >= 0 |
| Worker claim query index | Partial index `background_jobs_queued_status_idx` on status WHERE status='queued' — prevents seq-scan as table grows |
| Migration vs schema | All 5 indexes match between drizzle schema and migration SQL |
| FK onDelete | cascade — correct: job rows are owned by the company |
| Shared types | BackgroundJobEvent properly wraps in LiveEvent envelope (VOY-1659 S2 fix) |

### 2. Billing Race Fixes — ✅

| Concern | Verdict |
|---------|---------|
| TOCTOU race | Closed via transaction + ON CONFLICT DO UPDATE |
| Webhook at-least-once | INSERT ... ON CONFLICT (stripe_subscription_id) DO UPDATE — idempotent |
| Race between handlers | Shared `seedSubscriptionUsageRows` helper with ON CONFLICT DO NOTHING |
| Stripe customer lookup | Type-safe `getStripeCustomerId` helper replaces unsafe cast |
| Tests | Comprehensive concurrency tests covering upsert and race-lost paths |
| Retry logic | Exponential backoff for Stripe API calls (3 attempts, 200ms base) |

### 3. Migration 0229 — ✅

All indexes present and match drizzle schema definitions:
- background_jobs: 5 indexes (incl. partial index for worker claim)
- company_subscriptions: 2 indexes + unique constraint on company_id
- stripe tables: unique indexes on stripe IDs
- subscription_*: compound indexes on (company_id, period), unique on (subscription_id, metric, period)
- knowledge: compound indexes on (company_id, status/created/updated), unique on memory_record_id
- memory: compound indexes on scoped lookups, HNSW index for vector embeddings
- notifications: compound indexes, partial unique index for execution_error dedup

FK constraints use appropriate onDelete strategies:
- `cascade` — background_jobs, knowledge_documents, plan_review_gates
- `no action` — billing reference data (subscription_tiers, stripe_customers)
- `set null` — optional agent references (knowledge_documents.author_agent_id, plan_review_gates.assigned_agent_id)

### 4. Code Separation — ✅

| Concern | Verdict |
|---------|---------|
| pnpm-workspace.yaml | References `../voyonder` — correct external repo link |
| AGENTS.md | Updated with Voyonder repo status |
| Voyonder code in paperclip | All removed — app/ scaffold deleted, routes cleaned from app.ts |
| Shared types published | background-job-types.ts, types/background-job.ts exported from @paperclipai/shared |
| DB schema exported | backgroundJobs table exported from @paperclipai/db |

### 5. Feature Gating — ✅

| Concern | Verdict |
|---------|---------|
| Billing routes gated | Behind PAPERCLIP_BILLING_ENABLED env var |
| requireFeature middleware | Extracts companyId from req.params, delegates to billing.requireFeature |
| Paywall errors | Clear error messages per reason (no_subscription, subscription_inactive, etc.) |
| FREE_FEATURES | CUSTOM_PLUGINS always available; paid features require active/trialing |
| Degradation logic | cancelAtPeriodEnd properly detected; feature access denied after period end |

## Non-Blocking Observations

1. **requireFeature silent pass-through** — If mounted on a route without `:companyId` param, the middleware calls `next()` without error, making the gate invisible. Document this constraint or add a defensive log. (Low risk — routing is explicit.)

2. **getSubscriptionInternal 3-query pattern** — `subscription → tier → usage` queries are correct for single-company routes but would N+1 in a batch context. Fine for current usage patterns.

## CTO Review Cross-Check

The CTO (5a914da0) reviewed and approved Phase 1 at 2026-08-22 ~17:25 UTC (`doc/review/cto-voy-1658-review.md`). Two fixes fielded:
- `@types/*` moved from dependencies to devDependencies
- Duplicate constants dedup'd in research-search.ts

Both fixes are confirmed applied in the downstream voyonder repo. These do not affect the Paperclip monorepo scope.

## Delegation

| Step | Owner | Status |
|------|-------|--------|
| Implementation | Founding Engineer | ✅ DONE |
| CTO Review | CTO | ✅ APPROVED |
| Structural Audit | Staff Engineer | ✅ APPROVED (this document) |
| Release | Release Engineer | ⏳ Ready |
| QA Verification | QA Engineer | ⬜ Not started |

## Assessment

This branch is structurally sound. All code changes have been reviewed, merged upstream (PR #70), and the accumulated commits on this release branch are consistent with the code separation goal.

**Recommendation:** Approve for shipping once CTO gives final sign-off. Hand off to Release Engineer.