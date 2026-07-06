// V8 Error Tracking SDK init wrappers per RAM-311 §4.
import { redactEvent } from "@paperclipai/shared/security";
import type { RedactionResult } from "@paperclipai/shared/security";

interface SentryEvent {
  message?: string; exception?: { values?: Array<{ value?: string }> };
  breadcrumbs?: Array<{ message?: string; data?: unknown }>;
  user?: Record<string, unknown>; request?: { headers?: Record<string, string | string[]>; cookies?: string; data?: unknown };
  contexts?: Record<string, unknown>; tags?: Record<string, string>; extra?: Record<string, unknown>;
}

export function sentryBeforeSend(event: SentryEvent, _hint?: unknown): SentryEvent | null {
  const result: RedactionResult = redactEvent(event);
  if (result.redacted === null || (typeof result.redacted === "object" && result.redacted !== null && "redacted" in result.redacted)) return null;
  return result.redacted as SentryEvent;
}
export function sentryBeforeSendTransaction(tx: unknown, _hint?: unknown): unknown { return redactEvent(tx).redacted; }
export function sentryBeforeBreadcrumb(bc: unknown, _hint?: unknown): unknown { return redactEvent(bc).redacted; }
export function datadogBeforeSend(event: unknown, _ctx?: unknown): unknown { return redactEvent(event).redacted; }

export function bugsnagOnError(event: unknown): unknown | null {
  const result = redactEvent(event);
  if (result.redacted !== null && typeof result.redacted === "object" && "redacted" in result.redacted) return null;
  return result.redacted;
}

export { redactEvent as redactV8 } from "@paperclipai/shared/security";