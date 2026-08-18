# Support Case Assessment: Notification System — Email, Push, and In-App Notifications

**Feature**: Multi-channel notification system with user-configurable preferences, email digests, push subscriptions, and automatic notifications for key events
**Assessed by**: Support Engineer
**Date**: 2026-08-18
**Related**: VOY-1342, VOY-1364, VOY-1367, VOY-1365
**Release**: v0.4.0-alpha (hotfix VOY-1367)

## Feature Overview (User Perspective)

The Notification System provides a multi-channel notification infrastructure for Voyonder. Board users receive notifications about events requiring their attention — approval requests, review requests, completed work, budget threshold crosses, and execution errors.

**What users experience:**

- **In-app notifications** — A notification panel accessible from the board UI shows recent notifications with read/unread state
- **Email notifications** — Branded HTML emails sent via SMTP when enabled for a notification type, with a click-through "Open in board" action button
- **Push notifications** — Web push notifications delivered via configured push subscriptions
- **Daily/weekly digests** — A summary email of all notifications from the past day or week, instead of instant individual emails
- **Per-type preferences** — Users can control which channels (email, webpush, in_app) are active for each notification type, and choose between instant delivery or digest bundling

### Notification Types

| Type | Triggered When | Default Email |
|------|---------------|---------------|
| `review_requested` | An issue transitions to `in_review` status | Off (in-app only by default) |
| `approval_needed` | An approval is created on an issue | Off (in-app only by default) |
| `work_completed` | An issue transitions to `done` status | Off (in-app only by default) |
| `budget_threshold` | A budget soft/hard threshold is crossed | On |
| `execution_error` | An agent run fails or times out | Off (in-app only by default) |

### Channels

| Channel | Description | Requires Setup |
|---------|-------------|---------------|
| `in_app` | Notification appears in the board notification panel | None — always available |
| `email` | HTML email sent to the user's email address | SMTP server (see Environment Configuration) |
| `webpush` | Web push notification via browser push API | Push subscription registration |

### Digests

Users can choose a digest frequency for each notification type × channel:
- **`instant`** — Each notification is delivered immediately
- **`daily`** — Notifications are bundled into a single daily email
- **`weekly`** — Notifications are bundled into a single weekly email
- **`never`** — No notifications for this type/channel

### Notification preference defaults

| Notification Type | In-App | Email | Web Push |
|-------------------|--------|-------|----------|
| review_requested | ✅ Enabled | ❌ Disabled | ❌ Disabled |
| approval_needed | ✅ Enabled | ❌ Disabled | ❌ Disabled |
| work_completed | ✅ Enabled | ❌ Disabled | ❌ Disabled |
| budget_threshold | ✅ Enabled | ✅ Enabled | ❌ Disabled |
| execution_error | ✅ Enabled | ❌ Disabled | ❌ Disabled |

## What Changed

### New API endpoints

**Notification Preferences:**

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/companies/:companyId/notification-preferences` | Board user | Get all notification preferences |
| `PUT` | `/api/companies/:companyId/notification-preferences` | Board user | Batch upsert notification preferences |

**In-App Notifications:**

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/companies/:companyId/notifications` | Board user | List notifications (paginated, optional `unreadOnly` filter) |
| `GET` | `/api/companies/:companyId/notifications/unread-count` | Board user | Get unread notification count |
| `POST` | `/api/companies/:companyId/notifications/read-all` | Board user | Mark all notifications as read |
| `POST` | `/api/companies/:companyId/notifications/:notificationId/read` | Board user | Mark a single notification as read |

**Push Subscriptions:**

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/companies/:companyId/push-subscriptions` | Board user | List push subscriptions |
| `POST` | `/api/companies/:companyId/push-subscriptions` | Board user | Register a push subscription |
| `DELETE` | `/api/companies/:companyId/push-subscriptions/:subscriptionId` | Board user | Unregister a push subscription |

**System Notifications (Admin/Server):**

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/companies/:companyId/notifications/send` | Agent or board user | Manually send a notification to a company member |
| `POST` | `/api/companies/:companyId/notifications/digest` | Board user | Trigger a digest send for a frequency (daily/weekly) |

### Auto-notification triggers

Notifications are automatically sent by the system at these points:

| Trigger | Notification Type | Where | 
|---------|-------------------|-------|
| Issue transitions to `in_review` | `review_requested` | `issues.ts` route — issue status change |
| Issue transitions to `done` | `work_completed` | `issues.ts` route — issue status change |
| Approval is created | `approval_needed` | `approvals.ts` route — approval creation |
| Budget threshold crossed | `budget_threshold` | `budgets.ts` service — threshold incident creation |
| Agent run execution error | `execution_error` | `heartbeat.ts` service — run terminal error |

All auto-notifications are fire-and-forget: a failure to dispatch a notification never causes the triggering operation to fail. Errors are logged as warnings.

### Execution error deduplication (VOY-1364 B3 fix)

The `notifyExecutionErrorOnce` function deduplicates execution error notifications by tracking `metadataJson->>'runId'`. This ensures that if the same run transitions to terminal error status through multiple code paths (e.g., process loss *and* status setting), only one notification is sent per run ID.

### SMTP mailer

Notifications use a **built-in SMTP client** built on Node.js `net` and `tls` modules — no external email library required. It supports:
- Plain TCP (port 25/587) with STARTTLS
- SSL/TLS (port 465)
- AUTH LOGIN authentication

### Email branding

All notification emails use Voyonder branding:
- Dark header banner with brand name
- Greeting line with recipient name (when available)
- Action button linking into the board
- Company name in the footer
- Unsubscribe/Preference management note

