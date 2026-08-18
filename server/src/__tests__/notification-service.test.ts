import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authUsers,
  companies,
  companyMemberships,
  createDb,
  notificationPreferences,
  notifications,
} from "@paperclipai/db";
import { eq } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { notificationService } from "../services/notifications.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres notification service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("notification service fixes", () => {
  let db: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId: string;
  let userId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-notification-tests-");
    db = createDb(tempDb.connectionString);
    companyId = randomUUID();
    userId = "test-user-1";

    await db.insert(companies).values({
      id: companyId,
      name: "Notification Test Co",
      status: "active",
      issuePrefix: "NTF",
      updatedAt: new Date(),
    });

    await db.insert(authUsers).values({
      id: userId,
      name: "Test User",
      email: "test@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "admin",
      updatedAt: new Date(),
    });
  }, 30_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  describe("S1 — getEffectiveChannels defaults vs explicit disables", () => {
    beforeAll(async () => {
      // Clean up prefs from other tests
      await db.delete(notificationPreferences).where(
        eq(notificationPreferences.companyId, companyId),
      );
    });

    it("applies defaults when no preference row exists", async () => {
      const svc = notificationService(db);
      const channels = await svc.getEffectiveChannels(companyId, userId, "execution_error");
      // execution_error default: in_app: true, email: false, webpush: false
      expect(channels).toContain("in_app");
      expect(channels).not.toContain("email");
      expect(channels).not.toContain("webpush");
    });

    it("respects explicit user disable even when default is true", async () => {
      await db.insert(notificationPreferences).values({
        id: randomUUID(),
        companyId,
        userId,
        notificationType: "budget_threshold",
        channel: "email",
        enabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const svc = notificationService(db);
      const channels = await svc.getEffectiveChannels(companyId, userId, "budget_threshold");
      // budget_threshold default: email: true — but user explicitly disabled
      // So email should NOT be in the effective channels
      expect(channels).toContain("in_app");
      expect(channels).not.toContain("email");
      expect(channels).not.toContain("webpush");
    });

    it("respects explicit user enable when default is false", async () => {
      await db.insert(notificationPreferences).values({
        id: randomUUID(),
        companyId,
        userId,
        notificationType: "work_completed",
        channel: "email",
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const svc = notificationService(db);
      const channels = await svc.getEffectiveChannels(companyId, userId, "work_completed");
      // work_completed default: email: false — but user explicitly enabled
      expect(channels).toContain("in_app");
      expect(channels).toContain("email");
    });
  });

  describe("S2 — sentAt not set when email is deferred to digest", () => {
    beforeAll(async () => {
      const svc = notificationService(db);

      // Set up a daily digest preference for execution_error/email
      await db.insert(notificationPreferences).values({
        id: randomUUID(),
        companyId,
        userId,
        notificationType: "execution_error",
        channel: "email",
        enabled: true,
        digestFrequency: "daily",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Notify with a deferred email type
      await svc.notify({
        companyId,
        userId,
        notificationType: "execution_error",
        title: "Test notification",
        body: "This should be deferred to digest",
      });
    });

    it("leaves sentAt null when email is deferred to digest", async () => {
      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.companyId, companyId))
        .limit(10);

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.sentAt).toBeNull();
      }
    });
  });

  describe("S2 — sentAt set when email is not deferred", () => {
    beforeAll(async () => {
      const svc = notificationService(db);

      // Notify with a type that has no daily/weekly digest preference
      await svc.notify({
        companyId,
        userId,
        notificationType: "review_requested",
        title: "Test immediate",
        body: "This should be sent immediately",
      });
    });

    it("sets sentAt when no digest preference exists for the type", async () => {
      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.notificationType, "review_requested"))
        .limit(10);

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.sentAt).not.toBeNull();
      }
    });
  });
});