import { REDACTION_PATTERNS } from "./patterns.js";
import { isDenyField, ALLOWLIST_HEADERS } from "./deny-fields.js";
import type { RedactionPattern } from "./patterns.js";

export interface RedactionReport { classes: Record<string, number> }
export interface RedactionResult { redacted: unknown; redaction_report: RedactionReport }

interface WalkContext { report: RedactionReport; depth: number }

const MAX_DEPTH = 20;
const DENIED = "[REDACTED]";

function inc(report: RedactionReport, cls: string, n = 1): void {
  report.classes[cls] = (report.classes[cls] ?? 0) + n;
}

function applyPatterns(value: string, report: RedactionReport): string {
  let result = value;
  for (const p of REDACTION_PATTERNS) {
    result = applyOne(result, p, report);
  }
  return result;
}

function applyOne(value: string, p: RedactionPattern, report: RedactionReport): string {
  p.pattern.lastIndex = 0;
  let count = 0;
  const replaced = value.replace(p.pattern, (match) => {
    if (p.validate && !p.validate(match)) return match;
    count++;
    return p.replacement;
  });
  if (count > 0) inc(report, p.class, count);
  return replaced;
}

function walk(value: unknown, path: string, ctx: WalkContext): unknown {
  if (ctx.depth > MAX_DEPTH) {
    inc(ctx.report, "depth_exceeded");
    return DENIED;
  }
  if (value === null || typeof value !== "object") {
    if (typeof value === "string") {
      if (isDenyField(path)) return DENIED;
      for (const [header, maxLen] of ALLOWLIST_HEADERS) {
        if (path.endsWith(`.${header}`) || path === `request.headers.${header}`) {
          return value.length > maxLen ? value.slice(0, maxLen) : value;
        }
      }
      return applyPatterns(value, ctx.report);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (isDenyField(path)) return DENIED;
    return value.map((entry, idx) => walk(entry, `${path}.${idx}`, { ...ctx, depth: ctx.depth + 1 }));
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(obj)) {
    const childPath = path ? `${path}.${key}` : key;
    if (isDenyField(childPath)) {
      out[key] = DENIED;
      inc(ctx.report, `field:${childPath.split(".").slice(0, 3).join(".")}`);
      continue;
    }
    if (entry !== null && typeof entry === "object") {
      out[key] = walk(entry, childPath, { ...ctx, depth: ctx.depth + 1 });
    } else if (typeof entry === "string") {
      out[key] = isDenyField(childPath) ? DENIED : applyPatterns(entry, ctx.report);
    } else {
      out[key] = entry;
    }
  }
  return out;
}

export function redact(value: unknown): RedactionResult {
  const report: RedactionReport = { classes: {} };
  if (value === undefined) {
    return { redacted: { redacted: true, reason: "undefined_input" }, redaction_report: report };
  }
  if (value === null) {
    return { redacted: { redacted: true, reason: "null_input" }, redaction_report: report };
  }
  try {
    const redacted = walk(value, "", { report, depth: 0 });
    return { redacted, redaction_report: report };
  } catch {
    inc(report, "parse_error");
    return { redacted: { redacted: true, reason: "parse_error" }, redaction_report: report };
  }
}

export function redactEvent(event: unknown): RedactionResult { return redact(event); }
export function redactLogRecord(record: unknown): RedactionResult { return redact(record); }

/**
 * Redact every query-string value in a URL while preserving key names.
 *
 * Examples:
 *   "/api/users?email=alice@example.com" -> "/api/users?email=[REDACTED]"
 *   "/path?a=1&b=2" -> "/path?a=[REDACTED]&b=[REDACTED]"
 *   "/path" -> "/path"
 *
 * Value-less keys such as `?debug` are given an explicit `[REDACTED]` value.
 * Hash fragments are preserved.
 */
export function redactQueryString(url: string): string {
  const queryIndex = url.indexOf("?");
  if (queryIndex === -1) return url;

  const base = url.slice(0, queryIndex + 1);
  const rest = url.slice(queryIndex + 1);
  const hashIndex = rest.indexOf("#");
  const query = hashIndex === -1 ? rest : rest.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : rest.slice(hashIndex);

  if (query === "") {
    return url;
  }

  const redacted = query.split("&").map((pair) => {
    if (pair === "") return "";
    const eq = pair.indexOf("=");
    if (eq === -1) return `${pair}=${DENIED}`;
    return `${pair.slice(0, eq)}=${DENIED}`;
  });

  return `${base}${redacted.join("&")}${hash}`;
}