### Digest emails

Digest emails bundle multiple notifications into a single summary with:
- Frequency label ("Daily" or "Weekly") with date
- List of notification items with title, body, and links
- Footer note explaining the digest preference

### Default preference resolution (VOY-1364 S1 fix)

The `getEffectiveChannels` function applies default preferences **only when no preference row exists** for the user. If a user has explicitly disabled a channel for a notification type, that preference is respected — defaults do not override explicit user choices.

## Environment Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `SMTP_HOST` | For email notifications | SMTP server hostname |
| `SMTP_PORT` | For email notifications | SMTP server port (default: 587) |
| `SMTP_USER` | For email notifications | SMTP authentication username |
| `SMTP_PASS` | For email notifications | SMTP authentication password |
| `SMTP_FROM` | No (default: noreply@voyonder.com) | From email address |
| `SMTP_FROM_NAME` | No (default: Voyonder) | From display name |

**Web push notifications** use the [web-push](https://www.npmjs.com/package/web-push) package with VAPID keys:

| Variable | Required | Description |
|----------|----------|-------------|
| `VAPID_PUBLIC_KEY` | For web push | VAPID public key |
| `VAPID_PRIVATE_KEY` | For web push | VAPID private key |
| `VAPID_SUBJECT` | No (default: mailto:noreply@voyonder.com) | VAPID contact URI |

Without VAPID keys, web push is silently skipped (returns false). Push subscriptions can still be registered, but delivery only occurs when VAPID is configured.

If SMTP is not configured, email notifications are silently skipped (logged as warnings). In-app notifications work regardless.

## Potential User Confusion Points

1. **"I'm not getting email notifications"** — Check: (1) SMTP is configured (SMTP_HOST, SMTP_USER, SMTP_PASS), (2) email is enabled for the notification type in preferences, (3) the notification type's digest is set to `instant` rather than `daily`/`weekly`/`never`. Defaults have email disabled for most types — users must opt in.

2. **"I'm getting too many emails"** — Change the notification preference for the notification type to `daily` or `weekly` digest, or set email to disabled. Each notification type × channel has independent settings.

3. **"I set my preferences but notifications still go to email"** — Ensure the preference upsert is for the correct `notificationType` and `channel` combination. The `getEffectiveChannels` function only falls back to defaults when **no preference row exists at all** — an explicit `enabled: false` preference is respected.

4. **"Notifications say they're sent but I didn't receive an email"** — Emails are sent asynchronously. Check the server logs for SMTP connection errors. If SMTP is not configured, the notification record is still created (in-app notification works) but email is silently skipped with a log warning.

5. **"Digest emails are empty"** — If no notifications were created during the digest period, the digest email may have zero items. This is expected behavior. Check that notifications are being created by verifying the notification records in the database.

6. **"I'm getting duplicate execution error notifications"** — The `notifyExecutionErrorOnce` deduplication prevents multiple notifications for the same run ID. If duplicates still occur, verify the `metadataJson` payload includes a unique `runId`. This should be a rare edge case — escalate to Staff Engineer.

7. **"Push notifications aren't working"** — Push subscriptions require browser Push API support. Verify the subscription was registered successfully. Push notifications use web push protocol — check that the VAPID keys or other push service configuration is correct if needed.

9. **"My email notifications have garbled content"** — The email templates escape all user-controlled content for HTML safety. If content appears garbled, it may be an encoding issue in the SMTP transport. Check server logs.

10. **"I chose daily digest but I'm still getting instant emails"** — Digest preferences are per notification type × channel. Ensure the digest frequency is set for the specific `email` channel on the specific notification type. When email is deferred to digest, `emailSentAt` stays `null` on the notification record until the digest sends.

11. **"I tried to send a notification to a user but got 'Target user is not an active member'"** — The `/notifications/send` endpoint verifies that the target `userId` is an active member of the company. Check that the user has an active membership (`status = 'active'`) in the company. Users who have been removed or whose membership is inactive cannot receive notifications via this endpoint.

## Support Escalation Path

| Issue | Severity | Action |
|---|---|---|
| Email notifications not delivering (SMTP configured) | High | Check server logs for SMTP connection/auth errors. Verify SMTP credentials. Test SMTP connectivity manually. |
| Notification system causing request failures | Critical | Notifications are designed as fire-and-forget — they should never fail the triggering request. If they do, escalate to CTO immediately. |
| Duplicate execution error notifications | Medium | Check if the same run ID is being processed through multiple error paths. Escalate to Staff Engineer if confirmed. |
| Digest not sending on schedule | Medium | Verify digest trigger is being called. The digest endpoint is manual/triggered — check if a scheduled job or cron is configured to call `POST /notifications/digest`. |
| User cannot find notification preferences | Low | Preferences UI is accessed from the board. Direct user to their account/notification settings. |
| Notification preference save fails | Medium | Verify the request body matches the expected schema (notificationType, channel, enabled). The batch endpoint accepts 1-50 preferences per request. |
| In-app notification count is wrong | Low | The `unread-count` endpoint counts notifications with `readAt IS NULL`. Verify no other user is marking notifications as read. |
| Web push notification delivery failure | Medium | Push subscriptions are stored per browser. If a subscription endpoint is stale (browser unsubscribed), push delivery will fail silently. Re-register the push subscription. |

## Related Documentation

- [Billing System Support Case Assessment](support-case-billing-system.md)
- [v0.4.0-alpha Release Notes](../releases/v0.4.0-alpha-deep-planning.md)