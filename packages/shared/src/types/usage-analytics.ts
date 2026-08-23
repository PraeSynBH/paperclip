/** A single day's analytics data point */
export interface UsageAnalyticsDay {
  date: string;
  signups: number;
  activations: number;
  /** Companies that created at least one agent on this day */
  conversions: number;
  /** Active agents (any run activity) on this day */
  activeAgents: number;
}

/** Funnel summary for a date range */
export interface UsageAnalyticsFunnel {
  /** Total registered users in the period */
  totalSignups: number;
  /** Users who joined at least one company */
  totalActivations: number;
  /** Companies with at least one agent created */
  totalConvertedCompanies: number;
  /** Users active in the most recent window */
  activeUsers: number;
}

/** Overall snapshot metrics */
export interface UsageAnalyticsSnapshot {
  totalUsers: number;
  totalCompanies: number;
  totalAgents: number;
  totalActiveAgents: number;
  totalRuns: number;
  totalIssues: number;
}

/** Full analytics dashboard response */
export interface UsageAnalyticsResponse {
  /** Daily time series for the requested window */
  daily: UsageAnalyticsDay[];
  /** Funnel summary for the requested window */
  funnel: UsageAnalyticsFunnel;
  /** Point-in-time snapshot */
  snapshot: UsageAnalyticsSnapshot;
}

export type UsageAnalyticsWindow = "7d" | "30d" | "90d";
