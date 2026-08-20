# VOY-1413 Plan — Deploy Docs Site with Case Studies + Discord Link (Revised 2026-08-20 v3)

**Status**: Phase 1 (P0 outage) RESOLVED — voyonder.com is back up. Remaining: Discord link + case studies. Awaiting founder approval of revised scope before implementation child issues.
**Author**: CEO (Voyonder)
**Date**: 2026-08-20 (v3: outage resolved verified live ~03:21 UTC)
**Mode**: Planning — awaiting approval before implementation tasks are created
**Children completed**: VOY-1417 (docs verification — done), VOY-1464 (productivity review — done)

---

## Executive Summary

There are **two separate sites** with **two separate codebases**. Neither serves the intended content. Per user steering (2026-08-19 18:30), **Paperclip code changes and Paperclip documentation are completely out of scope for this Voyonder company.** This invalidates Workstream A (paperclip.mintlify.app deployment) entirely. The remaining scope is voyonder.com only.

### Sites

| Site | Platform | Codebase | Current Status | Scope |
|---|---|---|---|---|
| **voyonder.com** | Next.js (self-hosted) | `PraeSynBH/travel_itenerary_planning` → Hostinger VPS | **ALL ROUTES RETURN 404** (production outage) | ✅ **IN SCOPE** |
| **paperclip.mintlify.app** | Mintlify (docs) | `paperclip` repo `docs/` folder | 200 root, but Mint Starter Kit template — never connected to repo | ❌ **OUT OF SCOPE** per user steering |

---

## Live Verification (2026-08-20 ~03:21 UTC — this heartbeat)

| URL | Status | Notes |
|---|---|---|
| https://voyonder.com/ | **200** | ✅ Full Voyonder landing page, Next.js RSC rendering |
| https://voyonder.com/case-studies/ | **308→404** | Route does not exist yet — redirects to /case-studies which 404s |
| https://voyonder.com/documentation | **200** | ✅ Documentation page serves properly |
| https://voyonder.com/documentation/releases | **200** | ✅ Release notes page serves properly |
| https://voyonder.com/api/health | **200 (degraded)** | DB timeout (400ms), OpenRouter timeout (401ms) but site serves |
| https://paperclip.mintlify.app/ | 200 | Mint Starter Kit — NOT Paperclip docs (out of scope) |
| https://discord.gg/m4HZY7xNG3 | **200** | Live independently (8,600+ members) — not linked from voyonder.com |

### voyonder.com Outage Resolution

The P0 outage (all routes returning bare "404 page not found") is **RESOLVED**. Every route now serves proper Next.js-rendered content. Root cause was infra-level (Docker container crash or Traefik misconfiguration on Hostinger VPS) — no code change was needed. Founder action (SSH access) restored the site.

**Footer links currently**: Documentation, Release Notes, Privacy Policy, TOS, Pricing, Gallery, Contact (mailto). **No Discord link.**

---

## Scope Correction (per User Steering)

**User said (2026-08-19 18:30 UTC):**
> "Do not spend any time documenting our renewing to paperclip in this paperclip company. Paperclip code changes and paperclip documentation are both completely out of scope for this voyonder company and company projects."

**Impact on this plan:**
1. ❌ **Workstream A (paperclip.mintlify.app) — STRICKEN.** The docs are already committed to fork/master (commit `e79f5e8853` includes case studies + Discord link in topbar). Connecting Mintlify to the repo is a Paperclip concern, not Voyonder's.
2. ❌ **Push to fork/master — STRICKEN.** The content already exists there (confirmed by git ls-tree on fork/master). This is Paperclip infrastructure work.
3. ❌ **Two dangling commits** (`d30b6eccfe`, `694c687525`) in the paperclip repo duplicate the same content but aren't on any branch. These are Paperclip repo hygiene, not Voyonder work.
4. ✅ **Voyonder.com remains in scope**: restore from outage, add Discord link, add Voyonder-centric case studies.

---

## Remaining Work: voyonder.com Only

### Phase 1 (P0 — Outage): ✅ RESOLVED

The voyonder.com P0 production outage is **resolved** as of ~2026-08-20 03:21 UTC. The site is serving full Voyonder pages on all routes. No further action needed on Phase 1.

### Phase 2: Add Discord Link to Footer

**Location**: `components/layout/footer.tsx` in the voyonder repo (PraeSynBH/travel_itenerary_planning).

**Change needed**: Add a Discord icon/link to the existing footer link group alongside Documentation, Release Notes, Privacy Policy, etc.

**Deploy after change**: Push to `main` → CI passes → GitHub Actions auto-deploys via deploy.yml.

**Blocker**: Requires GitHub push access to the voyonder repo. Founder-gated.

### Phase 3: Create Voyonder-Centric Case Studies

