# Staff Engineer Structural Audit Report
## Date: 2026-08-22 ~23:26 UTC
## Branch: release/vo/voyonder-code-separation-phase-1
## Scope: SEO Metadata Infrastructure (VOY-1695)

---

## Disposition: NOT APPROVED — Blocking findings exist

## Summary

| # | Severity | Finding | Fix complexity |
|---|----------|---------|----------------|
| 1 | CRITICAL | React Rules of Hooks violation (27 files) | 1 line each — move call inside function |
| 2 | CRITICAL | TypeScript null/string mismatch | 1 line fix in type or caller |
| 3 | MEDIUM | Missing `hiddenAt` filter in sitemap | 1 line addition to WHERE clause |
| 4 | MEDIUM | No XML escaping in sitemap | Add `escapeXml()` helper |
| 5 | MEDIUM | No `noindex` for private pages | New parameter + audit of all pages |
| 6 | LOW | Unused import `sql` | Remove import |
| 7 | LOW | No SEO route tests | Add test file |

---

### FINDING 1 (CRITICAL — BLOCKING): React Rules of Hooks Violation

**27 page files** have `usePageMeta()` calls placed at **module level** (outside component function bodies). The `usePageMeta` hook internally calls `useEffect`, which violates React Rules of Hooks — hooks must only be called from React function components or custom hooks, never at module scope.

**Root cause**: The bulk insertion of `usePageMeta(title, description)` calls was placed before `export function ComponentName()` declarations. In files where the main component is not the first exported function, the hook call ended up at module level between the closing `}` of a helper function and the `export function ComponentName()` declaration.

**Pattern** (e.g. `BoardChat.tsx:105`):
```
  }
                                            // ← previous function ends here

  usePageMeta("Board Chat", ...);           // ← HOOK at module level, after `}`
export function BoardChat() {               // ← component starts here
```

**Confirmed violations** (verified by brace-depth analysis):

| File | Line | Context |
|------|------|---------|
| AdapterManager.tsx | 258 | Between `}` and `export function AdapterManager()` |
| Artifacts.tsx | 65 | Between `}` and `export function Artifacts()` |
| BoardChat.tsx | 105 | Between `}` and `export function BoardChat()` |
| CaseDetail.tsx | 449 | Between `}` and `export function CaseDetail()` |
| Cases.tsx | 743 | Between `}` and `export function Cases()` |
| CompanyEnvironments.tsx | 1264 | Between `}` and `export function CompanyEnvironments()` |
| CompanyImport.tsx | 845 | Between `}` and `export function CompanyImport()` |
| CompanyInvites.tsx | 50 | Between `}` and `export function CompanyInvites()` |
| DesignGuide.tsx | 376 | Between `}` and `export function DesignGuide()` |
| InstanceExperimentalSettings.tsx | 230 | Between `}` and `export function` |
| InstanceSettings.tsx | 29 | Between `}` and `export function` |
| InviteLanding.tsx | 211 | Between `}` and `export function` |
| KnowledgeBrowser.tsx | 950 | Between `}` and `export function` |
| MemoryBrowser.tsx | 446 | Between `}` and `export function` |
| Org.tsx | 88 | Between `}` and `export function Org()` |
| PipelineSettings.tsx | 1276 | Between `}` and `export function` |
| Pipelines.tsx | 346 | Between `}` and `export function Pipelines()` |
| Plans.tsx | 72 | Between `}` and `export function Plans()` |
| PluginManager.tsx | 89 | Between `}` and `export function` |
| ProjectDetail.tsx | 367 | Between `}` and `export function` |
| ProjectWorkspaceDetail.tsx | 248 | Between `}` and `export function` |
| RoutineDetail.tsx | 157 | Between `}` and `export function` |
| Routines.tsx | 320 | Between `}` and `export function Routines()` |
| SkillStudio.tsx | 271 | Between `}` and `export function` |
| Timeline.tsx | 306 | Between `}` and `export function` |
| UserProfile.tsx | 198 | Between `}` and `export function` |
| Workspaces.tsx | 80 | Between `}` and `export function Workspaces()` |

