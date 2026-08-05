import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ToolAuthorizer } from "../tool-auth.js";
import { JitAccessManager } from "../jit-access.js";
import type { JitDataScope } from "../jit-access.js";

const SCOPES: JitDataScope[] = ["gmail.read", "calendar.read", "drive.read"];

/**
 * Wire a ToolAuthorizer to a JitAccessManager the same way SecureAiPipeline does.
 */
function wireChecker(authorizer: ToolAuthorizer, manager: JitAccessManager) {
  authorizer.setJitSessionChecker((toolName, agentId, requiredScopes) => {
    const result = manager.checkJitAccess(
      toolName,
      agentId,
      undefined,
      requiredScopes as JitDataScope[] | undefined,
    );
    return {
      active: result.allowed,
      sessionId: result.sessionId,
      reason: result.reason,
    };
  });
}

describe("ToolAuthorizer JIT gate", () => {
  // Regression: `access_customer_data` is declared `requiresJitSession: true`,
  // but the gate used to be written as
  //   `if (permission.requiresJitSession && this.jitSessionChecker)`
  // which SKIPPED the check entirely whenever no checker was wired. Any
  // ToolAuthorizer built outside the governance/pipeline path therefore
  // allowed customer-data access with no JIT session at all. Must fail closed.
  describe("fail-closed when no session checker is configured", () => {
    it("denies a JIT-required tool when no checker is wired", () => {
      const authorizer = new ToolAuthorizer();

      const result = authorizer.authorizeTool("access_customer_data", "CISO", "agent-1");

      assert.equal(result.allowed, false);
      assert.match(String(result.reason), /JIT session/i);
    });

    it("still allows non-JIT tools when no checker is wired", () => {
      const authorizer = new ToolAuthorizer();

      const result = authorizer.authorizeTool("read_file", "CISO", "agent-1");

      assert.equal(result.allowed, true);
    });
  });

  describe("with a session checker wired", () => {
    it("denies when the agent has no active session", () => {
      const authorizer = new ToolAuthorizer();
      wireChecker(authorizer, new JitAccessManager());

      const result = authorizer.authorizeTool("access_customer_data", "CISO", "agent-1");

      assert.equal(result.allowed, false);
    });

    it("allows when the agent holds an active, correctly scoped session", () => {
      const authorizer = new ToolAuthorizer();
      const manager = new JitAccessManager();
      wireChecker(authorizer, manager);
      manager.startSession("agent-1", "customer-a", SCOPES);

      const result = authorizer.authorizeTool("access_customer_data", "CISO", "agent-1");

      assert.equal(result.allowed, true);
    });

    it("denies again once the session is ended", () => {
      const authorizer = new ToolAuthorizer();
      const manager = new JitAccessManager();
      wireChecker(authorizer, manager);
      const session = manager.startSession("agent-1", "customer-a", SCOPES);
      manager.endSession(session.sessionId);

      const result = authorizer.authorizeTool("access_customer_data", "CISO", "agent-1");

      assert.equal(result.allowed, false);
    });

    it("denies when the session lacks the required scopes", () => {
      const authorizer = new ToolAuthorizer();
      const manager = new JitAccessManager();
      wireChecker(authorizer, manager);
      manager.startSession("agent-1", "customer-a", ["drive.read"]);

      const result = authorizer.authorizeTool("access_customer_data", "CISO", "agent-1");

      assert.equal(result.allowed, false);
    });
  });
});
