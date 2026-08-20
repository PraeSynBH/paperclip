# VOY-1413 Plan — Deploy Case Studies + Discord Link (Corrected)

**Status**: Corrected — replaces prior plan (which had a factual error)
**Author**: CEO (Voyonder)
**Date**: 2026-08-19 (revised 2026-08-19)
**Mode**: Planning only

## Key Correction: Two Sites, Not One

The prior plan contained a factual error: it described voyonder.com as a "Mintlify docs site". **It is not.**

There are **two separate sites** with **two separate codebases**:

| Site | Platform | Codebase | Status |
|---|---|---|---|
| **paperclip.mintlify.app** | Mintlify (docs) | `paperclip` repo `docs/` folder | LIVE at root, but showing default "Mint Starter Kit" template — NO custom content deployed |
| **voyonder.com** | Next.js (product) | `~/Programming/Business/projects/voyonder` (travel_itenerary_planning) | LIVE at root and /documentation (200). **Missing**: case studies, Discord link |

## Live Verification (2026-08-19)

| URL | Status | Notes |
|---|---|---|
| https://voyonder.com/ | 200 | Voyonder product landing page — working |
| https://voyonder.com/documentation | 200 | Voyonder product docs — working |
| https://voyonder.com/case-studies/ | 308 → 404 | Redirects to /case-studies (no trailing slash) → 404 |
| https://voyonder.com/blog | timeout | Blog route may be slow or broken |
| https://paperclip.mintlify.app/ | 200 | Default "Mint Starter Kit" — NOT the Paperclip docs |
| https://paperclip.mintlify.app/case-studies/ | 404 | Never deployed |
| https://discord.gg/m4HZY7xNG3 | expected 200 | Discord link in docs.json, 8,600+ members live |

## Current State

### What's committed (paperclip repo docs/ folder)
- 4 case studies + index at `docs/case-studies/` (commits `6a72f197d6`, `1734fb6f56`)
- `docs.json` with "Case Studies" nav tab, Discord link in topbar
- These commits are on `fork/master` (PraeSynBH/paperclip) — confirmed present

### What's NOT deployed
- **paperclip.mintlify.app**: Not connected to the paperclip repo. Still showing the default Mintlify starter template. Mintlify auto-deploy is NOT configured.
- **voyonder.com**: No case studies route. No Discord link in footer. The voyonder repo is a separate Next.js app with its own deployment pipeline.

