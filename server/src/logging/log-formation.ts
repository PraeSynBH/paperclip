// LogFormation layer — the single emit path per RAM-311 §5.1.
import { logger as pinoLogger } from "../middleware/logger.js";
import { redactLogRecord } from "@paperclipai/shared/security";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

function scrubFields(fields: Record<string, unknown>): Record<string, unknown> {
  const result = redactLogRecord(fields);
  return (result.redacted as Record<string, unknown>) ?? {};
}

export function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  const redactedMsg = redactLogRecord(msg).redacted;
  const safeFields = fields && Object.keys(fields).length > 0 ? scrubFields(fields) : undefined;
  const logMethod = pinoLogger[level];
  if (typeof logMethod === "function") {
    if (safeFields) logMethod.call(pinoLogger, safeFields, String(redactedMsg));
    else logMethod.call(pinoLogger, String(redactedMsg));
  } else {
    pinoLogger.info(safeFields ?? {}, String(redactedMsg));
  }
}

export const log = {
  trace: (msg: string, f?: Record<string, unknown>) => emit("trace", msg, f),
  debug: (msg: string, f?: Record<string, unknown>) => emit("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit("error", msg, f),
  fatal: (msg: string, f?: Record<string, unknown>) => emit("fatal", msg, f),
};

export const safeConsole = {
  log: (msg: string, ...args: unknown[]) => emit("info", msg, args.length > 0 ? { args } : undefined),
  info: (msg: string, ...args: unknown[]) => emit("info", msg, args.length > 0 ? { args } : undefined),
  warn: (msg: string, ...args: unknown[]) => emit("warn", msg, args.length > 0 ? { args } : undefined),
  error: (msg: string, ...args: unknown[]) => emit("error", msg, args.length > 0 ? { args } : undefined),
  debug: (msg: string, ...args: unknown[]) => emit("debug", msg, args.length > 0 ? { args } : undefined),
  trace: (msg: string, ...args: unknown[]) => emit("trace", msg, args.length > 0 ? { args } : undefined),
};