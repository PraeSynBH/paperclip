import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  notificationPreferences,
  notifications,
  pushSubscriptions,
  authUsers,
  companies,
  companyMemberships,
} from "@paperclipai/db";
import type {
  NotificationType,
  NotificationChannel,
  DigestFrequency,
  NotificationPreference,
  NotificationPreferenceUpsertInput,
  NotificationRecord,
  PushSubscription,
  PushSubscriptionRegisterInput,
  NotifyInput,
  DeliveryStatus,
  DeliveryChannelStatus,
} from "@paperclipai/shared";
import { DEFAULT_NOTIFICATION_PREFERENCES, computeDeliveryStatus } from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import { publishLiveEvent } from "./live-events.js";
import { renderNotificationEmail, renderDigestEmail } from "./email-templates.js";
import { getTelemetryClient } from "../telemetry.js";
import {
  trackNotificationDeliverySent,
  trackNotificationDeliveryFailed,
} from "@paperclipai/shared/telemetry";
import {
  SMTP_CONVERSATION_TIMEOUT_MS,
  WEB_PUSH_TTL_SECONDS,
  DEFAULT_SMTP_PORT,
} from "../timeout-constants.js";

// ---------------------------------------------------------------------------
// SMTP mailer — lightweight, no external dependency (Node built-ins only)
// ---------------------------------------------------------------------------

function resolveMailerConfig() {
  return {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? String(DEFAULT_SMTP_PORT)),
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.SMTP_FROM ?? "noreply@voyonder.com",
    fromName: process.env.SMTP_FROM_NAME ?? "Voyonder",
  };
}

function isSmtpConfigured(): boolean {
  const cfg = resolveMailerConfig();
  return Boolean(cfg.host && cfg.user && cfg.pass);
}

type SmtpSocket = import("node:net").Socket;

/**
 * Minimal SMTP client over Node built-ins (net/tls) with STARTTLS and
 * AUTH LOGIN support. No external dependency required. Any failure is
 * logged and returns false — notification delivery must never throw.
 */
