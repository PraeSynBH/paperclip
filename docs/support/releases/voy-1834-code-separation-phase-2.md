|---
title: VOY-1834 — Code Separation Phase 2 Release
version: 2026.817.0
date: 2026-08-22
commits: 9bfe95db64, 7d28ac572c, c6c725304e, f888a9e04c, ce8bd9340a, 2b02471f7c, 3acd2dd383
status: Released — packages published to npm, Voyonder consuming published packages
---

# Release: Code Separation Phase 2 (VOY-1834)

**Release:** Code Separation Phase 2
**Date:** 2026-08-22
**Status:** Released — packages published to npm, Voyonder consuming published packages

## Summary

This release completes the separation of Voyonder product code from the Paperclip monorepo, begun in Phase 1. The shared contract packages (`@paperclipai/shared` and `@paperclipai/db`) are now published to npm, and Voyonder consumes them as published dependencies rather than workspace links.

## What Changed

### @paperclipai/shared and @paperclipai/db Published to npm

The two packages that provide shared API contract types and database access are now published to npm:

- **@paperclipai/shared@0.3.3** — Shared types, constants, validators, and API path constants. Includes background job types (`BackgroundJob`, `BackgroundJobEvent`, `BACKGROUND_JOB_TYPES`) and the `LIVE_EVENT_TYPES` constant.
- **@paperclipai/db@0.3.3** — Drizzle schema, migrations, and database clients. Exports `backgroundJobs` table schema.

Both packages now include:
- `publishConfig` with proper ESM `exports` maps for Node.js consumers
- `prepublishOnly` script that runs the build before publishing
- Excluded migration `.sql` files from tarball (Drizzle schema metadata preserved)
- Compatible with pnpm, npm, and yarn

### npm Publish Configuration

| Detail | Value |
|--------|-------|
| Registry | npm (public) |
| Access | `public` |
| Package scope | `@paperclipai` |
| Version | 0.3.3 (semver) |
| License | MIT |

### Background Job Contract Types

The shared package now exports the API contract types for the background job system:

- `BackgroundJob` — Full job object with status, progress, payload, and result
- `BackgroundJobEvent` — SSE event payload for real-time status updates
- `BACKGROUND_JOB_TYPES` — Enum of all registered job type strings
- `background_job` status added to `LIVE_EVENT_TYPES` for SSE routing

### Voyonder Product — Migrated to Published Packages

The Voyonder product codebase now consumes `@paperclipai/shared` and `@paperclipai/db` as published npm packages instead of workspace-linked local packages. This means:

- Voyonder has its own independent dependency graph
- Version bumps in Paperclip packages no longer require pnpm-lock.yaml syncs in Voyonder
- Voyonder can be built and deployed independently of the Paperclip monorepo

### Workspace Cleanup

The in-repo `app/` scaffold (which belonged in the Voyonder repository) was removed from the Paperclip monorepo. The `pnpm-workspace.yaml` file includes `../voyonder` for local development convenience but the workspace is no longer required for Voyonder to function.

### Sentry Error Tracking Integration

Both the Paperclip server and Voyonder now include Sentry error tracking:

- **Server-side** — Express middleware (`sentryRequestHandler`, `sentryTracingHandler`, `sentryErrorHandler`) that captures unhandled errors and performance traces. Activated by setting `SENTRY_DSN`. No-op when unset — no Sentry packages are loaded.
- **Frontend-side** — React SDK integration with browser tracing, privacy-safe session replays, and automatic error capture. Activated by setting `VITE_SENTRY_DSN`. No-op when unset.
- **PII protection** — Request bodies are redacted in error events via `beforeSend` hooks. Query parameters in captured URLs are stripped.
- **Source map support** — Vite plugin for frontend source maps, manual upload path for server source maps.

### Knowledge Base System

The knowledge base feature is now fully documented and available:

- **Document lifecycle** — Draft → in review → published → archived with full revision history
- **Full-text search** — Search across all published knowledge documents by content
- **Backlinks** — Explicit references from knowledge documents to issues
- **Diff endpoint** — Compare any two revisions of a document
- **Knowledge Browser UI** — Dedicated knowledge base page at `/knowledge` for searching, browsing, reviewing, and creating documents

## Impact

### For Voyonder Developers

- Install `@paperclipai/shared` and `@paperclipai/db` from npm instead of relying on workspace links
- Use `npm install @paperclipai/shared@0.3.3 @paperclipai/db@0.3.3` (or `pnpm add`)
- No more lockfile churn from Paperclip package bumps
- Independent build and deployment pipeline

### For Platform Operators

- Sentry error tracking is available by setting `SENTRY_DSN` (server) and `VITE_SENTRY_DSN` (frontend)
- No configuration changes needed — Sentry is entirely opt-in and no-op by default
- Full knowledge base API available for company documentation

### For Self-Hosted Deployments

- No changes required — existing deployments continue to work identically
- The published packages are used by Voyonder; the Paperclip server itself still uses workspace links internally

## Configuration

### Sentry (Optional)

| Variable | Required | Description |
|----------|----------|-------------|
| `SENTRY_DSN` | No (server) | Server-side Sentry DSN |
| `VITE_SENTRY_DSN` | No (frontend) | Frontend Sentry DSN (exposed to browser) |
| `SENTRY_ENVIRONMENT` | No | Environment label (default: `NODE_ENV` or `production`) |
| `SENTRY_RELEASE` | No | Release version (default: auto-detected) |

## Known Limitations

| Issue | Status |
|-------|--------|
| Migration `.sql` files excluded from npm tarball — if you need runtime migrations, use the source repo or manage migrations separately | By design |
| `bundledDependencies` field removed from `@paperclipai/db` — incompatible with pnpm's default isolated node-linker | By design |
| Voyonder's Sentry integration is independent — no shared Sentry project configuration between Paperclip and Voyonder | By design |

## Related Documentation

- [Sentry Error Tracking](/sentry) — Full Sentry setup and configuration guide
- [Knowledge Documents API](/api/knowledge) — Knowledge base API reference
- [Knowledge Browser UI](/guides/board-operator/knowledge-browser) — Using the knowledge base in the board UI
- [Support Case: Background Jobs](/support/assessments/support-case-async-ux-background-jobs) — Async UX support assessment
- [AGENTS.md](/AGENTS.md) — Voyonder code separation status section

## Related Issues

- VOY-1657 — Voyonder code separation: shared contract types + workspace link
- VOY-1659 — BackgroundJobEvent type alignment with LiveEvent wire format
- VOY-1756 — npm publish config for @paperclipai/shared and @paperclipai/db
- VOY-1834 — Code Separation Phase 2 release (parent)