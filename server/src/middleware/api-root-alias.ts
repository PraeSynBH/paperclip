// Rescue for agent issue writes aimed at the wrong API base, plus the counter and
// alarm that make this class visible instead of greppable.
//
// ## The failure this closes
//
// 253 `POST /issues 404` lines landed in the service log in 24h (218 carrying a
// real issue title). Two mechanisms produced them, and BOTH dropped the report:
//
//   1. the request was composed against the server root (`POST /issues`) instead
//      of `/api/issues`, so it fell through the API router, the plugin UI routes
//      and the SPA handlers and died in Express's finalhandler as an opaque
//      `text/html` "Cannot POST /issues" 404;
//   2. the request used the natural shorthand `POST /api/issues`, which never
//      existed — issue create only lives at
//      `POST /api/companies/:companyId/issues` — so it 404'd in the API router.
//
// From the caller's side a 404 is indistinguishable from "created fine" unless
// the body is parsed, so the report is simply lost. Two were lost for good on
// 2026-10-22 (including a CRITICAL fleet-wide outage report).
//
// ## What this guard does
//
//   * Rescues the write instead of only complaining: an API-shaped mutation at
//     the root is rewritten onto `/api`, and `POST /issues` / `POST /api/issues`
//     are rewritten onto the canonical create route with the companyId taken
//     from the body / query / `X-Paperclip-Company-Id`. The report lands.
//   * Never touches GET/HEAD/OPTIONS, so SPA navigation (`GET /issues/123`) and
//     static assets are unaffected.
//   * Makes it loud and countable: every rescue emits a structured WARN with a
//     running total, is appended to a durable JSONL ledger (survives restarts
//     and payload upgrades), is exposed on
//     `GET /api/diagnostics/api-base-rewrites`, and raises an ERROR-level ALARM
//     above 5 rescues in a rolling 10 minutes.
//   * When the companyId genuinely cannot be resolved, the caller gets an
//     explicit 400 naming the canonical route — never a silent 404.
//
// ## Deliberately not in the OpenAPI document
//
// `POST /api/issues` is reachable (that is the point) but is NOT registered in
// `routes/openapi.ts`. The canonical `POST /api/companies/{companyId}/issues`
// stays the single documented create operation: the shorthand exists to rescue
// callers that composed the wrong URL, not to bless a second create contract
// whose companyId floats between body, query and header. The exchange is covered
// by `api-root-alias.test.ts` instead, and `__tests__/openapi-routes.test.ts`
// keeps the spec bound to the mounted routes.
import fs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { resolvePaperclipHomeDir } from "../home-paths.js";
import { logger } from "./logger.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// First path segment of the top-level resources mounted under /api. Deliberately a
// list rather than "anything that is not a static file": a UI typo must still fall
// through to the SPA's own 404, and a write must never be rerouted into the API
// router unless it is unambiguously API-shaped.
const API_RESOURCE_SEGMENTS = new Set([
  "access", "activity", "adapters", "agent-runtime", "agents", "approvals",
  "assets", "auth", "cases", "cloud", "companies", "company-skills", "cost",
  "dashboard", "decisions", "diagnostics", "documents", "environments",
  "feedback", "file-resources", "folders", "goals", "health", "heartbeat-runs",
  "inbox-agent-policy", "instance", "interactions", "issue", "issues", "labels",
  "mcp", "pipelines", "plugins", "projects", "routines", "search", "secrets",
  "skills", "smoke-lab", "status-cards", "teams", "tool-access", "work-products",
]);

// Paths callers use for "create an issue" that are not the canonical route.
const ISSUE_CREATE_SHORTHANDS = new Set(["/issues", "/api/issues"]);
const CANONICAL_CREATE_ROUTE = "POST /api/companies/{companyId}/issues";

const ALARM_WINDOW_MS = 10 * 60 * 1000;
const ALARM_THRESHOLD = 5;
const ALARM_REPEAT_MS = 30 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// The ledger is the only durable history; bound the rows we re-read per snapshot
// so a pathological day cannot make the diagnostics endpoint read forever.
const LEDGER_MAX_LINES = 20000;

export type ApiBaseRewriteKind =
  | "root-alias"
  | "create-shorthand"
  | "create-shorthand-unresolved";

export interface ApiBaseRewriteLedgerCounts {
  count: number;
  byPath: Record<string, number>;
  createShorthands: number;
  unresolvedShorthands: number;
}

