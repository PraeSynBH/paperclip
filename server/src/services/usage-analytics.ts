import { gte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { authUsers, companies, companyMemberships, agents, heartbeatRuns, issues } from "@paperclipai/db";
import type { UsageAnalyticsDay, UsageAnalyticsFunnel, UsageAnalyticsResponse, UsageAnalyticsSnapshot, UsageAnalyticsWindow } from "@paperclipai/shared";

function getWindowStart(window: UsageAnalyticsWindow): Date {
  const now = new Date();
  switch (window) {
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "90d":
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  }
}

function formatUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getDateKeys(start: Date, end: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor <= end) {
    keys.push(formatUtcDateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

export function usageAnalyticsService(db: Db) {
  return {
    async report(window: UsageAnalyticsWindow): Promise<UsageAnalyticsResponse> {
      const now = new Date();
      const windowStart = getWindowStart(window);
      const dateKeys = getDateKeys(windowStart, now);

      // ── Daily signups: users created per day ──
      // authUsers.createdAt is a timestamptz, cast to date in UTC
      const signupRows = (await db.execute(sql`
        SELECT
          to_char(${authUsers.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
          count(*)::double precision AS count
        FROM ${authUsers}
        WHERE ${authUsers.createdAt} >= ${windowStart.toISOString()}::timestamptz
        GROUP BY date
        ORDER BY date
      `)) as unknown as Iterable<{ date: string; count: number | string }>;

      // ── Daily activations: company memberships created per day ──
      const activationRows = (await db.execute(sql`
        SELECT
          to_char(${companyMemberships.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
          count(*)::double precision AS count
        FROM ${companyMemberships}
        WHERE ${companyMemberships.createdAt} >= ${windowStart.toISOString()}::timestamptz
        GROUP BY date
        ORDER BY date
      `)) as unknown as Iterable<{ date: string; count: number | string }>;

      // ── Daily conversions: companies that created their first agent ──
      // Find the first agent creation date per company, then count by day
      const conversionRows = (await db.execute(sql`
        WITH first_agent AS (
          SELECT
            ${agents.companyId} AS company_id,
            min(${agents.createdAt}) AS first_agent_at
          FROM ${agents}
          WHERE ${agents.createdAt} >= ${windowStart.toISOString()}::timestamptz
          GROUP BY ${agents.companyId}
        )
        SELECT
          to_char(first_agent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
          count(*)::double precision AS count
        FROM first_agent
        GROUP BY date
        ORDER BY date
      `)) as unknown as Iterable<{ date: string; count: number | string }>;
      // ── Daily active agents: agents that had a heartbeat run on that day ──
      const activeAgentRows = (await db.execute(sql`
        SELECT
          to_char(${heartbeatRuns.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
          count(DISTINCT ${heartbeatRuns.agentId})::double precision AS count
        FROM ${heartbeatRuns}
        WHERE ${heartbeatRuns.createdAt} >= ${windowStart.toISOString()}::timestamptz
        GROUP BY date
        ORDER BY date
      `)) as unknown as Iterable<{ date: string; count: number | string }>;

      // Build lookup maps
      const signupMap = new Map<string, number>();
      for (const row of signupRows) signupMap.set(String(row.date), Number(row.count));

      const activationMap = new Map<string, number>();
      for (const row of activationRows) activationMap.set(String(row.date), Number(row.count));

      const conversionMap = new Map<string, number>();
      for (const row of conversionRows) conversionMap.set(String(row.date), Number(row.count));

      const retentionMap = new Map<string, number>();
      for (const row of activeAgentRows) retentionMap.set(String(row.date), Number(row.count));

      // Assemble daily series
      const daily: UsageAnalyticsDay[] = dateKeys.map((date) => ({
        date,
        signups: signupMap.get(date) ?? 0,
        activations: activationMap.get(date) ?? 0,
        conversions: conversionMap.get(date) ?? 0,
        activeAgents: retentionMap.get(date) ?? 0,
      }));

      // ── Funnel: cumulative totals for the window ──
      const funnelSignups = await db
        .select({ count: sql<number>`count(*)` })
        .from(authUsers)
        .where(gte(authUsers.createdAt, windowStart))
        .then((rows) => Number(rows[0]?.count ?? 0));

      // Unique users who joined any company in window
      const funnelActivations = await db
        .select({ count: sql<number>`count(DISTINCT ${companyMemberships.principalId})` })
        .from(companyMemberships)
        .where(gte(companyMemberships.createdAt, windowStart))
        .then((rows) => Number(rows[0]?.count ?? 0));

      // Companies that created at least one agent in window
      const funnelConversions = await db
        .select({ count: sql<number>`count(DISTINCT ${agents.companyId})` })
        .from(agents)
        .where(gte(agents.createdAt, windowStart))
        .then((rows) => Number(rows[0]?.count ?? 0));

      // Active agents in the last 7 days (retained)
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const activeUsers = await db
        .select({ count: sql<number>`count(DISTINCT ${heartbeatRuns.agentId})` })
        .from(heartbeatRuns)
        .where(gte(heartbeatRuns.createdAt, sevenDaysAgo))
        .then((rows) => Number(rows[0]?.count ?? 0));

      // ── Snapshot: point-in-time totals ──
      const [totalUsers] = await db
        .select({ count: sql<number>`count(*)` })
        .from(authUsers)
        .then((rows) => [Number(rows[0]?.count ?? 0)]);

      const [totalCompanies] = await db
        .select({ count: sql<number>`count(*)` })
        .from(companies)
        .then((rows) => [Number(rows[0]?.count ?? 0)]);

      const [totalAgents] = await db
        .select({ count: sql<number>`count(*)` })
        .from(agents)
        .then((rows) => [Number(rows[0]?.count ?? 0)]);

      const [totalActiveAgents] = await db
        .select({ count: sql<number>`count(*)` })
        .from(agents)
        .where(sql`${agents.status} IN ('idle', 'running')`)
        .then((rows) => [Number(rows[0]?.count ?? 0)]);

      const [totalRuns] = await db
        .select({ count: sql<number>`count(*)` })
        .from(heartbeatRuns)
        .then((rows) => [Number(rows[0]?.count ?? 0)]);

      const [totalIssues] = await db
        .select({ count: sql<number>`count(*)` })
        .from(issues)
        .then((rows) => [Number(rows[0]?.count ?? 0)]);

      return {
        daily,
        funnel: {
          totalSignups: funnelSignups,
          totalActivations: funnelActivations,
          totalConvertedCompanies: funnelConversions,
          activeUsers,
        },
        snapshot: {
          totalUsers,
          totalCompanies,
          totalAgents,
          totalActiveAgents,
          totalRuns,
          totalIssues,
        },
      };
    },
  };
}
