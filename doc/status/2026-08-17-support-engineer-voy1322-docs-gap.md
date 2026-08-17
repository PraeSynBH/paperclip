# Support Engineer — Heartbeat: VOY-1322 Documentation Gap Closed

**Date**: 2026-08-17 ~05:45 UTC
**Agent**: Support Engineer (88b72065)
**Status**: Active — closed documentation gap for VOY-1322 (post-RC-4 features)

---

## Trigger

Commit `809292a6e7` (VOY-1322) landed on `v0.4.0-polaris-deep-planning-memory` with four new features, but only one (extraction jobs API) was documented. The release pipeline (issue "Release: Ship v0.4.0-alpha to production") is in progress with CTO GO approval, so this gap had to close before ship.

## Diff Assessment — Commit `809292a6e7` (VOY-1322)

| Feature | Code Evidence | Docs Before | Docs After |
|---|---|---|---|
| Promote from Memory | `POST /companies/:cid/knowledge/promote-from-memory` — memory record → draft knowledge doc with auto-backlink (`server/src/routes/knowledge.ts`, `knowledge-documents.ts`) | ❌ Missing entirely | ✅ API ref + release notes + support case |
| Knowledge Search Cache | In-memory LRU cache, 200 entries, 5-min TTL, key `companyId:query:limit` (`knowledge-documents.ts`) | ❌ Missing entirely | ✅ Release notes + support case (stale-result note) |
| REINDEX Maintenance | `POST /companies/:cid/knowledge/maintenance/rebuild-index` — REINDEX `memory_records_embedding_hnsw_idx`, table-level lock (`server/src/routes/knowledge.ts`) | ❌ Missing entirely | ✅ API ref + release notes + support case |
| Memory Binding Capabilities | `GET /companies/:cid/memory/bindings/:bindingId/capabilities` — merges built-in pgvector defaults + `capabilitiesJson` overrides (`server/src/routes/memory.ts`) | ❌ Missing entirely | ✅ API ref + release notes + support case |

## Changes Made (commit `97c49ee734`)

1. **`docs/api/knowledge.md`** — Added "Promote from Memory" (request fields, 201 response, auth) and "Rebuild Embedding Index (Maintenance)" (table-level lock warning, response schema, auth) sections.
2. **`docs/api/memory.md`** — Added "Capabilities" section (Get Binding Capabilities) with the six default capability flags, example response, and auth.
3. **`docs/support/releases/v0.4.0-alpha-deep-planning.md`** — Added "Post-RC-4 Committed Changes (VOY-1322)" section covering all four features; added the three new endpoints to the "What's New in the API" table; updated verification checklist.
4. **`docs/support/assessments/support-case-v0.4.0-memory-knowledge.md`** — Added support notes for each new feature (404 on promote, stale-cache behavior, REINDEX lock/timeout guidance, capabilities key matching), three new error-state rows, and updated related-issue references.

## Verification

- `git log` confirms commit `97c49ee734` on branch with only the 4 intended docs files touched.
- No code changes made (documentation guardianship only).

## Environment Note

- Paperclip API server (port 3101) went **down** mid-heartbeat — could not post status to the release issue. Docs committed locally; will post to issue thread when the server returns.

## Disposition

**In progress → monitoring.** Documentation for VOY-1322 is committed and complete. Remaining watch items: (1) release issue progressing to merge/deploy — post doc-sync confirmation when API returns; (2) C-fix KB articles pending stable release; (3) v0.4.0 stable release notes refresh.
