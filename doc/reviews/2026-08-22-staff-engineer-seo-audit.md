# Staff Engineer Structural Audit Report
## Date: 2026-08-22 ~23:26 UTC
## Updated: 2026-08-23 ~00:28 UTC (final re-review of commits 1a50ce7446 + fde711db21)
## Branch: release/vo/voyonder-code-separation-phase-1
## Scope: SEO Metadata Infrastructure (VOY-1695)

---

## Disposition: APPROVED — all findings resolved. Routing to CTO for final sign-off.

## Summary

| # | Severity | Finding | Status | Fix complexity |
|---|----------|---------|--------|----------------|
| 1 | CRITICAL | React Rules of Hooks violation (~27 files) | **FIXED** ✓ — fde711db21 | 2-line swap per file |
| 2 | CRITICAL | TypeScript null/string mismatch | **FIXED** ✓ — fde711db21 | 1 line — caller → `?? ""` |
| 3 | MEDIUM | Missing `hiddenAt` filter in sitemap — data leakage | **FIXED** ✓ — fde711db21 | 1 line addition to WHERE |
| 4 | MEDIUM | No XML escaping in sitemap | **FIXED** ✓ — fde711db21 | escapeXml() helper added |
| 5 | MEDIUM | No `noindex` for private pages | **TRACKED** | New parameter + audit |
| 6 | LOW | Unused import `sql` | **FIXED** ✓ | Removed import |
| 7 | LOW | No SEO route tests | **NOT ADDRESSED** (acceptable) | Add test file |

---

### FINDING 1 (CRITICAL — BLOCKING): React Rules of Hooks Violation (FIXED ✓)

**Fixed in fde711db21**: All 28 affected files moved from module-level to inside function body. Verified on current HEAD — no module-level `usePageMeta()` calls remain.

**Fix**: For each affected file, move `usePageMeta(...)` from just before `export function ComponentName()` to just after it (first line inside the function body).

**Confirmed still-violating files**:
- AdapterManager.tsx:258-259
- Artifacts.tsx:65-66
- BoardChat.tsx:105-106
- CaseDetail.tsx:449-450
- DesignGuide.tsx:376-377
- InstanceSettings.tsx:29-30
- KnowledgeBrowser.tsx:950-951
- Pipelines.tsx:346-347
- Workspaces.tsx:80-81
- And ~18 more (all files where the main component is not the first export)

### FINDING 2 (CRITICAL — BLOCKING): TypeScript Type Mismatch (FIXED ✓)

**Fixed in fde711db21**: `issue?.title ?? null` → `issue?.title ?? ""` at IssueDetail.tsx:1775. The hook signature accepts `string`, so empty string is type-safe.

### FINDING 3 (MEDIUM): Missing `hiddenAt` filter (FIXED ✓)

**Fixed in fde711db21**: `isNull(issues.hiddenAt)` added to the WHERE clause at seo.ts:76.

### FINDING 4 (MEDIUM): No XML escaping (FIXED ✓)

**Fixed in fde711db21**: `escapeXml()` helper added at seo.ts:188-195, applied to host, path, and lastmod values in the sitemap XML. Escapes `&`, `<`, `>`, `"`, `'`. Trust boundary: X-Forwarded-Host now properly sanitized before XML insertion.

### FINDING 5 (MEDIUM): No `noindex` mechanism (STILL OPEN — tracked)

Not addressed. Acceptable for initial implementation; should be tracked for follow-up.

### FINDING 6 (LOW): Unused `sql` import (FIXED ✓)

Confirmed removed from `seo.ts:2`.

### FINDING 7 (LOW): No tests (NOT ADDRESSED)

No test file for `seo.ts`. Acceptable for initial implementation.

---

## Files Reviewed

- `server/src/routes/seo.ts` — SEO routes (sitemap.xml, robots.txt)
- `ui/src/hooks/usePageMeta.ts` — Client-side page meta hook
- `server/src/app.ts` — Route registration (lines 87, 681)
- `ui/src/pages/*.tsx` — 50+ page components using `usePageMeta`

## Escalation

All blocking findings resolved in commit fde711db21. Staff Engineer disposition: **APPROVED** — routing to CTO for final sign-off. Recommend tracking Finding 5 (noindex mechanism) as a follow-up issue, and considering `hiddenAt`-equivalent column on companies table in future schema migration.