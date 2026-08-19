# VOY-1413 Revised Plan — Deploy Docs Site (Voyonder, Not Paperclip)

**Status**: Proposed (CEO steering incorporated)
**Author**: CEO (Voyonder)
**Date**: 2026-08-19
**Mode**: Planning only

## Steering Signal

The user (company CEO) stated:

> *"This project and code is for voyonder, not paperclip. If documentation, references, chat, support, or any other application focused activity or content is produced, it must be for the core product voyonder and not paperclip."*

This is an unambiguous product-direction signal. voyonder.com must serve content about **Voyonder** as the core product. It must not present itself as a "Paperclip" documentation site.

## Current Problem

- voyonder.com (Mintlify site) serves docs branded as **"Paperclip"** — the docs.json `name` field is `"Paperclip"`, the description is `"The control plane for autonomous AI companies"`, and all case studies frame the story as "Voyonder uses Paperclip"
- The site is deployed from the `paperclipai/paperclip` repo, pushed to `PraeSynBH/paperclip` fork
- Case studies are written with Paperclip as the product and Voyonder as the company that uses it
- Discord link exists in docs.json topbar/footer but case-study routes (voyonder.com/case-studies/) return 404

## Revised Direction

**voyonder.com** → The product-facing site for **Voyonder** (core product). Content, branding, and positioning all center on Voyonder. Paperclip is the underlying technology but is not the brand on voyonder.com.

**paperclip.ai** or **docs.paperclip.ai** → The developer documentation site for Paperclip (open-source platform). Technical guides, API reference, adapter docs, CLI reference, deployment docs live here.

### What This Means for Existing Content

| Content | Move to paperclip.ai | Rewrite for voyonder.com | Both |
|---|---|---|---|
| API Reference | ✅ | | |
| Deploy docs | ✅ | | |
| Adapters | ✅ | | |
| CLI Reference | ✅ | | |
| Agent Developer guides | ✅ | | |
| Board Operator guides | ✅ | | |
| What is Paperclip | ✅ | | |
| Quickstart | ✅ | | |
| Case studies | | ✅ | |
| Blogs | | ✅ | |
| Release notes | | ✅ | |
| Support docs | ✅ | | |

## Plan for This Issue (VOY-1413)

### Phase 1: Site Identity Switch (voyonder.com)

1. **Rebrand docs.json** for voyonder.com:
   - name: `"Paperclip"` → `"Voyonder"`
   - description: `"The control plane for autonomous AI companies"` → `"AI-powered travel concierge and autonomous operations"`
   - Update logo, favicon references to Voyonder branding
   - Keep Discord link, add community/support links

2. **Rebrand the case studies** from Paperclip-centric to Voyonder-centric:
   - "Voyonder Travel — Customer Zero" → rewrite as "How Voyonder powers next-generation travel concierge"
   - "How AI Agents Built Paperclip" → "How Voyonder's AI Team Built the Platform" (or remove from voyonder.com)
   - "The Autonomous Agent Economy" → could stay, but reframe as Voyonder story
   - "Trail Life Troop WA-0337" → keep as Voyonder customer story

3. **Separate Paperclip technical content** from voyonder.com:
   - API Reference, Deploy guides, Adapters, CLI → remove from voyonder.com nav
   - These belong on paperclip.ai
   - Quickstart and "What is Paperclip" → redirect or rewrite as Voyonder onboarding

### Phase 2: Deploy

4. **Create paperclip.ai docs site** (or docs.paperclip.ai):
   - Fork the Paperclip docs to a paperclip-specific Mintlify project
   - Point paperclip.ai → Mintlify auto-deploy from that repo
   - Redirect paperclipai/paperclip docs references to paperclip.ai

5. **Push voyonder.com changes**:
   - Separate voyonder.com docs content from the paperclip repo (or maintain a split directory structure)
   - Trigger Mintlify auto-deploy from Voyonder-specific repo/branch

6. **Verify**:
   - `voyonder.com/case-studies/` returns 200 with Voyonder-branded content
   - Discord link works
   - Paperclip technical docs removed from voyonder.com nav

### Phase 3: Separation

7. **Repo strategy decision**: Does voyonder.com content live in:
   - Option A: A dedicated `voyonder/docs` repo (separate from paperclip)
   - Option B: A `docs/` directory split within the paperclip repo with conditional deployment
   - Option C: A Mintlify workspace that pulls from multiple repos

## Concrete Next Steps (Actionable)

Given planning mode constraint, the next actionable steps are:

1. **Decision needed**: Do we go with Path A (separate voyonder.com content repo) or Path B (split directory)? Path A is cleaner for brand separation but requires new repo setup.
2. **Rebrand docs.json** immediately — the name field change is a single-line edit that signals the new direction.
3. **Rewrite case study index and *maybe* case study 1** to frame Voyonder as the product (not Paperclip).
4. **Don't push Paperclip docs** to voyonder.com anymore — strip API/Deploy/Adapters/CLI tabs from the nav.

## Questions for the Board

1. Confirm direction: voyonder.com → Voyonder product, paperclip.ai → Paperclip platform docs?
2. Prefer Option A (separate repo for voyonder.com) or Option B (split directory)?
3. Should case studies stay as-is but rebranded, or fundamentally rewritten to focus on Voyonder travel concierge?
4. Timeline: is this deployment urgent enough to deploy with minimal changes now (just rebrand docs.json + strip technical tabs) and iterate, or wait for full separation?

## Disposition

**Blocked** pending CEO/board confirmation on the direction above. Once confirmed, the Release Engineer can execute the concrete deployment changes.