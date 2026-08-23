# VOY-1874: Knowledge Base / FAQ — Wiring Complete

## Summary
The Knowledge Base and FAQ system implementation was largely complete from a
previous timed-out run. This heartbeat completed the wiring that connects all
the pieces together.

## What Already Existed (from previous run)
- DB schema: 4 tables (knowledge_documents, knowledge_document_revisions,
  knowledge_document_reviews, knowledge_source_backlinks) — already in
  migration 0229
- Service: Full CRUD, review/publish workflow, revisions, diffs, backlinks,
  search (`server/src/services/knowledge.ts`)
- Routes: All REST endpoints (`server/src/routes/knowledge.ts`)
- Seed data: 6 FAQ entries (`server/src/knowledge-faq-seed-data.json`)
- Seed script: (`server/scripts/seed-knowledge-faq.ts`)
- UI API client + 19 tests (`ui/src/api/knowledge.ts`)
- UI Page: Full KnowledgeBrowser with detail sheet, revisions, diff viewer,
  backlinks + 7 tests (`ui/src/pages/KnowledgeBrowser.tsx`)

## What Was Wired (this heartbeat)

### packages/db/src/schema/index.ts
- Added exports for all 4 knowledge tables so the DB package exposes them

### server/src/services/index.ts
- Added `knowledgeService` export from the knowledge module

### server/src/app.ts
- Added import and API route mount for `knowledgeRoutes(db)`

### ui/src/App.tsx
- Added import and `<Route path="knowledge">` for KnowledgeBrowser
- Added unprefixed redirect route for knowledge

## Verification
- All 26 tests pass (19 API client + 7 UI component)
- No new migrations needed (tables created in migration 0229)

## Remaining Items (future scope)
- Sidebar navigation entry for Knowledge Base (UI polish)
<!-- For now, the page is accessible at /knowledge via direct URL or
     breadcrumb navigation -->
