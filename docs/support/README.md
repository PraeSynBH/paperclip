---
title: Support Knowledge Base
summary: Internal support case assessments for Paperclip features
---

# Support Knowledge Base

This directory contains support case assessments for Paperclip features. Each document covers what the feature does, known limitations, troubleshooting steps, and support escalation paths.

## Recently Shipped Features

| Feature | Version | Shipped | Assessment |
|---|---|---|---|
| Deep Planning — Plan Documents, Review Gates, Decomposition | v0.4.0-alpha | Aug 16, 2026 | [View](assessments/support-case-v0.4.0-deep-planning.md) |
| Memory & Knowledge — pgvector Memory, Knowledge Documents | v0.4.0-alpha | Aug 16, 2026 | [View](assessments/support-case-v0.4.0-memory-knowledge.md) |
| Stripe Billing Robustness Fixes | v0.2.13 | Aug 15, 2026 | [View](assessments/support-case-stripe-billing-fixes.md) |
| Legal Pages (Privacy Policy + Terms of Service) | v0.2.12 | Aug 15, 2026 | [View](assessments/support-case-legal-pages.md) |
| Domain Revert to voyonder.com | v0.2.10 | Aug 15, 2026 | [View](assessments/support-case-domain-revert.md) |
| Status Compare-and-Set (RBR-929/950/951/953) | v2026.626.0 | Jul 2026 | [View](status-compare-and-set.md) |
| Task Watchdogs | v2026.626.0 | Jun 26, 2026 | [View](task-watchdogs.md) |
| Ask Work Mode | v2026.626.0 | Jun 26, 2026 | [View](ask-work-mode.md) |
| Skills Store | v2026.618.0 | Jun 18, 2026 | [View](skills-store.md) |
| Company Artifacts | v2026.609.0 | Jun 9, 2026 | [View](company-artifacts.md) |

## Knowledge Base Articles

| Article | Covers | Commit | Issue |
|---|---|---|---|
| [Environment Driver Corruption — readEnum()](kb/environment-readenum-corrupt-driver.md) | `readEnum()` returns `null` instead of throwing on corrupt driver values | `32ccc16229` | PRA-577 |
| [Recovery Phantom-Park-and-Revalidate](kb/recovery-phantom-park-protocol.md) | Recovery system temporarily parks terminal issues for recovery action execution | `7f84af039b` | RBR-921/RBR-953 |
| [Heartbeat Max Concurrent Runs Enforcement](kb/heartbeat-max-concurrent-runs.md) | `tickTimers` checks maxConcurrentRuns before enqueueing | `b9d5299816` | PRA-553 |
| [Billing Downgrade-to-Free on Cancellation](kb/billing-cancellation-downgrade.md) | Subscription cancellation downgrades tier on next login | `83a1cee` | VOY-944 |
| [Child-Only Blocker Reclassification](kb/blocker-attention-child-only-classification.md) | Blocked issues with only child blockers now show `needs_attention` | `6b0b118367`+`7f84af039b` | RBR-824 |

## Standard Operating Procedures

| Document | Covers | Status |
|---|---|---|
| [PostHog Error Monitoring Triage](posthog-error-monitoring-triage-sop.md) | SOP for triaging PostHog error issues auto-created by the monitor | Implementation landed (83db54a); awaiting release |

## Planned Assessments

- Status Compare-and-Set (RBR-929/950/951/953) — ✅ assessed, see above
- Sandbox Execution (Kubernetes provider) — v2026.618.0
- Workspace File Viewer — v2026.618.0
- Inline Document Annotations — v2026.529.0
- Company Skills CLI — v2026.529.0
- Routine Secrets — v2026.525.0

## File Naming Convention

- `kb/{topic-slug}.md` — Knowledge base articles for specific behavioral changes
- `{feature-name}-sop.md` — Standard operating procedures for recurring processes
- `{feature-name}.md` — Feature support case assessments

## Document Maintenance

Each KB article includes:
- The Paperclip version it applies to
- The commit hash and issue ID it documents
- The old and new behavior (when applicable)
- Support implications
- Verification/debugging guidance

Documents are updated when:
1. A new commit changes the behavior described
2. A release ships that includes the change
3. Support discovers gaps or edge cases not covered

---

## Voyonder Release Notes

| Release | Notes |
|---|---|
| v0.4.0-alpha — Deep Planning + Memory & Knowledge | [View](releases/v0.4.0-alpha-deep-planning.md) |
| v0.2.13 — Stripe billing fixes | [View](releases/v0.2.13-stripe-fixes.md) |
| v0.2.12 — Legal pages | [View](releases/v0.2.12-legal-pages.md) |
| v0.2.10 — Domain revert | [View](releases/v0.2.10-domain-revert.md) |

---

*Last updated: 2026-08-16*
*Maintained by: Support Engineer (88b72065)*