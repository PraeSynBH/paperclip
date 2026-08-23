/**
 * LoggerProvider interface — a minimal logger abstraction.
 *
 * Any structured logger (pino, console, etc.) can satisfy this interface.
 * Voyonder accepts a LoggerProvider via createVoyonderApp options;
 * Paperclip passes its pino logger in production.
 */
export interface LoggerProvider {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
}