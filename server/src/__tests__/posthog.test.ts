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

async function importFreshPosthog() {
  vi.resetModules();
  return await import("../services/posthog.js");
}

beforeEach(() => {
  delete process.env[API_KEY_ENV];
  delete process.env[HOST_ENV];
  mockCapture.mockClear();
  mockCaptureException.mockClear();
  mockFlush.mockClear();
  mockShutdown.mockClear();
  MockPostHog.mockClear();
  loggerWarn.mockClear();
  loggerInfo.mockClear();
});

afterEach(() => {
  if (originalApiKey === undefined) delete process.env[API_KEY_ENV];
  else process.env[API_KEY_ENV] = originalApiKey;
  if (originalHost === undefined) delete process.env[HOST_ENV];
  else process.env[HOST_ENV] = originalHost;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// isPostHogEnabled / initPostHog
// ---------------------------------------------------------------------------

describe("isPostHogEnabled", () => {
  it("returns false when POSTHOG_API_KEY and POSTHOG_HOST are not set", async () => {
    const { isPostHogEnabled } = await importFreshPosthog();
    expect(isPostHogEnabled()).toBe(false);
  });

  it("returns false when only POSTHOG_API_KEY is set", async () => {
    process.env[API_KEY_ENV] = "phc_test_key";
    const { isPostHogEnabled } = await importFreshPosthog();
    expect(isPostHogEnabled()).toBe(false);
  });

  it("returns false when only POSTHOG_HOST is set", async () => {
    process.env[HOST_ENV] = "http://localhost:8000";
    const { isPostHogEnabled } = await importFreshPosthog();
    expect(isPostHogEnabled()).toBe(false);
  });

  it("returns true when both env vars are present", async () => {
    process.env[API_KEY_ENV] = "phc_test_key";
    process.env[HOST_ENV] = "http://localhost:8000";
    const { isPostHogEnabled } = await importFreshPosthog();
    expect(isPostHogEnabled()).toBe(true);
  });

  it("creates a PostHog client with the correct config when both env vars are set", async () => {
    process.env[API_KEY_ENV] = "phc_test_key";
    process.env[HOST_ENV] = "http://localhost:8000";
    const { isPostHogEnabled } = await importFreshPosthog();

    expect(isPostHogEnabled()).toBe(true);
    expect(MockPostHog).toHaveBeenCalledTimes(1);
    expect(MockPostHog).toHaveBeenCalledWith("phc_test_key", expect.objectContaining({
      host: "http://localhost:8000",
    }));
    expect(loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ host: "http://localhost:8000" }),
      expect.stringContaining("PostHog instrumentation enabled"),
    );
  });

  it("logs a warning and returns false when PostHog constructor throws", async () => {
    MockPostHog.mockImplementationOnce(() => {
      throw new Error("constructor failure");
    });

    process.env[API_KEY_ENV] = "phc_test_key";
    process.env[HOST_ENV] = "http://localhost:8000";
    const { isPostHogEnabled } = await importFreshPosthog();

    expect(isPostHogEnabled()).toBe(false);
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining("Failed to initialize PostHog client"),
    );
  });
});

// ---------------------------------------------------------------------------
// captureErrorEvent
// ---------------------------------------------------------------------------

