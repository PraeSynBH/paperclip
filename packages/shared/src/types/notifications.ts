export const NOTIFICATION_TYPES = [
  "review_requested",
  "approval_needed",
  "work_completed",
  "budget_threshold",
  "execution_error",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CHANNELS = ["email", "webpush", "in_app"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const DIGEST_FREQUENCIES = ["never", "instant", "daily", "weekly"] as const;
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];

export interface NotificationPreference {
  id: string;
  companyId: string;
  userId: string;
  notificationType: NotificationType;
  channel: NotificationChannel;
  enabled: boolean;
  digestFrequency: DigestFrequency | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationPreferenceUpsertInput {
  notificationType: NotificationType;
  channel: NotificationChannel;
  enabled: boolean;
  digestFrequency?: DigestFrequency | null;
}

export interface NotificationRecord {
  id: string;
  companyId: string;
  userId: string;
  notificationType: NotificationType;
  title: string;
  body: string;
  linkUrl: string | null;
  metadataJson: Record<string, unknown>;
  readAt: string | null;
  sentAt: string | null;
  emailSentAt: string | null;
  pushSentAt: string | null;
  createdAt: string;
}

export interface PushSubscription {
  id: string;
  companyId: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  createdAt: string;
}

export interface PushSubscriptionRegisterInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}

export interface NotificationDigestInput {
  companyId: string;
  frequency: "daily" | "weekly";
}

/** Payload for sending a notification in-code */
export interface NotifyInput {
  companyId: string;
  userId: string;
  notificationType: NotificationType;
  title: string;
  body: string;
  linkUrl?: string;
  metadata?: Record<string, unknown>;
  /** Display name used in the email greeting. Falls back to a generic greeting. */
  recipientName?: string | null;
  /** Company name shown in the email header/footer. */
  companyName?: string;
}

/** Default preferences when none are explicitly set */
export const DEFAULT_NOTIFICATION_PREFERENCES: Record<
  NotificationType,
  Partial<Record<NotificationChannel, boolean>>
> = {
  review_requested: { in_app: true, email: false, webpush: false },
  approval_needed: { in_app: true, email: false, webpush: false },
  work_completed: { in_app: true, email: false, webpush: false },
  budget_threshold: { in_app: true, email: true, webpush: false },
  execution_error: { in_app: true, email: false, webpush: false },
};