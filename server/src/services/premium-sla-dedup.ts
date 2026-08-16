/**
 * PremiumSLABreach duplicate suppression.
 *
 * When a PremiumSLABreach alert fires, this module checks if there is already
 * a recent issue for the same *client* within a configurable trailing window.
 * If a match is found, the new alert is linked as a child of the existing
 * tracking issue rather than creating a standalone critical issue.
 *
 * This prevents the SLA monitor from creating duplicate issues every ~30 min
 * while the trailing 24 h availability window still contains a known,
 * resolved incident's outage period.
 *
 * Environment variable:
 *   PAPERCLIP_SLA_DEDUP_WINDOW_HOURS  — trailing window (default 24)
 */

import { and, asc, eq, gte, like, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { issues } from "@paperclipai/db";

// ---------------------------------------------------------------------------
// Pattern
// ---------------------------------------------------------------------------

/**
 * Regex that matches a PremiumSLABreach issue title and captures the client
 * name. Example title:
 *   "[CRITICAL] PremiumSLABreach: paperclip.praesyn.int"
 *
 * Group 1: severity label  (e.g. "CRITICAL")
 * Group 2: client name    (e.g. "paperclip.praesyn.int")
 */
const PREMIUM_SLA_BREACH_RE =
  /^\[([^\]]+)\]\s*PremiumSLABreach:\s*(.+)$/i;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Default trailing dedup window in hours. Override via env var.
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
 * starts with the given client name. This allows for slight variations in
 * how the client name is presented (e.g. trailing dots, ports).
 *
 * Example: for client "paperclip.praesyn.int" we match titles like
 *   "[CRITICAL] PremiumSLABreach: paperclip.praesyn.int"
 *   "[WARNING] PremiumSLABreach: paperclip.praesyn.int:3101"
 */
function clientLikePattern(client: string): string {
  // Escape special LIKE characters (% _) then append wildcard
  const escaped = client.replace(/[%_]/g, "\\$&");
  return `[%] PremiumSLABreach: ${escaped}%`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PremiumSLABreachMatch {
  /** ID of the existing tracking issue to parent the new alert under. */
  existingIssueId: string;
  /** Identifier of the existing issue (e.g. "PRA-690"). */
  existingIdentifier: string;
  /** Title of the existing issue. */
  existingTitle: string;
}

/**
 * Check whether a new issue matches the PremiumSLABreach pattern and, if so,
 * whether a duplicate already exists within the dedup window.
 *
 * @returns The matching existing issue info, or null if no duplicate found.
 */
export async function checkPremiumSLABreachDuplicate(
  db: Db,
  companyId: string,
  title: string,
  windowHours?: number,
): Promise<PremiumSLABreachMatch | null> {
  const match = PREMIUM_SLA_BREACH_RE.exec(title);
  if (!match) return null;

  const clientName = match[2].trim();
  if (!clientName) return null;

  const hours = windowHours ?? dedupWindowHours();
  const cutoff = sql`now() - interval '1 hour' * ${hours}`;

  // Look for an existing issue for the same company + client.
  // We prefer the earliest issue so new alerts get parented to the
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
