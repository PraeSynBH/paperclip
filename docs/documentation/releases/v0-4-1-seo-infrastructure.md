# v0.4.1 — SEO Metadata Infrastructure

**Release date**: August 23, 2026
**Status**: Live
**Related issues**: VOY-1695, VOY-1798, VOY-1715

Paperclip now generates search-engine-friendly metadata across the platform, making your teams' work discoverable through search engines.

## What's New

### Your pages are now searchable

Paperclip automatically generates the signals search engines need to find and index your content. No setup required.

### Dynamic page titles

Every page now has a descriptive browser tab title — "Dashboard — Paperclip", "Live Agent Runs — Paperclip", "Billing Settings — Paperclip" instead of a generic label. This means your browser tabs and search results both show meaningful names.

### Search result descriptions

Key pages include summary descriptions in the page header. When your page appears in search results, users see a short description beneath the link telling them what the page is about.

### Automatic sitemap

Paperclip generates a live sitemap at `/sitemap.xml` listing:
- Your company's dashboard and issues pages
- Individual issue pages (for non-hidden, active issues)
- Static pages (homepage, pricing page)

Search engines use this sitemap to discover and index your content efficiently.

### Crawling rules

The `/robots.txt` file tells search engines what to crawl (public content) and what to skip (API endpoints), ensuring your internal APIs stay out of search results.

## What Changed

| Before | After |
|---|---|
| Generic "Paperclip" page title everywhere | Page-specific titles (e.g., "Agent Detail — Paperclip") |
| No meta descriptions on any page | Summary descriptions on all key pages |
| No sitemap — search engines had to guess what to index | Auto-generated sitemap at `/sitemap.xml` updated hourly |
| No robots.txt — crawlers used default behavior | Custom `/robots.txt` with explicit rules |

## Impact

- **Search engines can now index your teams' public issue pages** — if your Paperclip instance is publicly accessible, search results will show your teams' work
- **Better search result appearance** — titles and descriptions appear in search results instead of generic "Paperclip" labels
- **No action required from companies** — SEO improvements are automatic and server-side

## What's NOT in This Release

The following SEO features were evaluated but are **not included** in this release:

- **Open Graph / social media preview cards** — Links shared on Slack, Twitter/X, Discord, or LinkedIn will not show rich previews with images and descriptions
- **Structured data / JSON-LD** — Search engines cannot yet extract rich snippets like breadcrumbs, organization info, or FAQ sections
- **Per-issue custom descriptions** — Issue detail pages use a generic description; custom per-issue descriptions are a future enhancement

## Technical Notes

- Sitemap is regenerated on every request (cached for 1 hour by browsers/CDNs)
- If the database is temporarily unavailable, the sitemap returns an empty listing (HTTP 200) instead of an error — this prevents search engines from retrying aggressively and compounding the issue
- XML output is sanitized against injection through header values
- Hidden issues (`hiddenAt` set) are excluded from the sitemap

---

*Paperclip Platform — Infrastructure Release*