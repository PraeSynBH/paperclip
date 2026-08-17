# Discord Server Setup Guide

**Server**: Paperclip Community
**Invite**: https://discord.gg/m4HZY7xNG3

This document describes the Discord server structure, moderation, and maintenance procedures.

---

## Channel Structure

### Text Channels

#### Information Category
- `#welcome` — Automatic welcome message with rules, roles, and quickstart links
- `#rules` — Server rules (see community guidelines)
- `#announcements` — Release notes and important updates (mod-only)

#### Community Category
- `#general` — General discussion
- `#introductions` — New members introduce themselves
- `#showcase` — Show off what you've built
- `#community-showcase` — Highlighted community projects

#### Support Category
- `#support` — Get help with setup, configuration, and issues
- `#faq` — Frequently asked questions (read-only, curated)

#### Development Category
- `#dev` — Development discussions, architecture, SDK questions
- `#feature-requests` — Vote and discuss new features
- `#plugin-dev` — Plugin/SDK development discussion

#### Beta Category
- `#beta-discussion` — Beta customer discussion (beta role only)
- `#beta-feedback` — Structured feedback collection
- `#beta-announcements` — Beta release notes

### Voice Channels
- `General Voice` — Casual voice chat
- `Dev Hangout` — Development discussions

---

## Roles

| Role | Permissions | Assignment |
|------|-------------|------------|
| `@everyone` | Read most channels, write in public channels | Default |
| `Member` | Full access to all public channels | Auto after welcome |
| `Beta Tester` | Access to beta channels | Manual by COO |
| `Contributor` | Access to dev planning | Manual — awarded after PR merge |
| `Moderator` | Moderate messages, manage invites | Manual — trusted community members |
| `Admin` | Full server control | Voyonder team only |

---

## Moderation Guidelines

### Enforcement
1. **First offense** — Verbal warning (DM or public ping)
2. **Second offense** — 24-hour mute
3. **Third offense** — Kick or ban (at moderator discretion)

### Report Process
- Use `@Moderator` to report issues
- DMs to any Moderator or Admin
- Serious issues (harassment, threats, spam) → immediate ban

### Spam Policy
- Promotional links allowed only in `#showcase`
- No crypto/NFT/MLM promotions
- No repetitive pinging of members
- No DM advertising

---

## Bots & Integrations

### GitHub Webhook
- Channel: `#releases`
- Events: Releases only (not every push)
- Format: Clean embed with version, notes, and link

### Discord Bot (future)
- Welcome message automation
- Role assignment via reactions
- FAQ command (`!faq <topic>`)
- Status command (`!status` — show Paperclip system health)

---

## Onboarding Flow

1. User joins via invite link → lands in `#welcome`
2. Auto-message: "Welcome! Read #rules, introduce yourself in #introductions, check #quickstart to get started"
3. User reads rules, picks roles in #roles
4. User posts introduction → gets `Member` role
5. User is pinged weekly with community highlights until they engage

---

## Maintenance

### Weekly
- Check for unanswered questions in #support
- Archive stale threads
- Review reported messages

### Monthly
- Prune inactive members (90+ days no messages)
- Update FAQ with new common questions
- Review and rotate moderator assignments if needed

### Per Release
- Post release notes in #releases
- Create discussion thread for release feedback
- Pin release notes for 1 week
