/**
 * Voyonder Bridge — adapts Paperclip's core services to Voyonder's
 * injectable interfaces (EventBus, AuthProvider, LoggerProvider).
 *
 * This is the Paperclip-side of the C1 (EventBus) and C2 (AuthProvider)
 * interface wiring. When mounted, Voyonder routes, background jobs, and
 * live events flow through Paperclip's infrastructure instead of using
 * Voyonder's standalone stubs.
 *
 * C1 — EventBus:  Wraps Paperclip's publishLiveEvent / subscribeCompanyLiveEvents
 * C2 — AuthProvider: Wraps Paperclip's assertCompanyAccess / assertAuthenticated
 */

import type { Request } from "express";
import type { LiveEvent, LiveEventType } from "@paperclipai/shared";
import {
  publishLiveEvent,
  subscribeCompanyLiveEvents,
} from "./live-events.js";
import {
  assertAuthenticated,
  assertCompanyAccess,
} from "../routes/authz.js";
import { logger as paperclipLogger } from "../middleware/logger.js";

// ── Decoupling interfaces (via @paperclipai/shared) ───────────────────
import type { EventBus, AuthProvider, LoggerProvider } from "@paperclipai/shared";

// ── C1: EventBus adapter ──────────────────────────────────────────────
//
// Wires Voyonder's event emission into Paperclip's live-event delivery
// (SSE / WebSocket).  Background job status changes published through
// this bus reach Paperclip subscribers.

export function createPaperclipEventBus(): EventBus {
  return {
    async emit(input: {
      companyId: string;
      type: LiveEventType;
      payload?: Record<string, unknown>;
    }): Promise<LiveEvent> {
      return publishLiveEvent({
        companyId: input.companyId,
        type: input.type,
        payload: input.payload,
      });
    },

    async emitMany(events: Array<{
      companyId: string;
      type: LiveEventType;
      payload?: Record<string, unknown>;
    }>): Promise<LiveEvent[]> {
      return Promise.all(
        events.map((e) =>
          publishLiveEvent({
            companyId: e.companyId,
            type: e.type,
            payload: e.payload,
          }),
        ),
      );
    },

    on(companyId: string, listener: (event: LiveEvent) => void): () => void {
      return subscribeCompanyLiveEvents(companyId, listener);
    },

    off(companyId: string, listener: (event: LiveEvent) => void): void {
      // Paperclip's subscribeCompanyLiveEvents returns an unsubscribe
      // function; there is no direct off(). For EventBus.off() compatibility,
      // subscribe and immediately unsubscribe — this is a polyfill that
      // avoids refactoring Paperclip's EventEmitter internals.
      const unsub = subscribeCompanyLiveEvents(companyId, listener);
      unsub();
    },
  };
}

// ── C2: AuthProvider adapter ──────────────────────────────────────────
//
// Delegates Voyonder route auth checks to Paperclip's actor middleware.
// Paperclip's middleware already populates `req.actor` before Voyonder
// routes run, so the Voyonder local authz stubs also work — but this
// adapter provides the explicit formal contract for future auth flows
// that need to check permissions beyond basic company access.

export function createPaperclipAuthProvider(): AuthProvider {
  return {
    async assertCompanyAccess(
      req: Request,
      companyId: string,
    ): Promise<{ companyId: string; actorType: string; actorId: string }> {
      assertAuthenticated(req);
      assertCompanyAccess(req, companyId);
      return {
        companyId,
        actorType: req.actor.type,
        actorId: req.actor.agentId ?? req.actor.userId ?? "unknown",
      };
    },

    async assertCompanyScopeReadAllowed(
      companyId: string,
      actor: { type: string; agentId?: string; userId?: string; companyId?: string; companyIds?: string[] },
    ): Promise<void> {
      // Basic check: agent must belong to this company
      if (actor.type === "agent" && actor.companyId !== companyId) {
        throw Object.assign(new Error("Agent key cannot access another company"), { statusCode: 403 });
      }
      // Board users must be members of the company
      if (actor.type === "board") {
        const companyIds = actor.companyIds ?? [];
        if (!companyIds.includes(companyId)) {
          throw Object.assign(new Error("User does not have access to this company"), { statusCode: 403 });
        }
      }
    },
  };
}

// ── LoggerProvider adapter ─────────────────────────────────────────────
//
// Maps Voyonder's logger interface to Paperclip's pino logger.

export function createPaperclipLogger(): LoggerProvider {
  return {
    info: (msg: string, meta?: Record<string, unknown>) => paperclipLogger.info(meta ?? {}, msg),
    warn: (msg: string, meta?: Record<string, unknown>) => paperclipLogger.warn(meta ?? {}, msg),
    error: (msg: string, meta?: Record<string, unknown>) => paperclipLogger.error(meta ?? {}, msg),
    debug: (msg: string, meta?: Record<string, unknown>) => paperclipLogger.debug(meta ?? {}, msg),
  };
}