**Impact**: React may silently skip the `useEffect` in these components, causing page titles and meta descriptions to not be set. The bugs are latent — they won't crash, just silently fail. Since most developers test only a few pages, this would ship with invisible failures on 27 pages.

**Fix**: Move each `usePageMeta()` call inside the component function body, immediately after the function opening brace and before any other hooks.

### FINDING 2 (CRITICAL — BLOCKING): TypeScript Type Mismatch — null passed as string

**File**: `ui/src/pages/IssueDetail.tsx:1775`

```typescript
usePageMeta(
    issue?.title ?? null,       // ← null is not assignable to `string`
    issue?.title
      ? `Task ${issue.identifier}: ${issue.title}`
      : "Task detail",
  );
```

The `usePageMeta` signature is `(title: string, description?: string)`. With `"strict": true` in `ui/tsconfig.json`, `null` is not assignable to `string`. This should fail the typecheck.

**Fix**: Either change the function signature to `title: string | null` (since the body already handles falsy titles via `title ? `${title} - ${APP_NAME}` : APP_NAME`) or change the caller to use `""` as the fallback.

### FINDING 3 (MEDIUM): Missing `hiddenAt` filter in sitemap — data leakage

**File**: `server/src/routes/seo.ts:61-77`

The sitemap query selects issues where `status` is not `cancelled` or `backlog`, and `identifier` is not null. However, it does **not** filter by `hiddenAt IS NULL`. The `issues` schema (`packages/db/src/schema/issues.ts:75`) has a `hiddenAt` timestamp field used for soft-deletion. Hidden issues with identifiers would appear in the public sitemap.

**Impact**: Soft-deleted/hidden issues leak their identifiers to search engine crawlers.

**Fix**: Add `isNull(issues.hiddenAt)` to the WHERE clause.

### FINDING 4 (MEDIUM): No XML output escaping in sitemap

**File**: `server/src/routes/seo.ts:163-170` (`formatUrl`) and `:173-179` (`buildSitemapXml`)

Both functions construct XML via raw string interpolation without any escaping. `resolveRequestHost` (`seo.ts:144-154`) reads the `X-Forwarded-Host` header and interpolates it directly into the sitemap XML. Issue identifiers and company prefixes from the database could also contain XML-special characters (`&`, `<`, `>`, `"`, `'`).

**Impact**: XML injection in the sitemap could cause crawlers to misinterpret the sitemap, potentially leading to incorrect indexing. At minimum, special characters in any interpolated value would produce malformed XML.

**Fix**: Add an `escapeXml(str: string): string` helper that escapes `&`, `<`, `>`, `"`, `'` and apply it to all interpolated values in `formatUrl` and `buildSitemapXml`.

### FINDING 5 (MEDIUM): No `noindex` mechanism for private pages

The `usePageMeta` hook only sets `title` and `description` meta tags. There is no mechanism to set `<meta name="robots" content="noindex, nofollow">` on authenticated/internal pages such as dashboards, settings, admin pages, billing, etc.

**Impact**: Search crawlers that index the SPA could discover and index internal application pages.

**Fix**: Add an optional `noindex?: boolean` parameter to `usePageMeta` that injects a `<meta name="robots" content="noindex, nofollow">` tag, and use it on all authenticated/internal pages.

### FINDING 6 (LOW): Unused import — `sql` from drizzle-orm

**File**: `server/src/routes/seo.ts:2`

```typescript
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
```

`sql` is imported but never used in the file.

### FINDING 7 (LOW): No tests for SEO routes

The `server/src/routes/seo.ts` file has no corresponding test file. The sitemap XML generation, robots.txt response, and error handling paths are untested.

---

## Files Reviewed

- `server/src/routes/seo.ts` — SEO routes (sitemap.xml, robots.txt)
- `ui/src/hooks/usePageMeta.ts` — Client-side page meta hook
- `server/src/app.ts` — Route registration (lines 87, 681)
- `ui/src/pages/*.tsx` — 140 page components using `usePageMeta`

## Escalation

Escalated to CTO via request_confirmation interaction (id: 0cb1f7a7-312c-494e-a131-2114940a2c68).