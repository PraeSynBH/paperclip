import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the opt-in PostHog instrumentation service.
 *
 * The module initialises a PostHog client only when POSTHOG_API_KEY and
 * POSTHOG_HOST are both set. Without them every capture function is a no-op.
 *
 * The posthog-node package IS a regular dependency (not optional like OTel),
 * so importing it never fails. The gating is purely about not sending events
 * when the operator hasn't configured PostHog.
 *
 * Tests use vi.mock to replace the posthog-node PostHog class with a mock
 * so no real HTTP calls are made. The module under test reads env vars at
 * import time, so each scenario resets the module registry.
 */

const mockCapture = vi.fn();
const mockCaptureException = vi.fn();
const mockFlush = vi.fn();
const mockShutdown = vi.fn();

const MockPostHog = vi.fn(function () {
  return {
    capture: mockCapture,
    captureException: mockCaptureException,
    flush: mockFlush,
    shutdown: mockShutdown,
  };
});

vi.mock("posthog-node", () => ({
  PostHog: MockPostHog,
}));

const { loggerWarn, loggerInfo } = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock("../middleware/logger.js", () => ({
  logger: { warn: loggerWarn, info: loggerInfo },
}));

const API_KEY_ENV = "POSTHOG_API_KEY";
const HOST_ENV = "POSTHOG_HOST";

const originalApiKey = process.env[API_KEY_ENV];
const originalHost = process.env[HOST_ENV];

beforeEach(() => {
  vi.resetModules();
  mockCapture.mockClear();
  mockCaptureException.mockClear();
  mockFlush.mockClear();
  mockShutdown.mockClear();
  MockPostHog.mockClear();
  loggerWarn.mockClear();
  loggerInfo.mockClear();

  // Some tests set env vars, some don't — clear them first.
  delete process.env[API_KEY_ENV];
  delete process.env[HOST_ENV];
});

afterEach(() => {
  // Restore original env state
  if (originalApiKey !== undefined) process.env[API_KEY_ENV] = originalApiKey;
  else delete process.env[API_KEY_ENV];
  if (originalHost !== undefined) process.env[HOST_ENV] = originalHost;
  else delete process.env[HOST_ENV];
});

