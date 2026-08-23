---
title: v0.4.1 — SEO Metadata Infrastructure
version: voy-1695/voy-1798
date: 2026-08-23
commit: 1a50ce7446 + fde711db21
status: LIVE
---

# v0.4.1 — SEO Metadata Infrastructure

**Release:** VOY-1695 / VOY-1798
**Commits:** `1a50ce7446` (code review fix), `fde711db21` (structural audit fix)
**Date:** 2026-08-23
**Status:** LIVE
**Related issues:** VOY-1695, VOY-1696, VOY-1798, VOY-1715, VOY-1866

## Summary

This release adds SEO metadata infrastructure to Paperclip, enabling search engines to discover and index public content. The changes are entirely server-side and frontend hook-based — no API changes.

## Changes

### New files

| File | Purpose |
|---|---|
| `server/src/routes/seo.ts` | Dynamic sitemap.xml + robots.txt routes |
| `ui/src/hooks/usePageMeta.ts` | React hook for setting page title and meta description |

### Modified files

| File | Change |
|---|---|
| `server/src/app.ts` | Registered `seoRoutes(db)` before SPA fallback (line 681) |
| `ui/index.html` | Added base meta description tag |
| 75+ page components in `ui/src/pages/` | Added `usePageMeta()` calls |

### Server: sitemap.xml (`GET /sitemap.xml`)

- Query active companies and public issues from DB
- Generate XML urlset with `<loc>`, `<lastmod>`, `<changefreq>weekly`
- Max 10,000 companies and 10,000 issues
- On DB error: returns empty `<urlset>` with 200 (prevents crawler retry storms)
- XML escaping: `&`, `<`, `>`, `"`, `'` escaped to prevent injection via `X-Forwarded-Host`

### Server: robots.txt (`GET /robots.txt`)

- `Allow: /`, `Disallow: /api/`
- `Sitemap:` directive with resolved host
- Host resolution: `X-Forwarded-Host` > `Host` > `paperclip.ai`

### Frontend: usePageMeta hook

- Accepts `(title: string, description?: string)`
- Appends " — Paperclip" to title automatically
- Manages `<meta name="description">` lifecycle (create/update/remove)
- Last-call-wins: child routes override parent effects
- Cleans up on unmount

### Frontend: Page coverage

75+ components now call `usePageMeta`, covering:
- Company pages: dashboard, issues, settings, billing
- Agent pages: all agent detail and list views
- Admin pages: secrets, adapters, plugins, pipelines
- Utility pages: export, invites, decisions, approvals
- Legacy/Auth/Error pages: login, not-found, landing

### Not in scope (descoped or future)

- Open Graph tags — not implemented
- Twitter Card tags — not implemented
- JSON-LD structured data — not implemented
- Heading hierarchy audit — descoped per Founding Engineer decision
- Per-issue custom descriptions — not implemented

## Key Decisions

1. **Empty sitemap on DB error (200 vs 500)**: 5xx responses trigger crawler retry storms. Empty 200 avoids this while the system recovers.
2. **X-Forwarded-Host support**: Required for proxy deployments (e.g., behind Traefik). The first entry in a comma-separated list is used.
3. **`isNull(issues.hiddenAt)` filter**: Hidden issues are excluded from the sitemap. Admins can hide sensitive issues.
4. **XML escaping**: Defense-in-depth against injection attacks via request headers.
5. **Last-call-wins meta**: React's insertion order ensures the deepest child's meta tag wins, enabling hierarchical overrides.

## QA Checklist

- [x] sitemap.xml returns valid XML with company pages
- [x] robots.txt serves correct sitemap link
- [x] Meta tags render on all page components
- [x] Hidden issues excluded from sitemap
- [x] XML injection blocked via escapeXml
- [ ] CTO Sign-off

## Documentation

- Customer-facing release notes: `/docs/documentation/releases/v0-4-1-seo-infrastructure.md`
- Developer SEO best practices: `/docs/guides/agent-developer/seo-best-practices.md`
- Support case assessment: `/docs/support/assessments/support-case-seo-metadata.md`