async function sendEmailViaSmtp(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<boolean> {
  if (!isSmtpConfigured()) {
    logger.warn(
      { to: opts.to, subject: opts.subject },
      "SMTP not configured; skipping email notification. Set SMTP_HOST, SMTP_USER, SMTP_PASS.",
    );
    return false;
  }

  const cfg = resolveMailerConfig();
  const useSsl = cfg.port === 465;

  try {
    const net = await import("node:net");
    const tls = await import("node:tls");

    const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const messageId = `<${Date.now()}.${Math.random().toString(36).slice(8)}@${cfg.host}>`;

    const headers = [
      `From: ${cfg.fromName} <${cfg.from}>`,
      `To: ${opts.to}`,
      `Subject: ${opts.subject}`,
      `Message-ID: ${messageId}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      `Date: ${new Date().toUTCString()}`,
    ];

    const body = [
      `--${boundary}`,
      `Content-Type: text/plain; charset="utf-8"`,
      `Content-Transfer-Encoding: 7bit`,
      ``,
      opts.text,
      `--${boundary}`,
      `Content-Type: text/html; charset="utf-8"`,
      `Content-Transfer-Encoding: 7bit`,
      ``,
      opts.html ?? opts.text.replace(/\n/g, "<br>\n"),
      `--${boundary}--`,
    ];

    const raw = [...headers, "", ...body].join("\r\n");

    let socket: SmtpSocket | undefined;
    let buffer = "";
    let expectCode: number;
    let timedOut = false;

    const smtpTimeout = setTimeout(() => {
      timedOut = true;
      if (socket) socket.destroy(new Error("SMTP timeout"));
    }, SMTP_CONVERSATION_TIMEOUT_MS);

    const sendLine = (line: string) => {
      if (!socket) throw new Error("SMTP socket not connected");
      socket.write(`${line}\r\n`);
    };

    /**
     * Wait for the next complete SMTP reply (single or multi-line) and
     * return its status code. Rejects on non-success or socket close.
     */
    const readReply = (expected: number): Promise<void> =>
      new Promise((resolve, reject) => {
        const onData = (chunk: Buffer) => {
          buffer += chunk.toString("utf8");
          // A reply is complete when a line starts with the code followed
          // by a space (not a '-' continuation).
          while (true) {
            const lineEnd = buffer.indexOf("\r\n");
            if (lineEnd === -1) return;
            const line = buffer.slice(0, lineEnd);
            buffer = buffer.slice(lineEnd + 2);
            const code = parseInt(line.slice(0, 3), 10);
            const isContinuation = line.length > 3 && line[3] === "-";
            if (isContinuation) continue;
            expectCode = code;
            if (code === expected) {
              cleanup();
              resolve();
            } else if (code >= 400) {
              cleanup();
              reject(new Error(`SMTP ${code} error: ${line}`));
            }
            return;
          }
        };
        const onError = (err: Error) => {
          cleanup();
          reject(err);
        };
        const onClose = () => {
          cleanup();
          reject(new Error("SMTP connection closed unexpectedly"));
        };
        const cleanup = () => {
          socket!.off("data", onData);
          socket!.off("error", onError);
          socket!.off("close", onClose);
        };
        socket!.on("data", onData);
        socket!.on("error", onError);
        socket!.on("close", onClose);
      });

    const connectSocket = (): Promise<void> =>
      new Promise((resolve, reject) => {
        if (useSsl) {
          const tlsSocket = tls.connect({
            host: cfg.host,
            port: cfg.port,
            rejectUnauthorized: false,
          });
          socket = tlsSocket as unknown as SmtpSocket;
        } else {
          socket = net.connect(cfg.port, cfg.host);
        }
        socket.once("connect", () => resolve());
        socket.once("error", reject);
      });

    await connectSocket();
    expectCode = 0;

    // 1. Server greeting
    await readReply(220);

    // 2. EHLO
    sendLine(`EHLO ${cfg.host}`);
    await readReply(250);

    // 3. STARTTLS (only for non-SSL connections)
    if (!useSsl) {
      sendLine("STARTTLS");
      await readReply(220);
      const tlsSocket = tls.connect({
        socket,
        rejectUnauthorized: false,
      });
      await new Promise<void>((resolve, reject) => {
        tlsSocket.once("secureConnect", () => resolve());
        tlsSocket.once("error", reject);
      });
      socket = tlsSocket as unknown as SmtpSocket;
      buffer = "";
      sendLine(`EHLO ${cfg.host}`);
      await readReply(250);
    }

    // 4. AUTH LOGIN
    sendLine("AUTH LOGIN");
    await readReply(334);
    sendLine(Buffer.from(cfg.user, "utf8").toString("base64"));
    await readReply(334);
    sendLine(Buffer.from(cfg.pass, "utf8").toString("base64"));
    await readReply(235);

    // 5. Envelope + data
    sendLine(`MAIL FROM:<${cfg.from}>`);
    await readReply(250);
    sendLine(`RCPT TO:<${opts.to}>`);
    await readReply(250);
    sendLine("DATA");
    await readReply(354);
    sendLine(`${raw}\r\n.`);
    await readReply(250);

    // 6. Quit
    sendLine("QUIT");
    socket!.destroy();

    clearTimeout(smtpTimeout);
    logger.info({ to: opts.to, subject: opts.subject }, "Email sent via SMTP");
    return true;
  } catch (err) {
    logger.error({ err, to: opts.to, subject: opts.subject }, "Failed to send email");
    return false;
  }
}

// ---------------------------------------------------------------------------
// Web Push (VAPID) — optional, only works if VAPID keys are configured
// ---------------------------------------------------------------------------

function resolveVapidConfig() {
  return {
    subject: process.env.VAPID_SUBJECT ?? "mailto:noreply@voyonder.com",
    publicKey: process.env.VAPID_PUBLIC_KEY ?? "",
    privateKey: process.env.VAPID_PRIVATE_KEY ?? "",
  };
}

function isVapidConfigured(): boolean {
  const cfg = resolveVapidConfig();
  return Boolean(cfg.publicKey && cfg.privateKey);
}

async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: { title: string; body: string; linkUrl?: string; notificationId?: string },
): Promise<boolean> {
  if (!isVapidConfigured()) {
    return false;
  }

  try {
    const { send } = await import("web-push");
    const cfg = resolveVapidConfig();

    await send({
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
    }, JSON.stringify({
      title: payload.title,
      body: payload.body,
      data: {
        url: payload.linkUrl,
        notificationId: payload.notificationId,
      },
    }), {
      vapidDetails: {
        subject: cfg.subject,
        publicKey: cfg.publicKey,
        privateKey: cfg.privateKey,
      },
      TTL: WEB_PUSH_TTL_SECONDS, // 24 hours
    });

    return true;
  } catch (err: any) {
    // If subscription is expired/gone, log and return false
    if (err?.statusCode === 410 || err?.statusCode === 404) {
      logger.warn({ endpoint: subscription.endpoint }, "Push subscription expired or gone");
      return false;
    }
    logger.error({ err, endpoint: subscription.endpoint }, "Web push send failed");
    return false;
  }
}

// ---------------------------------------------------------------------------
// Notification service
// ---------------------------------------------------------------------------

export function notificationService(db: Db) {
  // ── Preferences ──────────────────────────────────────────────────────

  async function getPreferences(
    companyId: string,
    userId: string,
  ): Promise<NotificationPreference[]> {
    const rows = await db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.companyId, companyId),
          eq(notificationPreferences.userId, userId),
        ),
      )
      .orderBy(desc(notificationPreferences.updatedAt));

    return rows.map((row) => ({
      id: row.id,
      companyId: row.companyId,
      userId: row.userId,
      notificationType: row.notificationType as NotificationType,
      channel: row.channel as NotificationChannel,
      enabled: row.enabled,
      digestFrequency: row.digestFrequency as DigestFrequency | null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async function upsertPreference(
    companyId: string,
    userId: string,
    input: NotificationPreferenceUpsertInput,
  ): Promise<NotificationPreference> {
    const now = new Date();
    const [row] = await db
      .insert(notificationPreferences)
      .values({
        companyId,
        userId,
        notificationType: input.notificationType,
        channel: input.channel,
        enabled: input.enabled,
        digestFrequency: input.digestFrequency ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.companyId,
          notificationPreferences.userId,
          notificationPreferences.notificationType,
          notificationPreferences.channel,
        ],
        set: {
          enabled: input.enabled,
          digestFrequency: input.digestFrequency ?? null,
          updatedAt: now,
        },
      })
      .returning();

    return {
      id: row.id,
      companyId: row.companyId,
      userId: row.userId,
      notificationType: row.notificationType as NotificationType,
      channel: row.channel as NotificationChannel,
      enabled: row.enabled,
      digestFrequency: row.digestFrequency as DigestFrequency | null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async function getEffectiveChannels(
    companyId: string,
    userId: string,
    notificationType: NotificationType,
  ): Promise<NotificationChannel[]> {
    // Fetch ALL preference rows for this (company, user, type) — not just
    // enabled ones — so we know which channels the user has explicitly opted
    // into or out of. Defaults only apply when the user has NO row for a
    // given channel.
    const rows = await db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.companyId, companyId),
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.notificationType, notificationType),
        ),
      );

    // Channels the user has explicitly set a preference for (enabled or disabled)
    const explicitChannels = new Set(rows.map((r) => r.channel as NotificationChannel));
    // Channels the user has explicitly enabled
    const enabledChannels = new Set(
      rows.filter((r) => r.enabled).map((r) => r.channel as NotificationChannel),
    );

    // Apply defaults only for channels the user has NO preference row at all
    const defaults = DEFAULT_NOTIFICATION_PREFERENCES[notificationType] ?? {};
    for (const [channel, defaultEnabled] of Object.entries(defaults)) {
      if (defaultEnabled && !explicitChannels.has(channel as NotificationChannel)) {
        enabledChannels.add(channel as NotificationChannel);
      }
    }

    return Array.from(enabledChannels);
  }

  // ── Notifications ────────────────────────────────────────────────────

  async function create(input: NotifyInput): Promise<NotificationRecord> {
    const [row] = await db
      .insert(notifications)
      .values({
        companyId: input.companyId,
        userId: input.userId,
        notificationType: input.notificationType,
        title: input.title,
        body: input.body,
        linkUrl: input.linkUrl ?? null,
        metadataJson: input.metadata ?? {},
        readAt: null,
        sentAt: null,
        emailSentAt: null,
        pushSentAt: null,
      })
      .returning();

    const record: NotificationRecord = {
      ...row,
      id: row.id,
      companyId: row.companyId,
      userId: row.userId,
      notificationType: row.notificationType as NotificationType,
      title: row.title,
      body: row.body,
      linkUrl: row.linkUrl ?? null,
      metadataJson: row.metadataJson ?? {},
      readAt: row.readAt?.toISOString() ?? null,
      sentAt: row.sentAt?.toISOString() ?? null,
      emailSentAt: row.emailSentAt?.toISOString() ?? null,
      pushSentAt: row.pushSentAt?.toISOString() ?? null,
      emailDelivery: {
        status: (row.emailDeliveryStatus ?? null) as DeliveryStatus | null,
        error: row.emailDeliveryError ?? null,
      },
      pushDelivery: {
        status: (row.pushDeliveryStatus ?? null) as DeliveryStatus | null,
        error: row.pushDeliveryError ?? null,
      },
      deliveryStatus: computeDeliveryStatus(
        {
          status: (row.emailDeliveryStatus ?? null) as DeliveryStatus | null,
          error: row.emailDeliveryError ?? null,
        },
        {
          status: (row.pushDeliveryStatus ?? null) as DeliveryStatus | null,
          error: row.pushDeliveryError ?? null,
        },
      ),
      createdAt: row.createdAt.toISOString(),
    };

    // Publish live event for in-app delivery
    publishLiveEvent({
      companyId: input.companyId,
      type: "notification.created",
      payload: {
        notificationId: record.id,
        userId: input.userId,
        notificationType: input.notificationType,
        title: input.title,
        body: input.body,
        linkUrl: input.linkUrl,
      },
    });

    return record;
  }

  async function notify(input: NotifyInput): Promise<NotificationRecord> {
    const record = await create(input);

    const channels = await getEffectiveChannels(
      input.companyId,
      input.userId,
      input.notificationType,
    );

    // Initialize delivery statuses to pending before dispatch attempts
    const initUpdates: Record<string, any> = {};
    if (channels.includes("email") && !emailDeferredToDigest) {
      initUpdates.emailDeliveryStatus = "pending";
    }
    if (channels.includes("webpush")) {
      initUpdates.pushDeliveryStatus = "pending";
    }
    if (Object.keys(initUpdates).length > 0) {
      await db
        .update(notifications)
        .set(initUpdates)
        .where(eq(notifications.id, record.id));
    }

    // Dispatch to channels in parallel
    const dispatchPromises: Promise<void>[] = [];

    // Determine whether email for this (type, user) is deferred to a digest.
    // When the user has opted into a daily/weekly digest for this type,
    // skip immediate email and leave sentAt null so sendDigest picks it up.
    let emailDeferredToDigest = false;
    if (channels.includes("email")) {
      const emailPref = await db
        .select({ digestFrequency: notificationPreferences.digestFrequency })
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.companyId, input.companyId),
            eq(notificationPreferences.userId, input.userId),
            eq(notificationPreferences.notificationType, input.notificationType),
            eq(notificationPreferences.channel, "email"),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null);
      emailDeferredToDigest =
        emailPref?.digestFrequency === "daily" || emailPref?.digestFrequency === "weekly";
    }

    if (channels.includes("email") && !emailDeferredToDigest) {
      dispatchPromises.push(
        (async () => {
          const user = await db
            .select({ email: authUsers.email, name: authUsers.name })
            .from(authUsers)
            .where(eq(authUsers.id, input.userId))
            .then((rows) => rows[0] ?? null);

          if (user?.email) {
            const email = renderNotificationEmail({
              recipientName: input.recipientName ?? user.name,
              companyName: input.companyName,
              title: input.title,
              body: input.body,
              linkUrl: input.linkUrl,
            });
            const sent = await sendEmailViaSmtp({
              to: user.email,
              subject: email.subject,
              text: email.text,
              html: email.html,
            });
            const telemetry = getTelemetryClient();
            if (sent) {
              await db
                .update(notifications)
                .set({ emailSentAt: new Date(), emailDeliveryStatus: "sent" })
                .where(eq(notifications.id, record.id));
              if (telemetry) {
                trackNotificationDeliverySent(telemetry, {
                  channel: "email",
                  notificationType: input.notificationType,
                });
              }
            } else {
              await db
                .update(notifications)
                .set({ emailDeliveryStatus: "failed", emailDeliveryError: "SMTP delivery failed" })
                .where(eq(notifications.id, record.id));
              if (telemetry) {
                trackNotificationDeliveryFailed(telemetry, {
                  channel: "email",
                  notificationType: input.notificationType,
                  errorCode: "smtp_failed",
                });
              }
            }
          }
        })(),
      );
    }

    if (channels.includes("webpush")) {
      dispatchPromises.push(
        (async () => {
          const subs = await db
            .select()
            .from(pushSubscriptions)
            .where(
              and(
                eq(pushSubscriptions.companyId, input.companyId),
                eq(pushSubscriptions.userId, input.userId),
              ),
            );

          for (const sub of subs) {
            const sent = await sendWebPush(sub, {
              title: input.title,
              body: input.body,
              linkUrl: input.linkUrl,
              notificationId: record.id,
            });
            const telemetry = getTelemetryClient();
            if (sent) {
              await db
                .update(notifications)
                .set({ pushSentAt: new Date(), pushDeliveryStatus: "sent" })
                .where(eq(notifications.id, record.id));
              if (telemetry) {
                trackNotificationDeliverySent(telemetry, {
                  channel: "webpush",
                  notificationType: input.notificationType,
                });
              }
            } else {
              // Check if it was an expired subscription (410 Gone / 404 Not Found)
              // sendWebPush logs the specific error internally
              await db
                .update(notifications)
                .set({ pushDeliveryStatus: "failed", pushDeliveryError: "Web push delivery failed" })
                .where(eq(notifications.id, record.id));
              if (telemetry) {
                trackNotificationDeliveryFailed(telemetry, {
                  channel: "webpush",
                  notificationType: input.notificationType,
                  errorCode: "push_failed",
                });
              }
            }
          }
        })(),
      );
    }

    // Mark as sent unless email is deferred to digest. In-app is always
    // delivered immediately via live event; webpush is sent above.
    // When email is deferred, leave sentAt null so that sendDigest picks
    // the notification up for a daily/weekly batch email.
    if (!emailDeferredToDigest) {
      await db
        .update(notifications)
        .set({ sentAt: new Date() })
        .where(eq(notifications.id, record.id));
    }

    await Promise.all(dispatchPromises);

    return record;
  }

  async function list(
    companyId: string,
    userId: string,
    opts?: { limit?: number; offset?: number; unreadOnly?: boolean },
  ): Promise<NotificationRecord[]> {
    const conditions = [
      eq(notifications.companyId, companyId),
      eq(notifications.userId, userId),
    ];

    if (opts?.unreadOnly) {
      conditions.push(isNull(notifications.readAt));
    }

    const rows = await db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(opts?.limit ?? 50)
      .offset(opts?.offset ?? 0);

    return rows.map((row) => ({
      ...row,
      id: row.id,
      companyId: row.companyId,
      userId: row.userId,
      notificationType: row.notificationType as NotificationType,
      title: row.title,
      body: row.body,
      linkUrl: row.linkUrl ?? null,
      metadataJson: row.metadataJson ?? {},
      readAt: row.readAt?.toISOString() ?? null,
      sentAt: row.sentAt?.toISOString() ?? null,
      emailSentAt: row.emailSentAt?.toISOString() ?? null,
      pushSentAt: row.pushSentAt?.toISOString() ?? null,
      emailDelivery: {
        status: (row.emailDeliveryStatus ?? null) as DeliveryStatus | null,
        error: row.emailDeliveryError ?? null,
      },
      pushDelivery: {
        status: (row.pushDeliveryStatus ?? null) as DeliveryStatus | null,
        error: row.pushDeliveryError ?? null,
      },
      deliveryStatus: computeDeliveryStatus(
        {
          status: (row.emailDeliveryStatus ?? null) as DeliveryStatus | null,
          error: row.emailDeliveryError ?? null,
        },
        {
          status: (row.pushDeliveryStatus ?? null) as DeliveryStatus | null,
          error: row.pushDeliveryError ?? null,
        },
      ),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async function unreadCount(companyId: string, userId: string): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.companyId, companyId),
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      );
    return row?.count ?? 0;
  }

  async function markRead(id: string): Promise<void> {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(eq(notifications.id, id));
  }

  async function markAllRead(companyId: string, userId: string): Promise<void> {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.companyId, companyId),
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      );
  }

  // ── Push Subscriptions ───────────────────────────────────────────────

  async function registerPushSubscription(
    companyId: string,
    userId: string,
    input: PushSubscriptionRegisterInput,
  ): Promise<PushSubscription> {
    const [row] = await db
      .insert(pushSubscriptions)
      .values({
        companyId,
        userId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent ?? null,
      })
      .onConflictDoNothing({
        target: [pushSubscriptions.endpoint],
      })
      .returning();

    // If conflict, fetch existing
    if (!row) {
      const existing = await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, input.endpoint))
        .then((rows) => rows[0] ?? null);
      if (existing) {
        return {
          ...existing,
          createdAt: existing.createdAt.toISOString(),
        };
      }
    }

    return {
      ...row,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async function unregisterPushSubscription(id: string): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
  }

  async function listPushSubscriptions(
    companyId: string,
    userId: string,
  ): Promise<PushSubscription[]> {
    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.companyId, companyId),
          eq(pushSubscriptions.userId, userId),
        ),
      );
    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  // ── Digest ───────────────────────────────────────────────────────────

  async function sendDigest(
    companyId: string,
    frequency: "daily" | "weekly",
  ): Promise<{ sent: number }> {
    const company = await db
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.id, companyId))
      .then((rows) => rows[0] ?? null);

    const users = await db
      .selectDistinct({ userId: notifications.userId })
      .from(notifications)
      .where(
        and(
          eq(notifications.companyId, companyId),
          isNull(notifications.sentAt),
        ),
      );

    let sent = 0;

    for (const { userId } of users) {
      // Check if this user wants digest at this frequency
      const prefs = await db
        .select()
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.companyId, companyId),
            eq(notificationPreferences.userId, userId),
            eq(notificationPreferences.digestFrequency, frequency),
          ),
        )
        .limit(1);

      // If no explicit digest preference, skip
      if (prefs.length === 0) continue;

      const pending = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.companyId, companyId),
            eq(notifications.userId, userId),
            isNull(notifications.sentAt),
          ),
        )
        .limit(50);

      if (pending.length === 0) continue;

      const user = await db
        .select({ email: authUsers.email, name: authUsers.name })
        .from(authUsers)
        .where(eq(authUsers.id, userId))
        .then((rows) => rows[0] ?? null);

      if (!user?.email) continue;

      const email = renderDigestEmail({
        recipientName: user.name,
        companyName: company?.name,
        frequency,
        items: pending.map((n) => ({
          title: n.title,
          body: n.body,
          linkUrl: n.linkUrl,
        })),
      });

      const ok = await sendEmailViaSmtp({
        to: user.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });

      if (ok) {
        // Mark all pending as sent
        await db
          .update(notifications)
          .set({ sentAt: new Date(), emailDeliveryStatus: "sent" })
          .where(
            and(
              eq(notifications.companyId, companyId),
              eq(notifications.userId, userId),
              isNull(notifications.sentAt),
            ),
          );
        sent += pending.length;
      } else {
        // Mark pending as failed for email
        await db
          .update(notifications)
          .set({ emailDeliveryStatus: "failed", emailDeliveryError: "SMTP digest delivery failed" })
          .where(
            and(
              eq(notifications.companyId, companyId),
              eq(notifications.userId, userId),
              isNull(notifications.sentAt),
            ),
          );
      }
    }

    return { sent };
  }

  // ── Hooks for integration ────────────────────────────────────────────

  /**
   * Notify all human members of a company about an event.
   * Used for budget thresholds, errors, etc. that affect the whole company.
   */
  async function notifyCompanyMembers(
    companyId: string,
    input: Omit<NotifyInput, "companyId" | "userId">,
  ): Promise<NotificationRecord[]> {
    const members = await db
      .select({ principalId: companyMemberships.principalId })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.status, "active"),
        ),
      );

    const results: NotificationRecord[] = [];
    for (const member of members) {
      const record = await notify({
        ...input,
        companyId,
        userId: member.principalId,
      });
      results.push(record);
    }
    return results;
  }

  // ── Public API ───────────────────────────────────────────────────────

  return {
    getPreferences,
    upsertPreference,
    getEffectiveChannels,
    create,
    notify,
    list,
    unreadCount,
    markRead,
    markAllRead,
    registerPushSubscription,
    unregisterPushSubscription,
    listPushSubscriptions,
    sendDigest,
    notifyCompanyMembers,
  };
}

export type NotificationService = ReturnType<typeof notificationService>;

// Exported for testing of graceful degradation
export { isSmtpConfigured, sendEmailViaSmtp, isVapidConfigured, sendWebPush };