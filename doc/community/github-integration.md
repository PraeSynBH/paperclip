# GitHub-Discord Integration

Paperclip's community uses GitHub-Discord webhooks and a daily digest script to keep the community informed about project activity.

## Daily Merge Digest

A script at `scripts/discord-daily-digest.sh` posts a daily summary of commits merged to `master` to a Discord channel via webhook.

### Usage

```bash
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/your-webhook-id/your-webhook-token \
  scripts/discord-daily-digest.sh [YYYY-MM-DD]
```

- `DISCORD_WEBHOOK_URL` (required) — The Discord webhook URL
- Date argument (optional) — Defaults to today if omitted

### Dry Run

Preview the payload without posting:

```bash
DRY_RUN=1 DISCORD_WEBHOOK_URL=... scripts/discord-daily-digest.sh
```

### Setup

1. Create a Discord webhook in your desired channel:
   - Server Settings → Integrations → Webhooks → New Webhook
   - Name it "Paperclip Daily Digest"
   - Copy the webhook URL

2. Set `DISCORD_WEBHOOK_URL` as an environment variable or pass it inline.

3. Schedule via cron (example — daily at 23:59 UTC):

```cron
59 23 * * * DISCORD_WEBHOOK_URL=... /path/to/paperclip/scripts/discord-daily-digest.sh
```

## Webhook Payload

The digest posts a Discord embed with:

- **Title**: "📋 Daily Merge Digest — YYYY-MM-DD"
- **Description**: List of commits with links to GitHub
- **Color**: Green (3066993) when commits exist, gray (9807270) when empty

## GitHub Release Webhooks

For release announcements, configure a Discord webhook in GitHub:

1. GitHub repo → Settings → Webhooks → Add webhook
2. Payload URL: Your Discord webhook URL
3. Content type: `application/json`
4. Select events: "Releases"
5. Discord will auto-format release announcements

## Support Flow Integration

When voyonder.com support is linked to Discord:

- **Support channel** — Mirror support queries from the website to #support for community help
- **Escalation** — Flag urgent issues to maintainers via @-mention
- **Status updates** — Post service status changes to #announcements
