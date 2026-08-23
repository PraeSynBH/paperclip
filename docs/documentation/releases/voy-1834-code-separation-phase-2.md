# Code Separation Phase 2 — August 22, 2026

**Release status:** Live — packages published to npm

### Highlights

- **@paperclipai/shared and @paperclipai/db published to npm** — The two shared packages that provide API contract types and database access are now available on npm. Voyonder and any other consumer can install them as standard dependencies instead of relying on workspace links.

- **Background job types in shared package** — The shared package now exports `BackgroundJob`, `BackgroundJobEvent`, `BACKGROUND_JOB_TYPES`, and related constants — the API contract types for the background job system.

- **Voyonder migrated to published packages** — The Voyonder product code now consumes @paperclipai/shared and @paperclipai/db as published npm packages, enabling independent build and deployment.

- **Sentry error tracking** — Optional error tracking for both server and frontend, with configurable DSN via environment variables. Controlled error reporting with PII redaction, performance tracing, and privacy-safe session replays. Entirely opt-in — no-op when not configured.

- **Knowledge base system** — Full knowledge base with document lifecycle (draft → review → published → archived), revision history, backlinks to issues, and full-text search. Dedicated Knowledge Browser UI at `/knowledge`.

[Full release notes →](/support/releases/voy-1834-code-separation-phase-2)