export interface ApiBaseRewriteSnapshot {
  ok: true;
  generatedAt: string;
  rescues: {
    totalSinceStart: number;
    rootAliasSinceStart: number;
    createShorthandSinceStart: number;
    createShorthandUnresolvedSinceStart: number;
    lastHour: number;
    last24h: number;
    createShorthandLast24h: number;
    unresolvedShorthandLast24h: number;
    byPathSinceStart: Record<string, number>;
    byMethodSinceStart: Record<string, number>;
    byPathLast24h: Record<string, number>;
    windowCount: number;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    lastPath: string | null;
    lastMethod: string | null;
    lastKind: ApiBaseRewriteKind | null;
    lastCompanyId: string | null;
  };
  alarm: {
    active: boolean;
    windowMinutes: number;
    threshold: number;
    lastAlarmAt: string | null;
  };
  ledgerPath: string;
  canonicalCreateRoute: string;
}

export interface ApiBaseRewriteGuardOptions {
  /** Overrides the ledger location; defaults to `<paperclip home>/state/api-base-rewrites.jsonl`. */
  ledgerPath?: string;
  /** Overrides the paperclip home used to resolve the default ledger path. */
  homeDir?: string;
  /** Injectable clock, so tests can drive the rolling alarm window without sleeping. */
  now?: () => number;
}

export interface ApiBaseRewriteGuard {
  /** Express middleware; mount it at the app root BEFORE `app.use("/api", api)`. */
  guard: (req: Request, res: Response, next: NextFunction) => void;
  /** The payload served on `GET /api/diagnostics/api-base-rewrites`. */
  snapshot: () => ApiBaseRewriteSnapshot;
}

interface BudgetedMap {
  total: number;
  byPath: Map<string, number>;
  byMethod: Map<string, number>;
}

function firstSegment(pathname: string): string {
  const trimmed = pathname.replace(/^\/+/, "");
  const end = trimmed.search(/[/?]/);
  return (end === -1 ? trimmed : trimmed.slice(0, end)).toLowerCase();
}

export function isApiShapedRootPath(pathname: string): boolean {
  if (!pathname.startsWith("/")) return false;
  if (pathname === "/api" || pathname.startsWith("/api/")) return false;
  // A static asset (`/assets/app.js`, `/logo.png`) is never an API write, even when
  // its first segment collides with a resource name (`assets` is also /api/assets).
  if (/\.[A-Za-z0-9]{1,8}$/.test(pathname.replace(/\/+$/, ""))) return false;
  return API_RESOURCE_SEGMENTS.has(firstSegment(pathname));
}

// Keep query params except the companyId that moved into the path.
function stripCompanyIdFromQuery(rawQuery: string): string {
  if (!rawQuery) return "";
  const params = new URLSearchParams(rawQuery);
  params.delete("companyId");
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.trim() ? candidate : undefined;
}

/**
 * Builds one rescue guard plus the snapshot function that reports on it. Create a
 * single instance in `app.ts` and hand the same instance to the diagnostics route,
 * so the counters and the endpoint cannot drift apart.
 */
