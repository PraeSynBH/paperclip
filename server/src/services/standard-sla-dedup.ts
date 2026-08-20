/**
 * StandardSLABreach duplicate suppression.
 *
 * When a StandardSLABreach alert fires, this module checks if there is already
 * a recent issue for the same *client* within a configurable trailing window.
 * If a match is found, the new alert is suppressed (linked as a reference to
 * the existing tracking issue) rather than creating a standalone critical issue.
 *
 * This prevents the SLA monitor from creating duplicate issues every ~30 min
 * while the trailing 24 h availability window still contains a known,
 * resolved incident's outage period.
 *
 * Environment variable (shared with Premium dedup):
 *   PAPERCLIP_SLA_DEDUP_WINDOW_HOURS  — trailing window (default 24)
 */

import { and, asc, eq, gte, like, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { issues } from "@paperclipai/db";

// ---------------------------------------------------------------------------
// Pattern
// ---------------------------------------------------------------------------

/**
 * Regex that matches a StandardSLABreach issue title and captures the client
 * name. Example title:
 *   "[CRITICAL] StandardSLABreach: conn.praesyn.com"
 *
 * Group 1: severity label  (e.g. "CRITICAL")
 * Group 2: client name    (e.g. "conn.praesyn.com")
 */
const STANDARD_SLA_BREACH_RE =
  /^\[([^\]]+)\]\s*StandardSLABreach:\s*(.+)$/i;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Default trailing dedup window in hours. Override via env var
 * PAPERCLIP_SLA_DEDUP_WINDOW_HOURS (shared with Premium dedup).
 */
const DEFAULT_DEDUP_WINDOW_HOURS = 24;

function dedupWindowHours(): number {
  const raw = process.env.PAPERCLIP_SLA_DEDUP_WINDOW_HOURS;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_DEDUP_WINDOW_HOURS;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * Build a LIKE pattern that matches any issue title whose client portion
 * starts with the given client name.
 *
 * Example: for client "conn.praesyn.com" we match titles like
 *   "[CRITICAL] StandardSLABreach: conn.praesyn.com"
 *   "[WARNING] StandardSLABreach: conn.praesyn.com:3100"
 */
function clientLikePattern(client: string): string {
  const escaped = client.replace(/[%_]/g, "\\$&");
  return `[%] StandardSLABreach: ${escaped}%`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface StandardSLABreachMatch {
  /** ID of the existing tracking issue to link the duplicate to. */
  existingIssueId: string;
  /** Identifier of the existing issue (e.g. "PRA-690"). */
  existingIdentifier: string;
  /** Title of the existing issue. */
  existingTitle: string;
}

/**
 * Check whether a new issue matches the StandardSLABreach pattern and, if so,
 * whether a duplicate already exists within the dedup window.
 *
 * @returns The matching existing issue info, or null if no duplicate found.
 */
export async function checkStandardSLABreachDuplicate(
  db: Db,
  companyId: string,
  title: string,
  windowHours?: number,
): Promise<StandardSLABreachMatch | null> {
  const match = STANDARD_SLA_BREACH_RE.exec(title);
  if (!match) return null;

  const clientName = match[2].trim();
  if (!clientName) return null;

  const hours = windowHours ?? dedupWindowHours();
  const cutoff = sql`now() - interval '1 hour' * ${hours}`;

  // Look for an existing issue for the same company + client.
  // Prefer the earliest issue so new alerts get linked to the
  // original tracking incident, not to a later duplicate.
  const rows = await db
    .select({
      id: issues.id,
      identifier: issues.identifier,
      title: issues.title,
    })
    .from(issues)
    .where(
      and(
        eq(issues.companyId, companyId),
        like(issues.title, clientLikePattern(clientName)),
        gte(issues.createdAt, cutoff),
        sql`${issues.hiddenAt} is null`,
      ),
    )
    .orderBy(asc(issues.createdAt))
    .limit(1);

  const existing = rows[0];
  if (!existing) return null;

  return {
    existingIssueId: existing.id,
    existingIdentifier: existing.identifier ?? existing.id,
    existingTitle: existing.title ?? existing.identifier ?? existing.id ?? "",
  };
}