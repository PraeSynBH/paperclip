import type { LiveEvent } from "../types/live.js";
import type { LiveEventType } from "../constants.js";

/**
 * EventBus interface — decouples event emission/subscription consumers
 * from the concrete implementation (EventEmitter / WebSocket / SSE).
 *
 * Voyonder implements this interface; Paperclip passes its live-events
 * implementation as the concrete EventBus.
 */
export interface EventBus {
  /**
   * Emit a single event to a company's subscribers.
   */
  emit(input: {
    companyId: string;
    type: LiveEventType;
    payload?: Record<string, unknown>;
  }): Promise<LiveEvent>;

  /**
   * Emit multiple events in batch.
   */
  emitMany(events: Array<{
    companyId: string;
    type: LiveEventType;
    payload?: Record<string, unknown>;
  }>): Promise<LiveEvent[]>;

  /**
   * Subscribe to all events for a given company.
   * Returns an unsubscribe function.
   */
  on(companyId: string, listener: (event: LiveEvent) => void): () => void;

  /**
   * Unsubscribe a specific listener for a company.
   */
  off(companyId: string, listener: (event: LiveEvent) => void): void;
}