### What's NOT in the plan at all (corrected scope)
- The voyage/paperclip repo content (docs/case-studies/*) is Paperclip-centric ("Voyonder runs on Paperclip"). Per user steering, voyonder.com content must be Voyonder-centric.
- There is no voyonder.com-specific case study content anywhere in the voyonder repo.

## Workstreams

### Workstream A: Paperclip Mintlify Docs — paperclip.mintlify.app

**Objective**: Deploy the Paperclip docs (including case studies + Discord link) to paperclip.mintlify.app.

**Current blocker**: The Mintlify project at `paperclip.mintlify.app` is not connected to any GitHub repo. It shows the default Mintlify starter template. The custom docs/ content from the paperclip repo is not deployed.

**Steps**:
1. Connect the Mintlify project to the `PraeSynBH/paperclip` fork (or `paperclipai/paperclip` upstream)
2. Configure auto-deploy from the `master` or `fork/master` branch
3. Verify case studies render at `https://paperclip.mintlify.app/case-studies/`
4. Verify Discord link in topbar navigation

**Former block**: VOY-1421 (Mintlify dashboard setup). Needs to be unblocked via Mintlify dashboard access.

### Workstream B: Voyonder.com Product Site — Next.js App

**Objective**: Add Discord community link and case studies content to voyonder.com.

**Codebase**: `/Users/benh/Programming/Business/projects/voyonder` (main branch, git remote: `origin` → `PraeSynBH/travel_itenerary_planning`, `bitbucket` → `praesyn/travel-planner`)

**Deployment**: Docker-based on Hostinger VPS with Traefik reverse proxy. Pipeline: `git push origin main` → SSH to VPS → `docker compose pull && docker compose up -d` (or manual rebuild via `docker-compose.production.yml`).

**Sub-tasks**:

1. **Add Discord link to footer** (`components/layout/footer.tsx`)
   - Add a "Community" or "Discord" link pointing to `https://discord.gg/m4HZY7xNG3`
   - Current footer has: Documentation, Release Notes, Privacy Policy, Terms of Service, Pricing, Gallery, Contact
   - Insert Discord link in the footer link group

2. **Create case studies route** (new route at `/case-studies`)
   - Create `app/case-studies/page.tsx` with Voyonder-centric case study content
   - Content should focus on Voyonder (AI travel concierge), not Paperclip (the platform)
   - Link to the live case studies on paperclip.mintlify.app or embed the content
   - Add navigation link to the route

3. **Deploy** the updated app to voyonder.com
   - Push to `origin/main` (GitHub)
   - Trigger VPS deployment (docker compose up -d with rebuild)

### Workstream C: Content Strategy Decision

**Issue**: The case studies in `docs/case-studies/` are Paperclip-centric ("Voyonder runs on Paperclip"). Per user steering ("content must be for voyonder, not paperclip"), these need to be:
- Option 1: Rewritten for voyonder.com as Voyonder product case studies
- Option 2: Deployed to paperclip.mintlify.app as-is (Paperclip docs), and separate Voyonder case studies written for voyonder.com
- Option 3: Keep as-is on both sites

**Recommendation**: Option 2 — deploy the existing case studies to paperclip.mintlify.app (they're Paperclip docs content), and create new Voyonder-centric case studies for voyonder.com. This respects the user steering without discarding the existing work.

## Verifications

| Check | Expected | How |
|---|---|---|
| https://voyonder.com/ | 200 | curl |
| https://voyonder.com/case-studies/ | 200 | curl |
| https://voyonder.com/documentation | 200 | curl |
| voyonder.com footer has Discord link | visible | curl + grep for discord.gg |
| https://paperclip.mintlify.app/ | 200 | curl |
| https://paperclip.mintlify.app/case-studies/ | 200 | curl |
| paperclip.mintlify.app Discord link | visible | curl + grep for discord.gg |

## Non-Goals

- Do NOT ship Voyonder application code (trip planning, billing, etc.)
- Do NOT touch the production app deployment pipeline for application features
- Do NOT restructure repos or split directories
- Do NOT write Paperclip developer documentation
- Do NOT rebrand paperclip.mintlify.app away from Paperclip — it's the Paperclip docs site

## Blockers

1. **Mintlify project setup (VOY-1421)**: The Mintlify project at paperclip.mintlify.app needs to be connected to the paperclip repository for auto-deploy. This requires Mintlify dashboard access (founder action). No agent can unblock this.

2. **Voyonder.com deployment access**: Deployment to the Hostinger VPS requires SSH access or GitHub Actions configured. The exact deployment mechanism needs to be documented.

3. **Content decision**: Whether the case studies for voyonder.com should be rewritten from the existing Paperclip-centric content or created fresh.

## Disposition

**Blocked** on:
- **VOY-1421** (Mintlify dashboard setup) — Paperclip docs site needs to be connected to the repo. Owner: Founder/Ben.
- **Voyonder deployment access** — Needs SSH key or GitHub Actions setup for the travel_itenerary_planning repo. Owner: Ben.
- **Content decision** — Voyonder.com case studies: rewrite existing or create new? Owner: CEO/Ben.

**Recommended next action**: 
1. Resolve VOY-1421 (Mintlify setup) — this is the fastest path to getting the case studies live somewhere
2. Make the content decision about voyonder.com case studies
3. Add Discord link to voyonder.com footer — this is a small, safe change that can be done independently