describe("initPostHog", () => {
  it("returns null and does not create a PostHog client when env vars are missing", async () => {
    const { initPostHog } = await import("../services/posthog.js");
    expect(initPostHog()).toBeNull();
    expect(MockPostHog).not.toHaveBeenCalled();
    expect(loggerInfo).not.toHaveBeenCalled();
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it("returns null when only POSTHOG_API_KEY is set", async () => {
    process.env[API_KEY_ENV] = "test-key";
    const { initPostHog } = await import("../services/posthog.js");
    expect(initPostHog()).toBeNull();
    expect(MockPostHog).not.toHaveBeenCalled();
  });

  it("returns null when only POSTHOG_HOST is set", async () => {
    process.env[HOST_ENV] = "https://app.posthog.com";
    const { initPostHog } = await import("../services/posthog.js");
    expect(initPostHog()).toBeNull();
    expect(MockPostHog).not.toHaveBeenCalled();
  });

  it("creates a PostHog client when both env vars are present", async () => {
    process.env[API_KEY_ENV] = "phc_test123";
    process.env[HOST_ENV] = "https://app.posthog.com";
    const { initPostHog } = await import("../services/posthog.js");
    const client = initPostHog();
    expect(client).not.toBeNull();
    expect(MockPostHog).toHaveBeenCalledTimes(1);
    expect(MockPostHog).toHaveBeenCalledWith("phc_test123", {
      host: "https://app.posthog.com",
      flushAt: 20,
      flushInterval: 10_000,
    });
    expect(loggerInfo).toHaveBeenCalledWith(
      { host: "https://app.posthog.com" },
      "[paperclip] PostHog instrumentation enabled",
    );
  });

  it("is idempotent — returns the same singleton on second call", async () => {
    process.env[API_KEY_ENV] = "phc_test123";
    process.env[HOST_ENV] = "https://app.posthog.com";
    const { initPostHog } = await import("../services/posthog.js");
    const c1 = initPostHog();
    const c2 = initPostHog();
    expect(c1).not.toBeNull();
    expect(c2).toBe(c1);
    expect(MockPostHog).toHaveBeenCalledTimes(1);
  });
});

describe("captureMetric", () => {
  it("is a no-op when PostHog is not configured", async () => {
    const { captureMetric } = await import("../services/posthog.js");
    captureMetric("test.event", "company-123", { foo: "bar" });
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("captures an event when PostHog is configured", async () => {
    process.env[API_KEY_ENV] = "phc_test123";
    process.env[HOST_ENV] = "https://app.posthog.com";
    const { captureMetric } = await import("../services/posthog.js");
    captureMetric("test.event", "company-123", { foo: "bar" });
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledWith({
      distinctId: "company-123",
      event: "test.event",
      properties: { foo: "bar" },
    });
  });

  it("uses a fallback distinctId when none is provided", async () => {
    process.env[API_KEY_ENV] = "phc_test123";
    process.env[HOST_ENV] = "https://app.posthog.com";
    const { captureMetric } = await import("../services/posthog.js");
    captureMetric("test.event");
    expect(mockCapture).toHaveBeenCalledWith({
      distinctId: "paperclip-server",
      event: "test.event",
      properties: {},
    });
  });
});

describe("captureErrorEvent", () => {
  it("is a no-op when PostHog is not configured", async () => {
    const { captureErrorEvent } = await import("../services/posthog.js");
    captureErrorEvent(new Error("test error"));
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("captures an error via captureException when configured", async () => {
    process.env[API_KEY_ENV] = "phc_test123";
    process.env[HOST_ENV] = "https://app.posthog.com";
    const { captureErrorEvent } = await import("../services/posthog.js");
    const error = new Error("Something broke");
    captureErrorEvent(error, "company-123", { context: "test" });
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    const [capturedError, distinctId, extra] = mockCaptureException.mock.calls[0];
    expect(distinctId).toBe("company-123");
    expect(extra).toEqual({ context: "test" });
    expect(capturedError instanceof Error).toBe(true);
    expect(capturedError.name).toBe("Error");
  });
});

describe("flush", () => {
  it("is a no-op when PostHog is not configured", async () => {
    const { flush } = await import("../services/posthog.js");
    await flush();
    expect(mockFlush).not.toHaveBeenCalled();
  });

  it("flushes pending events when configured", async () => {
    process.env[API_KEY_ENV] = "phc_test123";
    process.env[HOST_ENV] = "https://app.posthog.com";
    const { flush } = await import("../services/posthog.js");
    await flush();
    expect(mockFlush).toHaveBeenCalledTimes(1);
  });
});

describe("shutdownPostHog", () => {
  it("is a no-op when PostHog is not configured", async () => {
    const { shutdownPostHog } = await import("../services/posthog.js");
    await shutdownPostHog();
    expect(mockShutdown).not.toHaveBeenCalled();
  });

  it("shuts down the PostHog client", async () => {
    process.env[API_KEY_ENV] = "phc_test123";
    process.env[HOST_ENV] = "https://app.posthog.com";
    const { shutdownPostHog } = await import("../services/posthog.js");
    await shutdownPostHog();
    expect(mockShutdown).toHaveBeenCalledTimes(1);
  });
});

describe("isPostHogEnabled", () => {
  it("returns false when not configured", async () => {
    const { isPostHogEnabled } = await import("../services/posthog.js");
    expect(isPostHogEnabled()).toBe(false);
  });

  it("returns true when configured", async () => {
    process.env[API_KEY_ENV] = "phc_test123";
    process.env[HOST_ENV] = "https://app.posthog.com";
    const { isPostHogEnabled } = await import("../services/posthog.js");
    expect(isPostHogEnabled()).toBe(true);
  });
});