**Location**: New `app/case-studies/` page(s) in the voyonder repo.

**Current status**: `/case-studies/` → 308 redirect to `/case-studies` → 404. Route does not exist.

**Content**: Voyonder-focused case studies (how travelers use Voyonder for trip planning, not Paperclip infrastructure).

**Blocker**: Content creation + code change. Founder-gated (GitHub push + content direction).

---

## Deployment Pipeline Documentation (voyonder.com)

**Due to popular demand**: "If the docs deploy pipeline is not Mintlify auto-deploy, document the manual steps needed for future docs releases (this has now bitten us twice)."

It is NOT Mintlify. It is a GitHub Actions → Docker → VPS pipeline.

### Pipeline

```
[Push to main] → [GitHub Actions: CI runs] → [CI passes?]
  ├── YES → [GitHub Actions: Deploy builds Docker image on amd64]
  │          → [SCP image + docker-compose.production.yml to VPS-1]
  │          → [SSH: docker load + docker compose up -d --force-recreate]
  │          → [Health check loop (60s, 15 attempts)]
  └── NO  → [Deploy skipped]
```

### Configuration Files

| File | Purpose |
|---|---|
| `.github/workflows/ci.yml` | PR/push CI: type-check, lint, test |
| `.github/workflows/deploy.yml` | Auto-deploy after CI passes on `main` |
| `Dockerfile` | Multi-stage build (deps → builder → runner with Next.js standalone + workers) |
| `docker-compose.production.yml` | Services: travel_app, travel_db (pgvector/pg16), 3 workers, Traefik labels |
| `start.sh` | Entrypoint: `prisma migrate deploy` then `node server.js` |

### Critical Details

1. **Traefik reverse proxy** runs externally (network: `traefik-public`) with Let's Encrypt cert via `mytlschallenge`
2. **VPS host**: `vps-1.adoptaitech.com` (resolves to 72.60.29.178, Hostinger)
3. **SSH deploy key**: GitHub Actions secret `VPS_SSH_KEY` — no agent has this key
4. **Health check**: `GET /api/health/live` on loopback port 3000
5. **Manual deploy** (if Actions is broken):
   ```bash
   # From your local machine with SSH access
   docker build --platform linux/amd64 -t travel_app:latest -f Dockerfile .
   docker save travel_app:latest -o /tmp/travel_app.tar
   scp /tmp/travel_app.tar root@vps-1.adoptaitech.com:/tmp/
   ssh root@vps-1.adoptaitech.com
   cd /opt/travel_planner
   docker load -i /tmp/travel_app.tar
   docker compose -f docker-compose.production.yml up -d --force-recreate
   ```

### Health Check Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Full health (DB, deps) |
| `GET /api/health/live` | Liveness probe (HTTP 200 = alive) |

---

## Recommendation

1. **P0 — ✅ DONE**: voyonder.com P0 outage resolved. Site restored without code change.
2. **This sprint — Discord link**: Add Discord link to voyonder.com footer (5-minute code change + push to main → auto-deploys via GitHub Actions).
3. **Next sprint — Case studies**: Create Voyonder-centric case studies and add `app/case-studies/` route to voyonder.com.
4. **Not this issue**: Mintlify/Paperclip docs deployment — out of scope per user steering.

---

## Gates / Decisions Needed

| # | Gate | Owner | Action Needed |
|---|---|---|---|
| 1 | ✅ voyonder.com P0 outage | **RESOLVED** | Site restored — no action needed |
| 2 | Approve revised scope (Phases 2-3) | Founder (Ben) | Accept scope: Discord link + case studies, Voyonder-only |
| 3 | Discord link priority — ship independently of case studies? | Founder (Ben) | Decision on parallel vs sequential execution |
| 4 | Case studies content — who writes Voyonder-centric content? | Founder (Ben) | Assign content creation |

---

## Disposition

**IN PROGRESS** — P0 outage resolved. Remaining work (Discord link + case studies) is founder-gated on:
- GitHub push access to `PraeSynBH/travel_itenerary_planning` (Discord link + case studies)
- Content direction for Voyonder-centric case studies

Pending founder approval of revised scope (request_confirmation on this issue). Once approved, this issue splits into implementation child issues:
- **Child A**: Add Discord link to voyonder.com footer
- **Child B**: Create Voyonder-centric case studies page

---

## Non-Goals / Out of Scope (per user steering)

- ❌ Paperclip code changes (paperclip repo)
- ❌ Paperclip documentation deployment (paperclip.mintlify.app, docs.paperclip.ing)
- ❌ Push to fork/master (PraeSynBH/paperclip)
- ❌ Mintlify dashboard connection to GitHub repo
- ❌ Voyonder application feature work (trip planning, billing, etc.)
- ❌ Production app deployment pipeline changes for application features
