import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  computeDeliveryStatus,
  type DeliveryChannelStatus,
} from "@paperclipai/shared";

describe("computeDeliveryStatus", () => {
  it("returns null when no channels are attempted", () => {
    expect(computeDeliveryStatus(null, null)).toBeNull();
  });

  it("returns 'sent' when all channels succeeded", () => {
    const email: DeliveryChannelStatus = { status: "sent", error: null };
    const push: DeliveryChannelStatus = { status: "sent", error: null };
    expect(computeDeliveryStatus(email, push)).toBe("sent");
  });

  it("returns 'failed' when any channel failed", () => {
    const email: DeliveryChannelStatus = { status: "sent", error: null };
    const push: DeliveryChannelStatus = { status: "failed", error: "Error" };
    expect(computeDeliveryStatus(email, push)).toBe("failed");
  });

  it("returns 'failed' when only one channel and it failed", () => {
    const email: DeliveryChannelStatus = { status: "failed", error: "SMTP error" };
    expect(computeDeliveryStatus(email, null)).toBe("failed");
  });

  it("returns 'pending' when a channel is still pending", () => {
    const email: DeliveryChannelStatus = { status: "pending", error: null };
    const push: DeliveryChannelStatus = { status: "sent", error: null };
    expect(computeDeliveryStatus(email, push)).toBe("pending");
  });

  it("returns 'pending' when all channels are pending", () => {
    const email: DeliveryChannelStatus = { status: "pending", error: null };
    expect(computeDeliveryStatus(email, null)).toBe("pending");
  });

  it("returns 'failed' over 'pending' when one failed and one pending", () => {
    const email: DeliveryChannelStatus = { status: "pending", error: null };
    const push: DeliveryChannelStatus = { status: "failed", error: "Push error" };
    expect(computeDeliveryStatus(email, push)).toBe("failed");
  });

  it("returns 'sent' when single channel succeeds", () => {
    const email: DeliveryChannelStatus = { status: "sent", error: null };
    expect(computeDeliveryStatus(email, null)).toBe("sent");
  });
});