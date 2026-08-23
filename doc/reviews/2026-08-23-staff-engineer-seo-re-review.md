# Staff Engineer Structural Re-review Report
## Date: 2026-08-23 ~00:28 UTC
## Branch: release/vo/voyonder-code-separation-phase-1
## Scope: SEO Metadata Infrastructure (VOY-1695) — Re-review of commits 1a50ce7446 and fde711db21

---

## Disposition: APPROVED — All blocking findings resolved. Routing to CTO for final sign-off.

## Findings Closure Verification

| # | Severity | Finding | Status | Verified |
|---|----------|---------|--------|----------|
| 1 | CRITICAL | React Rules of Hooks violation — usePageMeta called at module level | **FIXED** ✓ | 28 files inspected — all calls inside component bodies |
| 2 | CRITICAL | TypeScript `string | null` passed to `(title: string)` | **FIXED** ✓ | `?? null` → `?? ""` at IssueDetail.tsx:1775 |
| 3 | MEDIUM | Missing `hiddenAt` filter in sitemap — data leakage | **FIXED** ✓ | `isNull(issues.hiddenAt)` added to WHERE clause (seo.ts:76) |
| 4 | MEDIUM | No XML escaping in sitemap | **FIXED** ✓ | `escapeXml()` helper (seo.ts:188-195) applied to host, path, lastmod |
| 5 | MEDIUM | Missing `noindex` for private pages | **TRACKED** | Acceptable for initial impl; needs feature request |
| 6 | LOW | Unused import `sql` | **FIXED** ✓ | Removed in earlier commit |
| 7 | LOW | No SEO route tests | **DEFERRED** | Acceptable for initial impl |

## Fresh Structural Audit — Pass

In addition to verifying the original findings, I reviewed for new issues:

- **Trust boundaries**: X-Forwarded-Host processed through `escapeXml()` before XML insertion. Safe.
- **Error handling**: catch block returns empty sitemap (200) with no error detail leak. `err` variable unused — correct.
- **N+1 queries**: Two batch queries only. No per-row DB calls. Clean.
- **Route ordering**: SEO routes registered before SPA fallback catch-all in app.ts:681. Verified.
- **Hidden/soft-delete coverage**: `isNull(issues.hiddenAt)` present. Companies filter on `status = "active"`. No `hiddenAt` equivalent on companies table — acceptable for current schema; flagged for schema evolution.
- **Cache headers**: robots.txt and sitemap.xml both set `public, max-age=3600`. Error path sets `no-cache`. Correct.

## Files Re-reviewed

- `server/src/routes/seo.ts` — 195 lines
- `ui/src/hooks/usePageMeta.ts` — hook signature and implementation
- `server/src/app.ts` — route registration (lines 679-681, 135-138)
- 28 page files in `ui/src/pages/` — usePageMeta placement

## Next Steps

1. CTO final sign-off required before shipping
2. Recommend tracking Finding 5 (noindex mechanism) as a follow-up issue
3. Consider adding `hiddenAt`-equivalent column to companies table in future schema migration
