/**
 * Tests for Voyonder Bridge — Paperclip-side adapters for EventBus,
 * AuthProvider, and LoggerProvider interfaces.
 *
 * These adapters wrap Paperclip's internal live-event, auth, and logger
 * services so Voyonder routes, background jobs, and live events can use
 * Paperclip's infrastructure instead of Voyonder's standalone stubs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LiveEvent } from "@paperclipai/shared";
import type { EventBus, AuthProvider, LoggerProvider } from "@paperclipai/shared";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockPublishLiveEvent = vi.fn();
const mockSubscribeCompanyLiveEvents = vi.fn();
const mockAssertAuthenticated = vi.fn();
const mockAssertCompanyAccess = vi.fn();

// Logger mock (pino-style: first arg is object, second is message)
const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();
const mockLoggerDebug = vi.fn();

// Hoist mocks so they're available before module imports
vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: mockPublishLiveEvent,
  subscribeCompanyLiveEvents: mockSubscribeCompanyLiveEvents,
}));

vi.mock("../routes/authz.js", () => ({
  assertAuthenticated: mockAssertAuthenticated,
  assertCompanyAccess: mockAssertCompanyAccess,
}));

vi.mock("../middleware/logger.js", () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: mockLoggerDebug,
  },
}));

// Import after mocks are set up
const {
  createPaperclipEventBus,
  createPaperclipAuthProvider,
  createPaperclipLogger,
} = await import("../services/voyonder-bridge.js");

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeLiveEvent(overrides: Partial<LiveEvent> = {}): LiveEvent {
  return {
    id: 1,
    companyId: "test-company",
    type: "background_job.status",
    createdAt: new Date().toISOString(),
    payload: {},
    ...overrides,
  };
}

// ── C1: EventBus ─────────────────────────────────────────────────────────────

describe("createPaperclipEventBus()", () => {
  let eventBus: EventBus;

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus = createPaperclipEventBus();
  });

  describe("emit()", () => {
    it("publishes a single live event via Paperclip's publishLiveEvent", async () => {
      const expectedEvent = makeLiveEvent();
      mockPublishLiveEvent.mockReturnValue(expectedEvent);

      const result = await eventBus.emit({
        companyId: "test-company",
        type: "background_job.status",
        payload: { jobId: "job-1", status: "queued" },
      });

      expect(mockPublishLiveEvent).toHaveBeenCalledTimes(1);
      expect(mockPublishLiveEvent).toHaveBeenCalledWith({
        companyId: "test-company",
        type: "background_job.status",
        payload: { jobId: "job-1", status: "queued" },
      });
      expect(result).toEqual(expectedEvent);
    });

    it("defaults payload to undefined when omitted", async () => {
      mockPublishLiveEvent.mockReturnValue(makeLiveEvent());

      await eventBus.emit({
        companyId: "test-company",
        type: "background_job.status",
      });

      expect(mockPublishLiveEvent).toHaveBeenCalledWith({
        companyId: "test-company",
        type: "background_job.status",
        payload: undefined,
      });
    });

    it("propagates errors from publishLiveEvent", async () => {
      const testError = new Error("Event publish failed");
      mockPublishLiveEvent.mockRejectedValue(testError);

      await expect(
        eventBus.emit({
          companyId: "test-company",
          type: "background_job.status",
        }),
      ).rejects.toThrow("Event publish failed");
    });
  });

  describe("emitMany()", () => {
    it("publishes multiple events in parallel", async () => {
      const event1 = makeLiveEvent({ id: 1 });
      const event2 = makeLiveEvent({ id: 2 });
      mockPublishLiveEvent
        .mockReturnValueOnce(event1)
        .mockReturnValueOnce(event2);

      const results = await eventBus.emitMany([
        { companyId: "c1", type: "background_job.status", payload: { jobId: "a" } },
        { companyId: "c2", type: "background_job.status", payload: { jobId: "b" } },
      ]);

      expect(mockPublishLiveEvent).toHaveBeenCalledTimes(2);
      expect(mockPublishLiveEvent).toHaveBeenNthCalledWith(1, {
        companyId: "c1",
        type: "background_job.status",
        payload: { jobId: "a" },
      });
      expect(mockPublishLiveEvent).toHaveBeenNthCalledWith(2, {
        companyId: "c2",
        type: "background_job.status",
        payload: { jobId: "b" },
      });
      expect(results).toEqual([event1, event2]);
    });

    it("handles an empty array gracefully", async () => {
      const results = await eventBus.emitMany([]);
      expect(mockPublishLiveEvent).not.toHaveBeenCalled();
      expect(results).toEqual([]);
    });

    it("propagates a single failure without swallowing other events", async () => {
      mockPublishLiveEvent
        .mockReturnValueOnce(makeLiveEvent({ id: 1 }))
        .mockRejectedValueOnce(new Error("Second event failed"));

      await expect(
        eventBus.emitMany([
          { companyId: "c1", type: "background_job.status" },
          { companyId: "c2", type: "background_job.status" },
        ]),
      ).rejects.toThrow("Second event failed");

      // Both should have been called (Promise.all rejects on first rejection)
      expect(mockPublishLiveEvent).toHaveBeenCalledTimes(2);
    });
  });

  describe("on()", () => {
    it("subscribes to company live events and returns an unsubscribe function", () => {
      const listener = vi.fn();
      const mockUnsubscribe = vi.fn();
      mockSubscribeCompanyLiveEvents.mockReturnValue(mockUnsubscribe);

      const unsubscribe = eventBus.on("test-company", listener);

      expect(mockSubscribeCompanyLiveEvents).toHaveBeenCalledWith("test-company", listener);
      expect(unsubscribe).toBe(mockUnsubscribe);
    });
  });

  describe("off()", () => {
    it("unsubscribes a listener by re-subscribing and immediately unsubscribing", () => {
      const listener = vi.fn();
      const mockUnsubscribe = vi.fn();
      mockSubscribeCompanyLiveEvents.mockReturnValue(mockUnsubscribe);

      eventBus.off("test-company", listener);

      // Should subscribe once (to get the unsubscribe handle) then immediately unsubscribe
      expect(mockSubscribeCompanyLiveEvents).toHaveBeenCalledWith("test-company", listener);
      expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe("type compliance", () => {
    it("satisfies the EventBus interface contract", () => {
      // TypeScript structural typing check — this line will fail to compile
      // if createPaperclipEventBus() does not return a valid EventBus.
      const bus: EventBus = eventBus;
      expect(bus).toBeDefined();
    });
  });
});

// ── C2: AuthProvider ─────────────────────────────────────────────────────────

describe("createPaperclipAuthProvider()", () => {
  let authProvider: AuthProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    authProvider = createPaperclipAuthProvider();
  });

  describe("assertCompanyAccess()", () => {
    it("calls assertAuthenticated and assertCompanyAccess on success", async () => {
      const req = {
        actor: {
          type: "agent",
          agentId: "agent-1",
          userId: undefined,
        },
      } as any;

      const result = await authProvider.assertCompanyAccess(req, "company-1");

      expect(mockAssertAuthenticated).toHaveBeenCalledWith(req);
      expect(mockAssertCompanyAccess).toHaveBeenCalledWith(req, "company-1");
      expect(result).toEqual({
        companyId: "company-1",
        actorType: "agent",
        actorId: "agent-1",
      });
    });

    it("falls back to userId when agentId is not present", async () => {
      const req = {
        actor: {
          type: "board",
          userId: "user-1",
          agentId: undefined,
        },
      } as any;

      const result = await authProvider.assertCompanyAccess(req, "company-1");

      expect(result.actorId).toBe("user-1");
    });

    it("returns 'unknown' when neither agentId nor userId is present", async () => {
      const req = {
        actor: {
          type: "none",
          agentId: undefined,
          userId: undefined,
        },
      } as any;

      const result = await authProvider.assertCompanyAccess(req, "company-1");

      expect(result.actorId).toBe("unknown");
    });

    it("propagates auth errors from assertAuthenticated", async () => {
      const authError = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
      mockAssertAuthenticated.mockImplementation(() => {
        throw authError;
      });

      const req = { actor: { type: "none" } } as any;

      await expect(
        authProvider.assertCompanyAccess(req, "company-1"),
      ).rejects.toThrow("Unauthorized");

      // assertCompanyAccess should NOT be called if assertAuthenticated throws
      expect(mockAssertCompanyAccess).not.toHaveBeenCalled();
    });

    it("propagates access errors from assertCompanyAccess", async () => {
      const accessError = Object.assign(new Error("Agent key cannot access another company"), {
        statusCode: 403,
      });
      mockAssertCompanyAccess.mockImplementation(() => {
        throw accessError;
      });

      const req = { actor: { type: "agent", agentId: "agent-1" } } as any;

      await expect(
        authProvider.assertCompanyAccess(req, "other-company"),
      ).rejects.toThrow("Agent key cannot access another company");
    });
  });

  describe("assertCompanyScopeReadAllowed()", () => {
    it("allows access when the agent belongs to the company", async () => {
      const actor = { type: "agent", companyId: "company-1" };

      await expect(
        authProvider.assertCompanyScopeReadAllowed("company-1", actor),
      ).resolves.toBeUndefined();
    });

    it("throws 403 when the agent does not belong to the company", async () => {
      const actor = { type: "agent", companyId: "company-2" };

      await expect(
        authProvider.assertCompanyScopeReadAllowed("company-1", actor),
      ).rejects.toMatchObject({
        message: "Agent key cannot access another company",
        statusCode: 403,
      });
    });

    it("allows access when board user is a member of the company", async () => {
      const actor = { type: "board", companyIds: ["company-1", "company-2"] };

      await expect(
        authProvider.assertCompanyScopeReadAllowed("company-1", actor),
      ).resolves.toBeUndefined();
    });

    it("throws 403 when board user is not a member of the company", async () => {
      const actor = { type: "board", companyIds: ["company-2", "company-3"] };

      await expect(
        authProvider.assertCompanyScopeReadAllowed("company-1", actor),
      ).rejects.toMatchObject({
        message: "User does not have access to this company",
        statusCode: 403,
      });
    });

    it("throws 403 when board user has no companyIds at all", async () => {
      const actor = { type: "board", companyIds: undefined };

      await expect(
        authProvider.assertCompanyScopeReadAllowed("company-1", actor),
      ).rejects.toMatchObject({
        message: "User does not have access to this company",
        statusCode: 403,
      });
    });

    it("silently passes for non-agent, non-board actor types (e.g. 'none')", async () => {
      // The auth check only enforces agent and board boundaries;
      // other types (e.g. 'none' for unauthenticated paths) are let through
      // to be caught by assertCompanyAccess in the calling route.
      const actor = { type: "none" };

      await expect(
        authProvider.assertCompanyScopeReadAllowed("company-1", actor),
      ).resolves.toBeUndefined();
    });
  });

  describe("type compliance", () => {
    it("satisfies the AuthProvider interface contract", () => {
      const provider: AuthProvider = authProvider;
      expect(provider).toBeDefined();
    });
  });
});

// ── LoggerProvider ───────────────────────────────────────────────────────────

describe("createPaperclipLogger()", () => {
  let logger: LoggerProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createPaperclipLogger();
  });

  it("info delegates to Paperclip's pino logger", () => {
    logger.info("hello", { key: "value" });
    expect(mockLoggerInfo).toHaveBeenCalledWith({ key: "value" }, "hello");
  });

  it("warn delegates to Paperclip's pino logger", () => {
    logger.warn("warning", { code: 400 });
    expect(mockLoggerWarn).toHaveBeenCalledWith({ code: 400 }, "warning");
  });

  it("error delegates to Paperclip's pino logger", () => {
    logger.error("fail", { err: "timeout" });
    expect(mockLoggerError).toHaveBeenCalledWith({ err: "timeout" }, "fail");
  });

  it("debug delegates to Paperclip's pino logger", () => {
    logger.debug("verbose", { detail: true });
    expect(mockLoggerDebug).toHaveBeenCalledWith({ detail: true }, "verbose");
  });

  it("works when meta is omitted (falls back to empty object)", () => {
    logger.info("bare message");
    expect(mockLoggerInfo).toHaveBeenCalledWith({}, "bare message");
  });

  describe("type compliance", () => {
    it("satisfies the LoggerProvider interface contract", () => {
      const l: LoggerProvider = logger;
      expect(l).toBeDefined();
    });
  });
});
