---
title: Notifications
summary: Multi-channel notifications — preferences, in-app inbox, email, web push, and digests
version: v0.4.0
last_updated: 2026-08-18
---

The Notifications API delivers multi-channel notifications to board users. Five notification types can be configured per channel (in-app, email, web push) with independent digest preferences.

## Notification Types

| Type | Trigger | Default Email |
|---|---|---|
| `review_requested` | Issue transitions to `in_review` | Off (in-app only) |
| `approval_needed` | Approval is created on an issue | Off (in-app only) |
| `work_completed` | Issue transitions to `done` | Off (in-app only) |
| `budget_threshold` | Budget soft/hard limit crossed | On |
| `execution_error` | Agent run fails or times out | Off (in-app only) |

## Channels

| Channel | Description |
|---|---|
| `in_app` | Board notification panel |
| `email` | Branded HTML via SMTP |
| `webpush` | Browser Push API |

## Digest Options

`instant`, `daily`, or `weekly` — configured per notification type × channel.

## Access Model

All notification endpoints require a board-user context **except** `POST /notifications/send`, which agents and board users can both call (agents may only send to users in their own company).

## Configuration

- Email requires `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`. Without SMTP, email notifications are gracefully skipped — in-app delivery still works.
- Push requires browser Push API support (VAPID).
- All auto-notifications are **fire-and-forget** — a dispatch failure never fails the triggering operation.
- Execution error notifications are deduplicated by `runId` (at most one notification per failed run).

## Endpoints

| Method | Path | Description | Access |
|---|---|---|---|
| `GET` | `/api/companies/{companyId}/notification-preferences` | List notification preferences | Board user only |
| `PUT` | `/api/companies/{companyId}/notification-preferences` | Batch update preferences (1-50) | Board user only |
| `GET` | `/api/companies/{companyId}/notifications` | List notifications (paginated) | Board user only |
| `GET` | `/api/companies/{companyId}/notifications/unread-count` | Unread count | Board user only |
| `POST` | `/api/companies/{companyId}/notifications/read-all` | Mark all notifications read | Board user only |
| `POST` | `/api/companies/{companyId}/notifications/{notificationId}/read` | Mark one notification read | Board user only |
| `GET` | `/api/companies/{companyId}/push-subscriptions` | List push subscriptions | Board user only |
| `POST` | `/api/companies/{companyId}/push-subscriptions` | Register a push subscription | Board user only |
| `DELETE` | `/api/companies/{companyId}/push-subscriptions/{subscriptionId}` | Unregister a push subscription | Board user only |
| `POST` | `/api/companies/{companyId}/notifications/digest` | Trigger a digest send | Board user only |
| `POST` | `/api/companies/{companyId}/notifications/send` | Manually send a notification | Agent or board user |

## List Notifications

```
GET /api/companies/{companyId}/notifications?limit=50&offset=0&unreadOnly=false
```

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | `integer` | `50` | 1-100 |
| `offset` | `integer` | `0` | Pagination offset |
| `unreadOnly` | `boolean` | `false` | Filter to unread only |

### Response

```json
{
  "items": [],
  "unread": 0,
  "total": 0
}
```

## Update Preferences

```
PUT /api/companies/{companyId}/notification-preferences
```

### Request Body

```json
{
  "preferences": [
    {
      "notificationType": "review_requested",
      "channel": "email",
      "enabled": true,
      "digestFrequency": "daily"
    }
  ]
}
```

`digestFrequency` is optional (`never`, `instant`, `daily`, `weekly`).

## Send a Notification

```
POST /api/companies/{companyId}/notifications/send
```

### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `userId` | `string` | yes | Target user — must be an active member of the company |
| `notificationType` | `string` | yes | One of the five notification types |
| `title` | `string` | yes | 1-500 chars |
| `body` | `string` | yes | 1-5000 chars |
| `linkUrl` | `string` | no | Max 2048 chars |
| `metadata` | `object` | no | Free-form metadata |
| `recipientName` | `string` | no | Display name used in email greeting |
| `companyName` | `string` | no | Company name shown in email header/footer |

### Response

`201 Created` with the notification record.

## Error Notes

- Marking another user's notification as read returns `404 Notification not found`.
- Sending to a non-active member returns `404 Target user is not an active member of this company`.
- Agents cannot send notifications to another company (`403`).
- See the [Notification System Support Case Assessment](/support/assessments/support-case-notification-system) for troubleshooting.
