import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, Building2, Cpu, Hash, TrendingUp, Users, UserPlus, UserCheck, Activity } from "lucide-react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { usePageMeta } from "../hooks/usePageMeta";
import { usageAnalyticsApi } from "../api/usage-analytics";
import { MetricCard } from "../components/MetricCard";
import { ChartCard } from "../components/ActivityCharts";
import { PageSkeleton } from "../components/PageSkeleton";
import { Card } from "@/components/ui/card";
import type { UsageAnalyticsDay, UsageAnalyticsWindow } from "@paperclipai/shared";

const WINDOW_OPTIONS: { value: UsageAnalyticsWindow; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/* ── Stacked bar chart for daily time-series ── */

const BAR_COLORS = {
  signups: "var(--hex-3b82f6)",       // blue
  activations: "var(--hex-10b981)",    // green
  conversions: "var(--hex-f59e0b)",    // amber
  retained: "var(--hex-8b5cf6)",       // violet
} as const;

function barTooltip(entry: UsageAnalyticsDay): string {
  return [
    `${entry.date}`,
    `  Signups: ${entry.signups}`,
    `  Activations: ${entry.activations}`,
    `  Conversions: ${entry.conversions}`,
    `  Retained: ${entry.retained}`,
  ].join("\n");
}

function DailyBarChart({
  data,
  metric,
  color,
}: {
  data: UsageAnalyticsDay[];
  metric: keyof typeof BAR_COLORS;
  color: string;
}) {
  const maxValue = Math.max(...data.map((d) => d[metric]), 1);
  const hasData = data.some((d) => d[metric] > 0);
  const days = data.map((d) => d.date);

  if (!hasData) return <p className="text-xs text-muted-foreground">No data yet</p>;

  return (
    <div>
      <div className="flex items-end gap-(--sz-3px) h-20">
        {data.map((day) => {
          const value = day[metric] as number;
          const heightPct = (value / maxValue) * 100;
          return (
            <div
              key={day.date}
              className="flex-1 h-full flex flex-col justify-end"
              title={barTooltip(day)}
            >
              {value > 0 ? (
                <div
                  className="rounded-t-sm transition-all"
                  style={{ height: `${heightPct}%`, minHeight: 2, backgroundColor: color }}
                />
              ) : (
                <div className="bg-muted/30 rounded-sm" style={{ height: 2 }} />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-(--sz-3px) mt-1.5">
        {days.map((day, i) => (
          <div key={day} className="flex-1 text-center">
            {(i === 0 || i === Math.floor(days.length / 2) || i === days.length - 1) ? (
              <span className="text-(length:--text-nano) text-muted-foreground tabular-nums">
                {formatDayLabel(day)}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Funnel visualization ── */

function FunnelBar({ value, max, label, color }: { value: number; max: number; label: string; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 text-xs text-muted-foreground text-right shrink-0">{label}</span>
      <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-16 text-xs font-medium tabular-nums text-right shrink-0">{formatNumber(value)}</span>
    </div>
  );
}

/* ── Main page ── */

export function UsageAnalytics() {
  usePageMeta("Usage Analytics", "Internal usage analytics dashboard for product metrics.");
  const { setBreadcrumbs } = useBreadcrumbs();
  const [window, setWindow] = useState<UsageAnalyticsWindow>("30d");

  useEffect(() => {
    setBreadcrumbs([
      { label: "Settings", href: "/company/settings" },
      { label: "Usage Analytics" },
    ]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["usage-analytics", window],
    queryFn: () => usageAnalyticsApi.report(window),
  });

  if (isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal text-foreground">Usage Analytics</h1>
            <p className="mt-1 text-sm text-muted-foreground">Internal product metrics dashboard</p>
          </div>
        </div>
        <Card className="p-6">
          <p className="text-sm text-destructive">Failed to load analytics: {error.message}</p>
        </Card>
      </div>
    );
  }

  const { daily, funnel, snapshot } = data!;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-foreground">Usage Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">Internal product metrics dashboard</p>
        </div>
        <div className="flex items-center gap-2">
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setWindow(opt.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                window === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Snapshot metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-1 sm:gap-2">
        <MetricCard
          icon={Users}
          value={formatNumber(snapshot.totalUsers)}
          label="Total Users"
        />
        <MetricCard
          icon={Building2}
          value={formatNumber(snapshot.totalCompanies)}
          label="Total Companies"
        />
        <MetricCard
          icon={Cpu}
          value={formatNumber(snapshot.totalAgents)}
          label="Total Agents"
        />
        <MetricCard
          icon={Activity}
          value={formatNumber(snapshot.totalActiveAgents)}
          label="Active Agents"
        />
        <MetricCard
          icon={Hash}
          value={formatNumber(snapshot.totalRuns)}
          label="Total Runs"
        />
        <MetricCard
          icon={BarChart3}
          value={formatNumber(snapshot.totalIssues)}
          label="Total Issues"
        />
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Signups" subtitle={`Per day — last ${window}`}>
          <DailyBarChart data={daily} metric="signups" color={BAR_COLORS.signups} />
        </ChartCard>
        <ChartCard title="Activations" subtitle={`Per day — last ${window}`}>
          <DailyBarChart data={daily} metric="activations" color={BAR_COLORS.activations} />
        </ChartCard>
        <ChartCard title="Conversions" subtitle={`Companies w/ first agent — last ${window}`}>
          <DailyBarChart data={daily} metric="conversions" color={BAR_COLORS.conversions} />
        </ChartCard>
        <ChartCard title="Retention" subtitle={`Active agents per day — last ${window}`}>
          <DailyBarChart data={daily} metric="retained" color={BAR_COLORS.retained} />
        </ChartCard>
      </div>

      {/* Funnel section */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">Funnel</h3>
        <div className="space-y-3 max-w-lg">
          <FunnelBar
            value={funnel.totalSignups}
            max={funnel.totalSignups}
            label="Signups"
            color={BAR_COLORS.signups}
          />
          <FunnelBar
            value={funnel.totalActivations}
            max={funnel.totalSignups}
            label="Activated"
            color={BAR_COLORS.activations}
          />
          <FunnelBar
            value={funnel.totalConvertedCompanies}
            max={funnel.totalSignups}
            label="Converted"
            color={BAR_COLORS.conversions}
          />
          <FunnelBar
            value={funnel.activeUsers}
            max={funnel.totalSignups}
            label="Active (7d)"
            color={BAR_COLORS.retained}
          />
        </div>
      </Card>
    </div>
  );
}
