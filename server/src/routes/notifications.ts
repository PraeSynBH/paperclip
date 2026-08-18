import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { companyMemberships } from "@paperclipai/db";
import { and, eq } from "drizzle-orm";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { forbidden, unprocessable, notFound } from "../errors.js";
import { notificationService, logActivity } from "../services/index.js";
import { NOTIFICATION_TYPES, NOTIFICATION_CHANNELS, DIGEST_FREQUENCIES } from "@paperclipai/shared";

const preferenceSchema = z.object({
  notificationType: z.enum(NOTIFICATION_TYPES),
  channel: z.enum(NOTIFICATION_CHANNELS),
  enabled: z.boolean(),
  digestFrequency: z.enum(DIGEST_FREQUENCIES).nullish(),
});

const preferencesBatchSchema = z.object({
  preferences: z.array(preferenceSchema).min(1).max(50),
});

const pushSubscriptionSchema = z.object({
  endpoint: z.string().trim().min(1).max(2048),
  p256dh: z.string().trim().min(1).max(2048),
  auth: z.string().trim().min(1).max(2048),
  userAgent: z.string().trim().max(512).nullish(),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  unreadOnly: z.coerce.boolean().default(false),
});

const digestSchema = z.object({
  frequency: z.enum(["daily", "weekly"]),
});

export function notificationRoutes(db: Db) {
  const router = Router();
  const svc = notificationService(db);

  const requireBoardUser = (req: Parameters<typeof assertCompanyAccess>[0]): void => {
    assertBoard(req);
    if (!req.actor.userId) throw forbidden("Board user context required");
  };

  // ── Preferences ─────────────────────────────────────────────────────

  router.get("/companies/:companyId/notification-preferences", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    requireBoardUser(req);
    const prefs = await svc.getPreferences(companyId, req.actor.userId!);
    res.json(prefs);
  });

  router.put(
    "/companies/:companyId/notification-preferences",
    validate(preferencesBatchSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      requireBoardUser(req);

      const upserted = [];
      for (const pref of req.body.preferences) {
        const row = await svc.upsertPreference(companyId, req.actor.userId!, pref);
        upserted.push(row);
      }

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "notification.preferences_updated",
        entityType: "company",
        entityId: companyId,
        details: {
          userId: req.actor.userId,
          preferenceCount: upserted.length,
        },
      });

      res.json(upserted);
    },
  );

  // ── Notifications ───────────────────────────────────────────────────

  router.get("/companies/:companyId/notifications", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    requireBoardUser(req);
    const query = listQuerySchema.parse(req.query);
    const items = await svc.list(companyId, req.actor.userId!, query);
    const unread = await svc.unreadCount(companyId, req.actor.userId!);
    res.json({ items, unread, total: unread + items.length });
  });

  router.get("/companies/:companyId/notifications/unread-count", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    requireBoardUser(req);
    const unread = await svc.unreadCount(companyId, req.actor.userId!);
    res.json({ unread });
  });

  router.post("/companies/:companyId/notifications/read-all", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    requireBoardUser(req);
    await svc.markAllRead(companyId, req.actor.userId!);
    res.json({ ok: true });
  });

  router.post("/companies/:companyId/notifications/:notificationId/read", async (req, res) => {
    const companyId = req.params.companyId as string;
    const notificationId = req.params.notificationId as string;
    assertCompanyAccess(req, companyId);
    requireBoardUser(req);

    // Only allow marking your own notification as read
    const userNotifications = await svc.list(companyId, req.actor.userId!, { limit: 100 });
    const owned = userNotifications.some((n) => n.id === notificationId);
    if (!owned) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }

    await svc.markRead(notificationId);
    res.json({ ok: true });
  });

  // ── Push subscriptions ──────────────────────────────────────────────

  router.get("/companies/:companyId/push-subscriptions", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    requireBoardUser(req);
    const subs = await svc.listPushSubscriptions(companyId, req.actor.userId!);
    res.json(subs);
  });

  router.post(
    "/companies/:companyId/push-subscriptions",
    validate(pushSubscriptionSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      requireBoardUser(req);

      const sub = await svc.registerPushSubscription(companyId, req.actor.userId!, {
        ...req.body,
        userAgent: req.body.userAgent ?? req.get("user-agent") ?? null,
      });
      res.status(201).json(sub);
    },
  );

  router.delete("/companies/:companyId/push-subscriptions/:subscriptionId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const subscriptionId = req.params.subscriptionId as string;
    assertCompanyAccess(req, companyId);
    requireBoardUser(req);

    const subs = await svc.listPushSubscriptions(companyId, req.actor.userId!);
    const owned = subs.some((s) => s.id === subscriptionId);
    if (!owned) {
      res.status(404).json({ error: "Push subscription not found" });
      return;
    }

    await svc.unregisterPushSubscription(subscriptionId);
    res.json({ ok: true });
  });

  // ── Digest ──────────────────────────────────────────────────────────

  router.post(
    "/companies/:companyId/notifications/digest",
    validate(digestSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      requireBoardUser(req);

      const result = await svc.sendDigest(companyId, req.body.frequency);
      res.json(result);
    },
  );

  // ── Agent-to-human notification ─────────────────────────────────────
  // Agents can call this endpoint to notify human users about review,
  // approval, completion, or any other event requiring human attention.

  const sendNotificationSchema = z.object({
    userId: z.string().trim().min(1),
    notificationType: z.enum(NOTIFICATION_TYPES),
    title: z.string().trim().min(1).max(500),
    body: z.string().trim().min(1).max(5000),
    linkUrl: z.string().trim().max(2048).nullish(),
    metadata: z.record(z.unknown()).nullish(),
    recipientName: z.string().trim().max(200).nullish(),
    companyName: z.string().trim().max(200).nullish(),
  });

  router.post(
    "/companies/:companyId/notifications/send",
    validate(sendNotificationSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      // Agents can send notifications to users; board users can also send
      if (req.actor.type !== "agent" && req.actor.type !== "board") {
        throw forbidden("Agent or board access required");
      }

      // Agent can only notify within their own company
      if (req.actor.type === "agent" && req.actor.companyId !== companyId) {
        throw forbidden("Agent cannot send notifications to another company");
      }

      // Verify the target userId is an active member of this company
      const membership = await db
        .select({ principalId: companyMemberships.principalId })
        .from(companyMemberships)
        .where(
          and(
            eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, req.body.userId),
            eq(companyMemberships.status, "active"),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null);
      if (!membership) {
        throw notFound("Target user is not an active member of this company");
      }

      const record = await svc.notify({
        companyId,
        userId: req.body.userId,
        notificationType: req.body.notificationType,
        title: req.body.title,
        body: req.body.body,
        linkUrl: req.body.linkUrl ?? undefined,
        metadata: req.body.metadata ?? undefined,
        recipientName: req.body.recipientName ?? undefined,
        companyName: req.body.companyName ?? undefined,
      });

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "notification.sent",
        entityType: "company",
        entityId: companyId,
        details: {
          userId: req.body.userId,
          notificationType: req.body.notificationType,
          notificationId: record.id,
        },
      });

      res.status(201).json(record);
    },
  );

  return router;
}