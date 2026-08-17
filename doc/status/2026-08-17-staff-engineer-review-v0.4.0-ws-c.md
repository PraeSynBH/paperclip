# Staff Engineer — Structural Review Complete: v0.4.0 Workstream C + Phase 5

**Date**: 2026-08-17 ~00:20 UTC
**Branch**: v0.4.0-polaris-deep-planning-memory
**Scope**: 285 files, ~879K insertions (Deep Planning + Memory/Knowledge + Chat-to-Work Resolution Cards)

## Action Taken

1. **Reviewed** the full branch diff against master — focused on structural issues (N+1, race conditions, trust boundaries, SQL safety, auth)
2. **Posted structural review** as a comment on VOY-1263 (Code Review: Phase 5 Plan Board UI)
   - Comment ID: `19248fee-0b4d-4ce3-8796-9cfc555ceacb`
3. **Updated VOY-1263 status** → `blocked`

## Findings Summary

### CRITICAL (blocking — must fix before shipping)

| ID | Finding | File(s) | Risk |
|----|---------|---------|------|
| C-1 | LLM Trust Boundary: `extractActionSignals()` emits unvalidated JSON from model output to SSE stream. No schema validation before rendering `resolution.data.url` in `<a href>`. | `board-chat.ts`, `ResolutionCard.tsx` | HIGH — XSS/adversarial model output reaches browser |
| C-2 | TOCTOU Race: Title-pattern SLA dedup check runs outside transaction — concurrent firings can both pass and create duplicate critical alerts. Partial unique index doesn't cover legacy originKind values. | `issues.ts`, `premium-sla-dedup.ts`, `0134_migration.sql` | HIGH — duplicate critical SLA issues under concurrent monitor |
| C-3 | `to_tsquery` from user input: manual tsquery construction with `:*` prefix — Postgres rejects punctuation, operators, apostrophes in tsquery, causing 400 errors on normal search input. | `knowledge-documents.ts` | MED-HIGH — search failures on common input patterns |

### HIGH (should fix before shipping)

| ID | Finding | 
|----|---------|
| H-1 | N+1 for latest review status in knowledge documents list (fetches all reviews, dedupes in JS) |
| H-2 | P2-1: ORDER BY wraps `<=>` in `1 - (...) DESC` — HNSW index not used (VOY-1285, not actually fixed) |
| H-3 | P2-6: No embedding dimension validation on insert (VOY-1286) |

### MEDIUM (fix before GA)

M-1 through M-4: Manager-chain auth grant lacks audit trail; action signal rate limiting; createBacklink missing issue existence check; null-summary LIKE semantic bug.

## Disposition

**Cannot approve for shipping.** Three critical structural issues (C-1, C-2, C-3) must be fixed before the branch can ship. Returned to CTO for fixes.
