# Discord Channel Configuration — Paperclip Community Server

**Server:** Paperclip (discord.gg/m4HZY7xNG3)
**Guild ID:** 1478750559191302299
**Status:** Server exists (8,600+ members) — channels need configuring
**Access required:** Server Admin (Discord `Manage Server` permission or role Admin)
**Created:** 2026-08-19 (COO)
**Part of:** PRA-921 — Phase 3 Outreach

---

## Overview

This document specifies the exact channel structure to create, including category names, channel names, topic descriptions, and recommended permission overrides. Configuration requires human with Admin access on the Paperclip Discord server.

---

## Category: Welcome

| Channel | Type | Topic | Visibility | Notes |
|---------|------|-------|------------|-------|
| #welcome | Text | New member landing — rules, roles, and how to get started | Public | Pinned: welcome message + rules embed |
| #announcements | Text | Product updates, release notes, downtime notices | Public (read-only) | @everyone send disabled, only Admins/Mods can post |
| #roles | Text | Self-assign roles via bot commands | Public | Bot-command only (Carl-bot / MEE6 reaction roles) |

### Permission Notes for Welcome Category
- **@everyone**: Read, Send Messages (except #announcements — read-only)
- **@Admin**, **@Moderator**: Full access
- **#announcements**: Deny `Send Messages` for @everyone, `Read Message History` for all

---

## Category: Community

| Channel | Type | Topic | Visibility | Notes |
|---------|------|-------|------------|-------|
| #general | Text | Open discussion, questions, brainstorming | Public | High-traffic, light moderation |
| #showcase | Text | Share your Paperclip agent companies and use cases | Public | Encourage case studies, screenshots, configs |
| #feedback | Text | Structured feedback — what works, what's confusing, what's missing | Public | Pin feedback template thread |
| #support | Text | Troubleshooting, setup help, FAQ | Public | Pin common issues + links to docs |

### Permission Notes for Community Category
- **@everyone**: Read, Send Messages
- Slow mode: 5 seconds on #general, 10 seconds on #support

---

## Category: Product

| Channel | Type | Topic | Visibility | Notes |
|---------|------|-------|------------|-------|
| #feature-requests | Forum | Upvoted feature ideas — one thread per suggestion | Public | Use forum channel type; require title prefix [Feature] |
| #roadmap | Text | Planned releases, in-progress work, beta features | Public (read-only) | Only Admins can post; pin current roadmap doc |
| #changelog | Text | Automated release note feed from GitHub | Public (read-only) | Configure GitHub webhook → this channel |
| #beta | Text | Beta program updates, early access invites | Restricted | Only @Beta Tester and above can view |

### Permission Notes for Product Category
- **#changelog**, **#roadmap**: Deny `Send Messages` for @everyone
- **#beta**: Read+Send restricted to @Beta Tester, @Contributor, @Moderator, @Admin

---

## Category: Community Projects (Optional — add post-launch)

| Channel | Type | Topic | Visibility | Notes |
|---------|------|-------|------------|-------|
| #template-sharing | Text | Share agent templates, company configs, skill packs | Public | Pin index of shared templates |
| #integrations | Text | Connect Paperclip with external tools | Public | API keys, webhooks, custom plugins |
| #agent-showcase | Text | Spotlight specific agent configurations and workflows | Public | Encouraging detailed writeups |

---

## Category: Voice (Stage)

| Channel | Type | Topic | Visibility | Notes |
|---------|------|-------|------------|-------|
| 🎙️ Town Hall | Stage | Monthly community calls — product updates + Q&A | Public | Admin creates event; @everyone can listen |
| 🎙️ Office Hours | Stage | Weekly drop-in support with the founding team | Public | Same setup as Town Hall |

---

## Role Configuration

| Role | Permissions | Color | Assignable By | Notes |
|------|-------------|-------|---------------|-------|
| **@Admin** | Administrator | Red | Only existing Admins | Server owner + trusted founders |
| **@Moderator** | Manage Messages, Kick, Ban, Mute members | Green | Only Admins | Trusted community members |
| **@Beta Tester** | View #beta, priority support | Blue | Self-serve via #roles | React-to-assign |
| **@Contributor** | View #beta, priority feedback | Purple | Request + Mod approval | For code/docs/template contributors |
| **@Member** | General access | Default (white) | Auto on join | Default role for everyone |
| **@Guest** | Read-only (welcome + announcements) | Gray | Manual assignment | For pending verification |

### Permission Matrix

| Permission | @everyone | @Member | @Beta Tester | @Contributor | @Moderator | @Admin |
|------------|-----------|---------|--------------|--------------|------------|--------|
| View Channels | #welcome area | All public | All + #beta | All + #beta | All | All |
| Send Messages | #welcome only | All public | All public + #beta | All public + #beta | All | All |
| Read History | Default | All public | All | All | All | All |
| Manage Messages | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Kick/Ban | ❌ | ❌ | ❌ | ❌ | Kick ✅ | Both ✅ |
| Mute | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Administrator | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## Channel Setup Order (Recommended)

1. Create categories first (Welcome, Community, Product, Voice)
2. Create channels within each category
3. Set channel topics and slow mode
4. Configure permission overrides per channel
5. Create roles and assign colors
6. Add @everyone → @Member as default on-join
7. Test with a test user account
8. Pin welcome message in #welcome
9. Pin moderation guidelines in #welcome (as embed)
10. Configure GitHub webhook → #changelog

---

## GitHub → #changelog Webhook

### Setup Steps
1. Go to Paperclip GitHub repo → Settings → Webhooks → Add webhook
2. **Payload URL:** The Discord webhook URL (create via Server Settings → Integrations → Webhooks → New Webhook, select #changelog channel)
3. **Content type:** application/json
4. **Events:** Just the `push` event (or select specific release events)
5. **Secret:** Optional
6. Save and test

### Discord Webhook Format
```
POST https://discord.com/api/webhooks/{webhook.id}/{webhook.token}
Content-Type: application/json

{
  "username": "GitHub Releases",
  "avatar_url": "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
  "content": "New release: {{tag_name}}\n{{release_notes_url}}"
}
```

A GitHub Action is recommended instead of a raw webhook for richer embeds:
```yaml
# .github/workflows/discord-release.yml
name: Discord Release Notification
on:
  release:
    types: [published]
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Send Discord notification
        env:
          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_CHANGELOG_WEBHOOK }}
        run: |
          curl -H "Content-Type: application/json" \
            -d "{\"content\":\"**${{ github.event.release.tag_name }}** released\\n${{ github.event.release.html_url }}\\n\\n${{ github.event.release.body }}\"}" \
            "$DISCORD_WEBHOOK_URL"
```

---

## Onboarding Bot Setup

### Option A: Carl-bot (Recommended — Free, feature-rich)

1. Visit https://carl.gg and invite the bot with admin permissions
2. Run `!setup` in #admin channel
3. Configure:
   - **Auto-role:** @Member on join
   - **Welcome message:** Use the welcome message from discord-welcome-message.md
   - **Welcome DM:** Send new members a DM with getting-started links
   - **Reaction roles:** In #roles channel, set up reaction roles for @Beta Tester
   - **Moderation:** Enable auto-mod for spam, invite links, curse words

### Option B: MEE6 (Alternative)

1. Visit https://mee6.xyz and add the bot
2. Configure welcome messages, auto-role, and moderation via dashboard
3. Premium features for advanced moderation behind paywall — Carl-bot recommended for free tier

### Option C: Custom Bot (Future — when dedicated Paperclip bot exists)

Not needed for launch. Carl-bot covers onboarding, moderation, and reaction roles.

---

## Invite Link Configuration

1. Go to Server Settings → Invites
2. Create new invite for #welcome channel
3. Settings:
   - **Expires:** Never
   - **Max uses:** No limit
   - **Temporary membership:** OFF
4. Save the link as the primary invite: https://discord.gg/m4HZY7xNG3 (already set up)

---

## Verification & Safety

Current server settings:
- **Verification Level:** 2 (Medium — must have verified email + be registered on Discord for 5+ minutes)
- **Explicit Content Filter:** Not set (recommend: "Scan media from all members")
- **Age Verification:** Large guild features enabled

**Recommended safety settings:**
- Enable `Explicit Content Filter` → Scan media from all members
- Enable `Verification Level` → High (must have verified phone) only if spam becomes an issue (Medium is fine for launch)
- Set up automod rules for common spam patterns in Server Settings → Community → Automod

---

## Pre-Launch Checklist (Admin)

- [ ] Categories created (Welcome, Community, Product, Voice) per spec above
- [ ] Channels created with correct types and topics
- [ ] Permission overrides applied per channel
- [ ] Roles created (Admin, Moderator, Beta Tester, Contributor, Member, Guest)
- [ ] Member role set as default on-join
- [ ] Welcome message pinned in #welcome
- [ ] Moderation guidelines pinned in #welcome
- [ ] Slow mode set (general: 5s, support: 10s)
- [ ] Carl-bot (or MEE6) invited and configured:
  - Auto-role @Member on join
  - Welcome message set
  - Reaction roles for @Beta Tester
- [ ] GitHub webhook → #changelog configured
- [ ] Invite link tested with a test account
- [ ] First 5 beta customers invited (from beta-customer-candidates.md)
- [ ] #showcase seeded with case study posts

---

*Part of PRA-921 deliverable. Update this document if the channel structure changes.*
