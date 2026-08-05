import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { JitAccessManager, DEFAULT_SESSION_DURATION_MS } from "../jit-access.js";
import type { JitDataScope, JitSessionConfig } from "../jit-access.js";
import { AuditLogger } from "../audit-log.js";

function createJitManager(config?: Partial<JitSessionConfig>) {
  const auditLogger = new AuditLogger({ logToConsole: false });
  const manager = new JitAccessManager(config, auditLogger);
  return { manager, auditLogger };
}

const SCOPES: JitDataScope[] = ["gmail.read", "calendar.read", "drive.read"];

describe("JitAccessManager", () => {
  describe("session lifecycle", () => {
    it("starts a session with correct properties", () => {
      const { manager } = createJitManager();
      const session = manager.startSession("agent-1", "customer-a", SCOPES);

      assert.ok(session.sessionId.startsWith("jit-agent-1-customer-a"));
      assert.equal(session.agentId, "agent-1");
      assert.equal(session.customerId, "customer-a");
      assert.deepStrictEqual(session.scopes, SCOPES);
      assert.equal(session.accessCount, 0);
      assert.equal(session.lastAccessAt, null);
      assert.equal(session.endedAt, null);
      assert.ok(new Date(session.expiresAt).getTime() > Date.now());
    });

    it("ends an active session", () => {
      const { manager } = createJitManager();
      const session = manager.startSession("agent-1", "customer-a", SCOPES);

      const result = manager.endSession(session.sessionId);
      assert.equal(result, true);

      const ended = manager.getSession(session.sessionId);
      assert.notEqual(ended?.endedAt, null);
      assert.equal(ended?.accessCount, 0);
    });

    it("returns false when ending already-ended session", () => {
      const { manager } = createJitManager();
      const session = manager.startSession("agent-1", "customer-a", SCOPES);

      manager.endSession(session.sessionId);
      const result = manager.endSession(session.sessionId);
      assert.equal(result, false);
    });

    it("returns false for unknown session", () => {
      const { manager } = createJitManager();
      assert.equal(manager.endSession("nonexistent"), false);
      assert.equal(manager.isSessionActive("nonexistent"), false);
    });

    it("isSessionActive returns true for active session", () => {
      const { manager } = createJitManager();
      const session = manager.startSession("agent-1", "customer-a", SCOPES);

      assert.equal(manager.isSessionActive(session.sessionId), true);
    });

    it("isSessionActive returns false after session ended", () => {
      const { manager } = createJitManager();
      const session = manager.startSession("agent-1", "customer-a", SCOPES);

      manager.endSession(session.sessionId);
      assert.equal(manager.isSessionActive(session.sessionId), false);
    });
  });

  describe("auto-expiry", () => {
    it("returns false for expired session", async () => {
      const { manager } = createJitManager({ defaultSessionDurationMs: 1 });
      const session = manager.startSession("agent-1", "customer-a", SCOPES);

      await new Promise(resolve => setTimeout(resolve, 5));
      const active = manager.isSessionActive(session.sessionId);
      assert.equal(active, false);

      const ended = manager.getSession(session.sessionId);
      assert.notEqual(ended?.endedAt, null);
    });

    it("checkJitAccess auto-expires stale sessions", async () => {
      const { manager } = createJitManager({ defaultSessionDurationMs: 1 });
      const session = manager.startSession("agent-1", "customer-a", SCOPES);

      await new Promise(resolve => setTimeout(resolve, 5));
      const result = manager.checkJitAccess("access_customer_data", "agent-1", "customer-a");
      assert.equal(result.allowed, false);
      assert.ok(result.reason?.includes("No active JIT session"));
    });
  });

  describe("checkJitAccess", () => {
    it("grants access when active session exists", () => {
      const { manager } = createJitManager();
      manager.startSession("agent-1", "customer-a", SCOPES);

      const result = manager.checkJitAccess("access_customer_data", "agent-1", "customer-a");
      assert.equal(result.allowed, true);
      assert.ok(result.sessionId);
    });

    it("denies access when no session exists", () => {
      const { manager } = createJitManager();
      const result = manager.checkJitAccess("access_customer_data", "agent-1", "customer-a");
      assert.equal(result.allowed, false);
      assert.ok(result.reason?.includes("No active JIT session"));
    });

    it("denies access when session lacks required scopes", () => {
      const { manager } = createJitManager();
      manager.startSession("agent-1", "customer-a", ["gmail.read"]);

      const result = manager.checkJitAccess(
        "access_customer_data",
        "agent-1",
        "customer-a",
        ["gmail.read", "calendar.read"],
      );
      assert.equal(result.allowed, false);
      assert.ok(result.reason?.includes("lacks required scopes"));
    });

    it("grants access when session has all required scopes", () => {
      const { manager } = createJitManager();
      manager.startSession("agent-1", "customer-a", SCOPES);

      const result = manager.checkJitAccess(
        "access_customer_data",
        "agent-1",
        "customer-a",
        ["gmail.read", "calendar.read"],
      );
      assert.equal(result.allowed, true);
    });

    it("increments access count on each access", () => {
      const { manager } = createJitManager();
      const session = manager.startSession("agent-1", "customer-a", SCOPES);

      manager.checkJitAccess("access_customer_data", "agent-1", "customer-a");
      manager.checkJitAccess("access_customer_data", "agent-1", "customer-a");

      const updated = manager.getSession(session.sessionId);
      assert.equal(updated?.accessCount, 2);
      assert.notEqual(updated?.lastAccessAt, null);
    });
  });

  describe("getActiveSession", () => {
    it("returns active session for agent and customer", () => {
      const { manager } = createJitManager();
      const session = manager.startSession("agent-1", "customer-a", SCOPES);

      const active = manager.getActiveSession("agent-1", "customer-a");
      assert.ok(active);
      assert.equal(active.sessionId, session.sessionId);
    });

    it("returns null when no active session exists", () => {
      const { manager } = createJitManager();
      assert.equal(manager.getActiveSession("agent-1", "customer-a"), null);
    });

    it("returns null for different customer", () => {
      const { manager } = createJitManager();
      manager.startSession("agent-1", "customer-a", SCOPES);

      assert.equal(manager.getActiveSession("agent-1", "customer-b"), null);
    });
  });

  describe("session extension", () => {
    it("extends session expiry time", () => {
      const { manager } = createJitManager();
      const session = manager.startSession("agent-1", "customer-a", SCOPES);

      const originalExpiry = new Date(session.expiresAt).getTime();
      const result = manager.extendSession(session.sessionId, 60000);
      assert.equal(result, true);

      const extended = manager.getSession(session.sessionId);
      assert.ok(extended);
      assert.ok(new Date(extended.expiresAt).getTime() > originalExpiry);
    });

    it("caps extension at max duration", () => {
      const { manager } = createJitManager({ maxExtensionDurationMs: 60000 });
      const session = manager.startSession("agent-1", "customer-a", SCOPES);

      const result = manager.extendSession(session.sessionId, 120000);
      assert.equal(result, true);

      const originalExpiry = new Date(session.expiresAt).getTime();
      const extended = manager.getSession(session.sessionId);
      assert.ok(extended);
      const delta = new Date(extended.expiresAt).getTime() - originalExpiry;
      assert.ok(delta <= 60000 + 100);
    });

    it("denies extension beyond max count", () => {
      const { manager } = createJitManager({ maxExtensionCount: 1 });
      const session = manager.startSession("agent-1", "customer-a", SCOPES);

      assert.equal(manager.extendSession(session.sessionId, 60000), true);
      assert.equal(manager.extendSession(session.sessionId, 60000), false);
    });

    it("denies extension for ended session", () => {
      const { manager } = createJitManager();
      const session = manager.startSession("agent-1", "customer-a", SCOPES);

      manager.endSession(session.sessionId);
      assert.equal(manager.extendSession(session.sessionId, 60000), false);
    });
  });

  describe("revocation", () => {
    it("revokes all sessions for a customer", () => {
      const { manager } = createJitManager();
      manager.startSession("agent-1", "customer-a", SCOPES);
      manager.startSession("agent-2", "customer-a", SCOPES);
      manager.startSession("agent-1", "customer-b", SCOPES);

      const count = manager.revokeAllForCustomer("customer-a");
      assert.equal(count, 2);

      assert.equal(manager.getActiveSession("agent-1", "customer-a"), null);
      assert.equal(manager.getActiveSession("agent-2", "customer-a"), null);
      assert.ok(manager.getActiveSession("agent-1", "customer-b"));
    });

    it("revokes all sessions org-wide", () => {
      const { manager } = createJitManager();
      manager.startSession("agent-1", "customer-a", SCOPES);
      manager.startSession("agent-2", "customer-b", SCOPES);

      const count = manager.revokeAll();
      assert.equal(count, 2);

      assert.equal(manager.getActiveSessions().length, 0);
    });

    it("returns 0 when no sessions to revoke", () => {
      const { manager } = createJitManager();
      assert.equal(manager.revokeAllForCustomer("nonexistent"), 0);
      assert.equal(manager.revokeAll(), 0);
    });
  });

  describe("session summary", () => {
    it("returns accurate summary with multiple sessions", () => {
      const { manager } = createJitManager();
      manager.startSession("agent-1", "customer-a", SCOPES);
      manager.startSession("agent-2", "customer-b", SCOPES);

      const session = manager.startSession("agent-1", "customer-c", SCOPES);
      manager.checkJitAccess("access_customer_data", "agent-1", "customer-c");

      const summary = manager.getSessionSummary();
      assert.equal(summary.activeSessions, 3);
      assert.equal(summary.totalSessions, 3);
      assert.equal(summary.totalAccesses, 1);
      assert.equal(summary.activeByCustomer["customer-a"], 1);
      assert.equal(summary.activeByCustomer["customer-b"], 1);
      assert.equal(summary.activeByAgent["agent-1"], 2);
      assert.equal(summary.activeByAgent["agent-2"], 1);
    });

    it("returns zero counts when no sessions exist", () => {
      const { manager } = createJitManager();
      const summary = manager.getSessionSummary();
      assert.equal(summary.activeSessions, 0);
      assert.equal(summary.totalSessions, 0);
      assert.equal(summary.totalAccesses, 0);
    });
  });

  describe("custom config", () => {
    it("respects custom session duration", () => {
      const { manager } = createJitManager({ defaultSessionDurationMs: 60000 });
      const session = manager.startSession("agent-1", "customer-a", SCOPES);

      const delta = new Date(session.expiresAt).getTime() - Date.now();
      assert.ok(delta <= 61000 && delta >= 59000);
    });

    it("uses default duration when not specified", () => {
      const { manager } = createJitManager();
      const session = manager.startSession("agent-1", "customer-a", SCOPES);

      const delta = new Date(session.expiresAt).getTime() - Date.now();
      assert.ok(delta <= DEFAULT_SESSION_DURATION_MS + 1000);
      assert.ok(delta >= DEFAULT_SESSION_DURATION_MS - 1000);
    });
  });

  // Salvaged from the RBR-166 Python implementation (see RBR-769 adjudication).
  // The Python SessionManager ran a background sweeper thread; this manager
  // expired sessions only lazily, so an abandoned session stayed silently
  // "active" and emitted no audit event until something touched it.
  describe("expiry sweeper (salvaged from RBR-166)", () => {
    it("does not emit an expiry audit event on its own without a sweep", async () => {
      const { manager, auditLogger } = createJitManager({ defaultSessionDurationMs: 20 });
      manager.startSession("agent-1", "customer-a", SCOPES);

      await new Promise(resolve => setTimeout(resolve, 60));

      // Nothing has touched the session, so lazy expiry has not fired.
      const types = auditLogger.getEntries().map(e => e.eventType);
      assert.ok(!types.includes("jit.session_expired"));
    });

    it("sweepExpiredSessions expires abandoned sessions and emits the audit event", async () => {
      const { manager, auditLogger } = createJitManager({ defaultSessionDurationMs: 20 });
      manager.startSession("agent-1", "customer-a", SCOPES);

      await new Promise(resolve => setTimeout(resolve, 60));

      assert.equal(manager.sweepExpiredSessions(), 1);

      const types = auditLogger.getEntries().map(e => e.eventType);
      assert.ok(types.includes("jit.session_expired"));

      // Sweeping again is idempotent.
      assert.equal(manager.sweepExpiredSessions(), 0);
    });

    it("leaves unexpired sessions alone", () => {
      const { manager } = createJitManager({ defaultSessionDurationMs: 60_000 });
      manager.startSession("agent-1", "customer-a", SCOPES);

      assert.equal(manager.sweepExpiredSessions(), 0);
      assert.equal(manager.getActiveSessions().length, 1);
    });

    it("startSweeper expires sessions on an interval and stops cleanly", async () => {
      const { manager, auditLogger } = createJitManager({ defaultSessionDurationMs: 10 });
      manager.startSession("agent-1", "customer-a", SCOPES);

      const stop = manager.startSweeper(25);
      await new Promise(resolve => setTimeout(resolve, 90));
      stop();

      const types = auditLogger.getEntries().map(e => e.eventType);
      assert.ok(types.includes("jit.session_expired"));
      assert.equal(manager.getActiveSessions().length, 0);
    });
  });
});