export function createApiBaseRewriteGuard(
  options: ApiBaseRewriteGuardOptions = {},
): ApiBaseRewriteGuard {
  const ledgerPath =
    options.ledgerPath ??
    path.join(resolvePaperclipHomeDir(options.homeDir), "state", "api-base-rewrites.jsonl");
  const nowMs = options.now ?? Date.now;

  const rootAliases: BudgetedMap = { total: 0, byPath: new Map(), byMethod: new Map() };
  const createShorthands = { total: 0, unresolved: 0, byPath: new Map<string, number>() };
  const state: {
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    lastPath: string | null;
    lastMethod: string | null;
    lastKind: ApiBaseRewriteKind | null;
    lastCompanyId: string | null;
    windowHits: number[];
    alarmActive: boolean;
    lastAlarmAt: string | null;
    ledgerWarned: boolean;
  } = {
    firstSeenAt: null,
    lastSeenAt: null,
    lastPath: null,
    lastMethod: null,
    lastKind: null,
    lastCompanyId: null,
    windowHits: [],
    alarmActive: false,
    lastAlarmAt: null,
    ledgerWarned: false,
  };

  function appendLedger(entry: Record<string, unknown>): void {
    try {
      fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
      fs.appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`);
    } catch (err) {
      if (!state.ledgerWarned) {
        state.ledgerWarned = true;
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), ledgerPath },
          "api-base rewrite: ledger append failed (counter is in-memory only)",
        );
      }
    }
  }

  function readLedgerCounts(sinceMs: number): ApiBaseRewriteLedgerCounts {
    let lines: string[];
    try {
      lines = fs.readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean).slice(-LEDGER_MAX_LINES);
    } catch {
      return { count: 0, byPath: {}, createShorthands: 0, unresolvedShorthands: 0 };
    }
    let count = 0;
    let createShorthandRows = 0;
    let unresolvedShorthandRows = 0;
    const byPath: Record<string, number> = {};
    for (const line of lines) {
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const ts = Date.parse(typeof record.ts === "string" ? record.ts : "");
      if (!Number.isFinite(ts) || ts < sinceMs) continue;
      count += 1;
      if (record.kind === "create-shorthand") createShorthandRows += 1;
      if (record.kind === "create-shorthand-unresolved") unresolvedShorthandRows += 1;
      if (typeof record.path === "string") byPath[record.path] = (byPath[record.path] ?? 0) + 1;
    }
    return {
      count,
      byPath,
      createShorthands: createShorthandRows,
      unresolvedShorthands: unresolvedShorthandRows,
    };
  }

  function countHit(
    kind: ApiBaseRewriteKind,
    method: string,
    pathname: string,
    companyId: string | null,
  ): { now: number; nowIso: string } {
    const now = nowMs();
    const nowIso = new Date(now).toISOString();
    if (kind === "root-alias") {
      rootAliases.total += 1;
      rootAliases.byPath.set(pathname, (rootAliases.byPath.get(pathname) ?? 0) + 1);
      rootAliases.byMethod.set(method, (rootAliases.byMethod.get(method) ?? 0) + 1);
    } else if (kind === "create-shorthand") {
      createShorthands.total += 1;
      createShorthands.byPath.set(pathname, (createShorthands.byPath.get(pathname) ?? 0) + 1);
    } else {
      createShorthands.unresolved += 1;
      createShorthands.byPath.set(pathname, (createShorthands.byPath.get(pathname) ?? 0) + 1);
    }
    state.firstSeenAt ??= nowIso;
    state.lastSeenAt = nowIso;
    state.lastPath = pathname;
    state.lastMethod = method;
    state.lastKind = kind;
    if (companyId) state.lastCompanyId = companyId;
    state.windowHits.push(now);
    state.windowHits = state.windowHits.filter((ts) => now - ts <= ALARM_WINDOW_MS);
    return { now, nowIso };
  }

  function logHit(
    kind: ApiBaseRewriteKind,
    method: string,
    pathname: string,
    rewritten: string | null,
    companyId: string | null,
    now: number,
  ): void {
    const windowCount = state.windowHits.length;
    const total = rootAliases.total + createShorthands.total;
    const payload = {
      apiBaseRescue: {
        kind,
        method,
        path: pathname,
        rewritten,
        companyId,
        total,
        windowCount,
        windowMinutes: ALARM_WINDOW_MS / 60000,
      },
    };
    logger.warn(
      payload,
      `api-base rescue (${kind}): ${method} ${pathname}${rewritten ? ` -> ${rewritten}` : ""} (total=${total}, last ${windowCount} in ${ALARM_WINDOW_MS / 60000}m)`,
    );
    const shouldAlarm =
      windowCount >= ALARM_THRESHOLD &&
      (state.lastAlarmAt === null || now - Date.parse(state.lastAlarmAt) >= ALARM_REPEAT_MS);
    if (shouldAlarm) {
      state.alarmActive = true;
      state.lastAlarmAt = new Date(now).toISOString();
      logger.error(
        {
          ...payload,
          apiBaseRescue: { ...payload.apiBaseRescue, alarm: true, threshold: ALARM_THRESHOLD },
        },
        `api-base rescue ALARM: ${windowCount} agent writes hit a wrong API base or shorthand path in the last ${ALARM_WINDOW_MS / 60000}m (threshold ${ALARM_THRESHOLD}); reports are being rescued, but the callers still compose the wrong URL - fix the caller`,
      );
    }
  }

  function resolveCompanyId(req: Request): { companyId: string | null; fromBody: boolean } {
    const fromBody = stringField(req.body, "companyId");
    const fromQuery =
      typeof req.query?.companyId === "string" ? req.query.companyId : undefined;
    const fromHeader = req.get("x-paperclip-company-id") || undefined;
    const companyId = (fromBody ?? fromQuery ?? fromHeader ?? "").trim();
    if (!companyId) return { companyId: null, fromBody: false };
    return { companyId, fromBody: fromBody !== undefined };
  }

  function setRescueHeaders(res: Response, rewritten: string): void {
    if (typeof res.setHeader !== "function") return;
    res.setHeader("X-Paperclip-Api-Base", "/api");
    res.setHeader("X-Paperclip-Api-Base-Rewritten", rewritten);
  }

  function guard(req: Request, res: Response, next: NextFunction): void {
    const rawUrl = typeof req.url === "string" ? req.url : "";
    if (!rawUrl || !MUTATING_METHODS.has(req.method)) return next();
    const queryIndex = rawUrl.indexOf("?");
    const pathname = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);
    const rawQuery = queryIndex === -1 ? "" : rawUrl.slice(queryIndex + 1);

    // (2) issue-create shorthand, with or without the /api prefix
    if (req.method === "POST" && ISSUE_CREATE_SHORTHANDS.has(pathname.replace(/\/+$/, ""))) {
      const { companyId, fromBody } = resolveCompanyId(req);
      if (!companyId) {
        const { now, nowIso } = countHit("create-shorthand-unresolved", req.method, pathname, null);
        appendLedger({
          ts: nowIso,
          kind: "create-shorthand-unresolved",
          method: req.method,
          path: pathname,
          companyId: null,
        });
        logHit("create-shorthand-unresolved", req.method, pathname, null, null, now);
        res.status(400).json({
          error: "companyId is required to create an issue",
          didYouMean: CANONICAL_CREATE_ROUTE,
          hint: "send companyId in the JSON body (or X-Paperclip-Company-Id), or POST to /api/companies/{companyId}/issues",
        });
        return;
      }
      const rewritten = `/api/companies/${encodeURIComponent(companyId)}/issues${stripCompanyIdFromQuery(rawQuery)}`;
      const { now, nowIso } = countHit("create-shorthand", req.method, pathname, companyId);
      appendLedger({
        ts: nowIso,
        kind: "create-shorthand",
        method: req.method,
        path: pathname,
        rewritten,
        companyId,
      });
      logHit("create-shorthand", req.method, pathname, rewritten, companyId, now);
      if (fromBody && req.body && typeof req.body === "object") {
        // The canonical handler reads companyId from the path; drop the body copy so
        // the validated payload is exactly the canonical shape.
        delete (req.body as Record<string, unknown>).companyId;
      }
      setRescueHeaders(res, rewritten);
      req.url = rewritten;
      return next();
    }

    // (1) API-shaped mutation at the server root -> /api
    if (!isApiShapedRootPath(pathname)) return next();
    const rewritten = `/api${rawUrl}`;
    const { companyId } = resolveCompanyId(req);
    const rewrittenPath = queryIndex === -1 ? rewritten : rewritten.slice(0, rewritten.indexOf("?"));
    const { now, nowIso } = countHit("root-alias", req.method, pathname, companyId);
    appendLedger({
      ts: nowIso,
      kind: "root-alias",
      method: req.method,
      path: pathname,
      rewritten: rewrittenPath,
      companyId,
    });
    logHit("root-alias", req.method, pathname, rewrittenPath, companyId, now);
    setRescueHeaders(res, rewrittenPath);
    req.url = rewritten;
    return next();
  }

  function snapshot(): ApiBaseRewriteSnapshot {
    const now = nowMs();
    const last24h = readLedgerCounts(now - DAY_MS);
    const lastHour = readLedgerCounts(now - HOUR_MS);
    state.windowHits = state.windowHits.filter((ts) => now - ts <= ALARM_WINDOW_MS);
    return {
      ok: true,
      generatedAt: new Date(now).toISOString(),
      rescues: {
        totalSinceStart: rootAliases.total + createShorthands.total,
        rootAliasSinceStart: rootAliases.total,
        createShorthandSinceStart: createShorthands.total,
        createShorthandUnresolvedSinceStart: createShorthands.unresolved,
        lastHour: lastHour.count,
        last24h: last24h.count,
        createShorthandLast24h: last24h.createShorthands,
        unresolvedShorthandLast24h: last24h.unresolvedShorthands,
        byPathSinceStart: {
          ...Object.fromEntries(rootAliases.byPath),
          ...Object.fromEntries(createShorthands.byPath),
        },
        byMethodSinceStart: Object.fromEntries(rootAliases.byMethod),
        byPathLast24h: last24h.byPath,
        windowCount: state.windowHits.length,
        firstSeenAt: state.firstSeenAt,
        lastSeenAt: state.lastSeenAt,
        lastPath: state.lastPath,
        lastMethod: state.lastMethod,
        lastKind: state.lastKind,
        lastCompanyId: state.lastCompanyId,
      },
      alarm: {
        active: state.alarmActive,
        windowMinutes: ALARM_WINDOW_MS / 60000,
        threshold: ALARM_THRESHOLD,
        lastAlarmAt: state.lastAlarmAt,
      },
      ledgerPath,
      canonicalCreateRoute: CANONICAL_CREATE_ROUTE,
    };
  }

  return { guard, snapshot };
}
