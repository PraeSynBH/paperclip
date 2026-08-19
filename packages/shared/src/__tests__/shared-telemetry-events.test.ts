import { describe, expect, it, vi } from "vitest";
import { TelemetryClient } from "../telemetry/client.js";
import {
  trackNotificationDeliverySent,
  trackNotificationDeliveryFailed,
} from "../telemetry/events.js";

describe("notification telemetry events", () => {
  function createClient() {
    return new TelemetryClient(
      { enabled: true },
      () => ({
        installId: "test-install",
        salt: "test-salt",
        createdAt: "2026-01-01T00:00:00Z",
        firstSeenVersion: "0.0.0",
      }),
      "0.0.0-test",
    );
  }

  describe("trackNotificationDeliverySent", () => {
    it("emits notification.delivery_sent with correct channel and type", () => {
      const client = createClient();
      const spy = vi.spyOn(client, "track");

      trackNotificationDeliverySent(client, {
        channel: "email",
        notificationType: "review_requested",
      });

      expect(spy).toHaveBeenCalledWith("notification.delivery_sent", {
        channel: "email",
        notification_type: "review_requested",
      });
    });

    it("emits notification.delivery_sent for webpush channel", () => {
      const client = createClient();
      const spy = vi.spyOn(client, "track");

      trackNotificationDeliverySent(client, {
        channel: "webpush",
        notificationType: "approval_needed",
      });

      expect(spy).toHaveBeenCalledWith("notification.delivery_sent", {
        channel: "webpush",
        notification_type: "approval_needed",
      });
    });

    it("emits notification.delivery_sent for all notification types", () => {
      const client = createClient();
      const spy = vi.spyOn(client, "track");

      const types = [
        "review_requested",
        "approval_needed",
        "work_completed",
        "budget_threshold",
        "execution_error",
      ] as const;

      for (const notificationType of types) {
        trackNotificationDeliverySent(client, {
          channel: "email",
          notificationType,
        });

        expect(spy).toHaveBeenCalledWith("notification.delivery_sent", {
          channel: "email",
          notification_type: notificationType,
        });
      }
    });
  });

  describe("trackNotificationDeliveryFailed", () => {
    it("emits notification.delivery_failed with correct channel, type, and error code", () => {
      const client = createClient();
      const spy = vi.spyOn(client, "track");

      trackNotificationDeliveryFailed(client, {
        channel: "email",
        notificationType: "execution_error",
        errorCode: "smtp_failed",
      });

      expect(spy).toHaveBeenCalledWith("notification.delivery_failed", {
        channel: "email",
        notification_type: "execution_error",
        error_code: "smtp_failed",
      });
    });

    it("emits notification.delivery_failed without error code when omitted", () => {
      const client = createClient();
      const spy = vi.spyOn(client, "track");

      trackNotificationDeliveryFailed(client, {
        channel: "webpush",
        notificationType: "work_completed",
      });

      expect(spy).toHaveBeenCalledWith("notification.delivery_failed", {
        channel: "webpush",
        notification_type: "work_completed",
      });
    });

    it("emits notification.delivery_failed for push failures", () => {
      const client = createClient();
      const spy = vi.spyOn(client, "track");

      trackNotificationDeliveryFailed(client, {
        channel: "webpush",
        notificationType: "approval_needed",
        errorCode: "push_failed",
      });

      expect(spy).toHaveBeenCalledWith("notification.delivery_failed", {
        channel: "webpush",
        notification_type: "approval_needed",
        error_code: "push_failed",
      });
    });

    it("emits notification.delivery_failed for digest failures", () => {
      const client = createClient();
      const spy = vi.spyOn(client, "track");

      trackNotificationDeliveryFailed(client, {
        channel: "email",
        notificationType: "budget_threshold",
        errorCode: "digest_smtp_failed",
      });

      expect(spy).toHaveBeenCalledWith("notification.delivery_failed", {
        channel: "email",
        notification_type: "budget_threshold",
        error_code: "digest_smtp_failed",
      });
    });
  });
});