describe("captureErrorEvent", () => {
  it("is a no-op when PostHog is not configured", async () => {
    const { captureErrorEvent } = await importFreshPosthog();

    captureErrorEvent(new Error("test error"));

    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("calls captureException with the error when PostHog is configured", async () => {
    process.env[API_KEY_ENV] = "phc_test_key";
    process.env[HOST_ENV] = "http://localhost:8000";
    const { captureErrorEvent } = await importFreshPosthog();

    const error = new Error("something broke");
    captureErrorEvent(error, "test-distinct-id", { url: "/api/test", method: "POST" });

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: error.message, name: "Error" }),
      "test-distinct-id",
      { url: "/api/test", method: "POST" },
    );
  });

  it("uses default distinctId when none provided", async () => {
    process.env[API_KEY_ENV] = "phc_test_key";
    process.env[HOST_ENV] = "http://localhost:8000";
    const { captureErrorEvent } = await importFreshPosthog();

    captureErrorEvent(new Error("err"));

    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      "paperclip-server",
      undefined,
    );
  });

  it("redacts sensitive data from error message before sending to PostHog", async () => {
    process.env[API_KEY_ENV] = "phc_test_key";
    process.env[HOST_ENV] = "http://localhost:8000";
    const { captureErrorEvent } = await importFreshPosthog();

    // Build a JWT-like token where each dot-segment is >=8 chars to match
    // COMMAND_JWT_RE in @paperclipai/adapter-utils.  Constructed via
    // concatenation to avoid auto-redaction of literal JWT strings.
    function makeSegment(prefix: string, body: string, suffix: string): string {
      return prefix + body + suffix;
    }
    const seg1 = makeSegment("eyJh", "bGciOiJIUzI1NiJ9", "");
    const seg2 = makeSegment("eyJz", "dWIiOiIxMjM0NTY3ODkwIn0", "");
    const seg3 = makeSegment("dozj", "gNnP_9T0J0wI0gTQ0Q", "");
    const jwtToken = seg1 + "." + seg2 + "." + seg3;

    captureErrorEvent(
      new Error("SQL constraint violation: user data contains token " + jwtToken),
    );

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      "paperclip-server",
      undefined,
    );
    const sanitized = mockCaptureException.mock.calls[0][0] as Error;
    expect(sanitized.message).toContain("***REDACTED***");
    expect(sanitized.message).not.toContain(jwtToken);
    // Stack trace preserved (redacted in place) — PostHog triages by the real
    // throw site, and the token embedded in the trace is scrubbed.
    expect(sanitized.name).toBe("Error");
    expect(sanitized.stack).toBeDefined();
    expect(sanitized.stack).not.toContain(jwtToken);
    // The stack must point at the original throw site (this test file), not at
    // the sanitizer's own line in posthog.ts — the P1 regression this guards.
    expect(sanitized.stack).toContain("posthog.test.ts");
  });

  it("redacts non-Error values as-is (not an Error instance)", async () => {
    process.env[API_KEY_ENV] = "phc_test_key";
    process.env[HOST_ENV] = "http://localhost:8000";
    const { captureErrorEvent } = await importFreshPosthog();

    captureErrorEvent("string-error");

    expect(mockCaptureException).toHaveBeenCalledWith(
      "string-error",
      "paperclip-server",
      undefined,
    );
  });

  it("does not mutate the original error object (P2-1 cloneError)", async () => {
    process.env[API_KEY_ENV] = "phc_test_key";
    process.env[HOST_ENV] = "http://localhost:8000";
    const { captureErrorEvent } = await importFreshPosthog();

    const originalMessage = "secret-db-password=hunter2";
    const originalStack = "Error\n    at originalSite (file.ts:42:10)";
    const error = new Error(originalMessage);
    error.stack = originalStack;

    captureErrorEvent(error);

    // The original error must retain its unredacted values — the sanitization
    // operates on a clone.  If someone reverts to in-place mutation, this
    // assertion fails.
    expect(error.message).toBe(originalMessage);
    expect(error.stack).toBe(originalStack);
  });
});

// ---------------------------------------------------------------------------
// captureMetric
// ---------------------------------------------------------------------------

describe("captureMetric", () => {
  it("is a no-op when PostHog is not configured", async () => {
    const { captureMetric } = await importFreshPosthog();

    captureMetric("test.event", "user_123", { foo: "bar" });

    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("calls capture with event name and properties when PostHog is configured", async () => {
    process.env[API_KEY_ENV] = "phc_test_key";
    process.env[HOST_ENV] = "http://localhost:8000";
    const { captureMetric } = await importFreshPosthog();

    captureMetric("agent.run.started", "agent_42", {
      runId: "run-1",
      status: "running",
    });

    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledWith({
      distinctId: "agent_42",
      event: "agent.run.started",
      properties: { runId: "run-1", status: "running" },
    });
  });

  it("uses default distinctId when none provided", async () => {
    process.env[API_KEY_ENV] = "phc_test_key";
    process.env[HOST_ENV] = "http://localhost:8000";
    const { captureMetric } = await importFreshPosthog();

    captureMetric("test.event", undefined, { value: 1 });

    expect(mockCapture).toHaveBeenCalledWith({
      distinctId: "paperclip-server",
      event: "test.event",
      properties: { value: 1 },
    });
  });
});

// ---------------------------------------------------------------------------
// flush / shutdownPostHog
// ---------------------------------------------------------------------------

describe("flush", () => {
  it("is a no-op when PostHog is not configured", async () => {
    const { flush } = await importFreshPosthog();

    await flush();

    expect(mockFlush).not.toHaveBeenCalled();
  });

  it("flushes the PostHog client when configured", async () => {
    process.env[API_KEY_ENV] = "phc_test_key";
    process.env[HOST_ENV] = "http://localhost:8000";
    const { flush } = await importFreshPosthog();

    await flush();

    expect(mockFlush).toHaveBeenCalledTimes(1);
  });
});

describe("shutdownPostHog", () => {
  it("is a no-op when PostHog is not configured", async () => {
    const { shutdownPostHog } = await importFreshPosthog();

    await shutdownPostHog();

    expect(mockShutdown).not.toHaveBeenCalled();
  });

  it("shuts down the PostHog client when configured", async () => {
    process.env[API_KEY_ENV] = "phc_test_key";
    process.env[HOST_ENV] = "http://localhost:8000";
    const { shutdownPostHog } = await importFreshPosthog();

    await shutdownPostHog();

    expect(mockShutdown).toHaveBeenCalledTimes(1);
  });
});